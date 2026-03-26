import {
  getUserState, setUserState, updateTempData,
  getUserSeries, getSeriesById, updateSeries,
  getSeriesEpisodes, getYouTubeChannel, getEpisode
} from '../../db/database.js';
import {
  mainKeyboard, cancelKeyboard, episodesCountKeyboard,
  languageKeyboard, voiceKeyboard, seriesActionsKeyboard,
  youtubeSetupKeyboard, confirmKeyboard, newSeriesMsg
} from '../messages.js';
import { FREE_VOICES } from '../../services/elevenLabsService.js';
import { triggerManualPublish } from '../../services/cronScheduler.js';
import { generateEpisodeVideo } from '../../services/videoPipeline.js';
import { logger } from '../../utils/logger.js';

const STATES = {
  IDLE: 'idle',
  NEW_SERIES_TITLE: 'new_series_title',
  NEW_SERIES_DESC: 'new_series_desc',
  YT_CLIENT_ID: 'yt_client_id',
  YT_CLIENT_SECRET: 'yt_client_secret',
  YT_REFRESH_TOKEN: 'yt_refresh_token'
};

export async function handleCallbackQuery(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data = query.data;
  const msgId = query.message.message_id;

  await bot.answerCallbackQuery(query.id).catch(() => {});
  logger.bot(`Callback from ${userId}: ${data}`);

  const stateData = await getUserState(userId);
  const tempData = stateData?.temp_data || {};

  // ── Genre selection ──
  if (data.startsWith('genre:')) {
    const genre = data.split(':')[1];
    await updateTempData(userId, { genre });
    await bot.editMessageText(
      `${newSeriesMsg(1, 5)}✏️ *أدخل اسم المسلسل:*\n\nمثال: "أبطال المجرة" أو "ظلام الليل"`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );
    await setUserState(userId, STATES.NEW_SERIES_TITLE, { genre });
    return;
  }

  // ── Episode count ──
  if (data.startsWith('episodes:')) {
    const count = parseInt(data.split(':')[1]);
    await updateTempData(userId, { total_episodes: count });
    await bot.editMessageText(
      `${newSeriesMsg(3, 5)}🌐 *اختر لغة المسلسل:*`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...languageKeyboard() }
    );
    return;
  }

  // ── Language ──
  if (data.startsWith('lang:')) {
    const lang = data.split(':')[1];
    await updateTempData(userId, { language: lang });
    await bot.editMessageText(
      `${newSeriesMsg(4, 5)}🎙️ *اختر الصوت للتعليق:*`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...voiceKeyboard(FREE_VOICES) }
    );
    return;
  }

  // ── Voice selection ──
  if (data.startsWith('voice:')) {
    const voiceId = data.split(':')[1];
    await updateTempData(userId, { voice_id: voiceId });
    const updatedTemp = { ...tempData, voice_id: voiceId };
    await bot.editMessageText(
      `${newSeriesMsg(5, 5)}✍️ *أدخل وصفاً مختصراً للمسلسل:*\n_(اختياري - يمكنك إرسال "تخطي")_`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );
    await setUserState(userId, STATES.NEW_SERIES_DESC, updatedTemp);
    return;
  }

  // ── Preview episode ──
  if (data.startsWith('preview_ep:')) {
    const parts = data.split(':');
    const seriesId = parseInt(parts[1]);
    const epNumber = parseInt(parts[2]) || 1;

    const series = await getSeriesById(seriesId);
    if (!series) return bot.sendMessage(chatId, '❌ المسلسل غير موجود.');

    const episodes = await getSeriesEpisodes(seriesId);
    const episode = episodes.find(e => e.episode_number === epNumber);
    if (!episode) return bot.sendMessage(chatId, '❌ الحلقة غير موجودة.');

    // Show episode details with publish/skip options
    await bot.editMessageText(
      `👁️ *معاينة الحلقة ${epNumber}*\n\n` +
      `📺 المسلسل: *${series.title}*\n` +
      `🎬 العنوان: *${episode.title}*\n\n` +
      `📝 *السيناريو:*\n${episode.scenario}\n\n` +
      `اختر ما تريد فعله:`,
      {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🎬 توليد ونشر على يوتيوب', callback_data: `publish_now:${seriesId}` }
            ],
            [
              { text: '⏭️ تخطي - اترك التلقائي', callback_data: `back:main` }
            ],
            [
              { text: '📋 قائمة جميع الحلقات', callback_data: `episodes_list:${seriesId}` }
            ]
          ]
        }
      }
    );
    return;
  }

  // ── Series selection ──
  if (data.startsWith('series:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const series = await getSeriesById(seriesId);
    if (!series) return bot.sendMessage(chatId, '❌ المسلسل غير موجود.');

    const episodes = await getSeriesEpisodes(seriesId);
    const published = episodes.filter(e => e.status === 'published').length;
    const failed = episodes.filter(e => e.status === 'failed').length;
    const pending = episodes.filter(e => e.status === 'pending').length;

    await bot.editMessageText(
      `📺 *${series.title}*\n\n` +
      `🎭 النوع: ${series.genre}\n` +
      `📋 الحلقات: ${series.total_episodes}\n` +
      `✅ منشورة: ${published}\n` +
      `⏳ معلقة: ${pending}\n` +
      `❌ فاشلة: ${failed}\n\n` +
      `📅 النشر التلقائي: يومياً`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...seriesActionsKeyboard(seriesId) }
    );
    return;
  }

  // ── Publish now ──
  if (data.startsWith('publish_now:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const series = await getSeriesById(seriesId);
    if (!series) return bot.sendMessage(chatId, '❌ المسلسل غير موجود.');

    await bot.editMessageText(
      `⏳ *جاري توليد الحلقة ونشرها...*\n\nالمسلسل: ${series.title}\n\n⏱️ هذا قد يستغرق 2-5 دقائق.\nستصلك رسالة عند الانتهاء.`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );

    // Run in background
    triggerManualPublish(seriesId, chatId).catch(async (err) => {
      logger.error('BOT', `Manual publish failed: ${err.message}`);
      await bot.sendMessage(chatId, `❌ فشل النشر:\n${err.message}`, mainKeyboard());
    });
    return;
  }

  // ── Episodes list ──
  if (data.startsWith('episodes_list:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const episodes = await getSeriesEpisodes(seriesId);

    const statusEmoji = { published: '✅', pending: '⏳', generating: '🔄', failed: '❌', video_ready: '🎬' };
    const list = episodes.map(e =>
      `${statusEmoji[e.status] || '⏳'} ${e.episode_number}. ${e.title}`
    ).join('\n');

    await bot.editMessageText(
      `📋 *قائمة الحلقات:*\n\n${list}`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: `series:${seriesId}` }]] }
      }
    );
    return;
  }

  // ── Delete series ──
  if (data.startsWith('delete_series:')) {
    const seriesId = data.split(':')[1];
    await bot.editMessageText(
      '⚠️ *هل أنت متأكد من حذف هذا المسلسل؟*\n\nلا يمكن التراجع عن هذا الإجراء.',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...confirmKeyboard(`delete_series_${seriesId}`) }
    );
    return;
  }

  // ── Confirm delete ──
  if (data.startsWith('confirm:delete_series_')) {
    const seriesId = parseInt(data.replace('confirm:delete_series_', ''));
    await updateSeries(seriesId, { status: 'deleted' });
    await bot.editMessageText('✅ تم حذف المسلسل.', { chat_id: chatId, message_id: msgId });
    await bot.sendMessage(chatId, '👋 القائمة الرئيسية:', mainKeyboard());
    return;
  }

  // ── YouTube setup ──
  if (data === 'yt_setup:manual') {
    await bot.editMessageText(
      `⚙️ *إعداد يوتيوب (1/3)*\n\n🆔 أدخل *Client ID:*`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );
    await setUserState(userId, STATES.YT_CLIENT_ID, {});
    return;
  }

  // ── Back buttons ──
  if (data === 'back:main') {
    await bot.editMessageText('👋 القائمة الرئيسية:', { chat_id: chatId, message_id: msgId }).catch(() => {});
    await bot.sendMessage(chatId, '👋 اختر من الأزرار أدناه:', mainKeyboard());
    return;
  }

  if (data === 'back:my_series') {
    const series = await getUserSeries(userId);
    if (!series.length) {
      await bot.editMessageText('📭 لا توجد مسلسلات.', { chat_id: chatId, message_id: msgId });
      return;
    }
    await bot.editMessageText('📺 *مسلسلاتك:*', {
      chat_id: chatId, message_id: msgId,
      parse_mode: 'Markdown',
      ...seriesListKeyboard(series)
    });
    return;
  }

  if (data === 'cancel:action') {
    await bot.editMessageText('✅ تم الإلغاء.', { chat_id: chatId, message_id: msgId });
    await setUserState(userId, STATES.IDLE, {});
    return;
  }

  logger.warn('BOT', `Unknown callback: ${data}`);
}
