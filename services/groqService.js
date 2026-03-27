/**
 * groqService.js
 * Core AI engine — Story research + narrator script + scene prompts
 * Primary: Groq llama-3.3-70b-versatile
 * Fallback: Groq llama-3.1-8b-instant
 */

import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const CATEGORY_LABELS = {
  history:       'أحداث تاريخية موثقة',
  crime:         'جرائم وألغاز حقيقية',
  civilizations: 'حضارات قديمة',
  wars:          'حروب ومعارك تاريخية',
  figures:       'شخصيات أثرت في التاريخ',
  secrets:       'أسرار وألغاز التاريخ',
  arabic:        'قصص عربية وإسلامية موثقة',
  disasters:     'كوارث وأحداث كبرى'
};

const TONE_MAP = {
  history:       'رصين وجاد مع لمسة درامية',
  crime:         'مشوق وغامض وتصاعدي',
  civilizations: 'مبهر وملحمي',
  wars:          'حاد ودرامي وإنساني',
  figures:       'ملهم وانفعالي',
  secrets:       'غامض وفضولي ومثير',
  arabic:        'فصيح وبليغ مع إيقاع شعري',
  disasters:     'حزين ومؤثر وإنساني'
};

// ── Helper: call Groq with automatic model fallback ────────────────
async function callGroq(messages, maxTokens = 3000) {
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];
  for (const model of models) {
    try {
      const response = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0.8,
        max_tokens: maxTokens
      });
      return response.choices[0]?.message?.content || '';
    } catch (err) {
      logger.warn('GROQ', `Model ${model} failed: ${err.message} — trying next`);
    }
  }
  throw new Error('جميع نماذج Groq غير متاحة. تحقق من GROQ_API_KEY.');
}

// ── Helper: safe JSON extraction ───────────────────────────────────
function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Groq response');
  return JSON.parse(match[0]);
}

// ═══════════════════════════════════════════════════════════════════
// 1. FIND A REAL HISTORICAL STORY
// ═══════════════════════════════════════════════════════════════════
export async function findHistoricalStory(category, language = 'ar', storyIndex = 0) {
  logger.story(`Finding story: category=${category}, index=${storyIndex}`);
  const categoryLabel = CATEGORY_LABELS[category] || category;

  const prompt = `أنت باحث تاريخي محترف ومقدم برامج وثائقية متخصص في ${categoryLabel}.

اختر قصة حقيقية موثقة تاريخياً من فئة "${categoryLabel}" تكون:
- موثقة في كتب التاريخ المعتمدة (حقيقية 100%)
- مثيرة ومشوقة وتجلب المشاهدات على يوتيوب
- غنية بالتفاصيل والأحداث الدرامية
- تحتوي على شخصيات واضحة وأماكن وأزمنة محددة
${storyIndex > 0 ? `- اختر قصة مختلفة تماماً (الاختيار رقم ${storyIndex + 1})` : ''}

أجب بـ JSON فقط بدون أي نص إضافي:
{
  "title": "عنوان القصة الكامل",
  "period": "الفترة الزمنية (مثال: القرن الثامن الميلادي)",
  "location": "المكان الجغرافي",
  "summary": "ملخص القصة في 4-5 جمل مشوقة",
  "hook": "جملة افتتاحية جذابة تبدأ بسؤال أو مفاجأة",
  "key_characters": [{"name": "الاسم", "role": "الدور في القصة"}],
  "why_viral": "لماذا ستجلب مشاهدات كثيرة؟",
  "tone": "tragic/mysterious/epic/inspiring/horror",
  "category": "${category}"
}`;

  const text = await callGroq([{ role: 'user', content: prompt }], 1500);
  const story = extractJSON(text);
  logger.story(`Found story: "${story.title}"`);
  return story;
}

