// ═══════════════════════════════════════════════════════════════════
// messages.js — All keyboards and message templates
// Story Narrator Bot v3.0
// ═══════════════════════════════════════════════════════════════════

export function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📖 قصة جديدة' },   { text: '📚 مكتبتي' }],
        [{ text: '📺 إعداد يوتيوب' }, { text: '❓ مساعدة' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

export function cancelKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: '❌ إلغاء' }]],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

// ── Story category selection ─────────────────────────────────────────
export function categoryKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🏛️ تاريخية موثقة',      callback_data: 'cat:history' },
          { text: '🔍 جرائم وألغاز',         callback_data: 'cat:crime' }
        ],
        [
          { text: '🌍 حضارات قديمة',         callback_data: 'cat:civilizations' },
          { text: '⚔️ حروب ومعارك',           callback_data: 'cat:wars' }
        ],
        [
          { text: '👑 شخصيات أثّرت',          callback_data: 'cat:figures' },
          { text: '🕵️ أسرار التاريخ',         callback_data: 'cat:secrets' }
        ],
        [
          { text: '🌙 قصص عربية وإسلامية',   callback_data: 'cat:arabic' },
          { text: '🌊 كوارث وأحداث كبرى',    callback_data: 'cat:disasters' }
        ]
      ]
    }
  };
}

// ── Language selection ───────────────────────────────────────────────
export function languageKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🇸🇦 عربي (فصيح)',  callback_data: 'lang:ar' },
          { text: '🇺🇸 English',      callback_data: 'lang:en' }
        ]
      ]
    }
  };
}

// ── Video duration selection (NEW) ───────────────────────────────────
export function durationKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⚡ 1 دقيقة  (3 مشاهد)',  callback_data: 'dur:1' },
          { text: '🎬 2 دقيقتين (5 مشاهد)', callback_data: 'dur:2' }
        ],
        [
          { text: '📽️ 3 دقائق  (7 مشاهد)',  callback_data: 'dur:3' },
          { text: '🎥 5 دقائق (11 مشهد)',   callback_data: 'dur:5' }
        ],
        [
          { text: '🎞️ 10 دقائق (3 أجزاء × 7 مشاهد)', callback_data: 'dur:10' }
        ],
        [
          { text: '◀️ رجوع',  callback_data: 'back:lang' }
        ]
      ]
    }
  };
}

// ── Split confirmation for long videos (NEW) ─────────────────────────
export function splitKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📦 3 فيديوهات منفصلة (موصى به)', callback_data: 'split:yes' }
        ],
        [
          { text: '🎬 فيديو واحد طويل (10 دق)', callback_data: 'split:no' }
        ],
        [
          { text: '◀️ تغيير المدة', callback_data: 'back:duration' }
        ]
      ]
    }
  };
}

// ── Story preview actions ────────────────────────────────────────────
export function storyPreviewKeyboard(storyId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ إنشاء الفيديو',    callback_data: `generate:${storyId}` },
          { text: '🔄 قصة أخرى',        callback_data: `another:${storyId}` }
        ],
        [
          { text: '📝 عرض السيناريو',   callback_data: `script:${storyId}` }
        ],
        [
          { text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }
        ]
      ]
    }
  };
}

// ── After video generated ────────────────────────────────────────────
export function afterVideoKeyboard(storyId, hasYoutube = false) {
  const buttons = [
    [{ text: '📖 قصة جديدة', callback_data: 'new:story' }]
  ];
  if (hasYoutube) {
    buttons.unshift([{ text: '📺 نشر على يوتيوب', callback_data: `publish:${storyId}` }]);
  }
  buttons.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]);
  return { reply_markup: { inline_keyboard: buttons } };
}

// ── Story library ────────────────────────────────────────────────────
export function storiesListKeyboard(stories) {
  const buttons = stories.map(s => {
    const emoji = { video_ready: '🎬', published: '✅', pending: '⏳', generating: '🔄', failed: '❌' }[s.status] || '📖';
    const mins = s.duration_minutes ? ` (${s.duration_minutes}د)` : '';
    const title = s.title.length > 25 ? s.title.substring(0, 22) + '...' : s.title;
    return [{ text: `${emoji} ${title}${mins}`, callback_data: `story:${s.id}` }];
  });
  buttons.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]);
  return { reply_markup: { inline_keyboard: buttons } };
}

// ── Story detail actions ─────────────────────────────────────────────
export function storyDetailKeyboard(story) {
  const buttons = [];
  if (story.status === 'video_ready' || story.status === 'published') {
    buttons.push([{ text: '🎬 إرسال الفيديو مجدداً', callback_data: `resend:${story.id}` }]);
    if (!story.youtube_url) {
      buttons.push([{ text: '📺 نشر على يوتيوب', callback_data: `publish:${story.id}` }]);
    }
  }
  if (['pending', 'failed'].includes(story.status)) {
    buttons.push([{ text: '🔄 إعادة الإنشاء', callback_data: `generate:${story.id}` }]);
  }
  buttons.push(
    [{ text: '📝 عرض السيناريو', callback_data: `script:${story.id}` }],
    [{ text: '🗑️ حذف', callback_data: `delete:${story.id}` }, { text: '◀️ رجوع', callback_data: 'back:library' }]
  );
  return { reply_markup: { inline_keyboard: buttons } };
}

