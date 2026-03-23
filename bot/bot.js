import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { handleMessage } from './handlers/messageHandler.js';
import { handleCallbackQuery } from './handlers/callbackHandler.js';
import { createSupabaseClient } from '../db/supabase.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL;

if (!token) {
  console.error(`[${new Date().toISOString()}] ERROR: TELEGRAM_BOT_TOKEN is not set`);
  process.exit(1);
}

// Use Webhook in production (when CALLBACK_BASE_URL is set), Polling in development
const useWebhook = !!CALLBACK_BASE_URL;
export const bot = new TelegramBot(token, { polling: !useWebhook });

// Initialize Supabase
const supabase = createSupabaseClient();

// Log bot initialization
console.log(`[${new Date().toISOString()}] Telegram bot initialized successfully`);

// Handle errors
bot.on('error', (error) => {
  console.error(`[${new Date().toISOString()}] Bot Error:`, error);
});

bot.on('polling_error', (error) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Polling Error:`, error);
  
  // Handle 409 conflict error (multiple bot instances)
  if (error.response?.body?.error_code === 409) {
    console.error(`[${timestamp}] ERROR 409: Multiple bot instances detected.`);
    console.error(`[${timestamp}] This usually happens in production. Consider using Webhook mode.`);
    console.error(`[${timestamp}] Set CALLBACK_BASE_URL environment variable to enable Webhook mode.`);
    
    // Don't exit immediately, try to recover
    // The server will set up webhook if CALLBACK_BASE_URL is available
  }
});

// Handle messages
bot.on('message', async (msg) => {
  try {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Received message from user ${msg.from.id}: ${msg.text || 'media'}`);
    await handleMessage(bot, msg, supabase);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error handling message:`, error);
    try {
      await bot.sendMessage(msg.chat.id, '❌ حدث خطأ أثناء معالجة الرسالة. يرجى المحاولة مرة أخرى.');
    } catch (sendError) {
      console.error(`[${new Date().toISOString()}] Error sending error message:`, sendError);
    }
  }
});

// Handle callback queries (button presses)
bot.on('callback_query', async (query) => {
  try {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Received callback query from user ${query.from.id}: ${query.data}`);
    await handleCallbackQuery(bot, query, supabase);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error handling callback query:`, error);
    try {
      await bot.answerCallbackQuery(query.id, { text: '❌ حدث خطأ. يرجى المحاولة مرة أخرى.' });
    } catch (answerError) {
      console.error(`[${new Date().toISOString()}] Error answering callback query:`, answerError);
    }
  }
});

export { bot as telegramBot };

.
