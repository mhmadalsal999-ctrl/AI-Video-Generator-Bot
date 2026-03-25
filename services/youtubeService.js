import { google } from 'googleapis';
import fs from 'fs-extra';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../temp');

function getOAuth2Client(clientId, clientSecret, refreshToken) {
  const client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Upload video to YouTube as Shorts
 */
export async function uploadToYouTube(videoPath, title, description, tags, clientId, clientSecret, refreshToken) {
  logger.api(`Uploading to YouTube: ${title}`);

  const oauth2Client = getOAuth2Client(clientId, clientSecret, refreshToken);
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title || 'AI Anime - الحلقة الجديدة',
        description: description || 'حلقة أنيميشن مولدة بالذكاء الاصطناعي',
        categoryId: '1',
        tags: tags || ['أنيمي', 'AI', 'Shorts', 'anime', 'animation']
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
      }
    },
    media: { body: fs.createReadStream(videoPath) }
  });

  const videoId = response.data.id;
  const shortsUrl = `https://www.youtube.com/shorts/${videoId}`;
  logger.success('YOUTUBE', `Uploaded: ${shortsUrl}`);

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    shortsUrl
  };
}

/**
 * Upload from URL (download first, then upload)
 */
export async function uploadFromUrl(videoUrl, title, description, tags, clientId, clientSecret, refreshToken) {
  const fileName = `yt_upload_${Date.now()}.mp4`;
  const filePath = path.join(TEMP_DIR, fileName);

  try {
    logger.video('Downloading video for YouTube upload');
    const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream', timeout: 300000 });
    const writer = fs.createWriteStream(filePath);
    await new Promise((res, rej) => {
      response.data.pipe(writer);
      writer.on('finish', res);
      writer.on('error', rej);
    });

    const result = await uploadToYouTube(filePath, title, description, tags, clientId, clientSecret, refreshToken);
    return result;
  } finally {
    await fs.remove(filePath).catch(() => {});
  }
}

/**
 * Verify YouTube credentials
 */
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
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// Use env credentials if provided (for auto-publish)
export async function uploadWithEnvCredentials(videoPath, title, description, tags) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('YouTube env credentials not configured');
  }

  return uploadToYouTube(videoPath, title, description, tags, clientId, clientSecret, refreshToken);
}
