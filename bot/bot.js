import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { handleMessage } from './handlers/messageHandler.js';
import { handleCallbackQuery } from './handlers/callbackHandler.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL;

if (!token) {
  logger.error('BOT', 'TELEGRAM_BOT_TOKEN is missing');
  process.exit(1);
}

const useWebhook = !!CALLBACK_BASE_URL;
export const bot = new TelegramBot(token, { polling: !useWebhook });

logger.success('BOT', `Bot initialized (${useWebhook ? 'Webhook' : 'Polling'} mode)`);

bot.on('error', (err) => logger.error('BOT', err.message));
bot.on('polling_error', (err) => logger.error('BOT', `Polling error: ${err.message}`));

bot.on('message', async (msg) => {
  try {
    await handleMessage(bot, msg);
  } catch (err) {
    logger.error('BOT', `Message handler error: ${err.message}`);
    try {
      await bot.sendMessage(msg.chat.id, '❌ حدث خطأ. يرجى المحاولة مرة أخرى أو اضغط /start');
    } catch (_) {}
  }
});

bot.on('callback_query', async (query) => {
  try {
    await handleCallbackQuery(bot, query);
  } catch (err) {
    logger.error('BOT', `Callback handler error: ${err.message}`);
    try {
      await bot.answerCallbackQuery(query.id, { text: '❌ حدث خطأ. حاول مرة أخرى.' });
    } catch (_) {}
  }
});
