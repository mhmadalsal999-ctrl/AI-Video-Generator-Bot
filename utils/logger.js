const ts = () => new Date().toISOString();

export const logger = {
  info:    (cat, msg) => console.log(`[${ts()}] ℹ️  [${cat}] ${msg}`),
  success: (cat, msg) => console.log(`[${ts()}] ✅ [${cat}] ${msg}`),
  error:   (cat, msg) => console.error(`[${ts()}] ❌ [${cat}] ${msg}`),
  warn:    (cat, msg) => console.warn(`[${ts()}] ⚠️  [${cat}] ${msg}`),
  debug:   (cat, msg) => console.log(`[${ts()}] 🔍 [${cat}] ${msg}`),
  bot:     (msg)      => console.log(`[${ts()}] 🤖 [BOT] ${msg}`),
  api:     (msg)      => console.log(`[${ts()}] 🌐 [API] ${msg}`),
  video:   (msg)      => console.log(`[${ts()}] 🎬 [VIDEO] ${msg}`),
  cron:    (msg)      => console.log(`[${ts()}] ⏰ [CRON] ${msg}`),
  story:   (msg)      => console.log(`[${ts()}] 📖 [STORY] ${msg}`),
};
