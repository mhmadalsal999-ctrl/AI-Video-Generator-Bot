/**
 * Image Generation Service
 * Primary:  Pollinations.ai → مجاني 100% بدون API key
 * Fallback: HuggingFace    → يستخدم HUGGINGFACE_API_KEY إذا موجود
 */

import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../temp');
fs.ensureDirSync(TEMP_DIR);

const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;

// ── 1. Pollinations.ai ─────────────────────────────────────────────
async function generateWithPollinations(prompt) {
  const enriched = `${prompt}, anime style, high quality, vibrant colors, detailed`;
  const encoded = encodeURIComponent(enriched);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&model=flux&nologo=true&seed=${Date.now()}`;

  logger.api('Trying Pollinations.ai (FLUX) — no API key needed');

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  const buffer = Buffer.from(response.data);
  if (buffer.byteLength < 2000) {
    throw new Error(`Response too small: ${buffer.byteLength} bytes`);
  }

  const filePath = path.join(TEMP_DIR, `img_${Date.now()}.jpg`);
  await fs.writeFile(filePath, buffer);
  logger.success('IMG', `Pollinations saved: ${path.basename(filePath)} (${(buffer.byteLength / 1024).toFixed(0)} KB)`);
  return filePath;
}

// ── 2. HuggingFace fallback ────────────────────────────────────────
const HF_MODELS = [
  {
    id: 'stabilityai/stable-diffusion-2-1',
    params: { num_inference_steps: 25, guidance_scale: 7.5, width: 768, height: 768 }
  },
  {
    id: 'Lykon/dreamshaper-8',
    params: { num_inference_steps: 25, guidance_scale: 7.5, width: 512, height: 512 }
  }
];

async function generateWithHuggingFace(prompt) {
  if (!HF_TOKEN) throw new Error('HUGGINGFACE_API_KEY غير موجود');

  const enriched = `${prompt}, anime style, high quality, vibrant colors, detailed`;

  for (const model of HF_MODELS) {
    try {
      logger.api(`Trying HuggingFace: ${model.id}`);
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model.id}`,
        { inputs: enriched, parameters: model.params },
        {
          headers: { Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 120000
        }
      );

      const buffer = Buffer.from(response.data);
      if (buffer.byteLength < 1000 || buffer[0] === 123) {
        logger.warn('HF', `${model.id} returned error body`);
        continue;
      }

      const filePath = path.join(TEMP_DIR, `img_${Date.now()}.png`);
      await fs.writeFile(filePath, buffer);
      logger.success('HF', `Saved from ${model.id}`);
      return filePath;

    } catch (err) {
      const s = err.response?.status;
      if (s === 410) logger.warn('HF', `${model.id} GONE (410) - deprecated`);
      else if (s === 503) logger.warn('HF', `${model.id} loading (503)`);
      else logger.warn('HF', `${model.id} failed [${s}]: ${err.message}`);
    }
  }
  throw new Error('HuggingFace: جميع الموديلات غير متاحة');
}

// ── Main Export ────────────────────────────────────────────────────
export async function generateImageFromPrompt(prompt) {
  logger.api('Generating image...');

  try {
    return await generateWithPollinations(prompt);
  } catch (err) {
    logger.warn('IMG', `Pollinations failed: ${err.message} → trying HuggingFace...`);
  }

  try {
    return await generateWithHuggingFace(prompt);
  } catch (err) {
    logger.warn('IMG', `HuggingFace also failed: ${err.message}`);
  }

  throw new Error('فشل توليد الصورة من جميع المصادر. حاول بعد دقائق.');
}

export async function generateVideoFromImage(imagePath) {
  logger.api('Using image as video source (ffmpeg will animate)');
  return imagePath;
}
