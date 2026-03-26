import {
  getUserState, setUserState, getTempData, updateTempData,
  createSeries, getUserSeries, getSeriesById,
  getYouTubeChannel, saveYouTubeChannel,
  createEpisode, getSeriesEpisodes
} from '../../db/database.js';
import {
  mainKeyboard, cancelKeyboard, genreKeyboard, episodesCountKeyboard,
  languageKeyboard, voiceKeyboard, seriesListKeyboard,
  youtubeSetupKeyboard, WELCOME_MSG, HELP_MSG, newSeriesMsg
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
  const text = msg.text?.trim() || '';

  logger.bot(`Msg from ${userId}: "${text.substring(0, 40)}"`);

  // تحميل الحالة
  const stateData = await getUserState(userId);
  const state = stateData?.state || STATES.IDLE;
  const tempData = stateData?.temp_data || {};

  // ── أوامر عامة تعمل في أي حالة ──
  if (text === '/start') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, WELCOME_MSG, {
      parse_mode: 'Markdown',
      ...mainKeyboard()
    });
  }

  if (text === '/help' || text === '❓ مساعدة') {
    return bot.sendMessage(chatId, HELP_MSG, {
      parse_mode: 'Markdown',
      ...mainKeyboard()
    });
  }

  if (text === '/cancel' || text === '❌ إلغاء') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, '✅ تم الإلغاء.', mainKeyboard());
  }

  // ── أزرار القائمة الرئيسية ──
  if (text === '🎬 إنشاء مسلسل جديد') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, '🎭 *اختر نوع المسلسل:*', {
      parse_mode: 'Markdown',
      ...genreKeyboard()
    });
  }

  if (text === '📺 مسلسلاتي') {
    const series = await getUserSeries(userId);
    if (!series.length) {
      return bot.sendMessage(chatId,
        '📭 لا توجد مسلسلات بعد.\n\nاضغط "🎬 إنشاء مسلسل جديد" للبدء!',
        mainKeyboard()
      );
    }
    const list = series.map((s, i) =>
      `${i + 1}. *${s.title}*\n   ${s.genre} | الحلقة ${s.current_episode}/${s.total_episodes}`
    ).join('\n\n');
    return bot.sendMessage(chatId, `📺 *مسلسلاتك:*\n\n${list}\n\nاختر مسلسلاً:`, {
      parse_mode: 'Markdown',
      ...seriesListKeyboard(series)
    });
  }

  if (text === '▶️ نشر حلقة الآن') {
    const series = await getUserSeries(userId);
    if (!series.length) {
      return bot.sendMessage(chatId, '❌ لا توجد مسلسلات نشطة. أنشئ مسلسلاً أولاً!', mainKeyboard());
    }
    return bot.sendMessage(chatId, '🎬 *اختر المسلسل للنشر الفوري:*', {
      parse_mode: 'Markdown',
      ...seriesListKeyboard(series)
    });
  }

  if (text === '📊 الإحصائيات') {
    const series = await getUserSeries(userId);
    const totalEps = series.reduce((a, s) => a + (s.current_episode || 0), 0);
    return bot.sendMessage(chatId,
      `📊 *إحصائياتك:*\n\n🎭 المسلسلات النشطة: ${series.length}\n🎬 الحلقات المنشورة: ${totalEps}\n⏰ النشر التلقائي: يومياً الساعة 1 ظهراً`,
      { parse_mode: 'Markdown', ...mainKeyboard() }
    );
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
      `⚙️ *إعداد قناة يوتيوب*\n\nاضغط الزر أدناه للبدء:`,
      { parse_mode: 'Markdown', ...youtubeSetupKeyboard() }
    );
  }

  // ── State Machine ──
  switch (state) {

    case STATES.NEW_SERIES_TITLE: {
      if (!text) return bot.sendMessage(chatId, '⚠️ يرجى إدخال اسم المسلسل.', cancelKeyboard());
      const updated = { ...tempData, title: text };
      await setUserState(userId, STATES.NEW_SERIES_DESC, updated);
      return bot.sendMessage(chatId,
        `${newSeriesMsg(2, 5)}✍️ *أدخل وصفاً مختصراً للمسلسل:*\n\n_(اختياري - أرسل "تخطي" للمتابعة)_`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }

    case STATES.NEW_SERIES_DESC: {
      const description = (text === 'تخطي' || text === 'skip') ? '' : text;
      const finalData = { ...tempData, description };

      // إعادة الحالة للـ idle قبل التوليد لمنع التكرار
      await setUserState(userId, STATES.IDLE, {});

      const loadingMsg = await bot.sendMessage(chatId,
        `⏳ *جاري توليد السيناريو الكامل...*\n\n📝 المسلسل: ${finalData.title}\n🎭 النوع: ${finalData.genre}\n📋 الحلقات: ${finalData.total_episodes}\n\nهذا يستغرق 30-60 ثانية...`,
        { parse_mode: 'Markdown' }
      );

      try {
        const scenario = await generateSeriesScenario(
          finalData.title,
          finalData.genre,
          description,
          finalData.total_episodes || 10,
          finalData.language || 'ar'
        );

        // إنشاء المسلسل في قاعدة البيانات
        const series = await createSeries(userId, {
          title: finalData.title,
          genre: finalData.genre,
          description,
          characters: scenario.characters || [],
          full_scenario: JSON.stringify(scenario),
          total_episodes: finalData.total_episodes || 10,
          voice_id: finalData.voice_id && finalData.voice_id !== 'default' ? finalData.voice_id : null,
          language: finalData.language || 'ar'
        });

        // إنشاء كل الحلقات
        for (const ep of (scenario.episodes || [])) {
          await createEpisode(
            series.id, userId,
            ep.number,
            ep.scene || ep.summary || '',
            ep.title || `الحلقة ${ep.number}`
          );
        }

        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

        const charList = (scenario.characters || [])
          .map(c => `• *${c.name}* — ${c.personality}`)
          .join('\n');

        await bot.sendMessage(chatId,
          `✅ *تم إنشاء المسلسل بنجاح!*\n\n` +
          `📺 *${series.title}*\n` +
          `🎭 النوع: ${finalData.genre}\n` +
          `📋 الحلقات: ${series.total_episodes}\n\n` +
          `👥 *الشخصيات:*\n${charList}\n\n` +
          `📖 *ملخص القصة:*\n${scenario.story_summary || ''}\n\n` +
          `⏰ سيتم نشر حلقة يومياً تلقائياً!\n` +
          `أو اضغط *"▶️ نشر حلقة الآن"* للنشر الفوري.`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      } catch (err) {
        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
        logger.error('BOT', `Series creation failed: ${err.message}`);
        await bot.sendMessage(chatId,
          `❌ *فشل في توليد السيناريو*\n\n${err.message}\n\nحاول مرة أخرى.`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      }
      return;
    }

    case STATES.YT_CLIENT_ID: {
      if (!text) return bot.sendMessage(chatId, '⚠️ يرجى إدخال Client ID.', cancelKeyboard());
      await setUserState(userId, STATES.YT_CLIENT_SECRET, { ...tempData, yt_client_id: text });
      return bot.sendMessage(chatId,
        `⚙️ *إعداد يوتيوب (2/3)*\n\n🔐 أدخل *Client Secret:*`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }

    case STATES.YT_CLIENT_SECRET: {
      if (!text) return bot.sendMessage(chatId, '⚠️ يرجى إدخال Client Secret.', cancelKeyboard());
      await setUserState(userId, STATES.YT_REFRESH_TOKEN, { ...tempData, yt_client_secret: text });
      return bot.sendMessage(chatId,
        `⚙️ *إعداد يوتيوب (3/3)*\n\n🔄 أدخل *Refresh Token:*`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }

    case STATES.YT_REFRESH_TOKEN: {
      if (!text) return bot.sendMessage(chatId, '⚠️ يرجى إدخال Refresh Token.', cancelKeyboard());

      const verifyMsg = await bot.sendMessage(chatId, '🔍 جاري التحقق من بيانات القناة...');

      const result = await verifyYouTubeCredentials(
        tempData.yt_client_id,
        tempData.yt_client_secret,
        text
      );

      await bot.deleteMessage(chatId, verifyMsg.message_id).catch(() => {});
      await setUserState(userId, STATES.IDLE, {});

      if (result.valid) {
        await saveYouTubeChannel(
          userId,
          tempData.yt_client_id,
          tempData.yt_client_secret,
          text,
          result.channelId,
          result.channelTitle
        );
        return bot.sendMessage(chatId,
          `✅ *تم ربط قناة يوتيوب بنجاح!*\n\n📺 القناة: *${result.channelTitle}*`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      } else {
        return bot.sendMessage(chatId,
          `❌ *فشل التحقق:*\n${result.error}\n\nتحقق من البيانات وحاول مرة أخرى.`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      }
    }

    default:
      return bot.sendMessage(chatId, '👋 اختر من الأزرار أدناه:', mainKeyboard());
  }
}
