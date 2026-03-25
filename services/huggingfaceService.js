import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import FormData from 'form-data';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../temp');
fs.ensureDirSync(TEMP_DIR);

const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;

// Free models for video/image generation
const MODELS = {
  // Text-to-video (free tier)
  textToVideo: 'stabilityai/stable-video-diffusion-img2vid',
  // Image generation then animate
  textToImage: 'black-forest-labs/FLUX.1-schnell',
  // Animation from image  
  imgToVideo: 'ByteDance/AnimateDiff-Lightning'
};

/**
 * Generate image from prompt using FLUX (free)
 */
export async function generateImageFromPrompt(prompt) {
  logger.api('Generating image with FLUX.1-schnell');

  const response = await axios.post(
    `https://api-inference.huggingface.co/models/${MODELS.textToImage}`,
    { inputs: prompt + ', anime style, high quality, vibrant colors' },
    {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'image/jpeg'
      },
      responseType: 'arraybuffer',
      timeout: 120000
    }
  );

  const fileName = `img_${Date.now()}.jpg`;
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.writeFile(filePath, Buffer.from(response.data));
  logger.success('HF', `Image generated: ${fileName}`);
  return filePath;
}

/**
 * Generate video using AnimateDiff or stable-video from image
 */
export async function generateVideoFromImage(imagePath, prompt) {
  logger.api('Generating video from image with AnimateDiff');

  try {
    const imageData = await fs.readFile(imagePath);
    const base64Image = imageData.toString('base64');

    const response = await axios.post(
      `https://api-inference.huggingface.co/models/ByteDance/AnimateDiff-Lightning`,
      {
        inputs: prompt + ', anime animation, smooth motion, high quality',
        image: base64Image
      },
      {
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'video/mp4'
        },
        responseType: 'arraybuffer',
        timeout: 180000
      }
    );

    const fileName = `vid_${Date.now()}.mp4`;
    const filePath = path.join(TEMP_DIR, fileName);
    await fs.writeFile(filePath, Buffer.from(response.data));
    logger.success('HF', `Video generated: ${fileName}`);
    return filePath;
  } catch (err) {
    logger.warn('HF', `AnimateDiff failed, trying alt model: ${err.message}`);
    // Fallback: use stable-video-diffusion
    return await generateVideoFallback(imagePath);
  }
}

/**
 * Fallback: Use stable-video-diffusion
 */
async function generateVideoFallback(imagePath) {
  const imageData = await fs.readFile(imagePath);
  const base64Image = imageData.toString('base64');

  const response = await axios.post(
    `https://api-inference.huggingface.co/models/stabilityai/stable-video-diffusion-img2vid-xt`,
    { inputs: base64Image },
    {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'video/mp4'
      },
      responseType: 'arraybuffer',
      timeout: 300000
    }
  );

  const fileName = `vid_fallback_${Date.now()}.mp4`;
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.writeFile(filePath, Buffer.from(response.data));
  logger.success('HF', `Video generated (fallback): ${fileName}`);
  return filePath;
}
