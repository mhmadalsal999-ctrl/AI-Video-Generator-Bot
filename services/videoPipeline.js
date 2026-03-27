/**
 * videoPipeline.js
 * Orchestrates the full story → video pipeline:
 * Script scenes → Images → Voice → Scene videos → Concat → Music → Final MP4
 */

import { generateImageFromPrompt } from './huggingfaceService.js';
import { generateAudio } from './elevenLabsService.js';
import {
  imageToVideoKenBurns,
  mergeVideoAudio,
  concatenateScenes,
  addBackgroundMusic,
  getVideoDuration,
  cleanupTempFiles
} from './ffmpegService.js';
import { updateStory, updateScene, logAutoPublish } from '../db/database.js';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../temp');

// Background music URLs by story tone (royalty-free)
const MUSIC_URLS = {
  epic:       process.env.MUSIC_EPIC_URL       || null,
  mysterious: process.env.MUSIC_MYSTERIOUS_URL || null,
  tragic:     process.env.MUSIC_TRAGIC_URL     || null,
  inspiring:  process.env.MUSIC_INSPIRING_URL  || null,
  horror:     process.env.MUSIC_HORROR_URL     || null
};

function getMusicUrl(tone) {
  if (process.env.BACKGROUND_MUSIC_URL) return process.env.BACKGROUND_MUSIC_URL;
  return MUSIC_URLS[tone] || null;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PIPELINE: Story script → Final YouTube-ready video
// ═══════════════════════════════════════════════════════════════════
export async function generateStoryVideo(story, script, settings = {}) {
  const { language = 'ar', voiceId = null, progressCallback = null } = settings;
  const intermediateFiles = [];

  logger.video(`=== Starting pipeline: "${story.title}" (${script.scenes?.length} scenes) ===`);

  const notify = async (msg) => {
    if (progressCallback) {
      try { await progressCallback(msg); } catch (_) {}
    }
  };

  try {
    const scenes = script.scenes || [];
    if (!scenes.length) throw new Error('No scenes in script');

    const sceneVideoPaths = [];

    // ── Process each scene ─────────────────────────────────────────
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const sceneNum = i + 1;
      const totalScenes = scenes.length;

      logger.video(`Processing scene ${sceneNum}/${totalScenes}: "${scene.scene_title}"`);
      await notify(`🎬 مشهد ${sceneNum}/${totalScenes}: توليد الصورة...`);

      let imagePath, audioPath, videoPath, mergedPath;

      try {
        // 1. Generate scene image
        imagePath = await generateImageFromPrompt(scene.image_prompt);
        intermediateFiles.push(imagePath);

        // 2. Generate narration audio
        await notify(`🎙️ مشهد ${sceneNum}/${totalScenes}: توليد الصوت...`);
        audioPath = await generateAudio(
          scene.narration,
          voiceId,
          language,
          scene.voice_tone || script.narrator_tone || 'dramatic'
        );
        intermediateFiles.push(audioPath);

        // 3. Get audio duration to set video length
        const audioDuration = await getVideoDuration(audioPath);
        const videoDuration = Math.max(audioDuration + 2, scene.duration_seconds || 35);

        // 4. Convert image to video with Ken Burns effect
        await notify(`🖼️ مشهد ${sceneNum}/${totalScenes}: معالجة الفيديو...`);
        videoPath = await imageToVideoKenBurns(imagePath, videoDuration);
        intermediateFiles.push(videoPath);

        // 5. Merge video + audio for this scene
        mergedPath = await mergeVideoAudio(videoPath, audioPath);
        intermediateFiles.push(mergedPath);
        sceneVideoPaths.push(mergedPath);

        logger.success('PIPELINE', `Scene ${sceneNum}/${totalScenes} complete`);

      } catch (sceneErr) {
        logger.error('PIPELINE', `Scene ${sceneNum} failed: ${sceneErr.message} — skipping`);
        // Skip failed scene but continue with rest
        await notify(`⚠️ مشهد ${sceneNum} فشل، جاري تخطيه...`);
      }
    }

    if (sceneVideoPaths.length === 0) {
      throw new Error('كل المشاهد فشلت في التوليد. تحقق من مفاتيح API.');
    }

    // ── Concatenate all scenes ─────────────────────────────────────
    await notify(`🎞️ دمج ${sceneVideoPaths.length} مشهد في فيديو واحد...`);
    let finalVideo;

    if (sceneVideoPaths.length === 1) {
      finalVideo = sceneVideoPaths[0];
    } else {
      finalVideo = await concatenateScenes(sceneVideoPaths);
      intermediateFiles.push(finalVideo);
    }

    // ── Add background music ───────────────────────────────────────
    await notify('🎵 إضافة الموسيقى الخلفية...');
    const musicUrl = getMusicUrl(story.tone || script.narrator_tone);
    const withMusic = await addBackgroundMusic(finalVideo, {
      musicUrl,
      volume: 0.12
    });

    if (withMusic !== finalVideo) {
      intermediateFiles.push(withMusic);
    }

    // ── Get final stats ────────────────────────────────────────────
    const totalDuration = await getVideoDuration(withMusic);
    const fileSize = (await fs.stat(withMusic)).size;

    logger.success('PIPELINE', `Complete! Duration: ${totalDuration.toFixed(1)}s, Size: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

    // Update DB
    try {
      await updateStory(story.id, { status: 'video_ready' });
    } catch (_) {}

    return {
      success: true,
      videoPath: withMusic,
      durationSeconds: totalDuration,
      fileSizeMB: fileSize / 1024 / 1024,
      scenesCompleted: sceneVideoPaths.length,
      totalScenes: scenes.length
    };

  } catch (error) {
    logger.error('PIPELINE', `Pipeline failed: ${error.message}`);

    try {
      await updateStory(story.id, { status: 'failed', error_message: error.message });
    } catch (_) {}

    throw error;

  } finally {
    // Cleanup intermediate files (keep final output)
    for (const f of intermediateFiles) {
      await fs.remove(f).catch(() => {});
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SPLIT VIDEO: Generate multiple part videos (for 10-min stories)
// ═══════════════════════════════════════════════════════════════════
export async function generateSplitVideos(story, settings = {}, partProgressCallback = null) {
  const {
    totalParts = 3,
    sceneCount = 7,
    secPerScene = 29,
    language = 'ar',
    voiceId = null
  } = settings;

  logger.video(`=== Split video: ${totalParts} parts, ${sceneCount} scenes each ===`);

  const { generateStoryScriptPart } = await import('./groqService.js');
  const results = [];

  for (let partNum = 1; partNum <= totalParts; partNum++) {
    const notify = async (msg) => {
      if (partProgressCallback) {
        try { await partProgressCallback(partNum, msg); } catch (_) {}
      }
    };

    await notify(`📝 كتابة السيناريو...`);
    const script = await generateStoryScriptPart(
      story.story_data || story, language, partNum, totalParts, sceneCount, secPerScene
    );

    await notify(`🎬 إنشاء الفيديو...`);
    const result = await generateStoryVideo(
      { ...story, title: `${story.title} - الجزء ${partNum}` },
      script,
      { language, voiceId, progressCallback: notify }
    );

    results.push({ ...result, partNumber: partNum });
    logger.success('SPLIT', `Part ${partNum}/${totalParts} complete`);
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// QUICK PREVIEW: Single-scene clip for fast preview
// ═══════════════════════════════════════════════════════════════════
export async function generateScenePreview(scene, story, language = 'ar') {
  const tempFiles = [];

  try {
    logger.video(`Generating preview for scene: "${scene.scene_title}"`);

    const imagePath = await generateImageFromPrompt(scene.image_prompt);
    tempFiles.push(imagePath);

    const audioPath = await generateAudio(
      scene.narration.substring(0, 200) + '...',
      null,
      language,
      scene.voice_tone || 'dramatic'
    );
    tempFiles.push(audioPath);

    const videoPath = await imageToVideoKenBurns(imagePath, 20);
    tempFiles.push(videoPath);

    const merged = await mergeVideoAudio(videoPath, audioPath);
    return merged;

  } finally {
    for (const f of tempFiles) {
      await fs.remove(f).catch(() => {});
    }
  }
}
