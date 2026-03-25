-- ============================================================
-- ANIME SERIES BOT - Complete Database Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. USER STATES
CREATE TABLE IF NOT EXISTS user_states (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  temp_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SERIES TABLE
CREATE TABLE IF NOT EXISTS series (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  genre TEXT NOT NULL,
  description TEXT,
  characters JSONB DEFAULT '[]',
  full_scenario TEXT,
  total_episodes INTEGER DEFAULT 0,
  current_episode INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  voice_id TEXT,
  style TEXT DEFAULT 'anime',
  language TEXT DEFAULT 'ar',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. EPISODES TABLE
CREATE TABLE IF NOT EXISTS episodes (
  id BIGSERIAL PRIMARY KEY,
  series_id BIGINT REFERENCES series(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT,
  scenario TEXT,
  video_url TEXT,
  audio_url TEXT,
  youtube_video_id TEXT,
  youtube_url TEXT,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  generation_task_id TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. YOUTUBE CHANNELS
CREATE TABLE IF NOT EXISTS youtube_channels (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  channel_id TEXT,
  channel_title TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. AUTO PUBLISH LOG
CREATE TABLE IF NOT EXISTS auto_publish_log (
  id BIGSERIAL PRIMARY KEY,
  series_id BIGINT REFERENCES series(id),
  episode_id BIGINT REFERENCES episodes(id),
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. GENERATION TASKS
CREATE TABLE IF NOT EXISTS generation_tasks (
  id BIGSERIAL PRIMARY KEY,
  episode_id BIGINT REFERENCES episodes(id),
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  external_task_id TEXT,
  type TEXT DEFAULT 'video',
  status TEXT DEFAULT 'pending',
  result_data JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_user_states_user_id ON user_states(user_id);
CREATE INDEX IF NOT EXISTS idx_series_user_id ON series(user_id);
CREATE INDEX IF NOT EXISTS idx_series_status ON series(status);
CREATE INDEX IF NOT EXISTS idx_episodes_series_id ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);
CREATE INDEX IF NOT EXISTS idx_episodes_user_id ON episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_youtube_channels_user_id ON youtube_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_tasks_external ON generation_tasks(external_task_id);
CREATE INDEX IF NOT EXISTS idx_generation_tasks_episode ON generation_tasks(episode_id);

-- AUTO UPDATE TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_states_updated_at ON user_states;
DROP TRIGGER IF EXISTS update_series_updated_at ON series;
DROP TRIGGER IF EXISTS update_episodes_updated_at ON episodes;
DROP TRIGGER IF EXISTS update_youtube_channels_updated_at ON youtube_channels;
DROP TRIGGER IF EXISTS update_generation_tasks_updated_at ON generation_tasks;

CREATE TRIGGER update_user_states_updated_at BEFORE UPDATE ON user_states FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_series_updated_at BEFORE UPDATE ON series FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_episodes_updated_at BEFORE UPDATE ON episodes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_youtube_channels_updated_at BEFORE UPDATE ON youtube_channels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_generation_tasks_updated_at BEFORE UPDATE ON generation_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
