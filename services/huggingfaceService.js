/**
 * huggingfaceService.js
 * Image Generation — Multi-provider with clean fallback chain
 *
 * Priority:
 * 1. Google Gemini API  — مجاني، يحتاج GEMINI_API_KEY (primary ✅)
 * 2. Pollinations.ai    — مجاني، بدون API key (fallback 1)
 * 3. Prodia             — مجاني، يحتاج PRODIA_API_KEY (fallback 2)
 * 4. Stable Horde       — مجاني تماماً، بدون API key (fallback 3)
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

// ═══════════════════════════════════════════════════════════════════
// 1. GOOGLE GEMINI — Primary ✅ (Free ~500 req/day)
//    احصل على مفتاحك المجاني: https://aistudio.google.com/apikey
//    أضف في .env: GEMINI_API_KEY=your_key_here
// ═══════════════════════════════════════════════════════════════════
async function generateWithGemini(cleanPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const fullPrompt = `${QUALITY_PREFIX}, ${cleanPrompt}, ${QUALITY_SUFFIX}`;
  logger.api(`Gemini: "${cleanPrompt.substring(0, 60)}..."`);

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`,
    {
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    }
  );

  const parts = response.data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart) throw new Error('Gemini: no image in response');

  const ext = imagePart.inlineData.mimeType.includes('png') ? 'png' : 'jpg';
  const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
  if (buffer.byteLength < 5000) throw new Error(`Gemini: image too small (${buffer.byteLength} bytes)`);

  const filePath = path.join(TEMP_DIR, `img_gemini_${Date.now()}.${ext}`);
  await fs.writeFile(filePath, buffer);
  logger.success('IMG', `✅ Gemini → ${path.basename(filePath)}`);
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════
// 2. POLLINATIONS.AI — Fallback 1 (Free, no key needed)
// ═══════════════════════════════════════════════════════════════════
const POLLINATIONS_MODELS = ['flux', 'turbo', null];

async function generateWithPollinations(cleanPrompt, width = 1280, height = 720, modelIndex = 0) {
  const model = POLLINATIONS_MODELS[modelIndex];
  const fullPrompt = `${QUALITY_PREFIX}, ${cleanPrompt}, ${QUALITY_SUFFIX}`;
  const encoded = encodeURIComponent(fullPrompt);
  const seed = Math.floor(Math.random() * 999999);

  let url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
  if (model) url += `&model=${model}`;

  const modelLabel = model || 'default';
  logger.api(`Pollinations [${modelLabel}]: "${cleanPrompt.substring(0, 50)}..."`);

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://pollinations.ai/',
      'Accept': 'image/*'
    }
  });

  const buffer = Buffer.from(response.data);
  if (buffer.byteLength < 5000) throw new Error(`Image too small (${buffer.byteLength} bytes)`);

  const filePath = path.join(TEMP_DIR, `img_poll_${Date.now()}.jpg`);
  await fs.writeFile(filePath, buffer);
  logger.success('IMG', `✅ Pollinations [${modelLabel}] → ${path.basename(filePath)}`);
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════
// 3. PRODIA — Fallback 2 (Free key at prodia.com)
// ═══════════════════════════════════════════════════════════════════
async function generateWithProdia(cleanPrompt) {
  const apiKey = process.env.PRODIA_API_KEY;
  if (!apiKey) throw new Error('PRODIA_API_KEY not set');

  const fullPrompt = `${QUALITY_PREFIX}, ${cleanPrompt}, ${QUALITY_SUFFIX}`;
  logger.api('Prodia: generating...');

  const job = await axios.get('https://api.prodia.com/v1/sdxl/generate', {
    params: {
      model: 'dreamshaperXL10_alpha2',
      prompt: fullPrompt,
      negative_prompt: 'cartoon, anime, blurry, text, watermark, signature',
      width: 1024,
      height: 576,
      steps: 20,
      cfg_scale: 7
    },
    headers: { 'X-Prodia-Key': apiKey },
    timeout: 30000
  });

  const jobId = job.data.job;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await axios.get(`https://api.prodia.com/v1/job/${jobId}`, {
      headers: { 'X-Prodia-Key': apiKey },
      timeout: 15000
    });

    if (status.data.status === 'succeeded') {
      const imgRes = await axios.get(status.data.imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const buffer = Buffer.from(imgRes.data);
      const filePath = path.join(TEMP_DIR, `img_prodia_${Date.now()}.png`);
      await fs.writeFile(filePath, buffer);
      logger.success('IMG', `✅ Prodia → ${path.basename(filePath)}`);
      return filePath;
    }
  }
  throw new Error('Prodia timeout');
}

// ═══════════════════════════════════════════════════════════════════
// 4. STABLE HORDE — Fallback 3 (Always free, may be slow)
// ═══════════════════════════════════════════════════════════════════
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
  logger.api(`Stable Horde job: ${jobId} — polling...`);

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
      logger.success('IMG', `✅ Stable Horde → ${path.basename(filePath)}`);
      return filePath;
    }

    logger.api(`Horde waiting: queue=${check.data.queue_position || '?'}, ETA=${check.data.wait_time || '?'}s`);
  }
  throw new Error('Stable Horde timeout (5 minutes)');
}

// ═══════════════════════════════════════════════════════════════════
// MAIN EXPORT — Full fallback chain
// Priority: Gemini ✅ → Pollinations → Prodia → Stable Horde
// ═══════════════════════════════════════════════════════════════════
export async function generateImageFromPrompt(rawPrompt, width = 1280, height = 720) {
  const cleanPrompt = sanitizePrompt(rawPrompt) || 'historical scene, dramatic lighting, cinematic';
  logger.api(`Generating image for: "${cleanPrompt.substring(0, 60)}..."`);

  // 1. ✅ Gemini — الأفضل والأسرع
  try {
    return await generateWithGemini(cleanPrompt);
  } catch (err) {
    if (err.message.includes('not set')) {
      logger.warn('IMG', '⚠️  GEMINI_API_KEY غير موجود في .env — جارٍ تجربة البدائل');
    } else {
      logger.warn('IMG', `Gemini failed: ${err.message}`);
    }
  }

  // 2. Pollinations — جرب كل النماذج
  for (let i = 0; i < POLLINATIONS_MODELS.length; i++) {
    try {
      return await generateWithPollinations(cleanPrompt, width, height, i);
    } catch (err) {
      logger.warn('IMG', `Pollinations[${POLLINATIONS_MODELS[i] || 'default'}] failed: ${err.message}`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // 3. Prodia — إذا في API key
  try {
    return await generateWithProdia(cleanPrompt);
  } catch (err) {
    if (!err.message.includes('not set')) {
      logger.warn('IMG', `Prodia failed: ${err.message}`);
    }
  }

  // 4. Stable Horde — آخر خيار (مجاني دائماً لكن بطيء)
  try {
    logger.api('Trying Stable Horde (free, may take 1-3 min)...');
    return await generateWithStableHorde(cleanPrompt, width, height);
  } catch (err) {
    logger.warn('IMG', `Stable Horde failed: ${err.message}`);
  }

  throw new Error('❌ فشل توليد الصورة من جميع المصادر. تحقق من الاتصال أو أضف GEMINI_API_KEY في .env');
}

export async function generateVideoFromImage(imagePath) {
  return imagePath;
}
