/**
 * cronScheduler.js
 * Scheduled jobs for the Story Narrator Bot
 */

import cron from 'node-cron';
import { getAllActiveStories, updateStory, logAutoPublish } from '../db/database.js';
import { generateStoryScript } from './groqService.js';
import { generateStoryVideo } from './videoPipeline.js';
import { uploadVideoToStorage } from '../utils/storage.js';
import { cleanupTempFiles } from './ffmpegService.js';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';

let botInstance = null;

export function setBotInstance(bot) {
  botInstance = bot;
  logger.success('CRON', 'Bot instance registered for notifications');
}

// ── Notify user via bot ───────────────────────────────────────────────
async function notifyUser(userId, message) {
  if (!botInstance || !userId) return;
  try {
    await botInstance.sendMessage(userId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.warn('CRON', `Could not notify user ${userId}: ${err.message}`);
  }
}

// ── Process one pending story ─────────────────────────────────────────
async function processStory(story) {
  logger.cron(`Processing story ${story.id}: "${story.title}"`);

  try {
    // Generate script if needed
    let script = story.script_data;
    if (!script?.scenes?.length) {
      script = await generateStoryScript(story.story_data, story.language);
      await updateStory(story.id, {
        script_data: script,
        total_scenes: script.scenes?.length || 0,
        status: 'generating'
      });
    }

    const result = await generateStoryVideo(
      story,
      script,
      { language: story.language }
    );

    // Upload video
    let videoUrl = null;
    try {
      videoUrl = await uploadVideoToStorage(
        result.videoPath,
        `story_${story.id}_auto.mp4`
      );
    } catch (upErr) {
      logger.warn('CRON', `Storage upload failed: ${upErr.message}`);
    }

    await updateStory(story.id, {
      status: 'video_ready',
      video_url: videoUrl
    });

    // Notify user
    await notifyUser(
      story.user_id,
      `🎬 *فيديو جاهز!*\n\n📖 "${story.title}"\n\nفتح المكتبة: /start`
    );

    await logAutoPublish(story.user_id, story.id, 'auto_generate', 'success');

    // Cleanup
    if (result.videoPath) await fs.remove(result.videoPath).catch(() => {});

    logger.success('CRON', `Story ${story.id} processed successfully`);

  } catch (err) {
    logger.error('CRON', `Story ${story.id} failed: ${err.message}`);
    await updateStory(story.id, { status: 'failed', error_message: err.message });
    await logAutoPublish(story.user_id, story.id, 'auto_generate', 'failed', { error: err.message });
  }
}

// ── Main cron job ─────────────────────────────────────────────────────
async function processAllPendingStories() {
  logger.cron('=== Running pending stories check ===');

  try {
    const stories = await getAllActiveStories();
    const pending = stories.filter(s => s.status === 'pending');

    logger.cron(`Found ${pending.length} pending stories`);

    for (const story of pending) {
      try {
        await processStory(story);
        await new Promise(r => setTimeout(r, 10000)); // 10s delay between stories
      } catch (err) {
        logger.error('CRON', `Error processing story ${story.id}: ${err.message}`);
      }
    }

    await cleanupTempFiles();
    logger.cron('=== Processing complete ===');
  } catch (err) {
    logger.error('CRON', `Cron job failed: ${err.message}`);
  }
}

// ── Initialize all cron jobs ──────────────────────────────────────────
export function initCronJobs() {
  // Check for pending stories every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    logger.cron('Triggered: pending stories check');
    await processAllPendingStories();
  }, { timezone: 'UTC' });

  // Cleanup temp files every 3 hours
  cron.schedule('0 */3 * * *', async () => {
    logger.cron('Triggered: cleanup job');
    await cleanupTempFiles();
  });

  logger.success('CRON', 'Cron jobs initialized: stories check every 30min, cleanup every 3h');
}

// ── Manual trigger for testing ────────────────────────────────────────
export async function triggerManualPublish(storyId) {
  const { getStoryById } = await import('../db/database.js');
  const story = await getStoryById(storyId);
  if (!story) throw new Error('Story not found');
  await processStory(story);
}
