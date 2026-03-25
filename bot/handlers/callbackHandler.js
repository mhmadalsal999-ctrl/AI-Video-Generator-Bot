// ═══════════════ KEYBOARDS ═══════════════

export function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🎬 إنشاء مسلسل جديد' }, { text: '📺 مسلسلاتي' }],
        [{ text: '▶️ نشر حلقة الآن' }, { text: '📊 الإحصائيات' }],
        [{ text: '⚙️ إعدادات يوتيوب' }, { text: '❓ مساعدة' }]
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

export function genreKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '👻 رعب', callback_data: 'genre:horror' },
          { text: '⚔️ أكشن', callback_data: 'genre:action' }
        ],
        [
          { text: '💕 رومانسي', callback_data: 'genre:romance' },
          { text: '😄 كوميدي', callback_data: 'genre:comedy' }
        ],
        [
          { text: '🧙 خيال وسحر', callback_data: 'genre:fantasy' },
          { text: '🚀 خيال علمي', callback_data: 'genre:scifi' }
        ],
        [
          { text: '🔥 إثارة', callback_data: 'genre:thriller' },
          { text: '💔 دراما', callback_data: 'genre:drama' }
        ]
      ]
    }
  };
}

export function episodesCountKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '5 حلقات', callback_data: 'episodes:5' },
          { text: '10 حلقات', callback_data: 'episodes:10' }
        ],
        [
          { text: '15 حلقة', callback_data: 'episodes:15' },
          { text: '20 حلقة', callback_data: 'episodes:20' }
        ]
      ]
    }
  };
}

export function languageKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🇸🇦 عربي', callback_data: 'lang:ar' },
          { text: '🇺🇸 English', callback_data: 'lang:en' }
        ]
      ]
    }
  };
}

export function voiceKeyboard(voices) {
  const rows = [];
  for (let i = 0; i < Math.min(voices.length, 5); i += 2) {
    const row = [{ text: voices[i].name, callback_data: `voice:${voices[i].id}` }];
    if (voices[i + 1]) row.push({ text: voices[i + 1].name, callback_data: `voice:${voices[i + 1].id}` });
    rows.push(row);
  }
  rows.push([{ text: '⏩ تخطي (صوت افتراضي)', callback_data: 'voice:default' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

export function seriesListKeyboard(seriesList) {
  const rows = seriesList.map((s, i) => [{
    text: `${i + 1}. ${s.title} (${s.current_episode}/${s.total_episodes})`,
    callback_data: `series:${s.id}`
  }]);
  rows.push([{ text: '🔙 رجوع', callback_data: 'back:main' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

export function seriesActionsKeyboard(seriesId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '▶️ نشر حلقة الآن', callback_data: `publish_now:${seriesId}` },
          { text: '📋 عرض الحلقات', callback_data: `episodes_list:${seriesId}` }
        ],
        [
          { text: '🗑️ حذف المسلسل', callback_data: `delete_series:${seriesId}` },
          { text: '🔙 رجوع', callback_data: 'back:my_series' }
        ]
      ]
    }
  };
}

export function confirmKeyboard(action) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ تأكيد', callback_data: `confirm:${action}` },
          { text: '❌ إلغاء', callback_data: 'cancel:action' }
        ]
      ]
    }
  };
}

export function youtubeSetupKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔑 إعداد يدوي (OAuth)', callback_data: 'yt_setup:manual' }],
        [{ text: '🔙 رجوع', callback_data: 'back:main' }]
      ]
    }
  };
}

// ═══════════════ MESSAGES ═══════════════

export const WELCOME_MSG = `🎌 *مرحباً بك في بوت الأنيميشن الذكي!*

أنا قادر على:
🎬 *توليد مسلسلات أنيميشن كاملة* - سيناريو + فيديو + صوت
📅 *نشر تلقائي يومي* على يوتيوب
🎭 *شخصيات ثابتة* في كل حلقة
🎙️ *تعليق صوتي* بأصوات احترافية

اضغط *"🎬 إنشاء مسلسل جديد"* للبدء!`;

export const HELP_MSG = `❓ *مساعدة - كيفية الاستخدام*

*1. إنشاء مسلسل جديد:*
- اختر نوع المسلسل (رعب، أكشن...)
- أدخل اسم المسلسل
- وصف مختصر (اختياري)
- حدد عدد الحلقات
- اختر اللغة والصوت
- سيتم توليد السيناريو الكامل تلقائياً!

*2. النشر التلقائي:*
يتم نشر حلقة واحدة يومياً على يوتيوب تلقائياً الساعة 1 ظهراً.

*3. النشر اليدوي:*
اضغط "▶️ نشر حلقة الآن" لنشر حلقة فوراً.

*4. إعداد يوتيوب:*
أدخل بيانات OAuth الخاصة بقناتك لنشر الفيديوهات.

⚡ *التقنيات المستخدمة:*
• Groq AI - توليد السيناريو
• FLUX + AnimateDiff - توليد الفيديو
• ElevenLabs - التعليق الصوتي
• FFmpeg - دمج الصوت والفيديو`;

export function newSeriesMsg(step, total) {
  return `📝 *إنشاء مسلسل جديد (${step}/${total})*\n\n`;
}
