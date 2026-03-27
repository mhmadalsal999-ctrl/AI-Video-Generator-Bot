/**
 * elevenLabsService.js
 * Professional voice narration with tone-matched settings
 * Primary: ElevenLabs TTS
 * Fallback: Informative error (no silent fallback)
 */

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

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const BASE_URL = 'https://api.elevenlabs.io/v1';

// ── Voice catalog — multilingual narrators ─────────────────────────
export const NARRATOR_VOICES = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',   style: 'dramatic',  lang: 'ar', desc: 'صوت درامي قوي' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',   style: 'intense',   lang: 'ar', desc: 'صوت مشوق متوتر' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', style: 'epic',      lang: 'ar', desc: 'صوت ملحمي حاد' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', style: 'calm',      lang: 'ar', desc: 'صوت هادئ رصين' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', style: 'soft',      lang: 'en', desc: 'صوت ناعم إنجليزي' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',  style: 'narrator',  lang: 'en', desc: 'صوت راوي إنجليزي' }
];

// ── Voice settings by tone ─────────────────────────────────────────
const TONE_SETTINGS = {
  calm:     { stability: 0.75, similarity_boost: 0.85, style: 0.20, use_speaker_boost: true },
  dramatic: { stability: 0.50, similarity_boost: 0.85, style: 0.65, use_speaker_boost: true },
  intense:  { stability: 0.35, similarity_boost: 0.90, style: 0.80, use_speaker_boost: true },
  whisper:  { stability: 0.85, similarity_boost: 0.70, style: 0.10, use_speaker_boost: false },
  powerful: { stability: 0.40, similarity_boost: 0.92, style: 0.75, use_speaker_boost: true },
  solemn:   { stability: 0.70, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
  default:  { stability: 0.55, similarity_boost: 0.85, style: 0.50, use_speaker_boost: true }
};

// ── Best voice for language + tone ────────────────────────────────
function selectVoice(voiceId, language, tone) {
  if (voiceId) return voiceId;

  const langVoices = NARRATOR_VOICES.filter(v => v.lang === language);
  const toneMatch  = langVoices.find(v => v.style === tone);
  return (toneMatch || langVoices[0] || NARRATOR_VOICES[0]).id;
}

// ── Generate audio file ────────────────────────────────────────────
export async function generateAudio(text, voiceId = null, language = 'ar', tone = 'dramatic') {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY غير مضبوط. أضفه في متغيرات البيئة.');
  }

  const selectedVoice = selectVoice(voiceId, language, tone);
  const settings = TONE_SETTINGS[tone] || TONE_SETTINGS.default;

  logger.api(`ElevenLabs TTS: voice=${selectedVoice}, tone=${tone}, lang=${language}`);

  const response = await axios.post(
    `${BASE_URL}/text-to-speech/${selectedVoice}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: settings
    },
    {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      responseType: 'arraybuffer',
      timeout: 90000
    }
  );

  const buffer = Buffer.from(response.data);
  if (buffer.byteLength < 1000) {
    throw new Error('ElevenLabs returned empty audio response');
  }

  const fileName = `audio_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.writeFile(filePath, buffer);

  logger.success('ELEVENLABS', `Audio generated: ${fileName} (${(buffer.byteLength / 1024).toFixed(0)} KB)`);
  return filePath;
}

// ── Get available voices ───────────────────────────────────────────
export async function getVoices() {
  try {
    const response = await axios.get(`${BASE_URL}/voices`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      timeout: 15000
    });
    return response.data.voices || NARRATOR_VOICES;
  } catch {
    logger.warn('ELEVENLABS', 'Using default voice list');
    return NARRATOR_VOICES;
  }
}

export { NARRATOR_VOICES as FREE_VOICES };
