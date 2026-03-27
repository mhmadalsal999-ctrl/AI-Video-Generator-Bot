/**
 * messageHandler.js
 * Handles all text messages from the user
 */

import {
  getUserState, setUserState,
  getUserStories, getYouTubeChannel,
  saveYouTubeChannel
} from '../../db/database.js';
import {
  mainKeyboard, cancelKeyboard,
  categoryKeyboard, storiesListKeyboard,
  youtubeSetupKeyboard,
  WELCOME_MSG, HELP_MSG,
  CATEGORY_LABELS, STATUS_LABELS
} from '../messages.js';
import { verifyYouTubeCredentials } from '../../services/youtubeService.js';
import { logger } from '../../utils/logger.js';

export const STATES = {
  IDLE:              'idle',
  AWAIT_CATEGORY:    'await_category',
  YT_CLIENT_ID:      'yt_client_id',
  YT_CLIENT_SECRET:  'yt_client_secret',
  YT_REFRESH_TOKEN:  'yt_refresh_token'
};

// ════════════════════════════════════════════════════════════════════
export async function handleMessage(bot, msg) {
  if (!msg.text) return;

  const chatId  = msg.chat.id;
  const userId  = msg.from.id.toString();
  const text    = msg.text.trim();

  const stateData = await getUserState(userId);
  const state     = stateData?.state    || STATES.IDLE;
  const tempData  = stateData?.temp_data || {};

  // ── Global commands ───────────────────────────────────────────────
  if (text === '/start' || text === '/start@' + (process.env.BOT_USERNAME || '')) {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, WELCOME_MSG, { parse_mode: 'Markdown', ...mainKeyboard() });
  }

  if (text === '/help' || text === '❓ مساعدة') {
    return bot.sendMessage(chatId, HELP_MSG, { parse_mode: 'Markdown', ...mainKeyboard() });
  }

  if (text === '/cancel' || text === '❌ إلغاء') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, '✅ تم الإلغاء.', mainKeyboard());
  }

  // ── Main keyboard buttons ─────────────────────────────────────────
  if (text === '📖 قصة جديدة') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(
      chatId,
      '📚 *اختر فئة القصة التاريخية:*\n\nالبوت سيبحث تلقائياً عن قصة حقيقية موثقة ومثيرة.',
      { parse_mode: 'Markdown', ...categoryKeyboard() }
    );
  }

  if (text === '📚 مكتبتي') {
    const stories = await getUserStories(userId);
    if (!stories.length) {
      return bot.sendMessage(
        chatId,
        '📭 *مكتبتك فارغة!*\n\nاضغط "📖 قصة جديدة" لإنشاء أول قصة.',
        { parse_mode: 'Markdown', ...mainKeyboard() }
      );
    }
    const list = stories.map((s, i) => {
      const status = STATUS_LABELS[s.status] || '📖';
      const cat = CATEGORY_LABELS[s.category] || s.category;
      return `${status}\n*${i + 1}. ${s.title}*\n   ${cat}`;
    }).join('\n\n');

    return bot.sendMessage(
      chatId,
      `📚 *مكتبتك (${stories.length} قصة):*\n\n${list}\n\nاختر قصة للتفاصيل:`,
      { parse_mode: 'Markdown', ...storiesListKeyboard(stories) }
    );
  }

  if (text === '📺 إعداد يوتيوب') {
    const channel = await getYouTubeChannel(userId);
    if (channel) {
      return bot.sendMessage(
        chatId,
        `📺 *قناتك مربوطة:*\n\n🎬 القناة: ${channel.channel_title || 'غير معروف'}\n🆔 ID: ${channel.channel_id || 'N/A'}\n\nيمكن النشر التلقائي عند إنشاء الفيديوهات.`,
        { parse_mode: 'Markdown', ...mainKeyboard() }
      );
    }
    return bot.sendMessage(
      chatId,
      '📺 *ربط قناة يوتيوب*\n\nاربط قناتك للنشر التلقائي للفيديوهات.',
      { parse_mode: 'Markdown', ...youtubeSetupKeyboard() }
    );
  }

  // ── YouTube setup flow ────────────────────────────────────────────
  if (state === STATES.YT_CLIENT_ID) {
    await setUserState(userId, STATES.YT_CLIENT_SECRET, { ...tempData, clientId: text });
    return bot.sendMessage(
      chatId,
      '2️⃣ أرسل الآن *Client Secret* من Google Cloud Console:',
      { parse_mode: 'Markdown', ...cancelKeyboard() }
    );
  }

  if (state === STATES.YT_CLIENT_SECRET) {
    await setUserState(userId, STATES.YT_REFRESH_TOKEN, { ...tempData, clientSecret: text });
    return bot.sendMessage(
      chatId,
      '3️⃣ أرسل الآن *Refresh Token* من OAuth Playground:',
      { parse_mode: 'Markdown', ...cancelKeyboard() }
    );
  }

  if (state === STATES.YT_REFRESH_TOKEN) {
    const loadingMsg = await bot.sendMessage(chatId, '🔄 جاري التحقق من بياناتك...');
    try {
      const result = await verifyYouTubeCredentials(tempData.clientId, tempData.clientSecret, text);
      if (!result.valid) {
        await bot.editMessageText(`❌ بيانات غير صحيحة: ${result.error}`, {
          chat_id: chatId, message_id: loadingMsg.message_id
        });
        return;
      }

      await saveYouTubeChannel(userId, {
        clientId: tempData.clientId,
        clientSecret: tempData.clientSecret,
        refreshToken: text,
        channelId: result.channelId,
        channelTitle: result.channelTitle
      });
      await setUserState(userId, STATES.IDLE, {});

      await bot.editMessageText(
        `✅ *تم ربط قناتك بنجاح!*\n\n🎬 القناة: ${result.channelTitle}\n\nستُنشر فيديوهاتك تلقائياً.`,
        { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'Markdown' }
      );
      return bot.sendMessage(chatId, 'العودة للقائمة الرئيسية:', mainKeyboard());
    } catch (err) {
      logger.error('YT_SETUP', err.message);
      await bot.editMessageText(`❌ خطأ: ${err.message}`, {
        chat_id: chatId, message_id: loadingMsg.message_id
      });
    }
    return;
  }

  // ── Unknown input ─────────────────────────────────────────────────
  return bot.sendMessage(
    chatId,
    '❓ لم أفهم رسالتك. استخدم الأزرار أدناه:',
    mainKeyboard()
  );
}
