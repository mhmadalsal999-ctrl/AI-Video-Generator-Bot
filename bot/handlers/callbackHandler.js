import {
  getUserState, setUserState, updateTempData,
  getUserSeries, getSeriesById, updateSeries,
  getSeriesEpisodes, getYouTubeChannel
} from '../../db/database.js';
import {
  mainKeyboard, cancelKeyboard, episodesCountKeyboard,
  languageKeyboard, voiceKeyboard, seriesActionsKeyboard,
  youtubeSetupKeyboard, confirmKeyboard, newSeriesMsg
} from '../messages.js';
import { FREE_VOICES } from '../../services/elevenLabsService.js';
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

export async function handleCallbackQuery(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data = query.data;
  const msgId = query.message.message_id;

  await bot.answerCallbackQuery(query.id).catch(() => {});
  logger.bot(`Callback ${userId}: ${data}`);

  const stateData = await getUserState(userId);
  const tempData = stateData?.temp_data || {};

  // اختيار النوع
  if (data.startsWith('genre:')) {
    const genre = data.split(':')[1];
    const updated = { genre };
    await setUserState(userId, STATES.IDLE, updated);
    await bot.editMessageText(
      `${newSeriesMsg(1, 5)}📋 *كم عدد الحلقات؟*`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...episodesCountKeyboard() }
    );
    return;
  }

  // عدد الحلقات
  if (data.startsWith('episodes:')) {
    const count = parseInt(data.split(':')[1]);
    const updated = { ...tempData, total_episodes: count };
    await setUserState(userId, STATES.IDLE, updated);
    await bot.editMessageText(
      `${newSeriesMsg(2, 5)}🌐 *اختر لغة المسلسل:*`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...languageKeyboard() }
    );
    return;
  }

  // اللغة
  if (data.startsWith('lang:')) {
    const lang = data.split(':')[1];
    const updated = { ...tempData, language: lang };
    await setUserState(userId, STATES.IDLE, updated);
    await bot.editMessageText(
      `${newSeriesMsg(3, 5)}🎙️ *اختر الصوت للتعليق:*`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...voiceKeyboard(FREE_VOICES) }
    );
    return;
  }

  // الصوت
  if (data.startsWith('voice:')) {
    const voiceId = data.split(':')[1];
    const updated = { ...tempData, voice_id: voiceId };
    await setUserState(userId, STATES.NEW_SERIES_TITLE, updated);
    await bot.editMessageText(
      `${newSeriesMsg(4, 5)}✏️ *أدخل اسم المسلسل:*\n\nمثال: "أبطال المجرة" أو "ظلام الليل"`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );
    return;
  }

  // اختيار مسلسل من القائمة
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
      `❌ فاشلة: ${failed}`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...seriesActionsKeyboard(seriesId) }
    );
    return;
  }

  // نشر فوري
  if (data.startsWith('publish_now:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const series = await getSeriesById(seriesId);
    if (!series) return bot.sendMessage(chatId, '❌ المسلسل غير موجود.');

    await bot.editMessageText(
      `⏳ *جاري توليد الحلقة ونشرها...*\n\nالمسلسل: ${series.title}\n\nقد يستغرق عدة دقائق. ستصلك رسالة عند الانتهاء.`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );

    triggerManualPublish(seriesId).catch(async (err) => {
      logger.error('BOT', `Manual publish failed: ${err.message}`);
      await bot.sendMessage(chatId, `❌ فشل النشر:\n${err.message}`, mainKeyboard());
    });
    return;
  }

  // قائمة الحلقات
  if (data.startsWith('episodes_list:')) {
    const seriesId = parseInt(data.split(':')[1]);
    const episodes = await getSeriesEpisodes(seriesId);
    const statusEmoji = {
      published: '✅', pending: '⏳',
      generating: '🔄', failed: '❌', video_ready: '🎬'
    };
    const list = episodes.map(e =>
      `${statusEmoji[e.status] || '⏳'} ${e.episode_number}. ${e.title}`
    ).join('\n');

    await bot.editMessageText(
      `📋 *قائمة الحلقات:*\n\n${list || 'لا توجد حلقات'}`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: `series:${seriesId}` }]] }
      }
    );
    return;
  }

  // حذف مسلسل
  if (data.startsWith('delete_series:')) {
    const seriesId = data.split(':')[1];
    await bot.editMessageText(
      '⚠️ *هل أنت متأكد من حذف هذا المسلسل؟*',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...confirmKeyboard(`del_${seriesId}`) }
    );
    return;
  }

  if (data.startsWith('confirm:del_')) {
    const seriesId = parseInt(data.replace('confirm:del_', ''));
    await updateSeries(seriesId, { status: 'deleted' });
    await bot.editMessageText('✅ تم حذف المسلسل.', { chat_id: chatId, message_id: msgId });
    await bot.sendMessage(chatId, '👋 القائمة الرئيسية:', mainKeyboard());
    return;
  }

  // إعداد يوتيوب
  if (data === 'yt_setup:manual') {
    await setUserState(userId, STATES.YT_CLIENT_ID, {});
    await bot.editMessageText(
      `⚙️ *إعداد يوتيوب (1/3)*\n\n🆔 أدخل *Client ID:*\n\n_من Google Cloud Console → APIs & Services → Credentials_`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );
    return;
  }

  // أزرار الرجوع
  if (data === 'back:main' || data === 'cancel:action') {
    await setUserState(userId, STATES.IDLE, {});
    try {
      await bot.editMessageText('👋 القائمة الرئيسية:', { chat_id: chatId, message_id: msgId });
    } catch (_) {}
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

  logger.warn('BOT', `Unknown callback: ${data}`);
}
