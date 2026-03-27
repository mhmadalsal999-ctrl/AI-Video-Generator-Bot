/**
 * validators.js
 * Input validation utilities
 */

import { logger } from './logger.js';

const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

export async function validateVideo(url, fileSize) {
  if (fileSize > MAX_VIDEO_SIZE) {
    return {
      valid: false,
      error: `حجم الفيديو كبير جداً. الحد الأقصى ${MAX_VIDEO_SIZE / (1024 * 1024)} MB`
    };
  }
  if (fileSize === 0) {
    return { valid: false, error: 'الفيديو فارغ' };
  }
  return { valid: true };
}

export function validateCategory(category) {
  const valid = ['history', 'crime', 'civilizations', 'wars', 'figures', 'secrets', 'arabic', 'disasters'];
  return valid.includes(category);
}

export function validateLanguage(lang) {
  return ['ar', 'en'].includes(lang);
}
