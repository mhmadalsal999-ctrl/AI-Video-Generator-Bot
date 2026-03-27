/**
 * callbackHandler.js
 * Full callback handler with duration selection + split video support
 */

import {
  getUserState, setUserState,
  getUserStories, getStoryById, updateStory,
  createStory, getYouTubeChannel, logAutoPublish
} from '../../db/database.js';
import {
  mainKeyboard, categoryKeyboard, languageKeyboard,
  durationKeyboard, splitKeyboard,
  storiesListKeyboard, storyDetailKeyboard, storyPreviewKeyboard,
  afterVideoKeyboard, youtubeSetupKeyboard, confirmKeyboard, backToMainKeyboard,
  WELCOME_MSG, CATEGORY_LABELS, STATUS_LABELS, DURATION_CONFIG
} from '../messages.js';
import {
  findHistoricalStory, generateStoryScript,
  generateStoryScriptPart, generateYouTubeMetadata
} from '../../services/groqService.js';
import { generateStoryVideo, generateSplitVideos } from '../../services/videoPipeline.js';
import { uploadWithEnvCredentials } from '../../services/youtubeService.js';
import { uploadVideoToStorage } from '../../utils/storage.js';
import { logger } from '../../utils/logger.js';
import { STATES } from './messageHandler.js';
import fs from 'fs-extra';

