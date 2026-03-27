/**
 * youtubeService.js
 * YouTube Data API v3 — upload videos to user channel
 */

import { google } from 'googleapis';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../temp');
fs.ensureDirSync(TEMP_DIR);

function getOAuth2Client(clientId, clientSecret, refreshToken) {
  const client = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

// ── Upload video file ─────────────────────────────────────────────────
async function uploadToYouTube(videoPath, title, description, tags, clientId, clientSecret, refreshToken) {
  logger.api(`Uploading to YouTube: "${title}"`);

  const oauth2Client = getOAuth2Client(clientId, clientSecret, refreshToken);
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const videoStream = fs.createReadStream(videoPath);
  const fileSize = (await fs.stat(videoPath)).size;

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.substring(0, 100),
        description: description.substring(0, 5000),
        tags: tags?.slice(0, 30) || [],
        defaultLanguage: 'ar',
        defaultAudioLanguage: 'ar'
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      mimeType: 'video/mp4',
      body: videoStream
    }
  });

  const videoId = response.data.id;
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const shortsUrl = `https://www.youtube.com/shorts/${videoId}`;

  logger.success('YOUTUBE', `Uploaded: ${url}`);
  return { videoId, url, shortsUrl };
}

// ── Upload from Supabase Storage URL ─────────────────────────────────
export async function uploadFromStorageUrl(videoUrl, title, description, tags, clientId, clientSecret, refreshToken) {
  // Download file first
  const filePath = path.join(TEMP_DIR, `yt_upload_${Date.now()}.mp4`);
  try {
    logger.api('Downloading video for YouTube upload');
    const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream', timeout: 300000 });
    const writer = fs.createWriteStream(filePath);
    await new Promise((res, rej) => {
      response.data.pipe(writer);
      writer.on('finish', res);
      writer.on('error', rej);
    });
    return await uploadToYouTube(filePath, title, description, tags, clientId, clientSecret, refreshToken);
  } finally {
    await fs.remove(filePath).catch(() => {});
  }
}

// ── Upload using env credentials ──────────────────────────────────────
export async function uploadWithEnvCredentials(videoPathOrUrl, title, description, tags) {
  const clientId     = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('YouTube credentials not configured in environment variables');
  }

  // Check if it's a URL or a file path
  if (videoPathOrUrl.startsWith('http')) {
    return uploadFromStorageUrl(videoPathOrUrl, title, description, tags, clientId, clientSecret, refreshToken);
  }
  return uploadToYouTube(videoPathOrUrl, title, description, tags, clientId, clientSecret, refreshToken);
}

// ── Verify credentials ────────────────────────────────────────────────
export async function verifyYouTubeCredentials(clientId, clientSecret, refreshToken) {
  try {
    const oauth2Client = getOAuth2Client(clientId, clientSecret, refreshToken);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.channels.list({ part: ['snippet'], mine: true });

    if (response.data.items?.length > 0) {
      const ch = response.data.items[0];
      return { valid: true, channelTitle: ch.snippet.title, channelId: ch.id };
    }
    return { valid: false, error: 'القناة غير موجودة' };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
