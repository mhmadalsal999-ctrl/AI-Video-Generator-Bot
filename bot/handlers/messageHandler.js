/**
 * messageHandler.js
 * Handles all text messages — step-by-step series creation flow
 *
 * Flow:
 *  IDLE
 *  → [button] → genre keyboard (inline, in callbackHandler)
 *  → NEW_SERIES_TITLE   : user types series name
 *  → NEW_SERIES_DESC    : user types description (or "تخطي")
 *  → [auto] generate scenario → show results + action buttons
 */

import {
  getUserState, setUserState,
  createSeries, getUserSeries,
  getYouTubeChannel, saveYouTubeChannel,
  createEpisode
} from '../../db/database.js';
import {
  mainKeyboard, cancelKeyboard,
  scenarioActionsKeyboard,
  WELCOME_MSG, HELP_MSG
} from '../messages.js';
import { generateSeriesScenario } from '../../services/groqService.js';
import { verifyYouTubeCredentials } from '../../services/youtubeService.js';
import { logger } from '../../utils/logger.js';

// ── State constants (single source of truth) ─────────────────────
export const STATES = {
  IDLE:             'idle',
  NEW_SERIES_TITLE: 'new_series_title',
  NEW_SERIES_DESC:  'new_series_desc',
  YT_CLIENT_ID:     'yt_client_id',
  YT_CLIENT_SECRET: 'yt_client_secret',
  YT_REFRESH_TOKEN: 'yt_refresh_token'
};

// ── Genre display names ──────────────────────────────────────────
const GENRE_LABELS = {
  horror: '👻 رعب', action: '⚔️ أكشن', romance: '💕 رومانسي',
  comedy: '😄 كوميدي', fantasy: '🧙 خيال وسحر', scifi: '🚀 خيال علمي',
  thriller: '🔥 إثارة', drama: '💔 دراما'
};

