import { supabase } from './supabase.js';

// ─────────────────── USER STATES ───────────────────
export async function getUserState(userId) {
  const { data, error } = await supabase
    .from('user_states')
    .select('*')
    .eq('user_id', userId.toString())
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function setUserState(userId, state, tempData = {}) {
  const { data, error } = await supabase
    .from('user_states')
    .upsert({
      user_id: userId.toString(),
      state,
      temp_data: tempData,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTempData(userId) {
  const state = await getUserState(userId);
  return state?.temp_data || {};
}

export async function updateTempData(userId, newData) {
  const existing = await getTempData(userId);
  const merged = { ...existing, ...newData };
  const state = await getUserState(userId);
  await setUserState(userId, state?.state || 'idle', merged);
  return merged;
}

// ─────────────────── SERIES ───────────────────
export async function createSeries(userId, data) {
  const { data: series, error } = await supabase
    .from('series')
    .insert({
      user_id: userId.toString(),
      title: data.title,
      genre: data.genre,
      description: data.description || '',
      characters: data.characters || [],
      full_scenario: data.full_scenario || '',
      total_episodes: data.total_episodes || 10,
      current_episode: 0,
      status: 'active',
      voice_id: data.voice_id || null,
      style: data.style || 'anime',
      language: data.language || 'ar'
    })
    .select()
    .single();
  if (error) throw error;
  return series;
}

export async function getUserSeries(userId, limit = 10) {
  const { data, error } = await supabase
    .from('series')
    .select('*')
    .eq('user_id', userId.toString())
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getSeriesById(seriesId) {
  const { data, error } = await supabase
    .from('series')
    .select('*')
    .eq('id', seriesId)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function updateSeries(seriesId, updates) {
  const { data, error } = await supabase
    .from('series')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', seriesId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getAllActiveSeries() {
  const { data, error } = await supabase
    .from('series')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ─────────────────── EPISODES ───────────────────
export async function createEpisode(seriesId, userId, episodeNumber, scenario, title = null) {
  const { data, error } = await supabase
    .from('episodes')
    .insert({
      series_id: seriesId,
      user_id: userId.toString(),
      episode_number: episodeNumber,
      title: title || `الحلقة ${episodeNumber}`,
      scenario,
      status: 'pending'
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getEpisode(episodeId) {
  const { data, error } = await supabase
    .from('episodes')
    .select('*, series(*)')
    .eq('id', episodeId)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function getNextPendingEpisode(seriesId) {
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('series_id', seriesId)
    .eq('status', 'pending')
    .order('episode_number', { ascending: true })
    .limit(1)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function updateEpisode(episodeId, updates) {
  const { data, error } = await supabase
    .from('episodes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', episodeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getSeriesEpisodes(seriesId) {
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('series_id', seriesId)
    .order('episode_number', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ─────────────────── YOUTUBE ───────────────────
export async function getYouTubeChannel(userId) {
  const { data, error } = await supabase
    .from('youtube_channels')
    .select('*')
    .eq('user_id', userId.toString())
    .eq('is_active', true)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function saveYouTubeChannel(userId, clientId, clientSecret, refreshToken, channelId, channelTitle) {
  const { data, error } = await supabase
    .from('youtube_channels')
    .upsert({
      user_id: userId.toString(),
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      channel_id: channelId,
      channel_title: channelTitle,
      is_active: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─────────────────── GENERATION TASKS ───────────────────
export async function createGenerationTask(episodeId, userId, chatId, type = 'video') {
  const { data, error } = await supabase
    .from('generation_tasks')
    .insert({
      episode_id: episodeId,
      user_id: userId.toString(),
      chat_id: chatId.toString(),
      type,
      status: 'pending'
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTaskByExternalId(externalTaskId) {
  const { data, error } = await supabase
    .from('generation_tasks')
    .select('*, episodes(*, series(*))')
    .eq('external_task_id', externalTaskId)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function updateGenerationTask(taskId, updates) {
  const { data, error } = await supabase
    .from('generation_tasks')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─────────────────── AUTO PUBLISH LOG ───────────────────
export async function logAutoPublish(userId, seriesId, episodeId, action, status, details = {}) {
  await supabase.from('auto_publish_log').insert({
    user_id: userId.toString(),
    series_id: seriesId,
    episode_id: episodeId,
    action,
    status,
    details
  });
}
