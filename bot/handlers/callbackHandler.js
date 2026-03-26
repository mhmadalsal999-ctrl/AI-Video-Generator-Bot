/**
 * callbackHandler.js
 * Handles all inline keyboard button presses
 */

import {
  getUserState, setUserState,
  getUserSeries, getSeriesById, updateSeries,
  getSeriesEpisodes, getEpisode,
  getYouTubeChannel, updateEpisode
} from '../../db/database.js';
import {
  mainKeyboard, cancelKeyboard,
  genreKeyboard, episodesCountKeyboard, languageKeyboard, voiceKeyboard,
  seriesListKeyboard, seriesActionsKeyboard, episodeActionsKeyboard,
  scenarioActionsKeyboard, confirmKeyboard, youtubeSetupKeyboard, stepHeader
} from '../messages.js';
import { FREE_VOICES } from '../../services/elevenLabsService.js';
import { triggerManualPublish } from '../../services/cronScheduler.js';
import { generateEpisodeVideo } from '../../services/videoPipeline.js';
import { logger } from '../../utils/logger.js';

const STATES = {
  IDLE:             'idle',
  NEW_SERIES_TITLE: 'new_series_title',
  NEW_SERIES_DESC:  'new_series_desc',
  YT_CLIENT_ID:     'yt_client_id',
  YT_CLIENT_SECRET: 'yt_client_secret',
  YT_REFRESH_TOKEN: 'yt_refresh_token'
};

const GENRE_LABELS = {
  horror: '👻 رعب', action: '⚔️ أكشن', romance: '💕 رومانسي',
  comedy: '😄 كوميدي', fantasy: '🧙 خيال وسحر', scifi: '🚀 خيال علمي',
  thriller: '🔥 إثارة', drama: '💔 دراما'
};

const STATUS_EMOJI = {
  published:   '✅',
  pending:     '⏳',
  generating:  '🔄',
  failed:      '❌',
  video_ready: '🎬'
};