// ── Safe edit helper ──────────────────────────────────────────────────
async function safeEdit(bot, chatId, msgId, text, options = {}) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown',
      ...options
    });
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════
// SEND PROGRESS MESSAGE (updates same message)
// ═══════════════════════════════════════════════════════════════════
function makeProgressCallback(bot, chatId, msgId, storyTitle) {
  return async (msg) => {
    try {
      await bot.editMessageText(
        `🎬 *${storyTitle}*\n\n${msg}`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
      );
    } catch (_) {}
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════
export async function handleCallbackQuery(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data   = query.data;
  const msgId  = query.message.message_id;

  await bot.answerCallbackQuery(query.id).catch(() => {});
  logger.bot(`CB ${userId}: ${data}`);

  const stateData = await getUserState(userId);
  const tempData  = stateData?.temp_data || {};

  // ──────────────────────────────────────────────────────────────────
  // STEP 1: CATEGORY
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('cat:')) {
    const category = data.split(':')[1];
    await setUserState(userId, STATES.IDLE, { category });
    await safeEdit(
      bot, chatId, msgId,
      `${CATEGORY_LABELS[category]}\n\n*اختر لغة الراوي:*`,
      languageKeyboard()
    );
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // STEP 2: LANGUAGE → show duration keyboard
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('lang:')) {
    const language = data.split(':')[1];
    const category = tempData.category;
    if (!category) {
      await safeEdit(bot, chatId, msgId, '❌ اختر الفئة أولاً.', categoryKeyboard());
      return;
    }
    await setUserState(userId, STATES.IDLE, { ...tempData, language });
    await safeEdit(
      bot, chatId, msgId,
      `⏱️ *اختر مدة الفيديو:*\n\nكل مدة تحدد عدد المشاهد وطول السيناريو تلقائياً.`,
      durationKeyboard()
    );
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // STEP 3: DURATION
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('dur:')) {
    const durKey = data.split(':')[1];
    const durCfg = DURATION_CONFIG[durKey];
    if (!durCfg) return;

    await setUserState(userId, STATES.IDLE, { ...tempData, durKey, durCfg });

    if (durKey === '10') {
      // Ask split preference for 10-minute videos
      await safeEdit(
        bot, chatId, msgId,
        `🎞️ *فيديو 10 دقائق محدد!*\n\n*كيف تريد توزيعه؟*\n\n📦 *3 أجزاء منفصلة* (موصى به لليوتيوب)\nكل جزء ~3-4 دقائق — أكثر مشاهدات\n\n🎬 *فيديو واحد* (~10 دقائق)\nملف واحد كامل`,
        splitKeyboard()
      );
      return;
    }

    // Duration ≤ 5 min → search directly
    await searchAndShowStory(bot, chatId, msgId, userId, { ...tempData, durKey, durCfg, splitMode: false });
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // STEP 3b: SPLIT DECISION (for 10-min)
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('split:')) {
    const splitMode = data === 'split:yes';
    await setUserState(userId, STATES.IDLE, { ...tempData, splitMode });
    await searchAndShowStory(bot, chatId, msgId, userId, { ...tempData, splitMode });
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // ANOTHER STORY (retry search)
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('another:')) {
    const category  = tempData.category;
    const language  = tempData.language || 'ar';
    const durKey    = tempData.durKey || '3';
    const durCfg    = DURATION_CONFIG[durKey];
    const nextIndex = (tempData.searchRetry || 0) + 1;

    if (!category) {
      await safeEdit(bot, chatId, msgId, '📚 اختر فئة أولاً:', categoryKeyboard());
      return;
    }

    await safeEdit(bot, chatId, msgId, '🔍 *جاري البحث عن قصة مختلفة...*\n\n⏳ لحظة...');

    try {
      const storyData = await findHistoricalStory(category, language, nextIndex);
      const story = await createStory(userId, {
        category, language,
        title: storyData.title, period: storyData.period,
        location: storyData.location, summary: storyData.summary,
        story_data: storyData, narrator_tone: storyData.tone || 'dramatic',
        duration_minutes: parseInt(durKey), split_parts: durCfg?.split || 1,
        scenes_per_part: durCfg?.scenes || 7, sec_per_scene: durCfg?.secPerScene || 26
      });

      await setUserState(userId, STATES.IDLE, {
        ...tempData, storyId: story.id, pendingStory: storyData, searchRetry: nextIndex
      });

      const txt = `📖 *${storyData.title}*\n\n📅 ${storyData.period} | 📍 ${storyData.location}\n\n*الملخص:*\n${storyData.summary}\n\n_هل تريد إنشاء الفيديو؟_`;
      await safeEdit(bot, chatId, msgId, txt, storyPreviewKeyboard(story.id));
    } catch (err) {
      await safeEdit(bot, chatId, msgId, `❌ ${err.message}`, categoryKeyboard());
    }
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // VIEW SCRIPT
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('script:')) {
    const storyId = parseInt(data.split(':')[1]);
    const story = await getStoryById(storyId);
    if (!story) return;

    const script = story.script_data;
    if (!script?.scenes?.length) {
      await safeEdit(bot, chatId, msgId,
        '⏳ السيناريو لم يُنشأ بعد. اضغط "إنشاء الفيديو" أولاً.',
        storyPreviewKeyboard(storyId)
      );
      return;
    }

    const scenesText = script.scenes.map((s, i) =>
      `*المشهد ${i + 1}: ${s.scene_title || ''}*\n${(s.narration || '').substring(0, 200)}`
    ).join('\n\n──\n\n');

    const header = story.duration_minutes
      ? `📝 *سيناريو: ${story.title}*\n⏱️ المدة: ${story.duration_minutes} دقيقة | ${script.scenes.length} مشاهد\n\n`
      : `📝 *سيناريو: ${story.title}*\n\n`;

    await safeEdit(bot, chatId, msgId,
      (header + scenesText).substring(0, 4000),
      storyPreviewKeyboard(storyId)
    );
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // GENERATE VIDEO
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('generate:')) {
    const storyId = parseInt(data.split(':')[1]);
    const story = await getStoryById(storyId);
    if (!story) { await bot.answerCallbackQuery(query.id, { text: '❌ القصة غير موجودة' }); return; }
    if (story.status === 'generating') { await bot.answerCallbackQuery(query.id, { text: '⏳ قيد الإنشاء بالفعل' }); return; }

    const durKey    = String(story.duration_minutes || 3);
    const durCfg    = DURATION_CONFIG[durKey] || DURATION_CONFIG['3'];
    const isSplit   = story.split_parts > 1;

    await updateStory(storyId, { status: 'generating' });

    const durLabel = durCfg?.label || `${story.duration_minutes} دقائق`;
    const splitLabel = isSplit ? ` | ${story.split_parts} أجزاء` : '';

    await safeEdit(bot, chatId, msgId,
      `🎬 *بدأ إنشاء الفيديو!*\n_${story.title}_\n\n` +
      `⏱️ المدة: ${durLabel}${splitLabel}\n` +
      `🎞️ ${isSplit ? story.split_parts + ' أجزاء × ' + durCfg.scenes + ' مشاهد' : durCfg.scenes + ' مشهد'}\n\n` +
      `⏳ الإنشاء يستغرق بضع دقائق...`
    );

    const progressCallback = makeProgressCallback(bot, chatId, msgId, story.title);
    const hasYouTube = !!(await getYouTubeChannel(userId));

    try {
      if (isSplit) {
        // ── MULTI-PART VIDEO ───────────────────────────────────────
        await handleSplitVideoGeneration(
          bot, chatId, msgId, userId, story, durCfg, progressCallback, hasYouTube
        );
      } else {
        // ── SINGLE VIDEO ───────────────────────────────────────────
        await handleSingleVideoGeneration(
          bot, chatId, msgId, userId, story, durCfg, progressCallback, hasYouTube
        );
      }
    } catch (err) {
      logger.error('GENERATE', err.message);
      await updateStory(storyId, { status: 'failed', error_message: err.message });
      await safeEdit(bot, chatId, msgId,
        `❌ *فشل الإنشاء*\n\n${err.message}\n\nحاول مرة أخرى:`,
        storyPreviewKeyboard(storyId)
      );
      await logAutoPublish(userId, storyId, 'generate_video', 'failed', { error: err.message });
    }
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // PUBLISH TO YOUTUBE
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('publish:')) {
    const storyId = parseInt(data.split(':')[1]);
    const story = await getStoryById(storyId);
    if (!story) return;

    const channel = await getYouTubeChannel(userId);
    if (!channel) {
      await safeEdit(bot, chatId, msgId,
        '❌ لم تربط قناتك بعد. اذهب إلى "📺 إعداد يوتيوب".',
        backToMainKeyboard()
      );
      return;
    }

    if (!story.video_url) {
      await safeEdit(bot, chatId, msgId,
        '❌ الفيديو غير موجود في التخزين. أعد إنشاؤه.',
        storyPreviewKeyboard(storyId)
      );
      return;
    }

    await safeEdit(bot, chatId, msgId, '📺 *جاري النشر على يوتيوب...*\n\n⏳ لحظة...');

    try {
      const ytMeta = await generateYouTubeMetadata(story.story_data || {}, story.script_data || {});
      const result = await uploadWithEnvCredentials(
        story.video_url, ytMeta.title || story.title,
        ytMeta.description || story.summary, ytMeta.tags || ['تاريخ']
      );
      await updateStory(storyId, {
        status: 'published',
        youtube_video_id: result.videoId,
        youtube_url: result.shortsUrl || result.url
      });
      await safeEdit(bot, chatId, msgId,
        `✅ *تم النشر!*\n\n📺 ${ytMeta.title || story.title}\n\n🔗 ${result.shortsUrl || result.url}`,
        backToMainKeyboard()
      );
      await logAutoPublish(userId, storyId, 'youtube_publish', 'success', { videoId: result.videoId });
    } catch (err) {
      await safeEdit(bot, chatId, msgId, `❌ فشل النشر: ${err.message}`, storyDetailKeyboard(story));
    }
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // STORY LIBRARY DETAIL
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('story:')) {
    const storyId = parseInt(data.split(':')[1]);
    const story = await getStoryById(storyId);
    if (!story) { await bot.answerCallbackQuery(query.id, { text: 'القصة غير موجودة' }); return; }

    const status = STATUS_LABELS[story.status] || story.status;
    const durInfo = story.duration_minutes ? `⏱️ ${story.duration_minutes} دقيقة | ${story.split_parts || 1} جزء\n` : '';
    const ytLink = story.youtube_url ? `\n📺 [مشاهدة على يوتيوب](${story.youtube_url})` : '';
    const text = `📖 *${story.title}*\n\n📅 ${story.period || '—'} | 📍 ${story.location || '—'}\n📊 ${status}\n${durInfo}${ytLink}\n\n*الملخص:*\n${story.summary || '—'}`;

    await safeEdit(bot, chatId, msgId, text, storyDetailKeyboard(story));
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // YOUTUBE SETUP
  // ──────────────────────────────────────────────────────────────────
  if (data === 'yt:setup') {
    await setUserState(userId, STATES.YT_CLIENT_ID, {});
    await safeEdit(bot, chatId, msgId,
      `🔧 *ربط قناة يوتيوب*\n\n*الخطوة 1/3*\nأرسل *Client ID* من Google Cloud Console:\n\n_اذهب إلى: console.cloud.google.com → APIs → OAuth 2.0 Client IDs_`
    );
    return;
  }

  if (data === 'yt:help') {
    await safeEdit(bot, chatId, msgId,
      `❓ *كيف تحصل على بيانات يوتيوب؟*\n\n1️⃣ console.cloud.google.com\n2️⃣ أنشئ مشروعاً جديداً\n3️⃣ فعّل YouTube Data API v3\n4️⃣ أنشئ OAuth 2.0 Client ID\n5️⃣ استخدم OAuth Playground للحصول على Refresh Token\n\n_رابط: developers.google.com/oauthplayground_`,
      youtubeSetupKeyboard()
    );
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // DELETE
  // ──────────────────────────────────────────────────────────────────
  if (data.startsWith('delete:')) {
    const storyId = parseInt(data.split(':')[1]);
    await safeEdit(bot, chatId, msgId,
      '🗑️ هل أنت متأكد من حذف هذه القصة؟',
      confirmKeyboard('delete', storyId)
    );
    return;
  }

  if (data.startsWith('confirm:delete:')) {
    const storyId = parseInt(data.split(':')[2]);
    await updateStory(storyId, { status: 'deleted' });
    await safeEdit(bot, chatId, msgId, '✅ تم الحذف.');
    return bot.sendMessage(chatId, 'العودة للقائمة الرئيسية:', mainKeyboard());
  }

  // ──────────────────────────────────────────────────────────────────
  // NAVIGATION
  // ──────────────────────────────────────────────────────────────────
  if (data === 'new:story') {
    await setUserState(userId, STATES.IDLE, {});
    await safeEdit(bot, chatId, msgId, '📚 *اختر فئة القصة:*', categoryKeyboard());
    return;
  }

  if (data === 'back:main') {
    await setUserState(userId, STATES.IDLE, {});
    await safeEdit(bot, chatId, msgId, WELCOME_MSG, mainKeyboard());
    return;
  }

  if (data === 'back:lang') {
    await safeEdit(bot, chatId, msgId,
      `${CATEGORY_LABELS[tempData.category] || ''}\n\n*اختر لغة الراوي:*`,
      languageKeyboard()
    );
    return;
  }

  if (data === 'back:duration') {
    await safeEdit(bot, chatId, msgId,
      `⏱️ *اختر مدة الفيديو:*`,
      durationKeyboard()
    );
    return;
  }

  if (data === 'back:library') {
    const stories = await getUserStories(userId);
    if (!stories.length) { await safeEdit(bot, chatId, msgId, '📭 مكتبتك فارغة.'); return; }
    await safeEdit(bot, chatId, msgId,
      `📚 *مكتبتك (${stories.length} قصة):*\nاختر قصة:`,
      storiesListKeyboard(stories)
    );
    return;
  }

  logger.warn('BOT', `Unknown callback: ${data}`);
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

async function searchAndShowStory(bot, chatId, msgId, userId, tempDataWithDur) {
  const { category, language, durKey, durCfg, searchRetry = 0 } = tempDataWithDur;

  await safeEdit(bot, chatId, msgId,
    `🔍 *جاري البحث عن قصة ${CATEGORY_LABELS[category]}...*\n` +
    `⏱️ المدة: ${durCfg?.label}\n\n⏳ لحظة من فضلك...`
  );

  try {
    const storyData = await findHistoricalStory(category, language, searchRetry);

    const story = await createStory(userId, {
      category, language,
      title: storyData.title, period: storyData.period,
      location: storyData.location, summary: storyData.summary,
      story_data: storyData, narrator_tone: storyData.tone || 'dramatic',
      duration_minutes: parseInt(durKey),
      split_parts: durCfg?.split || 1,
      scenes_per_part: durCfg?.scenes || 7,
      sec_per_scene: durCfg?.secPerScene || 26
    });

    await setUserState(userId, 'idle', {
      ...tempDataWithDur, storyId: story.id, pendingStory: storyData, searchRetry
    });

    const chars = (storyData.key_characters || []).map(c =>
      typeof c === 'object' ? `• ${c.name} — ${c.role}` : `• ${c}`
    ).join('\n');

    const durLine = durCfg ? `\n⏱️ *المدة:* ${durCfg.label} | ${durCfg.scenes} مشهد${durCfg.split > 1 ? ` (${durCfg.split} أجزاء)` : ''}` : '';

    const preview = [
      `📖 *${storyData.title}*\n`,
      `📅 ${storyData.period} | 📍 ${storyData.location}${durLine}`,
      `\n*الملخص:*\n${storyData.summary}`,
      chars ? `\n*الشخصيات:*\n${chars}` : '',
      `\n*لماذا ستجلب مشاهدات؟*\n${storyData.why_viral || ''}`,
      `\n─────────────\n_اضغط "✅ إنشاء الفيديو" لبدء الإنشاء التلقائي_`
    ].filter(Boolean).join('\n');

    await safeEdit(bot, chatId, msgId, preview, storyPreviewKeyboard(story.id));
  } catch (err) {
    logger.error('SEARCH', err.message);
    await safeEdit(bot, chatId, msgId,
      `❌ فشل البحث: ${err.message}\n\nاختر فئة أخرى:`,
      categoryKeyboard()
    );
  }
}

async function handleSingleVideoGeneration(bot, chatId, msgId, userId, story, durCfg, progressCallback, hasYouTube) {
  const storyId = story.id;
  const sceneCount = durCfg?.scenes || story.scenes_per_part || 7;
  const secPerScene = durCfg?.secPerScene || story.sec_per_scene || 26;

  // Generate or reuse script
  let script = story.script_data;
  if (!script?.scenes?.length) {
    await progressCallback(`📝 كتابة السيناريو (${sceneCount} مشاهد)...`);
    script = await generateStoryScript(story.story_data, story.language, sceneCount, secPerScene);
    await updateStory(storyId, { script_data: script, total_scenes: script.scenes?.length || 0 });
  }

  const result = await generateStoryVideo(
    { ...story, id: storyId }, script,
    { language: story.language, voiceId: story.voice_id, progressCallback }
  );

  await progressCallback('☁️ رفع الفيديو...');
  let videoUrl = null;
  try {
    videoUrl = await uploadVideoToStorage(result.videoPath, `story_${storyId}_${Date.now()}.mp4`);
  } catch (e) {
    logger.warn('STORAGE', `Upload failed: ${e.message}`);
  }

  await updateStory(storyId, { status: 'video_ready', video_url: videoUrl });

  const durationSec = result.durationSeconds || (sceneCount * secPerScene);
  const fileMB = result.fileSizeMB || 0;

  await bot.editMessageText(
    `✅ *الفيديو جاهز!*\n_${story.title}_\n\n` +
    `⏱️ ${Math.round(durationSec / 60)} دقيقة ${durationSec % 60} ثانية\n` +
    `📦 ${fileMB.toFixed(1)} MB\n\nجاري الإرسال...`,
    { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
  );

  const caption = `🎬 *${story.title}*\n\n${(story.summary || '').substring(0, 200)}\n\n📅 ${story.period || ''} | 📍 ${story.location || ''}`;

  await bot.sendVideo(chatId, result.videoPath, {
    caption, parse_mode: 'Markdown', supports_streaming: true,
    ...afterVideoKeyboard(storyId, hasYouTube)
  });

  await fs.remove(result.videoPath).catch(() => {});
  await logAutoPublish(userId, storyId, 'generate_video', 'success');
}

async function handleSplitVideoGeneration(bot, chatId, msgId, userId, story, durCfg, progressCallback, hasYouTube) {
  const storyId   = story.id;
  const totalParts = story.split_parts || durCfg?.split || 3;
  const sceneCount = durCfg?.scenes || story.scenes_per_part || 7;
  const secPerScene = durCfg?.secPerScene || story.sec_per_scene || 29;

  await progressCallback(`🎞️ إنشاء ${totalParts} أجزاء — ${sceneCount} مشاهد × ${totalParts}...`);

  const results = await generateSplitVideos(
    { ...story, id: storyId },
    { totalParts, sceneCount, secPerScene, language: story.language, voiceId: story.voice_id },
    async (partNum, msg) => {
      await progressCallback(`📦 الجزء ${partNum}/${totalParts}: ${msg}`);
    }
  );

  await updateStory(storyId, { status: 'video_ready', total_scenes: totalParts * sceneCount });

  await bot.editMessageText(
    `✅ *${totalParts} أجزاء جاهزة!*\n_${story.title}_\n\nجاري الإرسال...`,
    { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
  );

  for (let i = 0; i < results.length; i++) {
    const part = results[i];
    const partLabel = `الجزء ${i + 1} من ${totalParts}`;
    const caption = `🎬 *${story.title}*\n📹 ${partLabel}\n\n${(story.summary || '').substring(0, 150)}`;

    try {
      await bot.sendVideo(chatId, part.videoPath, {
        caption, parse_mode: 'Markdown', supports_streaming: true,
        ...(i === results.length - 1 ? afterVideoKeyboard(storyId, hasYouTube) : {})
      });
    } catch (err) {
      logger.warn('SEND', `Part ${i + 1} send failed: ${err.message}`);
    }

    await fs.remove(part.videoPath).catch(() => {});
    await new Promise(r => setTimeout(r, 1500)); // gap between sends
  }

  await logAutoPublish(userId, storyId, 'generate_split_video', 'success');
}
