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
 * Merge video + audio into final video
 */
export async function mergeVideoAudio(videoPath, audioPath) {
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
        '-shortest',          // stop when shortest input ends
        '-movflags +faststart',
        '-pix_fmt yuv420p',
        '-preset fast'
      ])
      .on('end', () => {
        logger.success('FFMPEG', `Merged: ${outputName}`);
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
      .inputOptions([`-stream_loop 10`]) // loop up to 10 times
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
 * Get video duration in seconds
 */
export function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration || 0);
    });
  });
}

/**
 * Add subtitles/text overlay
 */
export async function addTextOverlay(videoPath, text, duration) {
  const outputName = `titled_${Date.now()}.mp4`;
  const outputPath = path.join(TEMP_DIR, outputName);
  const escapedText = text.replace(/'/g, "\\'").replace(/:/g, '\\:');

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        `-vf drawtext=text='${escapedText}':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=h-th-20:box=1:boxcolor=black@0.5:boxborderw=5`,
        '-c:a copy',
        '-preset fast'
      ])
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
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
