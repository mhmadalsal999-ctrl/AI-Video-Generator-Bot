/**
 * videoConverter.js
 * Video format conversion utilities
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../temp');
fs.ensureDirSync(TEMP_DIR);
ffmpeg.setFfmpegPath(ffmpegStatic);

export async function convertToTelegramCompatible(inputPath) {
  const outputPath = path.join(TEMP_DIR, `tg_${Date.now()}.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-preset fast',
        '-crf 23',
        '-vf scale=\'trunc(iw/2)*2:trunc(ih/2)*2\''
      ])
      .on('end', () => {
        logger.video(`Converted for Telegram: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error('CONVERTER', err.message);
        reject(err);
      })
      .save(outputPath);
  });
}

export async function downloadVideoFromUrl(videoUrl) {
  const outputPath = path.join(TEMP_DIR, `dl_${Date.now()}.mp4`);
  const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream', timeout: 300000 });
  const writer = fs.createWriteStream(outputPath);
  await new Promise((res, rej) => {
    response.data.pipe(writer);
    writer.on('finish', res);
    writer.on('error', rej);
  });
  return outputPath;
}
