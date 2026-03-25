import cron from 'node-cron';
import { getAllActiveSeries, getNextPendingEpisode, updateEpisode, updateSeries, getYouTubeChannel, logAutoPublish } from '../db/database.js';
import { generateEpisodeVideo } from '../services/videoPipeline.js';
import { uploadToYouTube, uploadWithEnvCredentials } from '../services/youtubeService.js';
import { logger } from '../utils/logger.js';
import { cleanupTempFiles } from '../services/ffmpegService.js';
import fs from 'fs-extra';
import dotenv from 'dotenv';
dotenv.config();

let botInstance = null;

export function setBotInstance(bot) {
  botInstance = bot;
}

/**
 * Process one episode of a series: generate + upload + notify
 */
async function processEpisode(series) {
  logger.cron(`Processing series: ${series.title} (ID: ${series.id})`);

  const episode = await getNextPendingEpisode(series.id);
  if (!episode) {
    logger.cron(`No pending episodes for series ${series.title}`);
    await updateSeries(series.id, { status: 'completed' });
    return;
  }

  logger.cron(`Processing episode ${episode.episode_number}: ${episode.title}`);

  try {
    // Update episode status
    await updateEpisode(episode.id, { status: 'generating' });

    // Generate video
    const result = await generateEpisodeVideo(episode, series);
    
    if (!result.success) throw new Error('Video generation failed');

    const videoPath = result.videoPath;

    // Get YouTube channel - check user's channel first, then env
    let youtubeResult = null;
    const userChannel = await getYouTubeChannel(series.user_id);
    
    const title = `${series.title} - ${episode.title}`;
    const description = `${series.description || ''}\n\nالحلقة ${episode.episode_number}: ${episode.title}\n\n${result.narrationText}\n\n#أنيمي #AI #Shorts`;
    const tags = ['أنيمي', 'anime', 'AI', 'Shorts', 'animation', series.genre];

    if (userChannel) {
      youtubeResult = await uploadToYouTube(
        videoPath, title, description, tags,
        userChannel.client_id, userChannel.client_secret, userChannel.refresh_token
      );
    } else {
      // Use env YouTube credentials
      youtubeResult = await uploadWithEnvCredentials(videoPath, title, description, tags);
    }

    // Update episode as published
    await updateEpisode(episode.id, {
      status: 'published',
      video_url: youtubeResult.url,
      youtube_video_id: youtubeResult.videoId,
      youtube_url: youtubeResult.shortsUrl,
      published_at: new Date().toISOString()
    });

    // Update series current episode
    await updateSeries(series.id, { current_episode: episode.episode_number });

    // Log success
    await logAutoPublish(series.user_id, series.id, episode.id, 'auto_publish', 'success', {
      youtube_url: youtubeResult.shortsUrl
    });

    // Notify user via Telegram
    if (botInstance) {
      try {
        await botInstance.sendMessage(
          series.user_id,
          `🎉 تم نشر حلقة جديدة تلقائياً!\n\n📺 المسلسل: ${series.title}\n🎬 الحلقة ${episode.episode_number}: ${episode.title}\n\n🔗 شاهدها: ${youtubeResult.shortsUrl}`
        );
      } catch (notifyErr) {
        logger.warn('CRON', `Could not notify user ${series.user_id}: ${notifyErr.message}`);
      }
    }

    logger.success('CRON', `Episode ${episode.episode_number} published: ${youtubeResult.shortsUrl}`);

    // Cleanup video file
    await fs.remove(videoPath).catch(() => {});

  } catch (error) {
    logger.error('CRON', `Failed episode ${episode.episode_number}: ${error.message}`);
    
    await updateEpisode(episode.id, {
      status: 'failed',
      error_message: error.message
    });

    await logAutoPublish(series.user_id, series.id, episode.id, 'auto_publish', 'failed', {
      error: error.message
    });

    // Notify user of failure
    if (botInstance) {
      try {
        await botInstance.sendMessage(
          series.user_id,
          `⚠️ فشل نشر حلقة من مسلسل "${series.title}"\n\nالحلقة ${episode.episode_number}: ${episode.title}\nالخطأ: ${error.message}\n\nسيتم المحاولة غداً.`
        );
      } catch (e) {}
    }
  }
}

/**
 * Daily job: process one episode per active series
 */
async function dailyPublishJob() {
  logger.cron('=== Starting daily publish job ===');
  
  try {
    const allSeries = await getAllActiveSeries();
    logger.cron(`Found ${allSeries.length} active series`);

    for (const series of allSeries) {
      try {
        await processEpisode(series);
        // Small delay between series to avoid API rate limits
        await new Promise(r => setTimeout(r, 5000));
      } catch (err) {
        logger.error('CRON', `Series ${series.id} failed: ${err.message}`);
      }
    }

    // Cleanup temp files
    await cleanupTempFiles();
    logger.cron('=== Daily publish job completed ===');
  } catch (error) {
    logger.error('CRON', `Daily job failed: ${error.message}`);
  }
}

/**
 * Initialize cron jobs
 */
export function initCronJobs() {
  // Daily at 10:00 UTC (1 PM KSA)
  cron.schedule('0 10 * * *', async () => {
    logger.cron('Triggered daily publish job (10:00 UTC)');
    await dailyPublishJob();
  }, { timezone: 'UTC' });

  // Cleanup every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    logger.cron('Running cleanup job');
    await cleanupTempFiles();
  });

  logger.success('CRON', 'Cron jobs initialized: daily publish at 10:00 UTC');
}

/**
 * Manually trigger publish for a specific series (for testing)
 */
export async function triggerManualPublish(seriesId) {
  const { getSeriesById } = await import('../db/database.js');
  const series = await getSeriesById(seriesId);
  if (!series) throw new Error('Series not found');
  await processEpisode(series);
}
