/**
 * callbackHandler.js — Staged pipeline: Script → Images → Audio → Video
 * Story Narrator Bot v4.0
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
  afterScriptKeyboard, afterImagesKeyboard, afterAudioKeyboard, afterVideoKeyboard,
  youtubeSetupKeyboard, confirmKeyboard, backToMainKeyboard,
  WELCOME_MSG, CATEGORY_LABELS, STATUS_LABELS, DURATION_CONFIG,
  pipelineProgressText
} from '../messages.js';
import {
  findHistoricalStory, generateStoryScript,
  generateStoryScriptPart, generateYouTubeMetadata
} from '../../services/groqService.js';
import { generateImageFromPrompt } from '../../services/huggingfaceService.js';
import { generateAudio } from '../../services/elevenLabsService.js';
import {
  imageToVideoKenBurns, mergeVideoAudio,
  concatenateScenes, addBackgroundMusic, cleanupTempFiles
} from '../../services/ffmpegService.js';
import { generateStoryVideo, generateSplitVideos } from '../../services/videoPipeline.js';
import { uploadWithEnvCredentials } from '../../services/youtubeService.js';
import { uploadVideoToStorage } from '../../utils/storage.js';
import { logger } from '../../utils/logger.js';
import { STATES } from './messageHandler.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../../temp');
fs.ensureDirSync(TEMP_DIR);

// ── Helpers ───────────────────────────────────────────────────────────
async function safeEdit(bot, chatId, msgId, text, options = {}) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...options
    });
  } catch (_) {}
}

function makeProgressCallback(bot, chatId, msgId, title, stage) {
  return async (detail) => {
    try {
      await bot.editMessageText(
        pipelineProgressText(title, stage, detail),
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

  try { await bot.answerCallbackQuery(query.id); } catch (_) {}
  logger.bot(`CB ${userId}: ${data}`);

  const stateData = await getUserState(userId);
  const tempData  = stateData?.temp_data || {};

  // ── STEP 1: CATEGORY ─────────────────────────────────────────────
  if (data.startsWith('cat:')) {
    const category = data.split(':')[1];
    await setUserState(userId, STATES.IDLE, { category });
    await safeEdit(bot, chatId, msgId,
      `${CATEGORY_LABELS[category]}\n\n*اختر لغة الراوي:*`,
      languageKeyboard()
    );
    return;
  }

  // ── STEP 2: LANGUAGE ─────────────────────────────────────────────
  if (data.startsWith('lang:')) {
    const language = data.split(':')[1];
    if (!tempData.category) {
      await safeEdit(bot, chatId, msgId, '❌ اختر الفئة أولاً.', categoryKeyboard());
      return;
    }
    await setUserState(userId, STATES.IDLE, { ...tempData, language });
    await safeEdit(bot, chatId, msgId,
      `⏱️ *اختر مدة الفيديو:*`,
      durationKeyboard()
    );
    return;
  }

  // ── STEP 3: DURATION ─────────────────────────────────────────────
  if (data.startsWith('dur:')) {
    const durKey = data.split(':')[1];
    const durCfg = DURATION_CONFIG[durKey];
    if (!durCfg) return;
    await setUserState(userId, STATES.IDLE, { ...tempData, durKey, durCfg });
    if (durKey === '10') {
      await safeEdit(bot, chatId, msgId,
        `🎞️ *فيديو 10 دقائق!*\n\n*كيف توزيعه؟*\n\n📦 *3 أجزاء منفصلة* — أكثر مشاهدات\n🎬 *فيديو واحد* — ملف كامل`,
        splitKeyboard()
      );
      return;
    }
    await searchAndShowStory(bot, chatId, msgId, userId, { ...tempData, durKey, durCfg, splitMode: false });
    return;
  }

  // ── STEP 3b: SPLIT ───────────────────────────────────────────────
  if (data.startsWith('split:')) {
    const splitMode = data === 'split:yes';
    await setUserState(userId, STATES.IDLE, { ...tempData, splitMode });
    await searchAndShowStory(bot, chatId, msgId, userId, { ...tempData, splitMode });
    return;
  }

  // ── ANOTHER STORY ────────────────────────────────────────────────
  if (data.startsWith('another:')) {
    const nextIndex = (tempData.searchRetry || 0) + 1;
    if (!tempData.category) {
      await safeEdit(bot, chatId, msgId, '📚 اختر فئة أولاً:', categoryKeyboard());
      return;
    }
    await safeEdit(bot, chatId, msgId, '🔍 *جاري البحث عن قصة مختلفة...*\n\n⏳ لحظة...');
    try {
      const storyData = await findHistoricalStory(tempData.category, tempData.language || 'ar', nextIndex);
      const durKey = tempData.durKey || '3';
      const durCfg = DURATION_CONFIG[durKey];
      const story = await createStory(userId, {
        category: tempData.category, language: tempData.language || 'ar',
        title: storyData.title, period: storyData.period,
        location: storyData.location, summary: storyData.summary,
        story_data: storyData, narrator_tone: storyData.tone || 'dramatic',
        duration_minutes: parseInt(durKey), split_parts: durCfg?.split || 1,
        scenes_per_part: durCfg?.scenes || 7, sec_per_scene: durCfg?.secPerScene || 26
      });
      await setUserState(userId, STATES.IDLE, {
        ...tempData, storyId: story.id, pendingStory: storyData, searchRetry: nextIndex
      });
      await safeEdit(bot, chatId, msgId, buildStoryPreviewText(storyData, durCfg), storyPreviewKeyboard(story.id));
    } catch (err) {
      await safeEdit(bot, chatId, msgId, `❌ ${err.message}`, categoryKeyboard());
    }
    return;
  }

  // ── STAGED PIPELINE ──────────────────────────────────────────────
  if (data.startsWith('step:')) {
    const parts   = data.split(':');
    const stage   = parts[1];           // script | images | audio | video
    const storyId = parseInt(parts[2]);
    const story   = await getStoryById(storyId);
    if (!story) { await bot.answerCallbackQuery(query.id, { text: '❌ القصة غير موجودة' }); return; }

    switch (stage) {
      case 'script': return await runScriptStage(bot, chatId, msgId, userId, story);
      case 'images': return await runImagesStage(bot, chatId, msgId, userId, story);
      case 'audio':  return await runAudioStage(bot, chatId, msgId, userId, story);
      case 'video':  return await runVideoStage(bot, chatId, msgId, userId, story);
    }
    return;
  }

  // ── VIEW SCRIPT ──────────────────────────────────────────────────
  if (data.startsWith('script:')) {
    const storyId = parseInt(data.split(':')[1]);
    const story = await getStoryById(storyId);
    if (!story) return;
    const script = story.script_data;
    if (!script?.scenes?.length) {
      await safeEdit(bot, chatId, msgId,
        '⏳ السيناريو لم يُنشأ بعد.\n\nاضغط "📝 إنشاء السيناريو" أولاً.',
        storyPreviewKeyboard(storyId)
      );
      return;
    }
    const scenesText = script.scenes.map((s, i) =>
      `*${i + 1}. ${s.scene_title || ''}*\n${(s.narration || '').substring(0, 200)}`
    ).join('\n\n──\n\n');
    const header = `📝 *سيناريو: ${story.title}*\n${script.scenes.length} مشاهد | ${story.duration_minutes || 3} دقيقة\n\n`;
    await safeEdit(bot, chatId, msgId,
      (header + scenesText).substring(0, 4000),
      storyDetailKeyboard(story)
    );
    return;
  }

  // ── PUBLISH YOUTUBE ──────────────────────────────────────────────
  if (data.startsWith('publish:')) {
    const storyId = parseInt(data.split(':')[1]);
    const story = await getStoryById(storyId);
    if (!story) return;
    const channel = await getYouTubeChannel(userId);
    if (!channel) {
      await safeEdit(bot, chatId, msgId,
        '❌ لم تربط قناتك بعد.\n\nاذهب إلى "📺 إعداد يوتيوب".',
        backToMainKeyboard()
      );
      return;
    }
    if (!story.video_url) {
      await safeEdit(bot, chatId, msgId,
        '❌ الفيديو غير موجود في التخزين. أعد إنشاؤه.',
        storyDetailKeyboard(story)
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
        `✅ *تم النشر على يوتيوب!*\n\n📺 ${ytMeta.title || story.title}\n\n🔗 ${result.shortsUrl || result.url}`,
        backToMainKeyboard()
      );
      await logAutoPublish(userId, storyId, 'youtube_publish', 'success', { videoId: result.videoId });
    } catch (err) {
      await safeEdit(bot, chatId, msgId, `❌ فشل النشر: ${err.message}`, storyDetailKeyboard(story));
    }
    return;
  }

  // ── STORY DETAIL ─────────────────────────────────────────────────
  if (data.startsWith('story:')) {
    const storyId = parseInt(data.split(':')[1]);
    const story = await getStoryById(storyId);
    if (!story) { await bot.answerCallbackQuery(query.id, { text: '❌ القصة غير موجودة' }); return; }
    const status  = STATUS_LABELS[story.status] || story.status;
    const durInfo = story.duration_minutes ? `⏱️ ${story.duration_minutes} دقيقة\n` : '';
    const ytLink  = story.youtube_url ? `\n📺 [مشاهدة على يوتيوب](${story.youtube_url})` : '';
    await safeEdit(bot, chatId, msgId,
      `📖 *${story.title}*\n\n📅 ${story.period || '—'} | 📍 ${story.location || '—'}\n📊 ${status}\n${durInfo}${ytLink}\n\n*الملخص:*\n${story.summary || '—'}`,
      storyDetailKeyboard(story)
    );
    return;
  }

  // ── YOUTUBE SETUP ────────────────────────────────────────────────
  if (data === 'yt:setup') {
    await setUserState(userId, STATES.YT_CLIENT_ID, {});
    await safeEdit(bot, chatId, msgId,
      `🔧 *ربط قناة يوتيوب*\n\n*الخطوة 1/3*\nأرسل *Client ID* من Google Cloud Console:\n\n_console.cloud.google.com → APIs → OAuth 2.0 Client IDs_`
    );
    return;
  }

  if (data === 'yt:help') {
    await safeEdit(bot, chatId, msgId,
      `❓ *كيف تحصل على بيانات يوتيوب؟*\n\n1️⃣ console.cloud.google.com\n2️⃣ أنشئ مشروعاً جديداً\n3️⃣ فعّل YouTube Data API v3\n4️⃣ أنشئ OAuth 2.0 Client ID\n5️⃣ استخدم OAuth Playground للحصول على Refresh Token\n\n_developers.google.com/oauthplayground_`,
      youtubeSetupKeyboard()
    );
    return;
  }

  // ── DELETE ───────────────────────────────────────────────────────
  if (data.startsWith('delete:')) {
    const storyId = parseInt(data.split(':')[1]);
    await safeEdit(bot, chatId, msgId,
      '🗑️ *هل أنت متأكد من الحذف؟*',
      confirmKeyboard('delete', storyId)
    );
    return;
  }

  if (data.startsWith('confirm:delete:')) {
    const storyId = parseInt(data.split(':')[2]);
    await updateStory(storyId, { status: 'deleted' });
    await safeEdit(bot, chatId, msgId, '✅ تم الحذف بنجاح.');
    await bot.sendMessage(chatId, 'القائمة الرئيسية:', mainKeyboard());
    return;
  }

  // ── NAVIGATION ───────────────────────────────────────────────────
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
    await safeEdit(bot, chatId, msgId, `⏱️ *اختر مدة الفيديو:*`, durationKeyboard());
    return;
  }
  if (data === 'back:library') {
    const stories = await getUserStories(userId);
    if (!stories.length) {
      await safeEdit(bot, chatId, msgId, '📭 مكتبتك فارغة. أنشئ قصتك الأولى!', backToMainKeyboard());
      return;
    }
    await safeEdit(bot, chatId, msgId,
      `📚 *مكتبتك (${stories.length} قصة):*`,
      storiesListKeyboard(stories)
    );
    return;
  }

  logger.warn('BOT', `Unknown callback: ${data}`);
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 1: SCRIPT
// ═══════════════════════════════════════════════════════════════════
async function runScriptStage(bot, chatId, msgId, userId, story) {
  const storyId   = story.id;
  const durKey    = String(story.duration_minutes || 3);
  const durCfg    = DURATION_CONFIG[durKey] || DURATION_CONFIG['3'];
  const sceneCount   = durCfg.scenes;
  const secPerScene  = durCfg.secPerScene;

  await updateStory(storyId, { status: 'generating' });
  const progress = makeProgressCallback(bot, chatId, msgId, story.title, 'script');
  await progress(`كتابة ${sceneCount} مشهد بالذكاء الاصطناعي...`);

  try {
    const script = await generateStoryScript(story.story_data, story.language, sceneCount, secPerScene);
    await updateStory(storyId, {
      script_data: script,
      total_scenes: script.scenes?.length || 0,
      status: 'script_done'
    });

    const sceneSummary = script.scenes?.slice(0, 3).map((s, i) =>
      `${i + 1}. ${s.scene_title || ''}`
    ).join('\n') + (script.scenes?.length > 3 ? '\n...' : '');

    await safeEdit(bot, chatId, msgId,
      `✅ *السيناريو جاهز!*\n_${story.title}_\n\n📝 ${script.scenes?.length} مشاهد\n\n${sceneSummary}\n\n*اضغط التالي لإنشاء الصور:*`,
      afterScriptKeyboard(storyId)
    );
    await logAutoPublish(userId, storyId, 'script', 'success');
  } catch (err) {
    await updateStory(storyId, { status: 'failed' });
    await safeEdit(bot, chatId, msgId,
      `❌ *فشل إنشاء السيناريو*\n\n${err.message}`,
      storyDetailKeyboard({ ...story, status: 'pending' })
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 2: IMAGES
// ═══════════════════════════════════════════════════════════════════
async function runImagesStage(bot, chatId, msgId, userId, story) {
  const storyId = story.id;
  const script  = story.script_data;

  if (!script?.scenes?.length) {
    await safeEdit(bot, chatId, msgId,
      '⚠️ *أنشئ السيناريو أولاً!*',
      storyDetailKeyboard({ ...story, status: 'pending' })
    );
    return;
  }

  await updateStory(storyId, { status: 'generating' });
  const progress = makeProgressCallback(bot, chatId, msgId, story.title, 'images');

  const scenes = script.scenes;
  const imagePaths = [];

  try {
    for (let i = 0; i < scenes.length; i++) {
      await progress(`إنشاء صورة ${i + 1} من ${scenes.length}...`);
      const imgPath = await generateImageFromPrompt(scenes[i].image_prompt || scenes[i].scene_title);
      imagePaths.push(imgPath);
    }

    // حفظ مسارات الصور في script_data
    const updatedScript = {
      ...script,
      scenes: scenes.map((s, i) => ({ ...s, image_path: imagePaths[i] }))
    };

    await updateStory(storyId, {
      script_data: updatedScript,
      status: 'images_done'
    });

    await safeEdit(bot, chatId, msgId,
      `✅ *الصور جاهزة!*\n_${story.title}_\n\n🖼️ ${imagePaths.length} صورة تم إنشاؤها\n\n*اضغط التالي لتوليد الصوت:*`,
      afterImagesKeyboard(storyId)
    );
    await logAutoPublish(userId, storyId, 'images', 'success');
  } catch (err) {
    await updateStory(storyId, { status: 'images_done' }); // نكمل حتى لو فشلت صورة
    await safeEdit(bot, chatId, msgId,
      `⚠️ *بعض الصور فشلت*\n\n${err.message}\n\nيمكنك المتابعة للصوت:`,
      afterImagesKeyboard(storyId)
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 3: AUDIO
// ═══════════════════════════════════════════════════════════════════
async function runAudioStage(bot, chatId, msgId, userId, story) {
  const storyId = story.id;
  const script  = story.script_data;

  if (!script?.scenes?.length) {
    await safeEdit(bot, chatId, msgId,
      '⚠️ *أنشئ السيناريو أولاً!*',
      storyDetailKeyboard({ ...story, status: 'pending' })
    );
    return;
  }

  await updateStory(storyId, { status: 'generating' });
  const progress = makeProgressCallback(bot, chatId, msgId, story.title, 'audio');

  const scenes = script.scenes;
  const audioPaths = [];

  try {
    for (let i = 0; i < scenes.length; i++) {
      await progress(`توليد صوت المشهد ${i + 1} من ${scenes.length}...`);
      const audioPath = await generateAudio(
        scenes[i].narration || '',
        story.voice_id,
        story.language || 'ar',
        scenes[i].voice_tone || story.narrator_tone || 'dramatic'
      );
      audioPaths.push(audioPath);
    }

    const updatedScript = {
      ...script,
      scenes: scenes.map((s, i) => ({ ...s, audio_path: audioPaths[i] }))
    };

    await updateStory(storyId, {
      script_data: updatedScript,
      status: 'audio_done'
    });

    await safeEdit(bot, chatId, msgId,
      `✅ *الصوت جاهز!*\n_${story.title}_\n\n🎙️ ${audioPaths.length} مقطع صوتي\n\n*اضغط التالي لتجميع الفيديو النهائي:*`,
      afterAudioKeyboard(storyId)
    );
    await logAutoPublish(userId, storyId, 'audio', 'success');
  } catch (err) {
    await updateStory(storyId, { status: 'audio_done' });
    await safeEdit(bot, chatId, msgId,
      `⚠️ *خطأ في الصوت*\n\n${err.message}\n\nيمكنك المتابعة:`,
      afterAudioKeyboard(storyId)
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 4: VIDEO
// ═══════════════════════════════════════════════════════════════════
async function runVideoStage(bot, chatId, msgId, userId, story) {
  const storyId  = story.id;
  const durKey   = String(story.duration_minutes || 3);
  const durCfg   = DURATION_CONFIG[durKey] || DURATION_CONFIG['3'];
  const isSplit  = story.split_parts > 1;

  if (story.status === 'generating') {
    await bot.answerCallbackQuery(undefined, { text: '⏳ الفيديو قيد الإنشاء بالفعل' });
    return;
  }

  await updateStory(storyId, { status: 'generating' });
  const progress = makeProgressCallback(bot, chatId, msgId, story.title, 'video');
  await progress('بدأ تجميع الفيديو...');

  const hasYouTube = !!(await getYouTubeChannel(userId));

  try {
    if (isSplit) {
      await handleSplitVideoGeneration(bot, chatId, msgId, userId, story, durCfg, progress, hasYouTube);
    } else {
      await handleSingleVideoGeneration(bot, chatId, msgId, userId, story, durCfg, progress, hasYouTube);
    }
    await logAutoPublish(userId, storyId, 'video', 'success');
  } catch (err) {
    logger.error('VIDEO', err.message);
    await updateStory(storyId, { status: 'failed', error_message: err.message });
    await safeEdit(bot, chatId, msgId,
      `❌ *فشل إنشاء الفيديو*\n\n${err.message}\n\nحاول مرة أخرى:`,
      storyDetailKeyboard({ ...story, status: 'audio_done' })
    );
    await logAutoPublish(userId, storyId, 'video', 'failed', { error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
function buildStoryPreviewText(storyData, durCfg) {
  const chars = (storyData.key_characters || [])
    .map(c => typeof c === 'object' ? `• ${c.name} — ${c.role}` : `• ${c}`)
    .join('\n');
  const durLine = durCfg ? `\n⏱️ *المدة:* ${durCfg.label} | ${durCfg.scenes} مشهد` : '';
  return [
    `📖 *${storyData.title}*\n`,
    `📅 ${storyData.period} | 📍 ${storyData.location}${durLine}`,
    `\n*الملخص:*\n${storyData.summary}`,
    chars ? `\n*الشخصيات:*\n${chars}` : '',
    storyData.why_viral ? `\n*لماذا ستجلب مشاهدات؟*\n${storyData.why_viral}` : '',
    `\n─────────────\n_اضغط "📝 إنشاء السيناريو" للبدء_`
  ].filter(Boolean).join('\n');
}

async function searchAndShowStory(bot, chatId, msgId, userId, tempDataWithDur) {
  const { category, language, durKey, durCfg, searchRetry = 0 } = tempDataWithDur;
  await safeEdit(bot, chatId, msgId,
    `🔍 *جاري البحث عن قصة ${CATEGORY_LABELS[category]}...*\n⏱️ ${durCfg?.label}\n\n⏳ لحظة...`
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
    await safeEdit(bot, chatId, msgId, buildStoryPreviewText(storyData, durCfg), storyPreviewKeyboard(story.id));
  } catch (err) {
    logger.error('SEARCH', err.message);
    await safeEdit(bot, chatId, msgId,
      `❌ فشل البحث: ${err.message}\n\nاختر فئة أخرى:`,
      categoryKeyboard()
    );
  }
}

async function handleSingleVideoGeneration(bot, chatId, msgId, userId, story, durCfg, progressCallback, hasYouTube) {
  const storyId    = story.id;
  const sceneCount = durCfg?.scenes || story.scenes_per_part || 7;
  const secPerScene = durCfg?.secPerScene || story.sec_per_scene || 26;

  let script = story.script_data;
  if (!script?.scenes?.length) {
    await progressCallback('كتابة السيناريو...');
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
    `✅ *الفيديو جاهز!*\n_${story.title}_\n\n⏱️ ${Math.round(durationSec / 60)}:${String(durationSec % 60).padStart(2,'0')} دقيقة\n📦 ${fileMB.toFixed(1)} MB\n\nجاري الإرسال...`,
    { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
  );

  const caption = `🎬 *${story.title}*\n\n${(story.summary || '').substring(0, 200)}\n\n📅 ${story.period || ''} | 📍 ${story.location || ''}`;
  await bot.sendVideo(chatId, result.videoPath, {
    caption, parse_mode: 'Markdown', supports_streaming: true,
    ...afterVideoKeyboard(storyId, hasYouTube)
  });
  await fs.remove(result.videoPath).catch(() => {});
}

async function handleSplitVideoGeneration(bot, chatId, msgId, userId, story, durCfg, progressCallback, hasYouTube) {
  const storyId    = story.id;
  const totalParts = story.split_parts || durCfg?.split || 3;
  const sceneCount = durCfg?.scenes || story.scenes_per_part || 7;
  const secPerScene = durCfg?.secPerScene || story.sec_per_scene || 29;

  await progressCallback(`إنشاء ${totalParts} أجزاء...`);

  const results = await generateSplitVideos(
    { ...story, id: storyId },
    { totalParts, sceneCount, secPerScene, language: story.language, voiceId: story.voice_id },
    async (partNum, msg) => await progressCallback(`الجزء ${partNum}/${totalParts}: ${msg}`)
  );

  await updateStory(storyId, { status: 'video_ready', total_scenes: totalParts * sceneCount });

  await bot.editMessageText(
    `✅ *${totalParts} أجزاء جاهزة!*\n_${story.title}_\n\nجاري الإرسال...`,
    { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
  );

  for (let i = 0; i < results.length; i++) {
    const part = results[i];
    const caption = `🎬 *${story.title}*\n📹 الجزء ${i + 1} من ${totalParts}\n\n${(story.summary || '').substring(0, 150)}`;
    try {
      await bot.sendVideo(chatId, part.videoPath, {
        caption, parse_mode: 'Markdown', supports_streaming: true,
        ...(i === results.length - 1 ? afterVideoKeyboard(storyId, hasYouTube) : {})
      });
    } catch (err) {
      logger.warn('SEND', `Part ${i + 1} failed: ${err.message}`);
    }
    await fs.remove(part.videoPath).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  }
}
