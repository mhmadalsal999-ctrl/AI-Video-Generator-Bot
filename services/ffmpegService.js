/**
 * ffmpegService.js
 * Video composition engine — images + voice + background music
 * Uses ffmpeg-static (bundled binary, no system install needed)
 */

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

// ═══════════════════════════════════════════════════════════════════
// 1. IMAGE → VIDEO with Ken Burns pan/zoom effect
// ═══════════════════════════════════════════════════════════════════
export async function imageToVideoKenBurns(imagePath, durationSeconds = 35) {
  const outputPath = path.join(TEMP_DIR, `scene_${Date.now()}.mp4`);

  logger.video(`Ken Burns effect: ${durationSeconds}s → ${path.basename(outputPath)}`);

  return new Promise((resolve, reject) => {
    ffmpeg(imagePath)
      .inputOptions(['-loop 1', `-t ${durationSeconds}`])
      .outputOptions([
        '-vf',
        [
          `scale=1920:1080:force_original_aspect_ratio=increase`,
          `crop=1920:1080`,
          `zoompan=z='min(zoom+0.0008,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720`,
          `fps=25`
        ].join(','),
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-preset medium',
        '-crf 22',
        '-movflags +faststart'
      ])
      .on('end', () => {
        logger.success('FFMPEG', `Ken Burns done: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', async (err) => {
        logger.warn('FFMPEG', `Ken Burns failed (${err.message}), using simple loop`);
        try {
          const fallback = await imageToVideoSimple(imagePath, durationSeconds);
          resolve(fallback);
        } catch (e) { reject(e); }
      })
      .save(outputPath);
  });
}

// ── Simple image loop (fallback) ───────────────────────────────────
async function imageToVideoSimple(imagePath, durationSeconds = 35) {
  const outputPath = path.join(TEMP_DIR, `scene_simple_${Date.now()}.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg(imagePath)
      .inputOptions(['-loop 1', `-t ${durationSeconds}`])
      .outputOptions([
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25',
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-preset fast',
        '-crf 23',
        '-movflags +faststart'
      ])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 2. MERGE VIDEO + AUDIO (single scene)
// ═══════════════════════════════════════════════════════════════════
export async function mergeVideoAudio(videoPath, audioPath) {
  const outputPath = path.join(TEMP_DIR, `merged_${Date.now()}.mp4`);

  // If input is an image, convert first
  const ext = path.extname(videoPath).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
  let actualVideoPath = videoPath;
  if (isImage) {
    logger.video('Input is image — converting to video first');
    actualVideoPath = await imageToVideoKenBurns(videoPath, 35);
  }

  logger.video(`Merging video + audio → ${path.basename(outputPath)}`);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(actualVideoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-b:a 192k',
        '-shortest',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-preset medium',
        '-crf 22'
      ])
      .on('end', () => {
        logger.success('FFMPEG', `Merged: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error('FFMPEG', `Merge failed: ${err.message}`);
        reject(err);
      })
      .save(outputPath);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 3. CONCATENATE MULTIPLE SCENE VIDEOS INTO ONE
// ═══════════════════════════════════════════════════════════════════
export async function concatenateScenes(scenePaths) {
  const outputPath = path.join(TEMP_DIR, `concat_${Date.now()}.mp4`);

  // Write concat list file
  const listPath = path.join(TEMP_DIR, `concat_list_${Date.now()}.txt`);
  const listContent = scenePaths.map(p => `file '${p}'`).join('\n');
  await fs.writeFile(listPath, listContent);

  logger.video(`Concatenating ${scenePaths.length} scenes → ${path.basename(outputPath)}`);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-b:a 192k',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-preset medium',
        '-crf 22'
      ])
      .on('end', async () => {
        await fs.remove(listPath).catch(() => {});
        logger.success('FFMPEG', `Concatenated: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', async (err) => {
        await fs.remove(listPath).catch(() => {});
        logger.error('FFMPEG', `Concat failed: ${err.message}`);
        reject(err);
      })
      .save(outputPath);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 4. ADD BACKGROUND MUSIC (mixed at low volume)
// ═══════════════════════════════════════════════════════════════════
export async function addBackgroundMusic(videoPath, musicConfig = {}) {
  const { musicUrl, volume = 0.12 } = musicConfig;
  const outputPath = path.join(TEMP_DIR, `final_music_${Date.now()}.mp4`);

  // Get video duration
  const duration = await getVideoDuration(videoPath);

  if (musicUrl) {
    // Download music if URL provided
    try {
      const musicPath = await downloadMusic(musicUrl, duration);
      logger.video(`Mixing background music at ${(volume * 100).toFixed(0)}% volume`);
      return await mixMusicIntoVideo(videoPath, musicPath, outputPath, volume, duration);
    } catch (err) {
      logger.warn('FFMPEG', `Music download failed: ${err.message} — generating ambient`);
    }
  }

  // Generate ambient audio with FFmpeg (no external dependency)
  try {
    const ambientPath = await generateAmbientAudio(duration);
    return await mixMusicIntoVideo(videoPath, ambientPath, outputPath, volume, duration);
  } catch (err) {
    logger.warn('FFMPEG', `Ambient music failed: ${err.message} — returning video as-is`);
    return videoPath; // Return without music rather than failing
  }
}

async function downloadMusic(url, duration) {
  const { default: axios } = await import('axios');
  const musicPath = path.join(TEMP_DIR, `music_${Date.now()}.mp3`);
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  await fs.writeFile(musicPath, Buffer.from(response.data));
  return musicPath;
}

async function generateAmbientAudio(duration) {
  const outputPath = path.join(TEMP_DIR, `ambient_${Date.now()}.mp3`);

  return new Promise((resolve, reject) => {
    // Layered sine waves: subtle cinematic drone
    ffmpeg()
      .input('anullsrc=r=44100:cl=stereo')
      .inputOptions(['-f lavfi'])
      .audioFilters([
        `aevalsrc=0.04*sin(60*2*PI*t)+0.03*sin(90*2*PI*t)+0.02*sin(120*2*PI*t)+0.015*sin(180*2*PI*t):s=44100`,
        `afade=t=in:st=0:d=3`,
        `afade=t=out:st=${Math.max(duration - 3, 0)}:d=3`
      ])
      .outputOptions([`-t ${duration}`, '-ar 44100', '-ac 2'])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

async function mixMusicIntoVideo(videoPath, musicPath, outputPath, volume, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(musicPath)
      .complexFilter([
        // Loop music if shorter than video, then trim
        `[1:a]aloop=loop=-1:size=2e+09,atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${volume}[music]`,
        // Mix narration audio with background music
        `[0:a][music]amix=inputs=2:duration=first:dropout_transition=3[aout]`
      ])
      .outputOptions([
        '-map 0:v',
        '-map [aout]',
        '-c:v copy',
        '-c:a aac',
        '-b:a 192k',
        '-movflags +faststart'
      ])
      .on('end', () => {
        logger.success('FFMPEG', `Music mixed: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', async (err) => {
        logger.warn('FFMPEG', `Music mix failed: ${err.message} — using video without music`);
        resolve(videoPath); // Graceful degradation
      })
      .save(outputPath);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 5. UTILITIES
// ═══════════════════════════════════════════════════════════════════
export function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      resolve(parseFloat(meta.format?.duration) || 30);
    });
  });
}

export async function loopVideoToMinDuration(videoPath, minSeconds = 10) {
  const outputPath = path.join(TEMP_DIR, `looped_${Date.now()}.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .inputOptions(['-stream_loop 10'])
      .outputOptions([
        `-t ${minSeconds}`,
        '-c:v libx264',
        '-c:a aac',
        '-pix_fmt yuv420p',
        '-preset fast',
        '-movflags +faststart'
      ])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

export async function cleanupTempFiles() {
  logger.info('CLEANUP', 'Removing temp files older than 2 hours');
  try {
    const files = await fs.readdir(TEMP_DIR);
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;
    let removed = 0;
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stats = await fs.stat(filePath).catch(() => null);
      if (stats && now - stats.mtimeMs > twoHours) {
        await fs.remove(filePath).catch(() => {});
        removed++;
      }
    }
    logger.success('CLEANUP', `Removed ${removed} temp files`);
  } catch (err) {
    logger.error('CLEANUP', err.message);
  }
}

// Run cleanup every 2 hours
setInterval(() => {
  cleanupTempFiles().catch(() => {});
}, 2 * 60 * 60 * 1000);
