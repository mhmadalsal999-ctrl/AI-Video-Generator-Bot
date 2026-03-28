/**
 * elevenLabsService.js
 * Voice narration with fallback chain
 *
 * Priority:
 * 1. ElevenLabs TTS     - جودة عالية (يحتاج ELEVENLABS_API_KEY)
 * 2. Google Cloud TTS   - مجاني 1 مليون حرف/شهر (يحتاج GOOGLE_TTS_KEY)
 * 3. EdgeTTS (Microsoft)- مجاني تماما، بدون مفتاح، عربي ممتاز
 */

import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';
dotenv.config();

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../temp');
fs.ensureDirSync(TEMP_DIR);

const BASE_URL = 'https://api.elevenlabs.io/v1';

export const NARRATOR_VOICES = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',   style: 'dramatic',  lang: 'ar', desc: 'صوت درامي قوي' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',   style: 'intense',   lang: 'ar', desc: 'صوت مشوق متوتر' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', style: 'epic',      lang: 'ar', desc: 'صوت ملحمي حاد' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', style: 'calm',      lang: 'ar', desc: 'صوت هادئ رصين' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', style: 'soft',      lang: 'en', desc: 'صوت ناعم انجليزي' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',  style: 'narrator',  lang: 'en', desc: 'صوت راوي انجليزي' }
];

const TONE_SETTINGS = {
  calm:     { stability: 0.75, similarity_boost: 0.85, style: 0.20, use_speaker_boost: true },
  dramatic: { stability: 0.50, similarity_boost: 0.85, style: 0.65, use_speaker_boost: true },
  intense:  { stability: 0.35, similarity_boost: 0.90, style: 0.80, use_speaker_boost: true },
  whisper:  { stability: 0.85, similarity_boost: 0.70, style: 0.10, use_speaker_boost: false },
  powerful: { stability: 0.40, similarity_boost: 0.92, style: 0.75, use_speaker_boost: true },
  solemn:   { stability: 0.70, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
  default:  { stability: 0.55, similarity_boost: 0.85, style: 0.50, use_speaker_boost: true }
};

function selectVoice(voiceId, language, tone) {
  if (voiceId) return voiceId;
  const langVoices = NARRATOR_VOICES.filter(v => v.lang === language);
  const toneMatch = langVoices.find(v => v.style === tone);
  return (toneMatch || langVoices[0] || NARRATOR_VOICES[0]).id;
}

// ===================================================================
// 1. ELEVENLABS - Primary (Best quality)
// ===================================================================
async function generateWithElevenLabs(text, voiceId, language, tone) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

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
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      responseType: 'arraybuffer',
      timeout: 90000
    }
  );

  const buffer = Buffer.from(response.data);
  if (buffer.byteLength < 1000) throw new Error('ElevenLabs returned empty audio');

  const filePath = path.join(TEMP_DIR, `audio_el_${Date.now()}.mp3`);
  await fs.writeFile(filePath, buffer);
  logger.success('AUDIO', `ElevenLabs -> ${path.basename(filePath)}`);
  return filePath;
}

// ===================================================================
// 2. GOOGLE CLOUD TTS - Fallback 1 (Free 1M chars/month)
//    احصل على مفتاح: https://console.cloud.google.com
//    اضف في Render: GOOGLE_TTS_KEY=your_key
// ===================================================================
async function generateWithGoogleTTS(text, language) {
  const apiKey = process.env.GOOGLE_TTS_KEY;
  if (!apiKey) throw new Error('GOOGLE_TTS_KEY not set');

  const langCode = language === 'ar' ? 'ar-XA' : 'en-US';
  const voiceName = language === 'ar' ? 'ar-XA-Wavenet-B' : 'en-US-Neural2-D';

  logger.api(`Google TTS: lang=${langCode}`);

  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      input: { text },
      voice: { languageCode: langCode, name: voiceName },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95, pitch: -2 }
    },
    { timeout: 30000 }
  );

  const buffer = Buffer.from(response.data.audioContent, 'base64');
  const filePath = path.join(TEMP_DIR, `audio_gtts_${Date.now()}.mp3`);
  await fs.writeFile(filePath, buffer);
  logger.success('AUDIO', `Google TTS -> ${path.basename(filePath)}`);
  return filePath;
}

// ===================================================================
// 3. EDGE TTS (Microsoft) - Fallback 2 (100% Free, no key needed)
//    عربي ممتاز، بدون قيود
// ===================================================================
async function generateWithEdgeTTS(text, language) {
  const voice = language === 'ar'
    ? 'ar-SA-HamedNeural'
    : 'en-US-GuyNeural';

  const filePath = path.join(TEMP_DIR, `audio_edge_${Date.now()}.mp3`);
  logger.api(`EdgeTTS: voice=${voice}`);

  // تثبيت edge-tts اذا مو موجود
  try {
    await execFileAsync('edge-tts', ['--version']).catch(async () => {
      await execFileAsync('pip', ['install', 'edge-tts', '--break-system-packages', '-q']);
    });

    await execFileAsync('edge-tts', [
      '--voice', voice,
      '--text', text.substring(0, 3000),
      '--write-media', filePath
    ], { timeout: 60000 });

    const stat = await fs.stat(filePath);
    if (stat.size < 1000) throw new Error('EdgeTTS: file too small');

    logger.success('AUDIO', `EdgeTTS -> ${path.basename(filePath)}`);
    return filePath;

  } catch (err) {
    throw new Error(`EdgeTTS failed: ${err.message}`);
  }
}

// ===================================================================
// MAIN EXPORT - Full fallback chain
// ElevenLabs -> Google TTS -> EdgeTTS
// ===================================================================
export async function generateAudio(text, voiceId = null, language = 'ar', tone = 'dramatic') {

  // 1. ElevenLabs
  try {
    return await generateWithElevenLabs(text, voiceId, language, tone);
  } catch (err) {
    if (err.message.includes('not set')) {
      logger.warn('AUDIO', 'ELEVENLABS_API_KEY not set - trying fallbacks');
    } else {
      logger.warn('AUDIO', `ElevenLabs failed: ${err.message}`);
    }
  }

  // 2. Google TTS
  try {
    return await generateWithGoogleTTS(text, language);
  } catch (err) {
    if (!err.message.includes('not set')) {
      logger.warn('AUDIO', `Google TTS failed: ${err.message}`);
    }
  }

  // 3. EdgeTTS - مجاني دائما
  try {
    logger.api('Trying EdgeTTS (Microsoft, free, no key needed)...');
    return await generateWithEdgeTTS(text, language);
  } catch (err) {
    logger.warn('AUDIO', `EdgeTTS failed: ${err.message}`);
  }

  throw new Error('Failed to generate audio from all providers.');
}

export async function getVoices() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return NARRATOR_VOICES;
    const response = await axios.get(`${BASE_URL}/voices`, {
      headers: { 'xi-api-key': apiKey },
      timeout: 15000
    });
    return response.data.voices || NARRATOR_VOICES;
  } catch {
    return NARRATOR_VOICES;
  }
}

export { NARRATOR_VOICES as FREE_VOICES };
