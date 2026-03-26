import {
  getUserState, setUserState, getTempData, updateTempData,
  createSeries, getUserSeries, getSeriesById,
  getYouTubeChannel, saveYouTubeChannel,
  createEpisode, getSeriesEpisodes
} from '../../db/database.js';
import {
  mainKeyboard, cancelKeyboard, genreKeyboard, episodesCountKeyboard,
  languageKeyboard, voiceKeyboard, seriesListKeyboard,
  seriesActionsKeyboard, youtubeSetupKeyboard,
  WELCOME_MSG, HELP_MSG, newSeriesMsg
} from '../messages.js';
import { generateSeriesScenario } from '../../services/groqService.js';
import { FREE_VOICES } from '../../services/elevenLabsService.js';
import { verifyYouTubeCredentials } from '../../services/youtubeService.js';
import { triggerManualPublish } from '../../services/cronScheduler.js';
import { logger } from '../../utils/logger.js';

const STATES = {
  IDLE: 'idle',
  NEW_SERIES_TITLE: 'new_series_title',
  NEW_SERIES_DESC: 'new_series_desc',
  YT_CLIENT_ID: 'yt_client_id',
  YT_CLIENT_SECRET: 'yt_client_secret',
  YT_REFRESH_TOKEN: 'yt_refresh_token'
};

