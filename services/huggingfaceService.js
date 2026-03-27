/**
 * huggingfaceService.js
 * Image Generation — Pollinations.ai (FREE, no API key)
 * Multiple model fallback chain — no HuggingFace dependency required
 *
 * Fallback order:
 * 1. Pollinations FLUX (best quality)
 * 2. Pollinations Turbo (faster)
 * 3. Pollinations FLUX-Realism
 * 4. Pollinations default
 * 5. HuggingFace (only if HUGGINGFACE_API_KEY is set)
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

const QUALITY_PREFIX = 'cinematic photograph, photorealistic, dramatic lighting, detailed, professional';
const QUALITY_SUFFIX = 'no text, no watermarks, no logos, sharp focus, high resolution';

// ═══════════════════════════════════════════════════════════════════
// POLLINATIONS.AI — Free, no API key, multiple models
// ═══════════════════════════════════════════════════════════════════
const POLLINATIONS_MODELS = [
  { model: 'flux',          label: 'FLUX (best)' },
  { model: 'turbo',         label: 'Turbo' },
  { model: 'flux-realism',  label: 'FLUX Realism' },
  { model: 'flux-anime',    label: 'FLUX Anime alt' }, // still realistic when prompted correctly
  { model: null,            label: 'Default' }
];

async function generateWithPollinations(prompt, width = 1280, height = 720, modelIndex = 0) {
  const modelConfig = POLLINATIONS_MODELS[modelIndex] || POLLINATIONS_MODELS[0];
  const enriched = `${QUALITY_PREFIX}, ${prompt}, ${QUALITY_SUFFIX}`;
  const encoded = encodeURIComponent(enriched);
  const seed = Math.floor(Math.random() * 999999);

  let url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`;
  if (modelConfig.model) url += `&model=${modelConfig.model}`;

  logger.api(`Pollinations [${modelConfig.label}]: "${prompt.substring(0, 50)}..."`);

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: { 'User-Agent': 'StoryNarratorBot/3.0' }
  });

  const buffer = Buffer.from(response.data);
  if (buffer.byteLength < 5000) {
    throw new Error(`Pollinations [${modelConfig.label}] returned too-small image`);
  }

  const filePath = path.join(TEMP_DIR, `img_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  await fs.writeFile(filePath, buffer);
  logger.success('IMG', `✅ [${modelConfig.label}] saved: ${path.basename(filePath)}`);
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════
// HUGGINGFACE — Optional fallback (only if API key is configured)
// ═══════════════════════════════════════════════════════════════════
const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;

const HF_MODELS = [
  'black-forest-labs/FLUX.1-schnell',
  'stabilityai/stable-diffusion-xl-base-1.0'
];

async function generateWithHuggingFace(prompt) {
  if (!HF_TOKEN) throw new Error('HUGGINGFACE_API_KEY not set — skipping HuggingFace');

  const enriched = `${QUALITY_PREFIX}, ${prompt}, ${QUALITY_SUFFIX}`;

  for (const modelId of HF_MODELS) {
    try {
      logger.api(`HuggingFace fallback: ${modelId}`);
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${modelId}`,
        { inputs: enriched, parameters: { width: 1280, height: 720 } },
        {
          headers: { Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 120000
        }
      );

      const buffer = Buffer.from(response.data);
      if (buffer.byteLength < 5000) continue;

      const filePath = path.join(TEMP_DIR, `img_hf_${Date.now()}.png`);
      await fs.writeFile(filePath, buffer);
      logger.success('HF', `Saved from ${modelId}`);
      return filePath;

    } catch (err) {
      logger.warn('HF', `${modelId} failed [${err.response?.status}]: ${err.message}`);
    }
  }
  throw new Error('HuggingFace: all models unavailable');
}

// ═══════════════════════════════════════════════════════════════════
// MAIN EXPORT — Full fallback chain
// ═══════════════════════════════════════════════════════════════════
export async function generateImageFromPrompt(prompt, width = 1280, height = 720) {
  logger.api('Generating historical scene image...');

  // Try all Pollinations models in order
  for (let i = 0; i < POLLINATIONS_MODELS.length; i++) {
    try {
      return await generateWithPollinations(prompt, width, height, i);
    } catch (err) {
      logger.warn('IMG', `Pollinations [${POLLINATIONS_MODELS[i].label}] failed: ${err.message}`);
      // Wait briefly before retrying
      if (i < POLLINATIONS_MODELS.length - 1) await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Final fallback: HuggingFace (only if API key available)
  try {
    return await generateWithHuggingFace(prompt);
  } catch (err) {
    logger.warn('IMG', `HuggingFace also failed: ${err.message}`);
  }

  throw new Error('❌ فشل توليد الصورة من جميع المصادر. تحقق من الاتصال بالإنترنت وحاول مرة أخرى.');
}

export async function generateVideoFromImage(imagePath) {
  return imagePath; // ffmpegService handles image→video conversion
}
