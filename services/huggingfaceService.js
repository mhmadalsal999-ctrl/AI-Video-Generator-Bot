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

// ✅ Models that work on HuggingFace free inference API
const MODELS = {
  primary: 'stabilityai/stable-diffusion-xl-base-1.0',
  fallback: 'runwayml/stable-diffusion-v1-5',
};

/**
 * Generate image from prompt - with retry and fallback
 */
export async function generateImageFromPrompt(prompt) {
  logger.api('Generating image with Stable Diffusion');

  const models = [MODELS.primary, MODELS.fallback];

  for (const model of models) {
    try {
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          inputs: prompt + ', anime style, high quality, vibrant colors, detailed',
          parameters: {
            num_inference_steps: 25,
            guidance_scale: 7.5,
            width: 512,
            height: 512
          }
        },
        {
          headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer',
          timeout: 120000
        }
      );

      // Verify it's actually an image
      if (response.data.byteLength < 5000) {
        const text = Buffer.from(response.data).toString();
        throw new Error(`Not an image: ${text.substring(0, 100)}`);
      }

      const fileName = `img_${Date.now()}.jpg`;
      const filePath = path.join(TEMP_DIR, fileName);
      await fs.writeFile(filePath, Buffer.from(response.data));
      logger.success('HF', `Image saved: ${fileName}`);
      return filePath;

    } catch (err) {
      logger.warn('HF', `${model} failed: ${err.message}`);
    }
  }

  throw new Error('فشل توليد الصورة - الموديلات غير متاحة حالياً، تحقق من HUGGINGFACE_API_KEY');
}

/**
 * For free HF tier, video generation is not reliable.
 * We return the image path and let ffmpegService convert it to video.
 */
export async function generateVideoFromImage(imagePath, prompt) {
  logger.api('Using image as video source (ffmpeg will animate)');
  return imagePath;
}