export async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text = msg.text || '';

  logger.bot(`Message from ${userId}: ${text.substring(0, 50)}`);

  const stateData = await getUserState(userId);
  const state = stateData?.state || STATES.IDLE;
  const tempData = stateData?.temp_data || {};

  // ── COMMANDS ──
  if (text === '/start' || text === '🏠 الرئيسية') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, WELCOME_MSG, { ...mainKeyboard(), parse_mode: 'Markdown' });
  }

  if (text === '❓ مساعدة') {
    return bot.sendMessage(chatId, HELP_MSG, { parse_mode: 'Markdown', ...mainKeyboard() });
  }

  if (text === '❌ إلغاء') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, '✅ تم الإلغاء.', mainKeyboard());
  }

  // ── MAIN MENU BUTTONS ──
  if (text === '🎬 إنشاء مسلسل جديد') {
    await setUserState(userId, STATES.IDLE, {});
    await bot.sendMessage(chatId, '🎭 *اختر نوع المسلسل:*', {
      parse_mode: 'Markdown',
      ...genreKeyboard()
    });
    return;
  }

  if (text === '📺 مسلسلاتي') {
    const series = await getUserSeries(userId);
    if (series.length === 0) {
      return bot.sendMessage(chatId, '📭 لا توجد مسلسلات بعد.\n\nاضغط "🎬 إنشاء مسلسل جديد" للبدء!', mainKeyboard());
    }
    const msg2 = series.map((s, i) =>
      `${i + 1}. *${s.title}*\n   📁 ${s.genre} | الحلقة ${s.current_episode}/${s.total_episodes}`
    ).join('\n\n');
    return bot.sendMessage(chatId, `📺 *مسلسلاتك:*\n\n${msg2}\n\nاختر مسلسلاً:`, {
      parse_mode: 'Markdown',
      ...seriesListKeyboard(series)
    });
  }

  if (text === '▶️ نشر حلقة الآن') {
    const series = await getUserSeries(userId);
    if (series.length === 0) {
      return bot.sendMessage(chatId, '❌ لا توجد مسلسلات نشطة.\n\nأنشئ مسلسلاً أولاً!', mainKeyboard());
    }
    return bot.sendMessage(chatId, '🎬 *اختر المسلسل للنشر الفوري:*', {
      parse_mode: 'Markdown',
      ...seriesListKeyboard(series.map(s => ({ ...s, _action: 'publish_now' })))
    });
  }

  if (text === '📊 الإحصائيات') {
    const series = await getUserSeries(userId);
    const totalEps = series.reduce((a, s) => a + s.current_episode, 0);
    const msg2 = `📊 *إحصائياتك:*\n\n🎭 المسلسلات: ${series.length}\n🎬 الحلقات المنشورة: ${totalEps}\n📅 النشر التلقائي: يومياً الساعة 1 ظهراً`;
    return bot.sendMessage(chatId, msg2, { parse_mode: 'Markdown', ...mainKeyboard() });
  }

  if (text === '⚙️ إعدادات يوتيوب') {
    const channel = await getYouTubeChannel(userId);
    if (channel) {
      return bot.sendMessage(chatId,
        `⚙️ *إعدادات يوتيوب*\n\n✅ القناة متصلة: *${channel.channel_title || 'قناتك'}*\n\nهل تريد تغيير الإعدادات؟`,
        { parse_mode: 'Markdown', ...youtubeSetupKeyboard() }
      );
    }
    return bot.sendMessage(chatId,
      `⚙️ *إعداد قناة يوتيوب*\n\nاضغط على الزر أدناه لبدء الإعداد:`,
      { parse_mode: 'Markdown', ...youtubeSetupKeyboard() }
    );
  }

  // ── STATE MACHINE ──
  switch (state) {
    case STATES.NEW_SERIES_TITLE: {
      if (!text.trim()) return bot.sendMessage(chatId, '⚠️ يرجى إدخال اسم المسلسل.', cancelKeyboard());
      await updateTempData(userId, { title: text.trim() });
      await setUserState(userId, STATES.NEW_SERIES_DESC, { ...tempData, title: text.trim() });
      return bot.sendMessage(chatId,
        `${newSeriesMsg(2, 5)}✍️ *أدخل وصفاً مختصراً للمسلسل:*\n_(اختياري - يمكنك إرسال "تخطي")_`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }

    case STATES.NEW_SERIES_DESC: {
      const description = text === 'تخطي' ? '' : text.trim();
      const updatedTemp = { ...tempData, description };
      await setUserState(userId, STATES.IDLE, updatedTemp);

      const loadingMsg = await bot.sendMessage(chatId,
        `⏳ *جاري توليد السيناريو الكامل...*\n\nهذا قد يستغرق 30-60 ثانية.`,
        { parse_mode: 'Markdown' }
      );

      try {
        const scenario = await generateSeriesScenario(
          updatedTemp.title,
          updatedTemp.genre,
          description,
          updatedTemp.total_episodes,
          updatedTemp.language
        );

        // Create series in DB
        const series = await createSeries(userId, {
          title: updatedTemp.title,
          genre: updatedTemp.genre,
          description,
          characters: scenario.characters,
          full_scenario: JSON.stringify(scenario),
          total_episodes: updatedTemp.total_episodes,
          voice_id: updatedTemp.voice_id !== 'default' ? updatedTemp.voice_id : null,
          language: updatedTemp.language
        });

        // Create all episodes
        for (const ep of scenario.episodes) {
          await createEpisode(series.id, userId, ep.number, ep.scene || ep.summary, ep.title);
        }

        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

        const charNames = scenario.characters.map(c => `• *${c.name}* - ${c.personality}`).join('\n');

        // ✅ زر معاينة الحلقة الأولى + زر النشر
        await bot.sendMessage(chatId,
          `✅ *تم إنشاء المسلسل بنجاح!*\n\n` +
          `📺 *${series.title}*\n` +
          `🎭 النوع: ${updatedTemp.genre}\n` +
          `📋 عدد الحلقات: ${series.total_episodes}\n\n` +
          `👥 *الشخصيات:*\n${charNames}\n\n` +
          `📖 *ملخص القصة:*\n${scenario.story_summary}\n\n` +
          `👇 *اختر ما تريد فعله الآن:*`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '👁️ معاينة الحلقة الأولى', callback_data: `preview_ep:${series.id}:1` }
                ],
                [
                  { text: '▶️ نشر الحلقة الأولى على يوتيوب', callback_data: `publish_now:${series.id}` }
                ],
                [
                  { text: '⏰ اترك النشر التلقائي يومياً', callback_data: `back:main` }
                ]
              ]
            }
          }
        );

        await setUserState(userId, STATES.IDLE, {});
      } catch (err) {
        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
        logger.error('BOT', `Series creation failed: ${err.message}`);
        await bot.sendMessage(chatId, `❌ فشل في توليد السيناريو:\n${err.message}\n\nحاول مرة أخرى.`, mainKeyboard());
        await setUserState(userId, STATES.IDLE, {});
      }
      return;
    }

    // YouTube setup states
    case STATES.YT_CLIENT_ID: {
      if (!text.trim()) return bot.sendMessage(chatId, '⚠️ يرجى إدخال Client ID.', cancelKeyboard());
      await setUserState(userId, STATES.YT_CLIENT_SECRET, { ...tempData, yt_client_id: text.trim() });
      return bot.sendMessage(chatId,
        `⚙️ *إعداد يوتيوب (2/3)*\n\n🔐 أدخل *Client Secret:*`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }

    case STATES.YT_CLIENT_SECRET: {
      if (!text.trim()) return bot.sendMessage(chatId, '⚠️ يرجى إدخال Client Secret.', cancelKeyboard());
      await setUserState(userId, STATES.YT_REFRESH_TOKEN, { ...tempData, yt_client_secret: text.trim() });
      return bot.sendMessage(chatId,
        `⚙️ *إعداد يوتيوب (3/3)*\n\n🔄 أدخل *Refresh Token:*`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }

    case STATES.YT_REFRESH_TOKEN: {
      if (!text.trim()) return bot.sendMessage(chatId, '⚠️ يرجى إدخال Refresh Token.', cancelKeyboard());

      const verifyMsg = await bot.sendMessage(chatId, '🔍 جاري التحقق من بيانات القناة...');

      const result = await verifyYouTubeCredentials(
        tempData.yt_client_id,
        tempData.yt_client_secret,
        text.trim()
      );

      await bot.deleteMessage(chatId, verifyMsg.message_id).catch(() => {});

      if (result.valid) {
        await saveYouTubeChannel(userId, tempData.yt_client_id, tempData.yt_client_secret, text.trim(), result.channelId, result.channelTitle);
        await setUserState(userId, STATES.IDLE, {});
        return bot.sendMessage(chatId,
          `✅ *تم ربط قناة يوتيوب بنجاح!*\n\n📺 القناة: *${result.channelTitle}*`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      } else {
        await setUserState(userId, STATES.IDLE, {});
        return bot.sendMessage(chatId,
          `❌ *فشل التحقق:*\n${result.error}`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      }
    }

    default:
      return bot.sendMessage(chatId, '👋 استخدم الأزرار أدناه:', mainKeyboard());
  }
}
