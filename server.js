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

// Request logger
app.use((req, res, next) => {
  logger.info('HTTP', `${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mode: CALLBACK_BASE_URL ? 'webhook' : 'polling'
  });
});

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

// Error handler
app.use((err, req, res, next) => {
  logger.error('EXPRESS', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start
app.listen(PORT, async () => {
  logger.success('SERVER', `Started on port ${PORT}`);

  // Pass bot to cron scheduler for notifications
  setBotInstance(bot);

  // Setup webhook if production
  if (CALLBACK_BASE_URL) {
    try {
      const webhookUrl = `${CALLBACK_BASE_URL}/webhook`;
      await bot.deleteWebHook();
      await bot.setWebHook(webhookUrl);
      logger.success('SERVER', `Webhook set: ${webhookUrl}`);
    } catch (err) {
      logger.error('SERVER', `Webhook setup failed: ${err.message}`);
    }
  } else {
    logger.info('SERVER', 'Running in polling mode (no CALLBACK_BASE_URL set)');
  }

  // Init cron jobs (daily publish + cleanup)
  initCronJobs();

  // Startup cleanup
  setTimeout(() => cleanupTempFiles().catch(() => {}), 5000);
});

process.on('SIGTERM', () => {
  logger.info('SERVER', 'SIGTERM received, shutting down');
  process.exit(0);
});
