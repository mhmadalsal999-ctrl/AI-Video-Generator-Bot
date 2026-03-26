import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const GENRES = {
  horror: 'رعب مرعب',
  action: 'أكشن ومغامرة',
  romance: 'رومانسي',
  comedy: 'كوميدي',
  fantasy: 'خيال وسحر',
  scifi: 'خيال علمي',
  thriller: 'إثارة وتشويق',
  drama: 'دراما عاطفية'
};

export async function generateSeriesScenario(title, genre, description, totalEpisodes = 10, language = 'ar') {
  logger.api(`Generating series scenario: ${title}`);

  const genreLabel = GENRES[genre] || genre;
  const langInstruction = language === 'ar' ? 'باللغة العربية' : 'in English';

  const prompt = `أنت كاتب سيناريو محترف لمسلسلات الأنيميشن.
اكتب ${langInstruction} سيناريو كامل لمسلسل أنيميشن بعنوان "${title}" من نوع ${genreLabel}.
${description ? `وصف المسلسل: ${description}` : ''}

المطلوب:
1. ابتكر 3-4 شخصيات رئيسية ثابتة (اسم، وصف مظهر محدد جداً، شخصيتها)
2. اكتب ملخصاً للقصة الرئيسية
3. قسّم المسلسل إلى ${totalEpisodes} حلقات - كل حلقة فيها:
   - عنوان الحلقة
   - ملخص مختصر (2-3 جمل)
   - مشهد أساسي يمكن تحويله لفيديو قصير 10-30 ثانية

أجب بصيغة JSON فقط بدون أي نص إضافي:
{
  "characters": [
    {
      "name": "اسم الشخصية",
      "appearance": "وصف مظهر مفصل: لون الشعر، طول الشعر، لون العيون، الملابس المميزة، الجسم",
      "personality": "وصف الشخصية",
      "role": "الدور في القصة"
    }
  ],
  "story_summary": "ملخص القصة الكاملة",
  "episodes": [
    {
      "number": 1,
      "title": "عنوان الحلقة",
      "summary": "ملخص الحلقة",
      "scene": "مشهد محدد للفيديو: من يظهر، ماذا يفعلون، الأحداث بالتفصيل"
    }
  ]
}`;

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 4000
  });

  const text = response.choices[0]?.message?.content || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]);
    logger.success('API', `Scenario generated: ${parsed.episodes?.length} episodes`);
    return parsed;
  } catch (e) {
    logger.error('API', `Failed to parse scenario JSON: ${e.message}`);
    throw new Error('فشل في توليد السيناريو. حاول مرة أخرى.');
  }
}

export async function generateVideoPrompt(episode, characters, genre) {
  logger.api(`Generating video prompt for episode ${episode.episode_number}`);

  const charDescriptions = characters.map(c => `${c.name}: ${c.appearance}`).join('\n');

  const prompt = `أنت خبير في كتابة بروبمتات لتوليد فيديوهات أنيميشن.

السيناريو: ${episode.scenario || episode.scene}

الشخصيات الثابتة:
${charDescriptions}

اكتب بروبمت انجليزي احترافي لتوليد فيديو أنيميشن مدته 10-30 ثانية.
البروبمت يجب أن:
- يحتوي على وصف الشخصيات بالضبط (نفس الألوان والمظهر دائماً)
- يصف المشهد والحركة والإضاءة
- يكون أسلوب anime style، vibrant colors
- لا يتجاوز 200 كلمة

أجب بالبروبمت فقط بدون أي مقدمة:`;

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 400
  });

  return response.choices[0]?.message?.content?.trim() || '';
}

export async function generateNarrationText(episode, characters, language = 'ar') {
  logger.api(`Generating narration for episode ${episode.episode_number}`);

  const langNote = language === 'ar' ? 'باللغة العربية الفصحى' : 'in English';

  const prompt = `اكتب نص تعليق صوتي ${langNote} لحلقة أنيميشن.

السيناريو: ${episode.scenario}

المطلوب:
- نص تعليق قصير (20-40 كلمة فقط)
- مناسب لفيديو 10-30 ثانية
- يصف المشهد بشكل درامي وجذاب
- بدون أي إشارات مسرحية أو توجيهات

أجب بالنص فقط:`;

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 200
  });

  return response.choices[0]?.message?.content?.trim() || '';
}
