// ═══════════════════════════════════════════════════════════════
//  messages.js  —  All keyboards + message templates
// ═══════════════════════════════════════════════════════════════

// ── Main reply keyboard ──────────────────────────────────────────
export function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🎬 إنشاء مسلسل جديد' }, { text: '📺 مسلسلاتي' }],
        [{ text: '📊 الإحصائيات' },         { text: '❓ مساعدة' }]
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

// ── Step 1: Genre ────────────────────────────────────────────────
export function genreKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '👻 رعب',       callback_data: 'genre:horror' },
          { text: '⚔️ أكشن',      callback_data: 'genre:action' }
        ],
        [
          { text: '💕 رومانسي',   callback_data: 'genre:romance' },
          { text: '😄 كوميدي',    callback_data: 'genre:comedy' }
        ],
        [
          { text: '🧙 خيال وسحر', callback_data: 'genre:fantasy' },
          { text: '🚀 خيال علمي', callback_data: 'genre:scifi' }
        ],
        [
          { text: '🔥 إثارة',     callback_data: 'genre:thriller' },
          { text: '💔 دراما',     callback_data: 'genre:drama' }
        ]
      ]
    }
  };
}

// ── Step 3: Episodes count ───────────────────────────────────────
export function episodesCountKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '5️⃣  5 حلقات',  callback_data: 'episodes:5' },
          { text: '🔟 10 حلقات',  callback_data: 'episodes:10' }
        ],
        [
          { text: '🔢 15 حلقة',   callback_data: 'episodes:15' },
          { text: '🔣 20 حلقة',   callback_data: 'episodes:20' }
        ],
        [
          { text: '🔙 رجوع',       callback_data: 'back:genre' }
        ]
      ]
    }
  };
}

// ── After scenario generated: action buttons ─────────────────────
export function scenarioActionsKeyboard(seriesId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎬 إنشاء الحلقة الأولى',   callback_data: `create_ep:${seriesId}:1` },
          { text: '📋 عرض جميع الحلقات',       callback_data: `episodes_list:${seriesId}` }
        ],
        [
          { text: '▶️ نشر الحلقة الأولى الآن', callback_data: `publish_now:${seriesId}` }
        ],
        [
          { text: '🔄 إعادة توليد السيناريو',  callback_data: `regen_scenario:${seriesId}` },
          { text: '🗑️ حذف هذا المسلسل',        callback_data: `delete_series:${seriesId}` }
        ],
        [
          { text: '🏠 القائمة الرئيسية',        callback_data: 'back:main' }
        ]
      ]
    }
  };
}

// ── Episode detail actions ────────────────────────────────────────
export function episodeActionsKeyboard(seriesId, episodeId, hasVideo) {
  const buttons = [];

  if (hasVideo) {
    buttons.push([
      { text: '▶️ نشر هذه الحلقة',       callback_data: `publish_ep:${seriesId}:${episodeId}` },
      { text: '👁️ معاينة السيناريو',       callback_data: `view_ep_scenario:${episodeId}` }
    ]);
  } else {
    buttons.push([
      { text: '🎬 توليد فيديو الحلقة',    callback_data: `create_ep:${seriesId}:${episodeId}` },
      { text: '👁️ معاينة السيناريو',       callback_data: `view_ep_scenario:${episodeId}` }
    ]);
  }

  buttons.push([
    { text: '🔙 العودة للحلقات',           callback_data: `episodes_list:${seriesId}` }
  ]);

  return { reply_markup: { inline_keyboard: buttons } };
}

// ── My series list ────────────────────────────────────────────────
export function seriesListKeyboard(seriesList) {
  const rows = seriesList.map(s => {
    const statusEmoji = s.status === 'active' ? '🟢' : s.status === 'completed' ? '✅' : '🔴';
    return [{
      text: `${statusEmoji} ${s.title}  (${s.current_episode}/${s.total_episodes})`,
      callback_data: `series:${s.id}`
    }];
  });
  rows.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'back:main' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// ── Single series actions ─────────────────────────────────────────
export function seriesActionsKeyboard(seriesId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎬 إنشاء الحلقة التالية', callback_data: `publish_now:${seriesId}` },
          { text: '📋 الحلقات',              callback_data: `episodes_list:${seriesId}` }
        ],
        [
          { text: '📖 عرض السيناريو الكامل', callback_data: `view_scenario:${seriesId}` },
          { text: '🗑️ حذف',                  callback_data: `delete_series:${seriesId}` }
        ],
        [
          { text: '🔙 مسلسلاتي',             callback_data: 'back:my_series' }
        ]
      ]
    }
  };
}

