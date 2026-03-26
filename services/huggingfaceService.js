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

// ✅ UPDATED: Models working on HuggingFace free inference API (2026)
// The old models (stable-diffusion-xl-base-1.0, stable-diffusion-v1-5) returned 410 Gone
const MODELS = [
  {
    id: 'black-forest-labs/FLUX.1-schnell',
    params: {
      num_inference_steps: 4,  // FLUX.1-schnell is optimized for 4 steps
      guidance_scale: 0.0,     // schnell doesn't use guidance scale
      width: 512,
      height: 512,
    }
  },
  {
    id: 'stabilityai/stable-diffusion-2-1',
    params: {
      num_inference_steps: 25,
      guidance_scale: 7.5,
      width: 768,
      height: 768,
    }
  },
  {
    id: 'Lykon/dreamshaper-8',
    params: {
      num_inference_steps: 25,
      guidance_scale: 7.5,
      width: 512,
      height: 512,
    }
  }
];

/**
 * Generate image from prompt - with retry and fallback across working models
 */
export async function generateImageFromPrompt(prompt) {
  logger.api('Generating image with Stable Diffusion');

  if (!HF_TOKEN) {
    throw new Error('HUGGINGFACE_API_KEY غير موجود في متغيرات البيئة');
  }

  const enrichedPrompt = `${prompt}, anime style, high quality, vibrant colors, detailed`;

  for (const model of MODELS) {
    try {
      logger.api(`Trying model: ${model.id}`);

      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model.id}`,
        {
          inputs: enrichedPrompt,
          parameters: model.params
        },
        {
          headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'image/png,image/jpeg,image/*,*/*'
          },
          responseType: 'arraybuffer',
          timeout: 180000  // 3 minutes - FLUX can be slow on cold start
        }
      );

      // ---- Check: is it actually an image? ----
      const buffer = Buffer.from(response.data);

      // If response is too small, it's probably a JSON error
      if (buffer.byteLength < 1000) {
        const text = buffer.toString('utf-8');
        // Model might be loading (503) - worth logging but trying next
        logger.warn('HF', `${model.id} response too small (${buffer.byteLength} bytes): ${text.substring(0, 200)}`);
        continue;
      }

      // Check for JSON error in response (some models return JSON even with arraybuffer)
      const firstBytes = buffer.slice(0, 1).toString();
      if (firstBytes === '{') {
        const text = buffer.toString('utf-8');
        logger.warn('HF', `${model.id} returned JSON error: ${text.substring(0, 200)}`);
        continue;
      }

      // Save the image
      const fileName = `img_${Date.now()}.png`;
      const filePath = path.join(TEMP_DIR, fileName);
      await fs.writeFile(filePath, buffer);

      logger.success('HF', `Image saved from ${model.id}: ${fileName} (${buffer.byteLength} bytes)`);
      return filePath;

    } catch (err) {
      const status = err.response?.status;
      const statusText = err.response?.statusText;

      if (status === 410) {
        logger.warn('HF', `${model.id} is GONE (410) - model deprecated, skipping`);
      } else if (status === 503) {
        logger.warn('HF', `${model.id} is loading (503) - try again in a few minutes`);
      } else if (status === 401) {
        throw new Error('HUGGINGFACE_API_KEY خاطئ أو منتهي الصلاحية - تحقق من المفتاح');
      } else if (status === 429) {
        logger.warn('HF', `${model.id} rate limit (429) - too many requests`);
      } else {
        logger.warn('HF', `${model.id} failed [${status || 'ERR'} ${statusText || ''}]: ${err.message}`);
      }
    }
  }

  throw new Error(
    'فشل توليد الصورة - جميع الموديلات غير متاحة حالياً.\n' +
    'تحقق من: 1) صحة HUGGINGFACE_API_KEY 2) حد الطلبات المجانية 3) حاول بعد دقائق'
  );
}

/**
 * For free HF tier, true video generation is not reliable.
 * We return the image path and let ffmpegService convert it to video.
 */
export async function generateVideoFromImage(imagePath, prompt) {
  logger.api('Using image as video source (ffmpeg will animate)');
  return imagePath;
}
