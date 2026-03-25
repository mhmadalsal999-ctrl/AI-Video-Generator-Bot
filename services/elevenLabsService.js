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

// Default free voices for Arabic/multilingual
export const FREE_VOICES = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (عربي)', lang: 'ar' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (إنجليزي)', lang: 'en' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh (عربي)', lang: 'ar' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold (قوي)', lang: 'ar' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (ناعم)', lang: 'en' }
];

/**
 * Get available voices
 */
export async function getVoices() {
  try {
    const response = await axios.get(`${BASE_URL}/voices`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    return response.data.voices || FREE_VOICES;
  } catch (e) {
    logger.warn('ELEVENLABS', 'Using default voices list');
    return FREE_VOICES;
  }
}

/**
 * Generate audio from text using ElevenLabs
 */
export async function generateAudio(text, voiceId = null, language = 'ar') {
  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');

  // Select best voice based on language
  const selectedVoice = voiceId || (language === 'ar' ? FREE_VOICES[0].id : FREE_VOICES[1].id);

  logger.api(`Generating audio with voice ${selectedVoice}`);

  const response = await axios.post(
    `${BASE_URL}/text-to-speech/${selectedVoice}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.5,
        use_speaker_boost: true
      }
    },
    {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      responseType: 'arraybuffer',
      timeout: 60000
    }
  );

  const fileName = `audio_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.writeFile(filePath, Buffer.from(response.data));
  
  logger.success('ELEVENLABS', `Audio generated: ${fileName}`);
  return filePath;
}
