/**
 * elevenLabsService.js
 * Voice narration with fallback chain
 *
 * Priority:
 * 1. ElevenLabs TTS   - جودة عالية (يحتاج ELEVENLABS_API_KEY)
 * 2. Google Cloud TTS - مجاني 1 مليون حرف/شهر (يحتاج GOOGLE_TTS_KEY)
 * 3. VoiceRSS TTS     - مجاني 350 طلب/يوم (يحتاج VOICERSS_KEY)
 * 4. Silent Fallback  - صمت مضمون، الفيديو يكمل دائماً
 *
 * تم إزالة EdgeTTS نهائياً - يحتاج Python CLI غير متاح على Render
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
    { text, model_id: 'eleven_multilingual_v2', voice_settings: settings },
    {
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
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

  // أفضل أصوات Neural2 المتاحة
  // عربي: ar-XA-Neural2-B = صوت رجالي عربي فصيح احترافي
  // انجليزي: en-US-Neural2-J = صوت رجالي عميق مناسب للسرد الوثائقي
  const voiceMap = {
    ar: { langCode: 'ar-XA', voiceName: 'ar-XA-Neural2-B', speakingRate: 0.88, pitch: -1.5 },
    en: { langCode: 'en-US', voiceName: 'en-US-Neural2-J', speakingRate: 0.92, pitch: -2.0 }
  };

  const config = voiceMap[language] || voiceMap.en;
  logger.api(`Google TTS Neural2: voice=${config.voiceName}`);

  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      input: { text },
      voice: { languageCode: config.langCode, name: config.voiceName },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: config.speakingRate,
        pitch: config.pitch,
        volumeGainDb: 1.0
      }
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
// 3. VOICERSS TTS - Fallback 2 (Free 350 req/day, HTTP only, no install)
//    احصل على مفتاح مجاني: https://www.voicerss.org/registration.aspx
//    اضف في Render: VOICERSS_KEY=your_key
// ===================================================================
async function generateWithVoiceRSS(text, language) {
  const apiKey = process.env.VOICERSS_KEY;
  if (!apiKey) throw new Error('VOICERSS_KEY not set');

  const langCode = language === 'ar' ? 'ar-sa' : 'en-us';
  logger.api(`VoiceRSS TTS: lang=${langCode}`);

  const response = await axios.get('https://api.voicerss.org/', {
    params: {
      key: apiKey,
      hl: langCode,
      src: text.substring(0, 3000),
      c: 'MP3',
      f: '44khz_16bit_stereo'
    },
    responseType: 'arraybuffer',
    timeout: 30000
  });

  const buffer = Buffer.from(response.data);
  if (buffer.byteLength < 1000) throw new Error('VoiceRSS returned empty audio');

  const filePath = path.join(TEMP_DIR, `audio_vrss_${Date.now()}.mp3`);
  await fs.writeFile(filePath, buffer);
  logger.success('AUDIO', `VoiceRSS -> ${path.basename(filePath)}`);
  return filePath;
}

// ===================================================================
// 4. STREAMELEMENTS TTS - Fallback 3 (مجاني 100% بدون مفتاح)
// ===================================================================
async function generateWithStreamElements(text, language) {
  const voice = language === "ar" ? "Hala" : "Brian";
  const encoded = encodeURIComponent(text.substring(0, 2000));
  const url = `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encoded}`;
  logger.api(`StreamElements TTS: voice=${voice}`);
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const buffer = Buffer.from(response.data);
  if (buffer.byteLength < 1000) throw new Error("StreamElements returned empty audio");
  const filePath = path.join(TEMP_DIR, `audio_se_${Date.now()}.mp3`);
  await fs.writeFile(filePath, buffer);
  logger.success("AUDIO", `StreamElements -> ${path.basename(filePath)}`);
  return filePath;
}

// ===================================================================
// 4. SILENT FALLBACK - مضمون 100%، الفيديو يكمل دائماً بدون صوت
// ===================================================================
async function generateSilentAudio(durationSeconds = 30) {
  logger.warn('AUDIO', 'All TTS providers failed - generating silent audio');

  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buffer = Buffer.alloc(fileSize, 0);

  // WAV Header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const filePath = path.join(TEMP_DIR, `audio_silent_${Date.now()}.wav`);
  await fs.writeFile(filePath, buffer);
  logger.success('AUDIO', `Silent audio -> ${path.basename(filePath)} (${durationSeconds}s)`);
  return filePath;
}

// ===================================================================
// MAIN EXPORT - Full fallback chain
// Google TTS -> ElevenLabs -> VoiceRSS -> Silent (never fails)
// ===================================================================
export async function generateAudio(text, voiceId = null, language = 'ar', tone = 'dramatic') {

  // 1. Google TTS - الأول لأنه مجاني واحترافي
  try {
    return await generateWithGoogleTTS(text, language);
  } catch (err) {
    if (!err.message.includes('not set')) {
      logger.warn('AUDIO', `Google TTS failed: ${err.message}`);
    }
  }

  // 2. ElevenLabs
  try {
    return await generateWithElevenLabs(text, voiceId, language, tone);
  } catch (err) {
    if (!err.message.includes('not set')) {
      logger.warn('AUDIO', `ElevenLabs failed: ${err.message}`);
    }
  }

  // 3. VoiceRSS
  try {
    logger.api('Trying VoiceRSS TTS...');
    return await generateWithVoiceRSS(text, language);
  } catch (err) {
    if (!err.message.includes('not set')) {
      logger.warn('AUDIO', `VoiceRSS failed: ${err.message}`);
    }
  }

  // 4. StreamElements - مجاني بدون مفتاح
  try {
    logger.api("Trying StreamElements TTS...");
    return await generateWithStreamElements(text, language);
  } catch (err) {
    logger.warn("AUDIO", `StreamElements failed: ${err.message}`);
  }

  // 5. Silent - لا يفشل أبداً
  return await generateSilentAudio(30);
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
