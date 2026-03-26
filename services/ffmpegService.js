import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../temp');
fs.ensureDirSync(TEMP_DIR);
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Convert image to video (15 seconds with zoom effect)
 * Used when HuggingFace returns an image instead of video
 */
export async function imageToVideo(imagePath, durationSeconds = 15) {
  const outputName = `vid_${Date.now()}.mp4`;
  const outputPath = path.join(TEMP_DIR, outputName);

  logger.video(`Converting image to ${durationSeconds}s video`);

  return new Promise((resolve, reject) => {
    ffmpeg(imagePath)
      .inputOptions([
        '-loop 1',
        `-t ${durationSeconds}`
      ])
      .outputOptions([
        '-vf scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2,zoompan=z=\'min(zoom+0.0015,1.5)\':d=1:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=512x512',
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-r 25',
        '-preset fast',
        '-movflags +faststart'
      ])
      .on('end', () => {
        logger.success('FFMPEG', `Image→Video: ${outputName}`);
        resolve(outputPath);
      })
      .on('error', async (err) => {
        logger.warn('FFMPEG', `Zoom effect failed, using simple loop: ${err.message}`);
        // Fallback: simple static video
        try {
          const result = await imageToVideoSimple(imagePath, durationSeconds);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      })
      .save(outputPath);
  });
}

/**
 * Simple image to video (no zoom effect, more compatible)
 */
async function imageToVideoSimple(imagePath, durationSeconds = 15) {
  const outputName = `vid_simple_${Date.now()}.mp4`;
  const outputPath = path.join(TEMP_DIR, outputName);

  return new Promise((resolve, reject) => {
    ffmpeg(imagePath)
      .inputOptions(['-loop 1', `-t ${durationSeconds}`])
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-r 25',
        '-preset fast',
        '-movflags +faststart'
      ])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

/**
 * Merge video + audio into final video
 */
export async function mergeVideoAudio(videoOrImagePath, audioPath) {
  // Check if it's an image - convert first
  const ext = path.extname(videoOrImagePath).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);

  let videoPath = videoOrImagePath;
  if (isImage) {
    logger.video('Input is image, converting to video first...');
    videoPath = await imageToVideo(videoOrImagePath, 20);
  }

  const outputName = `final_${Date.now()}.mp4`;
  const outputPath = path.join(TEMP_DIR, outputName);

  logger.video('Merging video + audio');

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-shortest',
        '-movflags +faststart',
        '-pix_fmt yuv420p',
        '-preset fast'
      ])
      .on('end', () => {
        logger.success('FFMPEG', `Final video: ${outputName}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error('FFMPEG', `Merge failed: ${err.message}`);
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * Loop short video to reach target duration
 */
export async function loopVideoToMinDuration(videoPath, minSeconds = 10) {
  const outputName = `looped_${Date.now()}.mp4`;
  const outputPath = path.join(TEMP_DIR, outputName);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .inputOptions(['-stream_loop 10'])
      .outputOptions([
        `-t ${minSeconds}`,
        '-c:v libx264',
        '-c:a aac',
        '-movflags +faststart',
        '-pix_fmt yuv420p',
        '-preset fast'
      ])
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

/**
 * Get video/image duration in seconds (returns 0 for images)
 */
export function getVideoDuration(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return Promise.resolve(0);

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return resolve(0);
      resolve(meta.format.duration || 0);
    });
  });
}

/**
 * Clean temp files older than 2 hours
 */
export async function cleanupTempFiles() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    const twoHours = 2 * 60 * 60 * 1000;
    for (const file of files) {
      const fp = path.join(TEMP_DIR, file);
      const stat = await fs.stat(fp);
      if (Date.now() - stat.mtimeMs > twoHours) {
        await fs.remove(fp);
        logger.debug('CLEANUP', `Removed: ${file}`);
      }
    }
  } catch (e) {
    logger.warn('CLEANUP', e.message);
  }
}
