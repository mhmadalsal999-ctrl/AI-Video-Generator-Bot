/**
 * huggingfaceService.js
 * Image Generation — Multi-provider with clean fallback chain
 *
 * Priority:
 * 1. Pollinations.ai  — مجاني، بدون API key (primary)
 * 2. Stable Horde     — مجاني تماماً، بدون API key (fallback موثوق)
 * 3. Prodia           — مجاني، يحتاج PRODIA_API_KEY (اختياري)
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

// ── دائماً إنجليزي — Pollinations تحتاج ASCII فقط ─────────────────
const QUALITY_PREFIX = 'cinematic historical photograph, photorealistic, dramatic lighting, detailed, professional, 8K';
const QUALITY_SUFFIX = 'no text, no watermarks, no logos, sharp focus, ultra realistic';

// تنظيف الـ prompt من أي نص عربي أو غير ASCII
function sanitizePrompt(prompt) {
  return (prompt || '')
    .replace(/[^\x00-\x7F]/g, ' ')   // إزالة أي حرف غير ASCII (عربي، إلخ)
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 400);               // حد أقصى للطول
}

// ═══════════════════════════════════════════════════════════════════
// 1. POLLINATIONS.AI — Primary (Free, no key)
// ═══════════════════════════════════════════════════════════════════
const POLLINATIONS_MODELS = [
  'flux',
  'turbo',
  null   // default (no model param)
];

async function generateWithPollinations(cleanPrompt, width = 1280, height = 720, modelIndex = 0) {
  const model = POLLINATIONS_MODELS[modelIndex];
  const fullPrompt = `${QUALITY_PREFIX}, ${cleanPrompt}, ${QUALITY_SUFFIX}`;
  const encoded = encodeURIComponent(fullPrompt);
  const seed = Math.floor(Math.random() * 999999);

  let url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}`;
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
// 2. STABLE HORDE — Free fallback (anonymous key)
// ═══════════════════════════════════════════════════════════════════
const HORDE_ANON_KEY = '0000000000';
const HORDE_MODELS   = ['Realistic Vision v6.0 B1', 'Deliberate 3.0', 'dreamshaper_8'];

async function generateWithStableHorde(cleanPrompt, width = 1280, height = 704) {
  // الأبعاد يجب أن تكون مضاعف 64
  const w = Math.floor(width / 64) * 64;   // 1280
  const h = Math.floor(height / 64) * 64;  // 704 (أقرب مضاعف لـ 720)

  const fullPrompt = `${QUALITY_PREFIX}, ${cleanPrompt}, ${QUALITY_SUFFIX}`;
  logger.api(`Stable Horde: "${cleanPrompt.substring(0, 50)}..."`);

  // إرسال طلب التوليد
  const jobRes = await axios.post(
    'https://stablehorde.net/api/v2/generate/async',
    {
      prompt: fullPrompt,
      params: {
        width: w,
        height: h,
        steps: 20,
        sampler_name: 'k_euler_a',
        cfg_scale: 7,
        n: 1
      },
      models: HORDE_MODELS,
      nsfw: false,
      r2: true,
      shared: false
    },
    {
      headers: {
        'apikey': HORDE_ANON_KEY,
        'Content-Type': 'application/json',
        'Client-Agent': 'StoryNarratorBot:3.1'
      },
      timeout: 20000
    }
  );

  const jobId = jobRes.data.id;
  if (!jobId) throw new Error('No job ID from Stable Horde');
  logger.api(`Stable Horde job: ${jobId} — polling...`);

  // Polling حتى 5 دقائق
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

      // تحميل الصورة
      const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const buffer = Buffer.from(imgRes.data);

      const filePath = path.join(TEMP_DIR, `img_horde_${Date.now()}.webp`);
      await fs.writeFile(filePath, buffer);
      logger.success('IMG', `✅ Stable Horde → ${path.basename(filePath)}`);
      return filePath;
    }

    const queue = check.data.queue_position || '?';
    const wait  = check.data.wait_time || '?';
    logger.api(`Horde waiting: queue=${queue}, ETA=${wait}s`);
  }

  throw new Error('Stable Horde timeout (5 minutes)');
}

// ═══════════════════════════════════════════════════════════════════
// 3. PRODIA — Optional (free API key at prodia.com)
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
// MAIN EXPORT — Full fallback chain
// ═══════════════════════════════════════════════════════════════════
export async function generateImageFromPrompt(rawPrompt, width = 1280, height = 720) {
  // دائماً نظّف الـ prompt من العربي قبل الإرسال
  const cleanPrompt = sanitizePrompt(rawPrompt) || 'historical scene, dramatic lighting, cinematic';

  logger.api(`Generating image for: "${cleanPrompt.substring(0, 60)}..."`);

  // 1. Pollinations — جرب كل النماذج
  for (let i = 0; i < POLLINATIONS_MODELS.length; i++) {
    try {
      return await generateWithPollinations(cleanPrompt, width, height, i);
    } catch (err) {
      logger.warn('IMG', `Pollinations[${POLLINATIONS_MODELS[i] || 'default'}] failed: ${err.message}`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // 2. Prodia — اذا في API key
  try {
    return await generateWithProdia(cleanPrompt);
  } catch (err) {
    if (!err.message.includes('not set')) {
      logger.warn('IMG', `Prodia failed: ${err.message}`);
    }
  }

  // 3. Stable Horde — آخر خيار (مجاني دائماً)
  try {
    logger.api('Trying Stable Horde (free, may take 1-3 min)...');
    return await generateWithStableHorde(cleanPrompt, width, height);
  } catch (err) {
    logger.warn('IMG', `Stable Horde failed: ${err.message}`);
  }

  throw new Error('❌ فشل توليد الصورة من جميع المصادر. تحقق من الاتصال بالإنترنت.');
}

export async function generateVideoFromImage(imagePath) {
  return imagePath;
}
