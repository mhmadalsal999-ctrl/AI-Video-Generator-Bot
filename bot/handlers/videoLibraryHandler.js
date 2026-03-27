/**
 * videoLibraryHandler.js
 * Handles video library browsing and re-sending
 */

import { getStoryById, getUserStories, updateStory } from '../../db/database.js';
import { mainKeyboard, storyDetailKeyboard, storiesListKeyboard, STATUS_LABELS, CATEGORY_LABELS } from '../messages.js';
import { logger } from '../../utils/logger.js';

export async function handleLibraryCommand(bot, chatId, userId) {
  try {
    const stories = await getUserStories(userId, 20);

    if (!stories.length) {
      return bot.sendMessage(
        chatId,
        '📭 *مكتبتك فارغة!*\n\nاضغط "📖 قصة جديدة" لإنشاء أول قصة.',
        { parse_mode: 'Markdown', ...mainKeyboard() }
      );
    }

    const readyStories  = stories.filter(s => s.status === 'video_ready' || s.status === 'published');
    const otherStories  = stories.filter(s => !['video_ready', 'published'].includes(s.status));

    let text = `📚 *مكتبتك — ${stories.length} قصة*\n\n`;
    if (readyStories.length) {
      text += `🎬 *فيديوهات جاهزة (${readyStories.length}):*\n`;
      text += readyStories.map(s => `• ${s.title}`).join('\n');
      text += '\n\n';
    }
    if (otherStories.length) {
      text += `📋 *أخرى (${otherStories.length}):*\n`;
      text += otherStories.map(s => `• ${STATUS_LABELS[s.status] || s.status} — ${s.title}`).join('\n');
    }
    text += '\n\nاختر قصة للتفاصيل:';

    return bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      ...storiesListKeyboard(stories)
    });
  } catch (err) {
    logger.error('LIBRARY', err.message);
    return bot.sendMessage(chatId, '❌ خطأ في جلب المكتبة. حاول مرة أخرى.', mainKeyboard());
  }
}

export async function handleResendVideo(bot, chatId, userId, storyId) {
  try {
    const story = await getStoryById(storyId);
    if (!story) {
      return bot.sendMessage(chatId, '❌ القصة غير موجودة.', mainKeyboard());
    }

    if (!story.video_url) {
      return bot.sendMessage(
        chatId,
        '❌ الفيديو غير موجود في التخزين. أعد إنشاء الفيديو.',
        { reply_markup: { inline_keyboard: [[{ text: '🔄 إعادة الإنشاء', callback_data: `generate:${storyId}` }]] } }
      );
    }

    const caption = `🎬 *${story.title}*\n\n📅 ${story.period || ''} | 📍 ${story.location || ''}`;

    await bot.sendVideo(chatId, story.video_url, {
      caption,
      parse_mode: 'Markdown',
      supports_streaming: true
    });

    logger.success('LIBRARY', `Resent video for story ${storyId}`);
  } catch (err) {
    logger.error('LIBRARY', `Resend failed: ${err.message}`);
    return bot.sendMessage(chatId, `❌ فشل الإرسال: ${err.message}`, mainKeyboard());
  }
}