// ═══════════════════════════════════════════════════════════════════
// 2. GENERATE SCRIPT WITH VARIABLE SCENE COUNT (based on duration)
// ═══════════════════════════════════════════════════════════════════
export async function generateStoryScript(story, language = 'ar', sceneCount = 7, secPerScene = 26) {
  logger.story(`Generating script: ${sceneCount} scenes × ${secPerScene}s = ~${Math.round(sceneCount * secPerScene / 60)}min`);

  const tone = TONE_MAP[story.category] || 'درامي ومؤثر';
  const langNote = language === 'ar' ? 'باللغة العربية الفصحى' : 'in English';

  // Calculate word count per scene based on duration
  // ~140 words per minute speaking speed
  const wordsPerScene = Math.round((secPerScene / 60) * 140);

  const prompt = `أنت كاتب سيناريو وثائقي محترف على مستوى BBC وNational Geographic.

اكتب سيناريو راوٍ ${langNote} لقصة: "${story.title}"
الفترة: ${story.period || ''}
المكان: ${story.location || ''}
الملخص: ${story.summary}
الطابع الصوتي: ${tone}

المطلوب بالضبط: ${sceneCount} مشاهد متسلسلة
- كل مشهد: نص راوٍ (${wordsPerScene - 10} إلى ${wordsPerScene + 10} كلمة تقريباً)
- مدة كل مشهد: ~${secPerScene} ثانية
- النبرة تتصاعد: هادئة → متوترة → ذروة → خاتمة

⚠️ CRITICAL RULE FOR image_prompt:
- image_prompt MUST be written in ENGLISH ONLY — no Arabic, no other language
- image_prompt must be purely ASCII characters (a-z, 0-9, spaces, commas)
- Format: "Cinematic historical [scene], [location], [lighting], [mood], photorealistic, 8K"
- Example: "Cinematic historical battlefield, ancient Roman soldiers marching at dawn, dramatic golden lighting, photorealistic, 8K"

أجب بـ JSON فقط بدون أي نص إضافي:
{
  "title": "${story.title}",
  "narrator_tone": "dramatic/solemn/intense/mysterious/inspiring",
  "total_duration_seconds": ${sceneCount * secPerScene},
  "intro_hook": "${story.hook || ''}",
  "scenes": [
    {
      "number": 1,
      "scene_title": "عنوان المشهد",
      "narration": "نص الراوي ${langNote} كامل ومفصل",
      "voice_tone": "calm/dramatic/intense/whisper/powerful",
      "duration_seconds": ${secPerScene},
      "image_prompt": "ENGLISH ONLY: Cinematic historical photograph of [scene in English], [location in English], dramatic lighting, photorealistic, 8K, no text",
      "transition": "fade/cut"
    }
  ],
  "outro": "جملة ختامية للفيديو"
}`;

  const maxTokens = Math.min(500 + sceneCount * 400, 8000);
  const text = await callGroq([{ role: 'user', content: prompt }], maxTokens);
  const script = extractJSON(text);

  logger.story(`Script generated: ${script.scenes?.length} scenes`);
  return script;
}

// ═══════════════════════════════════════════════════════════════════
// 3. GENERATE SCRIPT PART (for split videos)
// ═══════════════════════════════════════════════════════════════════
export async function generateStoryScriptPart(story, language = 'ar', partNumber = 1, totalParts = 3, sceneCount = 7, secPerScene = 29) {
  logger.story(`Generating script part ${partNumber}/${totalParts}`);

  const tone = TONE_MAP[story.category] || 'درامي ومؤثر';
  const langNote = language === 'ar' ? 'باللغة العربية الفصحى' : 'in English';
  const wordsPerScene = Math.round((secPerScene / 60) * 140);

  const partLabel =
    partNumber === 1 ? 'البداية والتمهيد' :
    partNumber === totalParts ? 'الذروة والنهاية' :
    `الجزء الأوسط ${partNumber}`;

  const prompt = `أنت كاتب سيناريو وثائقي محترف.

القصة: "${story.title}" (${story.period || ''} — ${story.location || ''})
${story.summary}

اكتب الجزء ${partNumber} من ${totalParts} لهذه القصة ${langNote}.
موضوع هذا الجزء: ${partLabel}
الطابع الصوتي: ${tone}

المطلوب: ${sceneCount} مشاهد (كل مشهد ~${wordsPerScene} كلمة لمدة ${secPerScene} ثانية)

أجب بـ JSON فقط:
{
  "title": "${story.title} - الجزء ${partNumber}",
  "narrator_tone": "dramatic/solemn/intense/mysterious",
  "part_number": ${partNumber},
  "total_parts": ${totalParts},
  "scenes": [
    {
      "number": 1,
      "scene_title": "عنوان المشهد",
      "narration": "نص الراوي ${langNote}",
      "voice_tone": "calm/dramatic/intense/powerful",
      "duration_seconds": ${secPerScene},
      "image_prompt": "ENGLISH ONLY: Cinematic historical photograph of [scene in English], [location], dramatic lighting, photorealistic, 8K, no text"
    }
  ],
  "outro": "جملة ختامية للجزء"
}`;

  const maxTokens = Math.min(500 + sceneCount * 400, 6000);
  const text = await callGroq([{ role: 'user', content: prompt }], maxTokens);
  const script = extractJSON(text);
  return script;
}

// ═══════════════════════════════════════════════════════════════════
// 4. YOUTUBE METADATA
// ═══════════════════════════════════════════════════════════════════
export async function generateYouTubeMetadata(story, script, partNumber = null) {
  const partLabel = partNumber ? ` - الجزء ${partNumber}` : '';

  const prompt = `اكتب بيانات يوتيوب لفيديو وثائقي عن: "${story.title}${partLabel}"
الملخص: ${story.summary || ''}

أجب بـ JSON فقط:
{
  "title": "عنوان يوتيوب مشوق بالعربية (أقل من 100 حرف)",
  "description": "وصف كامل بالعربية 150-300 كلمة مع هاشتاقات",
  "tags": ["وسم1", "وسم2", "وسم3", "وسم4", "وسم5"]
}`;

  try {
    const text = await callGroq([{ role: 'user', content: prompt }], 600);
    return extractJSON(text);
  } catch {
    return {
      title: `${story.title}${partLabel}`,
      description: story.summary || '',
      tags: ['تاريخ', 'قصص', 'وثائقي']
    };
  }
}
