// ═══════════════════════════════════════════════════════════════════
// messages.js — Keyboards & Templates
// Story Narrator Bot v4.0 — Staged Pipeline
// ═══════════════════════════════════════════════════════════════════

export const WELCOME_MSG =
`🎬 *مرحباً بك في بوت الفيديو التاريخي*

أنشئ فيديوهات احترافية بالذكاء الاصطناعي:
📝 سيناريو ← 🖼️ صور ← 🎙️ صوت ← 🎬 فيديو

اختر ما تريد:`;

export const CATEGORY_LABELS = {
  history:      '🏛️ تاريخية موثقة',
  crime:        '🔍 جرائم وألغاز',
  civilizations:'🌍 حضارات قديمة',
  wars:         '⚔️ حروب ومعارك',
  figures:      '👑 شخصيات أثّرت',
  secrets:      '🕵️ أسرار التاريخ',
  arabic:       '🌙 قصص عربية وإسلامية',
  disasters:    '🌊 كوارث وأحداث كبرى'
};

export const STATUS_LABELS = {
  pending:    '⏳ في الانتظار',
  generating: '🔄 قيد الإنشاء',
  script_done:'📝 السيناريو جاهز',
  images_done:'🖼️ الصور جاهزة',
  audio_done: '🎙️ الصوت جاهز',
  video_ready:'✅ الفيديو جاهز',
  published:  '📺 منشور',
  failed:     '❌ فشل',
  deleted:    '🗑️ محذوف'
};

export const DURATION_CONFIG = {
  '1':  { label: '⚡ 1 دقيقة',   scenes: 3,  split: 1, secPerScene: 20 },
  '2':  { label: '🎬 2 دقيقتين', scenes: 5,  split: 1, secPerScene: 24 },
  '3':  { label: '📽️ 3 دقائق',   scenes: 7,  split: 1, secPerScene: 26 },
  '5':  { label: '🎥 5 دقائق',   scenes: 11, split: 1, secPerScene: 27 },
  '10': { label: '🎞️ 10 دقائق',  scenes: 7,  split: 3, secPerScene: 29 }
};

// ── Main keyboard ────────────────────────────────────────────────────
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
      resize_keyboard: true
    }
  };
}

// ── Category ─────────────────────────────────────────────────────────
export function categoryKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🏛️ تاريخية موثقة',    callback_data: 'cat:history' },
          { text: '🔍 جرائم وألغاز',      callback_data: 'cat:crime' }
        ],
        [
          { text: '🌍 حضارات قديمة',      callback_data: 'cat:civilizations' },
          { text: '⚔️ حروب ومعارك',       callback_data: 'cat:wars' }
        ],
        [
          { text: '👑 شخصيات أثّرت',      callback_data: 'cat:figures' },
          { text: '🕵️ أسرار التاريخ',     callback_data: 'cat:secrets' }
        ],
        [
          { text: '🌙 قصص عربية وإسلامية', callback_data: 'cat:arabic' },
          { text: '🌊 كوارث وأحداث كبرى', callback_data: 'cat:disasters' }
        ]
      ]
    }
  };
}

// ── Language ─────────────────────────────────────────────────────────
export function languageKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🇸🇦 عربي (فصيح)', callback_data: 'lang:ar' },
          { text: '🇺🇸 English',     callback_data: 'lang:en' }
        ],
        [{ text: '◀️ رجوع', callback_data: 'new:story' }]
      ]
    }
  };
}

// ── Duration ─────────────────────────────────────────────────────────
export function durationKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⚡ 1 دقيقة  (3 مشاهد)',   callback_data: 'dur:1' },
          { text: '🎬 2 دقيقتين (5 مشاهد)',  callback_data: 'dur:2' }
        ],
        [
          { text: '📽️ 3 دقائق  (7 مشاهد)',   callback_data: 'dur:3' },
          { text: '🎥 5 دقائق (11 مشهد)',    callback_data: 'dur:5' }
        ],
        [
          { text: '🎞️ 10 دقائق (3 أجزاء)',  callback_data: 'dur:10' }
        ],
        [{ text: '◀️ رجوع', callback_data: 'back:lang' }]
      ]
    }
  };
}

// ── Split ────────────────────────────────────────────────────────────
export function splitKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📦 3 فيديوهات منفصلة (موصى به)', callback_data: 'split:yes' }],
        [{ text: '🎬 فيديو واحد (10 دق)',           callback_data: 'split:no' }],
        [{ text: '◀️ تغيير المدة',                  callback_data: 'back:duration' }]
      ]
    }
  };
}

// ── Story preview — بعد إيجاد القصة ─────────────────────────────────
export function storyPreviewKeyboard(storyId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📝 إنشاء السيناريو',  callback_data: `step:script:${storyId}` },
          { text: '🔄 قصة أخرى',        callback_data: `another:${storyId}` }
        ],
        [{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]
      ]
    }
  };
}

// ── بعد السيناريو ────────────────────────────────────────────────────
export function afterScriptKeyboard(storyId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🖼️ إنشاء الصور →',    callback_data: `step:images:${storyId}` }],
        [
          { text: '📝 عرض السيناريو',   callback_data: `script:${storyId}` },
          { text: '🔄 قصة أخرى',        callback_data: `another:${storyId}` }
        ],
        [{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]
      ]
    }
  };
}