// ── Confirm dialog ────────────────────────────────────────────────
export function confirmKeyboard(action) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ نعم، تأكيد', callback_data: `confirm:${action}` },
          { text: '❌ إلغاء',      callback_data: 'cancel:action' }
        ]
      ]
    }
  };
}

// ── Language keyboard ─────────────────────────────────────────────
export function languageKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🇸🇦 عربي',   callback_data: 'lang:ar' },
          { text: '🇺🇸 English', callback_data: 'lang:en' }
        ],
        [{ text: '🔙 رجوع', callback_data: 'back:episodes' }]
      ]
    }
  };
}

// ── Voice keyboard ────────────────────────────────────────────────
export function voiceKeyboard(voices = []) {
  const rows = [];
  for (let i = 0; i < Math.min(voices.length, 6); i += 2) {
    const row = [{ text: `🎙️ ${voices[i].name}`, callback_data: `voice:${voices[i].id}` }];
    if (voices[i + 1]) {
      row.push({ text: `🎙️ ${voices[i + 1].name}`, callback_data: `voice:${voices[i + 1].id}` });
    }
    rows.push(row);
  }
  rows.push([{ text: '⏩ صوت افتراضي', callback_data: 'voice:default' }]);
  rows.push([{ text: '🔙 رجوع', callback_data: 'back:lang' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// ── YouTube setup ─────────────────────────────────────────────────
export function youtubeSetupKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔑 ربط قناة يوتيوب (OAuth)', callback_data: 'yt_setup:manual' }],
        [{ text: '🏠 القائمة الرئيسية',         callback_data: 'back:main' }]
      ]
    }
  };
}

// ═══════════════════════════════════════════════════════════════
//  MESSAGES
// ═══════════════════════════════════════════════════════════════

export const WELCOME_MSG = `🎌 *أهلاً وسهلاً — بوت الأنيميشن الذكي!*

أنا قادر على إنشاء مسلسلات أنيميشن كاملة من الصفر:

✨ *ما يقدر يسويه البوت:*
🎭 توليد سيناريو احترافي بالكامل مع شخصيات ثابتة
🖼️ توليد صور وفيديوهات لكل حلقة
🎙️ تعليق صوتي بأصوات احترافية
📅 نشر تلقائي يومي على يوتيوب

─────────────────────
اضغط 👇 لتبدأ رحلتك!`;

export const HELP_MSG = `❓ *دليل الاستخدام الكامل*

*📌 الخطوات:*
1️⃣ اختر نوع المسلسل (رعب، أكشن...)
2️⃣ أدخل اسم المسلسل
3️⃣ حدد عدد الحلقات
4️⃣ أضف وصفاً مختصراً *(اختياري)*
5️⃣ شاهد السيناريو الكامل يُولَّد تلقائياً!
6️⃣ اضغط "إنشاء الحلقة" أو "نشر الآن"

*⚡ التقنيات:*
• Groq AI — توليد السيناريو
• Pollinations.ai FLUX — توليد الصور
• ElevenLabs — التعليق الصوتي  
• FFmpeg — دمج الفيديو والصوت
• YouTube API — النشر التلقائي`;

// Progress indicator for multi-step creation
export function stepHeader(step, total, title) {
  const filled = '█'.repeat(step);
  const empty = '░'.repeat(total - step);
  return `${filled}${empty}  ${step}/${total}\n*${title}*\n\n`;
}

export function newSeriesMsg(step, total) {
  return `📝 *إنشاء مسلسل جديد (${step}/${total})*\n\n`;
}
