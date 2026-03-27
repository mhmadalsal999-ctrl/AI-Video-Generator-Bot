/**
 * database.js — All Supabase DB operations
 * Story Narrator Bot v3.1
 */

import { supabase } from './supabase.js';

// ═══════════════════════════════════════════════════════════════════
// USER STATES
// ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════
// STORIES
// ═══════════════════════════════════════════════════════════════════
export async function createStory(userId, data) {
  const { data: story, error } = await supabase
    .from('stories')
    .insert({
      user_id:         userId.toString(),
      category:        data.category,
      title:           data.title,
      period:          data.period || '',
      location:        data.location || '',
      summary:         data.summary || '',
      story_data:      data.story_data || {},
      script_data:     data.script_data || {},
      total_scenes:    data.total_scenes || 0,
      status:          'pending',
      language:        data.language || 'ar',
      voice_id:        data.voice_id || null,
      narrator_tone:   data.narrator_tone || 'dramatic',
      // Duration fields
      duration_minutes: data.duration_minutes || 3,
      split_parts:      data.split_parts || 1,
      scenes_per_part:  data.scenes_per_part || 7,
      sec_per_scene:    data.sec_per_scene || 26
    })
    .select()
    .single();
  if (error) throw error;
  return story;
}

export async function getUserStories(userId, limit = 15) {
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .eq('user_id', userId.toString())
    .not('status', 'eq', 'deleted')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getStoryById(storyId) {
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .eq('id', storyId)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function updateStory(storyId, updates) {
  const { data, error } = await supabase
    .from('stories')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', storyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getAllActiveStories() {
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .in('status', ['pending', 'video_ready'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ═══════════════════════════════════════════════════════════════════
// SCENES
// ═══════════════════════════════════════════════════════════════════
export async function createScene(storyId, userId, sceneData) {
  const { data, error } = await supabase
    .from('scenes')
    .insert({
      story_id:     storyId,
      user_id:      userId.toString(),
      scene_number: sceneData.number,
      scene_title:  sceneData.scene_title,
      narration:    sceneData.narration,
      image_prompt: sceneData.image_prompt,
      voice_tone:   sceneData.voice_tone || 'dramatic',
      duration_sec: sceneData.duration_seconds || 26,
      status:       'pending'
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateScene(sceneId, updates) {
  const { data, error } = await supabase
    .from('scenes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', sceneId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getStoryScenes(storyId) {
  const { data, error } = await supabase
    .from('scenes')
    .select('*')
    .eq('story_id', storyId)
    .order('scene_number', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ═══════════════════════════════════════════════════════════════════
// YOUTUBE CHANNELS
// ═══════════════════════════════════════════════════════════════════
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

export async function saveYouTubeChannel(userId, channelData) {
  const { data, error } = await supabase
    .from('youtube_channels')
    .upsert({
      user_id:       userId.toString(),
      client_id:     channelData.clientId,
      client_secret: channelData.clientSecret,
      refresh_token: channelData.refreshToken,
      channel_id:    channelData.channelId || null,
      channel_title: channelData.channelTitle || null,
      is_active:     true,
      updated_at:    new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ═══════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════
export async function logAutoPublish(userId, storyId, action, status, details = {}) {
  await supabase.from('auto_publish_log').insert({
    user_id: userId.toString(), story_id: storyId, action, status, details
  }).catch(() => {});
}

// ── Backwards compatibility aliases ──────────────────────────────────
export const getUserSeries     = getUserStories;
export const getSeriesById     = getStoryById;
export const updateSeries      = updateStory;
export const getAllActiveSeries = getAllActiveStories;
export const getSeriesEpisodes = getStoryScenes;
export const updateEpisode     = updateScene;
