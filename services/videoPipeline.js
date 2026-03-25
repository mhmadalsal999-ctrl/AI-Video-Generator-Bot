import { generateVideoPrompt, generateNarrationText } from './groqService.js';
import { generateImageFromPrompt, generateVideoFromImage } from './huggingfaceService.js';
import { generateAudio } from './elevenLabsService.js';
import { mergeVideoAudio, loopVideoToMinDuration, getVideoDuration, cleanupTempFiles } from './ffmpegService.js';
import { updateEpisode, logAutoPublish } from '../db/database.js';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';

/**
 * Full pipeline: scenario → image → video → audio → merged video
 */
export async function generateEpisodeVideo(episode, series) {
  const tempFiles = [];
  logger.video(`Starting full pipeline for episode ${episode.episode_number}`);

  try {
    // 1. Generate video prompt
    logger.video('Step 1: Generating video prompt...');
    const videoPrompt = await generateVideoPrompt(episode, series.characters || [], series.genre);
    logger.success('VIDEO', `Prompt: ${videoPrompt.substring(0, 80)}...`);

    // 2. Generate narration text
    logger.video('Step 2: Generating narration text...');
    const narrationText = await generateNarrationText(episode, series.characters || [], series.language);
    logger.success('VIDEO', `Narration: ${narrationText.substring(0, 60)}...`);

    // 3. Generate image
    logger.video('Step 3: Generating image...');
    const imagePath = await generateImageFromPrompt(videoPrompt);
    tempFiles.push(imagePath);

    // 4. Generate video from image
    logger.video('Step 4: Generating video from image...');
    let videoPath = await generateVideoFromImage(imagePath, videoPrompt);
    tempFiles.push(videoPath);

    // 5. Check video duration - loop if too short
    const duration = await getVideoDuration(videoPath);
    logger.debug('VIDEO', `Video duration: ${duration}s`);
    if (duration < 10) {
      logger.video('Video too short, looping to 10s...');
      const loopedPath = await loopVideoToMinDuration(videoPath, 10);
      tempFiles.push(loopedPath);
      videoPath = loopedPath;
    }

    // 6. Generate audio
    logger.video('Step 5: Generating audio narration...');
    const audioPath = await generateAudio(narrationText, series.voice_id, series.language);
    tempFiles.push(audioPath);

    // 7. Merge video + audio
    logger.video('Step 6: Merging video + audio...');
    const finalVideoPath = await mergeVideoAudio(videoPath, audioPath);

    // Update episode with local path temporarily
    await updateEpisode(episode.id, {
      status: 'video_ready',
      scenario: episode.scenario
    });

    logger.success('VIDEO', `Episode ${episode.episode_number} pipeline complete!`);
    return { success: true, videoPath: finalVideoPath, narrationText, videoPrompt };

  } catch (error) {
    logger.error('VIDEO', `Pipeline failed for episode ${episode.episode_number}: ${error.message}`);
    await updateEpisode(episode.id, {
      status: 'failed',
      error_message: error.message
    });
    throw error;
  } finally {
    // Clean intermediate files (not final)
    for (const f of tempFiles) {
      await fs.remove(f).catch(() => {});
    }
  }
}
