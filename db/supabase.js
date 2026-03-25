import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(`[${new Date().toISOString()}] ❌ ERROR: Supabase credentials missing`);
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseKey);
console.log(`[${new Date().toISOString()}] ✅ Supabase client initialized`);