// ── بعد الصور ────────────────────────────────────────────────────────
export function afterImagesKeyboard(storyId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎙️ إنشاء الصوت →',    callback_data: `step:audio:${storyId}` }],
        [
          { text: '📝 عرض السيناريو',   callback_data: `script:${storyId}` },
          { text: '🔙 إعادة الصور',     callback_data: `step:images:${storyId}` }
        ],
        [{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]
      ]
    }
  };
}

// ── بعد الصوت ────────────────────────────────────────────────────────
export function afterAudioKeyboard(storyId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎬 إنشاء الفيديو →',  callback_data: `step:video:${storyId}` }],
        [
          { text: '🔙 إعادة الصوت',     callback_data: `step:audio:${storyId}` },
          { text: '🔙 إعادة الصور',     callback_data: `step:images:${storyId}` }
        ],
        [{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]
      ]
    }
  };
}

// ── بعد الفيديو ──────────────────────────────────────────────────────
export function afterVideoKeyboard(storyId, hasYoutube = false) {
  const buttons = [];
  if (hasYoutube) {
    buttons.push([{ text: '📺 نشر على يوتيوب', callback_data: `publish:${storyId}` }]);
  }
  buttons.push([{ text: '📖 قصة جديدة',        callback_data: 'new:story' }]);
  buttons.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]);
  return { reply_markup: { inline_keyboard: buttons } };
}

// ── Story library ────────────────────────────────────────────────────
export function storiesListKeyboard(stories) {
  const buttons = stories.map(s => {
    const emoji = {
      video_ready: '🎬', published: '✅', pending: '⏳',
      generating: '🔄', failed: '❌', script_done: '📝',
      images_done: '🖼️', audio_done: '🎙️'
    }[s.status] || '📖';
    const mins = s.duration_minutes ? ` (${s.duration_minutes}د)` : '';
    const title = s.title.length > 25 ? s.title.substring(0, 22) + '...' : s.title;
    return [{ text: `${emoji} ${title}${mins}`, callback_data: `story:${s.id}` }];
  });
  buttons.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]);
  return { reply_markup: { inline_keyboard: buttons } };
}

// ── Story detail (from library) ──────────────────────────────────────
export function storyDetailKeyboard(story) {
  const storyId = story.id;
  const status = story.status;
  const buttons = [];

  // أزرار حسب المرحلة الحالية
  if (status === 'pending') {
    buttons.push([{ text: '📝 إنشاء السيناريو', callback_data: `step:script:${storyId}` }]);
  } else if (status === 'script_done') {
    buttons.push([{ text: '🖼️ إنشاء الصور →',  callback_data: `step:images:${storyId}` }]);
    buttons.push([{ text: '📝 عرض السيناريو',   callback_data: `script:${storyId}` }]);
  } else if (status === 'images_done') {
    buttons.push([{ text: '🎙️ إنشاء الصوت →',  callback_data: `step:audio:${storyId}` }]);
    buttons.push([{ text: '📝 عرض السيناريو',   callback_data: `script:${storyId}` }]);
  } else if (status === 'audio_done') {
    buttons.push([{ text: '🎬 إنشاء الفيديو →', callback_data: `step:video:${storyId}` }]);
    buttons.push([{ text: '📝 عرض السيناريو',   callback_data: `script:${storyId}` }]);
  } else if (status === 'video_ready' || status === 'published') {
    if (story.youtube_url) {
      buttons.push([{ text: '📺 مشاهدة على يوتيوب', url: story.youtube_url }]);
    } else {
      buttons.push([{ text: '📺 نشر على يوتيوب', callback_data: `publish:${storyId}` }]);
    }
    buttons.push([{ text: '📝 عرض السيناريو',   callback_data: `script:${storyId}` }]);
  } else if (status === 'failed') {
    buttons.push([{ text: '🔄 إعادة المحاولة',  callback_data: `step:script:${storyId}` }]);
  }

  buttons.push([
    { text: '🗑️ حذف',               callback_data: `delete:${storyId}` },
    { text: '◀️ المكتبة',            callback_data: 'back:library' }
  ]);
  buttons.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]);
  return { reply_markup: { inline_keyboard: buttons } };
}

export function youtubeSetupKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔧 ربط القناة',        callback_data: 'yt:setup' }],
        [{ text: '❓ كيف أحصل على البيانات؟', callback_data: 'yt:help' }],
        [{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]
      ]
    }
  };
}

export function confirmKeyboard(action, id) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ نعم، تأكيد',    callback_data: `confirm:${action}:${id}` },
          { text: '❌ إلغاء',         callback_data: `story:${id}` }
        ]
      ]
    }
  };
}

export function backToMainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]
      ]
    }
  };
}

// ── Pipeline progress message ─────────────────────────────────────────
export function pipelineProgressText(title, stage, detail = '') {
  const stages = {
    script: { emoji: '📝', label: 'كتابة السيناريو',  step: 1 },
    images: { emoji: '🖼️', label: 'إنشاء الصور',      step: 2 },
    audio:  { emoji: '🎙️', label: 'توليد الصوت',      step: 3 },
    video:  { emoji: '🎬', label: 'تجميع الفيديو',    step: 4 }
  };
  const s = stages[stage] || stages.script;
  const bar = ['📝','🖼️','🎙️','🎬'].map((e, i) =>
    i < s.step ? `✅` : i === s.step - 1 ? `⏳` : `⬜`
  ).join('');

  return `🎬 *${title}*\n\n` +
    `${bar}\n` +
    `المرحلة ${s.step}/4: ${s.emoji} *${s.label}*\n\n` +
    (detail ? `${detail}\n\n` : '') +
    `⏳ جاري العمل...`;
}