// ── Helper: safe edit message ────────────────────────────────────
async function safeEdit(bot, chatId, msgId, text, options = {}) {
  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...options });
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
export async function handleCallbackQuery(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data   = query.data;
  const msgId  = query.message.message_id;

  await bot.answerCallbackQuery(query.id).catch(() => {});
  logger.bot(`Callback ${userId}: ${data}`);

  const stateData = await getUserState(userId);
  const tempData  = stateData?.temp_data || {};

  // ── STEP 1: Genre selection ──────────────────────────────────
  if (data.startsWith('genre:')) {
    const genre   = data.split(':')[1];
    const updated = { genre };
    await setUserState(userId, STATES.IDLE, updated);

    await safeEdit(
      bot, chatId, msgId,
      `✅ *النوع:* ${GENRE_LABELS[genre] || genre}\n\n` +
      stepHeader(2, 4, 'الخطوة 2 من 4 — كم حلقة تريد؟') +
      'اختر عدد الحلقات للمسلسل:',
      episodesCountKeyboard()
    );
    return;
  }

  // ── STEP 2: Episodes count ───────────────────────────────────
  if (data.startsWith('episodes:')) {
    const count   = parseInt(data.split(':')[1]);
    const updated = { ...tempData, total_episodes: count };
    await setUserState(userId, STATES.IDLE, updated);

    await safeEdit(
      bot, chatId, msgId,
      `✅ *النوع:* ${GENRE_LABELS[tempData.genre] || tempData.genre}\n` +
      `✅ *الحلقات:* ${count} حلقة\n\n` +
      stepHeader(3, 4, 'الخطوة 3 من 4 — اختر اللغة'),
      languageKeyboard()
    );
    return;
  }

  // ── STEP 3: Language ─────────────────────────────────────────
  if (data.startsWith('lang:')) {
    const lang    = data.split(':')[1];
    const updated = { ...tempData, language: lang };
    await setUserState(userId, STATES.NEW_SERIES_TITLE, updated);

    const langLabel = lang === 'ar' ? '🇸🇦 عربي' : '🇺🇸 English';
    await safeEdit(
      bot, chatId, msgId,
      `✅ *النوع:* ${GENRE_LABELS[tempData.genre] || tempData.genre}\n` +
      `✅ *الحلقات:* ${tempData.total_episodes} حلقة\n` +
      `✅ *اللغة:* ${langLabel}\n\n` +
      stepHeader(4, 4, 'الخطوة 4 من 4 — اسم المسلسل') +
      '✏️ الآن *اكتب اسم المسلسل* في الرسالة التالية:\n\n_مثال: أبطال المجرة · ظلام الليل · حارسة القمر_'
    );
    return;
  }

  // ── Series: view details ─────────────────────────────────────
  if (data.startsWith('series:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const series   = await getSeriesById(seriesId);
    if (!series) return bot.sendMessage(chatId, '❌ المسلسل غير موجود.');

    const episodes  = await getSeriesEpisodes(seriesId);
    const published = episodes.filter(e => e.status === 'published').length;
    const failed    = episodes.filter(e => e.status === 'failed').length;
    const pending   = episodes.filter(e => e.status === 'pending').length;
    const progress  = Math.round((published / (series.total_episodes || 1)) * 10);
    const bar       = '█'.repeat(progress) + '░'.repeat(10 - progress);

    await safeEdit(
      bot, chatId, msgId,
      `📺 *${series.title}*\n` +
      `${GENRE_LABELS[series.genre] || series.genre}\n\n` +
      `📊 التقدم: [${bar}] ${published}/${series.total_episodes}\n\n` +
      `✅ منشورة: *${published}*  ⏳ معلقة: *${pending}*  ❌ فاشلة: *${failed}*`,
      seriesActionsKeyboard(seriesId)
    );
    return;
  }

  // ── Episodes list ────────────────────────────────────────────
  if (data.startsWith('episodes_list:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const episodes = await getSeriesEpisodes(seriesId);
    const series   = await getSeriesById(seriesId);

    if (!episodes.length) {
      await safeEdit(bot, chatId, msgId, '📭 لا توجد حلقات بعد.');
      return;
    }

    const rows = episodes.map(e => [{
      text: `${STATUS_EMOJI[e.status] || '⏳'} ${e.episode_number}. ${e.title}`,
      callback_data: `ep_detail:${seriesId}:${e.id}`
    }]);
    rows.push([{ text: '🔙 رجوع للمسلسل', callback_data: `series:${seriesId}` }]);

    await safeEdit(
      bot, chatId, msgId,
      `📋 *حلقات "${series?.title || ''}"*\n\n` +
      `اضغط على حلقة للتفاصيل والإجراءات:`,
      { reply_markup: { inline_keyboard: rows } }
    );
    return;
  }

  // ── Episode detail ───────────────────────────────────────────
  if (data.startsWith('ep_detail:')) {
    const [, seriesId, episodeId] = data.split(':');
    const episode = await getEpisode(parseInt(episodeId));
    if (!episode) return bot.sendMessage(chatId, '❌ الحلقة غير موجودة.');

    const hasVideo = episode.status === 'published' || episode.status === 'video_ready';
    const statusText = {
      published:   '✅ منشورة على يوتيوب',
      pending:     '⏳ في الانتظار',
      generating:  '🔄 جاري التوليد',
      failed:      '❌ فشلت',
      video_ready: '🎬 جاهزة للنشر'
    };

    await safeEdit(
      bot, chatId, msgId,
      `🎬 *الحلقة ${episode.episode_number}: ${episode.title}*\n\n` +
      `📊 الحالة: ${statusText[episode.status] || episode.status}\n\n` +
      `📖 *السيناريو:*\n${(episode.scenario || '').substring(0, 300)}${episode.scenario?.length > 300 ? '...' : ''}\n\n` +
      (episode.youtube_url ? `🔗 [شاهد على يوتيوب](${episode.youtube_url})\n\n` : '') +
      (episode.error_message ? `⚠️ *الخطأ:* ${episode.error_message}\n\n` : ''),
      episodeActionsKeyboard(seriesId, episodeId, hasVideo)
    );
    return;
  }

  // ── View episode scenario ────────────────────────────────────
  if (data.startsWith('view_ep_scenario:')) {
    const episodeId = parseInt(data.split(':')[1]);
    const episode   = await getEpisode(episodeId);
    if (!episode) return;

    await bot.sendMessage(
      chatId,
      `📖 *سيناريو الحلقة ${episode.episode_number}: ${episode.title}*\n\n${episode.scenario || 'لا يوجد سيناريو'}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ── Create single episode video ──────────────────────────────
  if (data.startsWith('create_ep:')) {
    const [, seriesId, episodeNum] = data.split(':');
    const series  = await getSeriesById(parseInt(seriesId));
    if (!series) return;

    const episodes = await getSeriesEpisodes(parseInt(seriesId));
    const episode  = episodes.find(e => e.episode_number === parseInt(episodeNum));
    if (!episode) return bot.sendMessage(chatId, '❌ الحلقة غير موجودة.');

    await safeEdit(
      bot, chatId, msgId,
      `🎬 *جاري توليد فيديو الحلقة ${episode.episode_number}...*\n\n` +
      `📺 المسلسل: ${series.title}\n` +
      `🎭 الحلقة: ${episode.title}\n\n` +
      `⏳ قد يستغرق 2-5 دقائق. ستصلك رسالة عند الانتهاء.`
    );

    // Run async in background
    ;(async () => {
      try {
        await updateEpisode(episode.id, { status: 'generating' });
        const result = await generateEpisodeVideo(episode, series);
        if (result.success) {
          await bot.sendMessage(
            chatId,
            `✅ *تم توليد الحلقة بنجاح!*\n\n` +
            `📺 ${series.title}\n🎬 الحلقة ${episode.episode_number}: ${episode.title}\n\n` +
            `اضغط "نشر" لرفعها على يوتيوب أو انتظر النشر التلقائي.`,
            { parse_mode: 'Markdown', ...scenarioActionsKeyboard(series.id) }
          );
        }
      } catch (err) {
        logger.error('BOT', `Episode generation failed: ${err.message}`);
        await bot.sendMessage(
          chatId,
          `❌ *فشل توليد الحلقة ${episode.episode_number}*\n\n${err.message}`,
          { parse_mode: 'Markdown', ...mainKeyboard() }
        );
      }
    })();
    return;
  }

  // ── Publish now (next pending episode) ──────────────────────
  if (data.startsWith('publish_now:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const series   = await getSeriesById(seriesId);
    if (!series) return bot.sendMessage(chatId, '❌ المسلسل غير موجود.');

    await safeEdit(
      bot, chatId, msgId,
      `⏳ *جاري توليد الحلقة ورفعها...*\n\n` +
      `📺 ${series.title}\n\n` +
      `🤖 يولّد السيناريو → الصورة → الفيديو → الصوت → يرفع على يوتيوب\n` +
      `_(قد يستغرق 3-7 دقائق — ستصلك رسالة عند الانتهاء)_`
    );

    triggerManualPublish(seriesId).catch(async (err) => {
      logger.error('BOT', `Manual publish failed: ${err.message}`);
      await bot.sendMessage(
        chatId,
        `❌ *فشل النشر:*\n${err.message}`,
        { parse_mode: 'Markdown', ...mainKeyboard() }
      );
    });
    return;
  }

  // ── View full scenario ───────────────────────────────────────
  if (data.startsWith('view_scenario:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const series   = await getSeriesById(seriesId);
    if (!series || !series.full_scenario) {
      return bot.sendMessage(chatId, '❌ السيناريو غير موجود.');
    }

    let parsed;
    try { parsed = JSON.parse(series.full_scenario); } catch { parsed = {}; }

    const charList = (parsed.characters || [])
      .map(c => `👤 *${c.name}*\n  المظهر: ${c.appearance || ''}\n  الشخصية: ${c.personality || ''}`)
      .join('\n\n');

    await bot.sendMessage(
      chatId,
      `📖 *سيناريو "${series.title}"*\n${'─'.repeat(28)}\n\n` +
      `👥 *الشخصيات:*\n${charList}\n\n` +
      `📝 *ملخص القصة:*\n${parsed.story_summary || ''}`,
      { parse_mode: 'Markdown', ...seriesActionsKeyboard(seriesId) }
    );
    return;
  }

  // ── Regenerate scenario ──────────────────────────────────────
  if (data.startsWith('regen_scenario:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const series   = await getSeriesById(seriesId);
    if (!series) return;

    await safeEdit(
      bot, chatId, msgId,
      `⚠️ *إعادة توليد السيناريو*\n\nسيُحذف السيناريو الحالي وتُنشأ قصة جديدة.\n\nهل أنت متأكد؟`,
      confirmKeyboard(`regen_${seriesId}`)
    );
    return;
  }

  if (data.startsWith('confirm:regen_')) {
    const seriesId = parseInt(data.replace('confirm:regen_', ''));
    const series   = await getSeriesById(seriesId);
    if (!series) return;

    const { generateSeriesScenario } = await import('../../services/groqService.js');
    const { createEpisode } = await import('../../db/database.js');

    await safeEdit(bot, chatId, msgId, `⏳ جاري إعادة التوليد...`);

    try {
      const scenario = await generateSeriesScenario(
        series.title, series.genre, series.description,
        series.total_episodes, series.language || 'ar'
      );

      await updateSeries(seriesId, { full_scenario: JSON.stringify(scenario) });

      const charList = (scenario.characters || [])
        .map(c => `👤 *${c.name}* — ${c.personality || ''}`)
        .join('\n');

      await bot.sendMessage(
        chatId,
        `✅ *تم إعادة توليد السيناريو!*\n\n` +
        `👥 *الشخصيات الجديدة:*\n${charList}\n\n` +
        `📖 *القصة:*\n${scenario.story_summary || ''}`,
        { parse_mode: 'Markdown', ...scenarioActionsKeyboard(seriesId) }
      );
    } catch (err) {
      await bot.sendMessage(chatId, `❌ فشل: ${err.message}`, mainKeyboard());
    }
    return;
  }

  // ── Delete series ────────────────────────────────────────────
  if (data.startsWith('delete_series:')) {
    const seriesId = data.split(':')[1];
    await safeEdit(
      bot, chatId, msgId,
      `🗑️ *حذف المسلسل*\n\nهل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء.`,
      confirmKeyboard(`del_${seriesId}`)
    );
    return;
  }

  if (data.startsWith('confirm:del_')) {
    const seriesId = parseInt(data.replace('confirm:del_', ''));
    await updateSeries(seriesId, { status: 'deleted' });
    await safeEdit(bot, chatId, msgId, '✅ تم حذف المسلسل بنجاح.');
    await bot.sendMessage(chatId, '🏠 القائمة الرئيسية:', mainKeyboard());
    return;
  }

  // ── YouTube setup ────────────────────────────────────────────
  if (data === 'yt_setup:manual') {
    await setUserState(userId, STATES.YT_CLIENT_ID, {});
    await safeEdit(
      bot, chatId, msgId,
      `⚙️ *ربط قناة يوتيوب (1/3)*\n\n` +
      `🆔 أدخل *Client ID:*\n\n` +
      `_من: Google Cloud Console → APIs & Services → Credentials_`
    );
    return;
  }

  // ── Back navigation ──────────────────────────────────────────
  if (data === 'back:main' || data === 'cancel:action') {
    await setUserState(userId, STATES.IDLE, {});
    await safeEdit(bot, chatId, msgId, '🏠 القائمة الرئيسية:');
    await bot.sendMessage(chatId, '👇 اختر من القائمة:', mainKeyboard());
    return;
  }

  if (data === 'back:genre') {
    await safeEdit(
      bot, chatId, msgId,
      '🎭 *الخطوة 1 من 4 — اختر نوع المسلسل:*',
      genreKeyboard()
    );
    return;
  }

  if (data === 'back:episodes') {
    await safeEdit(
      bot, chatId, msgId,
      `✅ *النوع:* ${GENRE_LABELS[tempData.genre] || tempData.genre}\n\n` +
      stepHeader(2, 4, 'الخطوة 2 من 4 — كم حلقة تريد؟'),
      episodesCountKeyboard()
    );
    return;
  }

  if (data === 'back:lang') {
    await safeEdit(
      bot, chatId, msgId,
      `✅ *النوع:* ${GENRE_LABELS[tempData.genre] || tempData.genre}\n` +
      `✅ *الحلقات:* ${tempData.total_episodes} حلقة\n\n` +
      stepHeader(3, 4, 'الخطوة 3 من 4 — اللغة'),
      languageKeyboard()
    );
    return;
  }

  if (data === 'back:my_series') {
    const series = await getUserSeries(userId);
    if (!series.length) {
      await safeEdit(bot, chatId, msgId, '📭 لا توجد مسلسلات بعد.');
      return;
    }
    const { seriesListKeyboard } = await import('../messages.js');
    await safeEdit(
      bot, chatId, msgId,
      `📺 *مسلسلاتك (${series.length}):*\n\nاختر مسلسلاً:`,
      seriesListKeyboard(series)
    );
    return;
  }

  logger.warn('BOT', `Unknown callback: ${data}`);
}

