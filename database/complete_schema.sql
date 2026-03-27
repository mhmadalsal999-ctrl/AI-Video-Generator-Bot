-- ============================================================
-- STORY NARRATOR BOT — Complete Database Schema v3.1
-- ⚠️  انسخ كل هذا الكود في Supabase → SQL Editor → Run
-- ============================================================

-- 1. USER STATES (session management)
CREATE TABLE IF NOT EXISTS user_states (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT UNIQUE NOT NULL,
  state      TEXT NOT NULL DEFAULT 'idle',
  temp_data  JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. STORIES
CREATE TABLE IF NOT EXISTS stories (
  id               BIGSERIAL PRIMARY KEY,
  user_id          TEXT NOT NULL,
  category         TEXT NOT NULL,
  title            TEXT NOT NULL,
  period           TEXT,
  location         TEXT,
  summary          TEXT,
  story_data       JSONB DEFAULT '{}',
  script_data      JSONB DEFAULT '{}',
  total_scenes     INTEGER DEFAULT 0,
  status           TEXT DEFAULT 'pending',
  -- statuses: pending → generating → video_ready → published → failed → deleted
  video_url        TEXT,
  youtube_video_id TEXT,
  youtube_url      TEXT,
  error_message    TEXT,
  language         TEXT DEFAULT 'ar',
  voice_id         TEXT,
  narrator_tone    TEXT DEFAULT 'dramatic',
  -- Duration & split settings
  duration_minutes INTEGER DEFAULT 3,
  split_parts      INTEGER DEFAULT 1,
  scenes_per_part  INTEGER DEFAULT 7,
  sec_per_scene    INTEGER DEFAULT 26,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SCENES
CREATE TABLE IF NOT EXISTS scenes (
  id            BIGSERIAL PRIMARY KEY,
  story_id      BIGINT REFERENCES stories(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  scene_number  INTEGER NOT NULL,
  scene_title   TEXT,
  narration     TEXT,
  image_prompt  TEXT,
  voice_tone    TEXT DEFAULT 'dramatic',
  duration_sec  INTEGER DEFAULT 26,
  image_url     TEXT,
  audio_url     TEXT,
  video_url     TEXT,
  status        TEXT DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 4. YOUTUBE CHANNELS
CREATE TABLE IF NOT EXISTS youtube_channels (
  id             BIGSERIAL PRIMARY KEY,
  user_id        TEXT UNIQUE NOT NULL,
  client_id      TEXT NOT NULL,
  client_secret  TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,
  channel_id     TEXT,
  channel_title  TEXT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 5. AUTO PUBLISH LOG
CREATE TABLE IF NOT EXISTS auto_publish_log (
  id         BIGSERIAL PRIMARY KEY,
  story_id   BIGINT REFERENCES stories(id),
  user_id    TEXT NOT NULL,
  action     TEXT NOT NULL,
  status     TEXT NOT NULL,
  details    JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. GENERATION TASKS
CREATE TABLE IF NOT EXISTS generation_tasks (
  id            BIGSERIAL PRIMARY KEY,
  story_id      BIGINT REFERENCES stories(id),
  user_id       TEXT NOT NULL,
  chat_id       TEXT NOT NULL,
  type          TEXT DEFAULT 'full_video',
  status        TEXT DEFAULT 'pending',
  result_data   JSONB,
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_states_user_id      ON user_states(user_id);
CREATE INDEX IF NOT EXISTS idx_stories_user_id          ON stories(user_id);
CREATE INDEX IF NOT EXISTS idx_stories_status           ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_category         ON stories(category);
CREATE INDEX IF NOT EXISTS idx_scenes_story_id          ON scenes(story_id);
CREATE INDEX IF NOT EXISTS idx_scenes_status            ON scenes(status);
CREATE INDEX IF NOT EXISTS idx_youtube_channels_user_id ON youtube_channels(user_id);

-- ── AUTO-UPDATE TRIGGER ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS upd_user_states ON user_states;
DROP TRIGGER IF EXISTS upd_stories     ON stories;
DROP TRIGGER IF EXISTS upd_scenes      ON scenes;
DROP TRIGGER IF EXISTS upd_yt_channels ON youtube_channels;
DROP TRIGGER IF EXISTS upd_gen_tasks   ON generation_tasks;

CREATE TRIGGER upd_user_states BEFORE UPDATE ON user_states     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER upd_stories     BEFORE UPDATE ON stories          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER upd_scenes      BEFORE UPDATE ON scenes           FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER upd_yt_channels BEFORE UPDATE ON youtube_channels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER upd_gen_tasks   BEFORE UPDATE ON generation_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ✅ Schema v3.1 complete
-- الخطوة التالية: اذهب إلى Supabase → Storage → New Bucket → اسمه "videos" → Public
