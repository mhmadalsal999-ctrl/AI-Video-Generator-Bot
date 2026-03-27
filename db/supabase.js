import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(`[${new Date().toISOString()}] ❌ ERROR: SUPABASE_URL and SUPABASE_KEY must be set`);
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
  global: { headers: { 'x-application': 'story-narrator-bot' } }
});

console.log(`[${new Date().toISOString()}] ✅ Supabase client initialized`);
