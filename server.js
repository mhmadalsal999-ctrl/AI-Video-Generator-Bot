import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { bot } from './bot/bot.js';
import { initCronJobs, setBotInstance } from './services/cronScheduler.js';
import { cleanupTempFiles } from './services/ffmpegService.js';
import { logger } from './utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  logger.info('HTTP', `${req.method} ${req.path}`);
  next();
});

// Health check — required for Render zero-downtime
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'story-narrator-bot',
    mode: CALLBACK_BASE_URL ? 'webhook' : 'polling',
    uptime: process.uptime()
  });
});

// Keep-alive ping (Render free tier)
app.get('/ping', (_req, res) => res.send('pong'));

// Telegram Webhook
app.post('/webhook', (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    logger.error('WEBHOOK', err.message);
    res.sendStatus(200); // always 200 to Telegram
  }
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('EXPRESS', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
  logger.success('SERVER', `Story Narrator Bot started on port ${PORT}`);

  setBotInstance(bot);

  if (CALLBACK_BASE_URL) {
    try {
      const webhookUrl = `${CALLBACK_BASE_URL}/webhook`;
      await bot.deleteWebHook();
      await new Promise(r => setTimeout(r, 1000));
      await bot.setWebHook(webhookUrl);
      logger.success('SERVER', `Webhook set: ${webhookUrl}`);
    } catch (err) {
      logger.error('SERVER', `Webhook setup failed: ${err.message}`);
    }
  } else {
    logger.info('SERVER', 'Running in POLLING mode (set CALLBACK_BASE_URL for webhook)');
  }

  initCronJobs();
  setTimeout(() => cleanupTempFiles().catch(() => {}), 8000);
});

process.on('SIGTERM', () => {
  logger.info('SERVER', 'SIGTERM received — shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error('SERVER', `Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error('SERVER', `Unhandled Rejection: ${reason}`);
});
