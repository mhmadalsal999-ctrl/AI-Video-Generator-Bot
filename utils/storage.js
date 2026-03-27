/**
 * storage.js
 * Supabase Storage for video files
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
dotenv.config();

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

export async function uploadVideoToStorage(filePath, fileName) {
  if (!supabase) throw new Error('Supabase not configured');

  const fileBuffer = await fs.readFile(filePath);
  const uniqueName = `videos/${Date.now()}_${Math.random().toString(36).slice(2)}_${path.basename(fileName)}`;

  const { error } = await supabase.storage
    .from('videos')
    .upload(uniqueName, fileBuffer, { contentType: 'video/mp4', upsert: false });

  if (error) throw error;

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(uniqueName);
  return urlData.publicUrl;
}

export async function deleteVideoFromStorage(filePath) {
  if (!supabase || !filePath) return;
  try {
    await supabase.storage.from('videos').remove([filePath]);
  } catch (_) {}
}