// ════════════════════════════════════════════════════════════════
export async function handleMessage(bot, msg) {
  if (!msg.text) return;

  const chatId  = msg.chat.id;
  const userId  = msg.from.id.toString();
  const text    = msg.text.trim();

  logger.bot(`Msg from ${userId}: "${text.substring(0, 50)}"`);

  const stateData = await getUserState(userId);
  const state     = stateData?.state    || STATES.IDLE;
  const tempData  = stateData?.temp_data || {};

  // ── Global commands (work in any state) ──────────────────────

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
    return bot.sendMessage(chatId, '✅ تم الإلغاء. العودة للقائمة الرئيسية.', mainKeyboard());
  }

  // ── Main menu buttons ─────────────────────────────────────────

  if (text === '🎬 إنشاء مسلسل جديد') {
    await setUserState(userId, STATES.IDLE, {});
    const { genreKeyboard } = await import('../messages.js');
    return bot.sendMessage(
      chatId,
      '🎭 *الخطوة 1 من 4 — اختر نوع المسلسل:*\n\nاختر النوع المناسب لمسلسلك:',
      { parse_mode: 'Markdown', ...genreKeyboard() }
    );
  }

  if (text === '📺 مسلسلاتي') {
    const series = await getUserSeries(userId);
    if (!series.length) {
      return bot.sendMessage(
        chatId,
        '📭 *لا توجد مسلسلات بعد!*\n\nاضغط "🎬 إنشاء مسلسل جديد" للبدء.',
        { parse_mode: 'Markdown', ...mainKeyboard() }
      );
    }
    const { seriesListKeyboard } = await import('../messages.js');
    const list = series.map((s, i) => {
      const statusEmoji = s.status === 'active' ? '🟢' : s.status === 'completed' ? '✅' : '🔴';
      return `${statusEmoji} *${i + 1}. ${s.title}*\n   ${GENRE_LABELS[s.genre] || s.genre} | الحلقة ${s.current_episode}/${s.total_episodes}`;
    }).join('\n\n');
    return bot.sendMessage(
      chatId,
      `📺 *مسلسلاتك (${series.length}):*\n\n${list}\n\nاختر مسلسلاً للتفاصيل:`,
      { parse_mode: 'Markdown', ...seriesListKeyboard(series) }
    );
  }

  if (text === '📊 الإحصائيات') {
    const series = await getUserSeries(userId);
    const totalEps = series.reduce((a, s) => a + (s.current_episode || 0), 0);
    const active   = series.filter(s => s.status === 'active').length;
    const done     = series.filter(s => s.status === 'completed').length;
    return bot.sendMessage(
      chatId,
      `📊 *إحصائياتك:*\n\n` +
      `🎭 المسلسلات النشطة: *${active}*\n` +
      `✅ المكتملة: *${done}*\n` +
      `🎬 الحلقات المنشورة: *${totalEps}*\n` +
      `⏰ النشر التلقائي: يومياً 10:00 UTC`,
      { parse_mode: 'Markdown', ...mainKeyboard() }
    );
  }

  // ── State machine ─────────────────────────────────────────────

  switch (state) {

    // ── Step 2: Get title ───────────────────────────────────────
    case STATES.NEW_SERIES_TITLE: {
      if (text.length < 2) {
        return bot.sendMessage(
          chatId,
          '⚠️ الاسم قصير جداً! أدخل اسماً مكوناً من حرفين على الأقل.',
          cancelKeyboard()
        );
      }
      if (text.length > 80) {
        return bot.sendMessage(
          chatId,
          '⚠️ الاسم طويل جداً! الحد الأقصى 80 حرفاً.',
          cancelKeyboard()
        );
      }

      const updated = { ...tempData, title: text };
      await setUserState(userId, STATES.NEW_SERIES_DESC, updated);

      return bot.sendMessage(
        chatId,
        `✅ *اسم المسلسل:* "${text}"\n\n` +
        `📝 *الخطوة 4 من 4 — أضف وصفاً للمسلسل:*\n\n` +
        `اكتب وصفاً مختصراً يساعد الذكاء الاصطناعي على فهم فكرة المسلسل.\n\n` +
        `_(أرسل* "تخطي" *إذا أردت الاعتماد على الذكاء الاصطناعي بالكامل)_`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }

    // ── Step 4: Get description → generate scenario ─────────────
    case STATES.NEW_SERIES_DESC: {
      const description = (text === 'تخطي' || text === 'skip') ? '' : text;
      const finalData   = { ...tempData, description };

      // Reset state immediately to prevent double-trigger
      await setUserState(userId, STATES.IDLE, {});

      // Show loading message
      const loadingMsg = await bot.sendMessage(
        chatId,
        `⏳ *جاري توليد السيناريو الكامل...*\n\n` +
        `📺 *المسلسل:* ${finalData.title}\n` +
        `🎭 *النوع:* ${GENRE_LABELS[finalData.genre] || finalData.genre}\n` +
        `📋 *الحلقات:* ${finalData.total_episodes}\n\n` +
        `🤖 Groq AI يكتب الشخصيات والقصة... _(30-60 ثانية)_`,
        { parse_mode: 'Markdown' }
      );

      try {
        // Generate scenario
        const scenario = await generateSeriesScenario(
          finalData.title,
          finalData.genre,
          description,
          finalData.total_episodes || 10,
          finalData.language || 'ar'
        );

        // Save series to DB
        const series = await createSeries(userId, {
          title:          finalData.title,
          genre:          finalData.genre,
          description,
          characters:     scenario.characters || [],
          full_scenario:  JSON.stringify(scenario),
          total_episodes: finalData.total_episodes || 10,
          voice_id:       null,
          language:       finalData.language || 'ar'
        });

        // Save all episodes
        for (const ep of (scenario.episodes || [])) {
          await createEpisode(
            series.id,
            userId,
            ep.number,
            ep.scene || ep.summary || '',
            ep.title || `الحلقة ${ep.number}`
          );
        }

        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

        // Build character list
        const charList = (scenario.characters || [])
          .map(c => `👤 *${c.name}* — ${c.personality || c.role || ''}`)
          .join('\n');

        // Build episodes preview (first 3)
        const epsPreview = (scenario.episodes || []).slice(0, 3)
          .map(e => `  ${e.number}. ${e.title}`)
          .join('\n');
        const moreEps = (scenario.episodes?.length || 0) > 3
          ? `\n  _... و${(scenario.episodes?.length || 0) - 3} حلقات أخرى_`
          : '';

        await bot.sendMessage(
          chatId,
          `🎉 *تم توليد السيناريو بنجاح!*\n` +
          `${'─'.repeat(28)}\n\n` +
          `📺 *${series.title}*\n` +
          `🎭 ${GENRE_LABELS[finalData.genre] || finalData.genre}  •  ` +
          `📋 ${series.total_episodes} حلقة\n\n` +
          `👥 *الشخصيات:*\n${charList}\n\n` +
          `📖 *ملخص القصة:*\n${scenario.story_summary || ''}\n\n` +
          `🎬 *أول الحلقات:*\n${epsPreview}${moreEps}\n\n` +
          `${'─'.repeat(28)}\n` +
          `✨ اختر ما تريد فعله الآن 👇`,
          { parse_mode: 'Markdown', ...scenarioActionsKeyboard(series.id) }
        );

      } catch (err) {
        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
        logger.error('BOT', `Scenario generation failed: ${err.message}`);
        await bot.sendMessage(
          chatId,
          `❌ *فشل في توليد السيناريو*\n\n${err.message}\n\nحاول مرة أخرى.`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      }
      return;
    }

    // ── YouTube setup (3 steps) ──────────────────────────────────
    case STATES.YT_CLIENT_ID: {
      if (!text) return bot.sendMessage(chatId, '⚠️ يرجى إدخال Client ID.', cancelKeyboard());
      await setUserState(userId, STATES.YT_CLIENT_SECRET, { ...tempData, yt_client_id: text });
      return bot.sendMessage(
        chatId,
        `⚙️ *ربط يوتيوب (2/3)*\n\n🔐 الآن أدخل *Client Secret:*`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }

    case STATES.YT_CLIENT_SECRET: {
      if (!text) return bot.sendMessage(chatId, '⚠️ يرجى إدخال Client Secret.', cancelKeyboard());
      await setUserState(userId, STATES.YT_REFRESH_TOKEN, { ...tempData, yt_client_secret: text });
      return bot.sendMessage(
        chatId,
        `⚙️ *ربط يوتيوب (3/3)*\n\n🔄 أدخل *Refresh Token:*`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }

    case STATES.YT_REFRESH_TOKEN: {
      if (!text) return bot.sendMessage(chatId, '⚠️ يرجى إدخال Refresh Token.', cancelKeyboard());

      const verifyMsg = await bot.sendMessage(chatId, '🔍 جاري التحقق من بيانات القناة...');
      const result = await verifyYouTubeCredentials(
        tempData.yt_client_id, tempData.yt_client_secret, text
      );

      await bot.deleteMessage(chatId, verifyMsg.message_id).catch(() => {});
      await setUserState(userId, STATES.IDLE, {});

      if (result.valid) {
        await saveYouTubeChannel(
          userId, tempData.yt_client_id, tempData.yt_client_secret,
          text, result.channelId, result.channelTitle
        );
        return bot.sendMessage(
          chatId,
          `✅ *تم ربط قناة يوتيوب بنجاح!*\n\n📺 القناة: *${result.channelTitle}*\n\nالآن يمكنك نشر الحلقات مباشرة على قناتك.`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      } else {
        return bot.sendMessage(
          chatId,
          `❌ *فشل التحقق:*\n${result.error}\n\nتحقق من البيانات وحاول مرة أخرى.`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      }
    }

    default:
      return bot.sendMessage(chatId, '👋 اختر من القائمة أدناه:', mainKeyboard());
  }
}