// ── Confirm keyboard ─────────────────────────────────────────────────
export function confirmKeyboard(action, itemId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ نعم، تأكيد', callback_data: `confirm:${action}:${itemId}` },
          { text: '❌ إلغاء',      callback_data: 'back:main' }
        ]
      ]
    }
  };
}

// ── YouTube setup keyboard ────────────────────────────────────────────
export function youtubeSetupKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔧 ربط قناتي',              callback_data: 'yt:setup' }],
        [{ text: '❓ كيف أحصل على البيانات؟', callback_data: 'yt:help' }],
        [{ text: '🏠 رجوع',                    callback_data: 'back:main' }]
      ]
    }
  };
}

// ── Voice selection keyboard ──────────────────────────────────────────
export function voiceKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎙️ صوت درامي قوي',  callback_data: 'voice:pNInz6obpgDQGcFmaJgB' },
          { text: '🎙️ صوت مشوق متوتر', callback_data: 'voice:TxGEqnHWrfWFTfGW9XjX' }
        ],
        [
          { text: '🎙️ صوت ملحمي حاد',  callback_data: 'voice:VR6AewLTigWG4xSOukaG' },
          { text: '🎙️ صوت هادئ رصين',  callback_data: 'voice:ErXwobaYiN019PkySvjV' }
        ],
        [{ text: '⏭️ تخطي (افتراضي)',   callback_data: 'voice:default' }]
      ]
    }
  };
}

export function backToMainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]]
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// DURATION CONFIG (exported for use in handlers)
// ═══════════════════════════════════════════════════════════════════
export const DURATION_CONFIG = {
  '1':  { label: '1 دقيقة',    scenes: 3,  secPerScene: 20, split: 1 },
  '2':  { label: '2 دقيقتين',  scenes: 5,  secPerScene: 24, split: 1 },
  '3':  { label: '3 دقائق',    scenes: 7,  secPerScene: 26, split: 1 },
  '5':  { label: '5 دقائق',    scenes: 11, secPerScene: 27, split: 1 },
  '10': { label: '10 دقائق',   scenes: 21, secPerScene: 29, split: 3 }
};

// ═══════════════════════════════════════════════════════════════════
// MESSAGE TEMPLATES
// ═══════════════════════════════════════════════════════════════════
export const WELCOME_MSG = `📖 *أهلاً في بوت راوي القصص التاريخية!*

أنا أبحث عن قصص حقيقية موثقة وأحولها لمحتوى يوتيوب احترافي:

✨ *ما يفعله البوت تلقائياً:*
🔍 يبحث عن قصة تاريخية حقيقية مثيرة
⏱️ تختار مدة الفيديو (1 — 10 دقائق)
📝 يكتب سيناريو راوٍ بعدد مشاهد مناسب
🖼️ يولد صور سينمائية واقعية لكل مشهد
🎙️ يولد صوت راوٍ احترافي بنبرة تناسب القصة
🎵 يضيف موسيقى خلفية خفيفة
🎬 يُرسل فيديو يوتيوب كامل جاهز للنشر

─────────────────────────
اضغط 👇 لتبدأ!`;

export const HELP_MSG = `❓ *دليل الاستخدام الكامل*

*📌 خطوات إنشاء فيديو:*
1️⃣ اضغط "📖 قصة جديدة"
2️⃣ اختر فئة القصة (جرائم / تاريخ / حروب...)
3️⃣ اختر لغة الراوي (عربي / English)
4️⃣ اختر مدة الفيديو (1 — 10 دقائق)
5️⃣ البوت يبحث ويعرض ملخص القصة
6️⃣ اضغط "✅ إنشاء الفيديو" — الباقي تلقائي!

*⏱️ مدد الفيديو المتاحة:*
⚡ 1 دقيقة — 3 مشاهد
🎬 2 دقيقتين — 5 مشاهد
📽️ 3 دقائق — 7 مشاهد
🎥 5 دقائق — 11 مشهد
🎞️ 10 دقائق — 3 أجزاء منفصلة

*⚡ التقنيات:*
• Groq AI — بحث القصص وكتابة السيناريو
• Pollinations.ai FLUX — توليد الصور (مجاني بدون API)
• ElevenLabs — الصوت الاحترافي
• FFmpeg — مونتاج + موسيقى خلفية

*⏱️ وقت الإنشاء التقريبي:*
• 1 دقيقة → ~2 دقيقة انتظار
• 3 دقائق → ~5 دقائق انتظار
• 10 دقائق → ~12 دقيقة (3 أجزاء)`;

export const CATEGORY_LABELS = {
  history:       '🏛️ تاريخية موثقة',
  crime:         '🔍 جرائم وألغاز',
  civilizations: '🌍 حضارات قديمة',
  wars:          '⚔️ حروب ومعارك',
  figures:       '👑 شخصيات أثّرت',
  secrets:       '🕵️ أسرار التاريخ',
  arabic:        '🌙 عربية وإسلامية',
  disasters:     '🌊 كوارث وأحداث'
};

export const STATUS_LABELS = {
  pending:     '⏳ في الانتظار',
  generating:  '🔄 قيد الإنشاء',
  video_ready: '🎬 فيديو جاهز',
  published:   '✅ منشور',
  failed:      '❌ فشل'
};

// Backwards compat aliases
export { storyPreviewKeyboard as scenarioActionsKeyboard };
export { storiesListKeyboard as seriesListKeyboard };
export { storyDetailKeyboard as seriesActionsKeyboard };
