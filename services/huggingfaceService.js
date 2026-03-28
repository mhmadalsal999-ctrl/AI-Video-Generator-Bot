/**
 * huggingfaceService.js
 * Image Generation - Multi-provider with smart fallback chain
 *
 * Priority:
 * 1. Hugging Face FLUX.1-schnell - مجاني، سريع، بدون قيود جغرافية ✅
 * 2. Hugging Face FLUX.1-dev    - نفس الشي، جودة اعلى
 * 3. Stable Horde               - مجاني دائما (بطيء)
 *
 * احصل على مفتاح مجاني: https://huggingface.co/settings/tokens
 * اضف في Render: HF_API_TOKEN=hf_xxxxxxxxxx
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

const QUALITY_PREFIX = 'cinematic historical photograph, photorealistic, dramatic lighting, detailed, professional, 8K';
const QUALITY_SUFFIX = 'no text, no watermarks, no logos, sharp focus, ultra realistic';

function sanitizePrompt(prompt) {
  return (prompt || '')
    .replace(/[^\x00-\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 400);
}

// ===================================================================
// 1. HUGGING FACE FLUX.1-schnell - Primary (Free, no geo-restriction)
//    احصل على توكن مجاني: https://huggingface.co/settings/tokens
//    اضف في Render: HF_API_TOKEN=hf_xxxxxxxxxx
// ===================================================================
const HF_MODELS = [
  'black-forest-labs/FLUX.1-schnell',
  'black-forest-labs/FLUX.1-dev'
];

async function generateWithHuggingFace(cleanPrompt, modelIndex = 0) {
  const token = process.env.HF_API_TOKEN;
  if (!token) throw new Error('HF_API_TOKEN not set');

  const model = HF_MODELS[modelIndex];
  const fullPrompt = `${QUALITY_PREFIX}, ${cleanPrompt}, ${QUALITY_SUFFIX}`;

  logger.api(`HuggingFace [${model.split('/')[1]}]: "${cleanPrompt.substring(0, 50)}..."`);

  const response = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      inputs: fullPrompt,
      parameters: {
        width: 1280,
        height: 720,
        num_inference_steps: 4,
        guidance_scale: 0.0
      }
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'image/jpeg'
      },
      responseType: 'arraybuffer',
      timeout: 120000
    }
  );

  const buffer = Buffer.from(response.data);

  // لو رجع JSON بدل صورة = خطا
  const contentType = response.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    const json = JSON.parse(buffer.toString());
    throw new Error(`HuggingFace API error: ${json.error || JSON.stringify(json)}`);
  }

  if (buffer.byteLength < 5000) throw new Error(`Image too small (${buffer.byteLength} bytes)`);

  const filePath = path.join(TEMP_DIR, `img_hf_${Date.now()}.jpg`);
  await fs.writeFile(filePath, buffer);
  logger.success('IMG', `HuggingFace [${model.split('/')[1]}] -> ${path.basename(filePath)}`);
  return filePath;
}

// ===================================================================
// 2. STABLE HORDE - Fallback (Always free, slow)
// ===================================================================
const HORDE_ANON_KEY = '0000000000';
const HORDE_MODELS = ['Realistic Vision v6.0 B1', 'Deliberate 3.0', 'dreamshaper_8'];

async function generateWithStableHorde(cleanPrompt, width = 1280, height = 704) {
  const w = Math.floor(width / 64) * 64;
  const h = Math.floor(height / 64) * 64;
  const fullPrompt = `${QUALITY_PREFIX}, ${cleanPrompt}, ${QUALITY_SUFFIX}`;
  logger.api(`Stable Horde: "${cleanPrompt.substring(0, 50)}..."`);

  const jobRes = await axios.post(
    'https://stablehorde.net/api/v2/generate/async',
    {
      prompt: fullPrompt,
      params: { width: w, height: h, steps: 20, sampler_name: 'k_euler_a', cfg_scale: 7, n: 1 },
      models: HORDE_MODELS,
      nsfw: false,
      r2: true,
      shared: false
    },
    {
      headers: { 'apikey': HORDE_ANON_KEY, 'Content-Type': 'application/json', 'Client-Agent': 'StoryNarratorBot:3.1' },
      timeout: 20000
    }
  );

  const jobId = jobRes.data.id;
  if (!jobId) throw new Error('No job ID from Stable Horde');
  logger.api(`Stable Horde job: ${jobId} - polling...`);

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    const check = await axios.get(
      `https://stablehorde.net/api/v2/generate/check/${jobId}`,
      { headers: { 'apikey': HORDE_ANON_KEY }, timeout: 15000 }
    ).catch(() => null);

    if (!check) continue;
    if (check.data.faulted) throw new Error('Stable Horde job faulted');

    if (check.data.done) {
      const result = await axios.get(
        `https://stablehorde.net/api/v2/generate/status/${jobId}`,
        { headers: { 'apikey': HORDE_ANON_KEY }, timeout: 20000 }
      );
      const imgUrl = result.data.generations?.[0]?.img;
      if (!imgUrl) throw new Error('Stable Horde: no image in result');

      const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const buffer = Buffer.from(imgRes.data);
      const filePath = path.join(TEMP_DIR, `img_horde_${Date.now()}.webp`);
      await fs.writeFile(filePath, buffer);
      logger.success('IMG', `Stable Horde -> ${path.basename(filePath)}`);
      return filePath;
    }

    logger.api(`Horde waiting: queue=${check.data.queue_position || '?'}, ETA=${check.data.wait_time || '?'}s`);
  }
  throw new Error('Stable Horde timeout (5 minutes)');
}

// ===================================================================
// MAIN EXPORT
// HuggingFace FLUX schnell -> HuggingFace FLUX dev -> Stable Horde
// ===================================================================
export async function generateImageFromPrompt(rawPrompt, width = 1280, height = 720) {
  const cleanPrompt = sanitizePrompt(rawPrompt) || 'historical scene, dramatic lighting, cinematic';
  logger.api(`Generating image for: "${cleanPrompt.substring(0, 60)}..."`);

  // 1 + 2. HuggingFace - schnell ثم dev
  for (let i = 0; i < HF_MODELS.length; i++) {
    try {
      return await generateWithHuggingFace(cleanPrompt, i);
    } catch (err) {
      if (err.message.includes('not set')) {
        logger.warn('IMG', 'HF_API_TOKEN not in .env - trying Stable Horde');
        break;
      }
      logger.warn('IMG', `HuggingFace [${HF_MODELS[i].split('/')[1]}] failed: ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // 3. Stable Horde - اخر خيار
  try {
    logger.api('Trying Stable Horde (free, may take 1-3 min)...');
    return await generateWithStableHorde(cleanPrompt, width, height);
  } catch (err) {
    logger.warn('IMG', `Stable Horde failed: ${err.message}`);
  }

  throw new Error('Failed to generate image. Please add HF_API_TOKEN to Render environment variables.');
}

export async function generateVideoFromImage(imagePath) {
  return imagePath;
}
