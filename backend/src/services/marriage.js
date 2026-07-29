'use strict';

/**
 * @module services/marriage
 * @description Marriage (විවාහ) reading generation service.
 * Runs the same pipeline as the horoscope reading — freeastroapi chart data as the
 * Gemini system instruction, then one Gemini call per configurable section — but with
 * its own system prompt, its own section list and its own Word/PDF document.
 *
 * Config lives under the existing `horoscope_reading` plugin:
 *   marriage_system_prompt  — Gemini system instruction (blank → built-in default)
 *   marriage_sections       — [{ label, guide }]        (blank → DEFAULT_MARRIAGE_SECTIONS)
 *   marriage_special_note   — closing note appended to the document
 *   marriage_wa_prompt      — system prompt for the WhatsApp summary message
 *
 * Results are saved on orders.horoscope_data:
 *   marriage_sections_data  — [{ label, content }]
 *   marriage_wa_message     — string
 */

const db        = require('../db');
const { genAI } = require('./gemini');
const { buildSectionsDoc } = require('./horoscope');
const { todayContextBlock } = require('./dateContext');

const MARRIAGE_REPORT_TITLE = 'විවාහ ජීවිතය පිළිබඳ විශේෂ ශාස්ත්‍රීය වාර්තාව';

const DEFAULT_MARRIAGE_SYSTEM_PROMPT = `ඔබ වසර 40කට වැඩි පළපුරුද්දක් ඇති, විවාහ පලාපල (Marriage Astrology) පිළිබඳ විශේෂඥ ජ්‍යෝතිර්වේදියෙකි.

ඔබට ලබා දී ඇති කේන්ද්‍ර දත්ත (ලග්න කේන්ද්‍රය, නවාංශකය, සප්තාංශකය සහ විංශෝත්තරී දශා) පදනම් කරගෙන, විවාහය සහ ප්‍රේම සබඳතා පිළිබඳ ගැඹුරු, සෘජු සහ වෘත්තීය විග්‍රහයක් සිංහල භාෂාවෙන් ලබා දෙන්න.

මූලික නීති:
1. සම්පූර්ණ වාර්තාවම සිංහලෙන් ලියන්න (ජ්‍යෝතිෂ තාක්ෂණික වචන ඉංග්‍රීසියෙන් වරහන් තුළ දැක්වීම සුදුසුයි).
2. සත්‍යය සඟවන්න එපා. අසුබ පල, දෝෂ සහ බාධක පැහැදිලිව සහ සෘජුව පවසන්න — නමුත් සෑම විටම මනුෂ්‍යවාදීව, ජන්මියාගේ හිත නොකැඩෙන පරිදි සහ ධෛර්යවත් කරන වචන සමඟ.
3. පොදු, ඕනෑම කෙනෙකුට ගැලපෙන (generic) කථා ලියන්න එපා. සෑම ප්‍රකාශයක්ම මෙම කේන්ද්‍රයේ නිශ්චිත ග්‍රහ පිහිටීම් මත පදනම් විය යුතුය.
4. හැඳින්වීම් හෝ අනවශ්‍ය පෙරවදන් නොදා සෘජුවම කරුණට පිවිසෙන්න.`;

const DEFAULT_MARRIAGE_SECTIONS = [
  {
    label: 'විවාහයක් සැබෑ ලෙසම සිදුවේද නැද්ද යන්න',
    guide: '7 වන භාවය සහ නවාංශක කේන්ද්‍රය සෘජුව විශ්ලේෂණය කර, ග්‍රහ පිහිටීම් අනුව විවාහයක් සිදුවීම තහවුරු වේද නැතහොත් වළක්වා ඇත්ද යන්න පැහැදිලිව ප්‍රකාශ කරන්න. ශනි, රාහු, කේතු වැනි පාප ග්‍රහයන්ගේ දරුණු බලපෑම් නිසා අවිවාහක යෝග (Celibacy / No-Marriage Yoga) ඇත්දැයි පරීක්ෂා කරන්න. සත්‍ය තත්ත්වය පැණි ගා නොකියා, නමුත් වෘත්තීය ගාම්භීරත්වයකින් යුතුව පැහැදිලිව පවසන්න.',
  },
  {
    label: 'විවාහය සිදුවන නියමිතම වයස සහ කාල වකවානුව',
    guide: 'වර්තමාන මහ දශාව සහ අන්තර් දශාව අනුව විවාහ මාර්ග විවෘත වන නිශ්චිත වර්ෂය සහ මාස පරාසය හරියටම දක්වන්න. මෙතෙක් විවාහය හෝ ප්‍රේම සබඳතා ප්‍රමාද වීමට හෝ බාධා ඇතිවීමට හේතු වූ අතීත ග්‍රහ බාධක මොනවාද යන්න පැහැදිලිව විස්තර කරන්න.',
  },
  {
    label: 'ලැබෙන සහකරුගේ රැකියාව, නමේ අකුරු සහ දිශාව',
    guide: 'අනාගත සහකරු/සහකාරියගේ පෞරුෂය, හැසිරීම සහ මූලික ගතිගුණ විස්තර කරන්න. 7 සහ 10 භාව සම්බන්ධතාවය අනුව රැකියාවේ ස්වභාවය (රාජ්‍ය අංශය, ආයතනික විධායක මට්ටම, හෝ මහා පරිමාණ ව්‍යාපාරික) නිශ්චිතව දක්වන්න. සහකරුගේ නමේ සුබ මුල් අකුරු මොනවාද යන්නත්, ජන්මියාගේ උපන් ස්ථානයේ සිට සහකරු හමුවන නිශ්චිත භූගෝලීය දිශාව (උතුර, දකුණ, නැගෙනහිර, බටහිර) කුමක්ද යන්නත් සෘජුව පවසන්න.',
  },
  {
    label: 'සැඟවුණු දරුණු විවාහ දෝෂ හඳුනා ගැනීම',
    guide: 'දරුණු ජ්‍යෝතිෂ දෝෂ සඳහා තදබල විශ්ලේෂණයක් කරන්න:\n- කුජ (භෞම) දෝෂය: නොගැලපීමකදී ඇතිවිය හැකි ගැටුම්, තර්ක බහුල බව හෝ සෞඛ්‍ය බලපෑම් පැහැදිලි කරන්න.\n- ශනි-මංගල දෝෂය: මානසික ගැලපීම, සැකය සහ කෝපය කෙරෙහි ඇති බලපෑම විස්තර කරන්න.\n- කලත්‍ර නාශක සහ ද්වි-විවාහ යෝග: වෙන්වීම් හෝ විවාහ දෙකක් සිදුවීමේ අවදානම හඳුනාගන්න.\n- වඳ දෝෂ (දරු ප්‍රසූතියට බාධා): 5 වන භාවය පරීක්ෂා කර දරු ලැබීමට බාධා ඇත්දැයි දක්වන්න.\nදෝෂයක් නොමැති නම් එසේ නොමැති බව පැහැදිලිව පවසන්න — නොමැති දෝෂ නිර්මාණය කරන්න එපා.',
  },
  {
    label: 'සහකරු/සහකාරිය මුණගැසීමට කළ යුතු ප්‍රායෝගික ජීවන වෙනස්කම්',
    guide: 'කේන්ද්‍රය අනුව ප්‍රායෝගික, සැබෑ ලෝකයේ ජීවන රටා වෙනස්කම් ලබා දෙන්න. හමුවීමේ ඉඩකඩ වැඩිම පරිසරයන් හරියටම හඳුනාගන්න (රැකියා ස්ථානය, අධ්‍යාපන ආයතන, විනෝද චාරිකා/සමාජ අවස්ථා, හෝ ස්වේච්ඡා සේවා). ඉතා ක්‍රියාත්මක කළ හැකි උපදෙස් දෙන්න (උදා: "කේන්ද්‍රය අනුව ගමන් බිමන් වලදී අවස්ථා විවෘත වන බැවින්, ඉදිරි දශා කාලය තුළ චාරිකා සහ එළිමහන් සමාජ අවස්ථාවලට ක්‍රියාශීලීව සහභාගී වන්න").',
  },
  {
    label: 'ප්‍රේම සබඳතා බිඳී යාම සහ විවාහ ගැටලු',
    guide: '5 වන භාවය (ප්‍රේමයේ භාවය) විශ්ලේෂණය කර, අතීතයේ සිදුවූ හදිසි ප්‍රේම බිඳවැටීම්, සබඳතා හදිසියේ නතර වීම් (ghosting) හෝ අසාර්ථක වීම් පිටුපස ඇති සැබෑ ග්‍රහ හේතුව පැහැදිලි කරන්න.',
  },
  {
    label: 'දෝෂ භංග කරන සහ හඳහන් ගැලපීමේ ප්‍රායෝගික පිළියම්',
    guide: 'සාමාන්‍ය, ස්වයංක්‍රීය පන්සල් ශාන්තිකර්ම ලබා නොදෙන්න. ඉහත 4 වන අංශයේ හඳුනාගත් දරුණු දෝෂ උදාසීන වන (භංග වන) ක්‍රමවේද සහ කොන්දේසි මොනවාද යන්න පැහැදිලි කරන්න. මෙම කේන්ද්‍රයටම ආවේණික වූ, නිවසේදීම කළ හැකි ඉතා ප්‍රායෝගික වත්පිළිවෙත් පමණක් ලබා දෙන්න. සෑම ප්‍රධාන පිළියමක්ම \'###\' සලකුණෙන් ආරම්භ වන අනු-මාතෘකාවක් යටතේ දක්වා, එහි පියවර \'-\' බුලට් ලෙස ලැයිස්තුගත කරන්න.',
  },
  {
    label: 'විවාහයෙන් පසු ධන යෝග සහ පදිංචිය',
    guide: 'විවාහයෙන් පසුව විශේෂයෙන් ක්‍රියාත්මක වන ධන යෝග විශ්ලේෂණය කරන්න (ආර්ථික ස්ථාවරත්වය, දේපළ රැස්කිරීම සහ සහකරු/සහකාරිය විසින් ගෙන එන වාසනාව). අනාගත පදිංචිය පුරෝකථනය කරන්න: උපන් ගමේම ජීවත් වේද, වෙනත් පළාතකට යාද, නැතහොත් විවාහය හේතුවෙන් විදේශගත වේද යන්න සෘජුව පවසන්න.',
  },
];

const MARRIAGE_FIXED_INSTRUCTIONS = `කරුණාකර පහත උපදෙස් දැඩිව පිළිපදින්න:
1. කතාවක් මෙන් ලියන්න (Narrative Flow): 'ලග්න කේන්ද්‍රය අනුව', 'නවාංශකය අනුව' ලෙස දැඩි මාතෘකා යටතේ කරුණු නොබෙදන්න. සියලු දත්ත එකට මුසු කර, කියවීමට පහසු, ගලාගෙන යන ඡේද කිහිපයක් ලෙස ගැඹුරු විග්‍රහයක් කරන්න.
2. සෘජුවම කරුණට පිවිසෙන්න. හැඳින්වීම් අනවශ්‍යයි.
3. අතිශය වැදගත්: මීට පෙර අංශ විස්තර කිරීමේදී භාවිතා කළ වාක්‍ය හෝ අදහස් ඒ ආකාරයෙන්ම නැවත භාවිතා නොකරන්න. අදාළ මාතෘකාවට පමණක් සුවිශේෂී වූ නව කරුණු ඉදිරිපත් කරන්න.
4. පිළියම් සඳහා වෙන් වූ අංශය හැර වෙනත් කිසිදු අංශයක ශාන්තිකර්ම හෝ පිළියම් ඇතුළත් නොකරන්න. එහිදී කළ යුත්තේ ශාස්ත්‍රීය විග්‍රහය පමණි.
5. අසුබ පල සඟවන්න එපා, නමුත් මනුෂ්‍යවාදීව පවසන්න: දෝෂ හෝ බාධක ඇත්නම් ඒවා පැහැදිලිව සඳහන් කර, ඒ වහාම කේන්ද්‍රයේ ඇති සුබ ග්‍රහ බලයන් සහ ජන්මියාගේ සහජ වීර්යය පෙන්වා දෙමින් සිත සනසන, ධෛර්යවත් කරන වචන භාවිතා කරන්න.`;

function buildMarriageSectionPrompt(label, guide) {
  const guideText = guide
    ? `**මෙම අංශය සඳහා අනිවාර්යයෙන්ම ඇතුළත් කළ යුතු කරුණු:** ${guide}\n`
    : '';
  return (
    `ඔබ දැන් විශ්ලේෂණය කළ යුත්තේ [${label}] යන අංශය පිළිබඳව පමණයි. වෙනත් අංශ ගැන මෙහිදී විස්තර නොකරන්න. ` +
    `වෘත්තීය මට්ටමේ, ගලාගෙන යන ශාස්ත්‍රීය විග්‍රහයක් ලබා දෙන්න.\n\n` +
    `${guideText}\n` +
    MARRIAGE_FIXED_INSTRUCTIONS
  );
}

/**
 * Resolve the effective marriage config for a client (falling back to built-in defaults).
 */
function resolveMarriageConfig(config) {
  const sections = (Array.isArray(config.marriage_sections) && config.marriage_sections.length > 0)
    ? config.marriage_sections.filter(s => s && s.label)
    : DEFAULT_MARRIAGE_SECTIONS;
  const systemPrompt = (config.marriage_system_prompt && config.marriage_system_prompt.trim())
    ? config.marriage_system_prompt
    : DEFAULT_MARRIAGE_SYSTEM_PROMPT;
  return { sections, systemPrompt, specialNote: config.marriage_special_note || '' };
}

/**
 * Generate one marriage section from saved chart data.
 * @returns {Promise<string>} the section text
 */
async function generateMarriageSectionText({ chartData, systemPrompt, label, guide }) {
  const chartDataJson  = JSON.stringify(chartData, null, 2) + todayContextBlock();
  const sysInstruction = systemPrompt + '\n\nමෙම කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n' + chartDataJson;
  const prompt = buildMarriageSectionPrompt(label, guide);

  console.log(`[MARRIAGE] ── REQUEST: "${label}"`);
  console.log('[MARRIAGE] userPrompt:\n' + prompt);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, topP: 0.8, topK: 40 },
    systemInstruction: sysInstruction,
  });
  const chat   = model.startChat({});
  const result = await chat.sendMessage(prompt);
  const text   = result.response.text();
  const usage  = result.response.usageMetadata;
  console.log(`[MARRIAGE] ── RESPONSE: "${label}" tokens in=${usage?.promptTokenCount ?? '?'} out=${usage?.candidatesTokenCount ?? '?'} chars=${text.length}`);
  return text;
}

/**
 * Generate every configured marriage section for an order and save the result.
 * Requires chart_data to already exist on the order (fetched by the horoscope flow).
 *
 * @param {string} clientId
 * @param {string} orderId
 * @returns {Promise<Array<{label: string, content: string}>>}
 */
async function generateMarriageReading(clientId, orderId) {
  const r = await db.pgQuery('SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]);
  if (!r.rows.length) throw new Error('Order not found');

  const hd = (typeof r.rows[0].horoscope_data === 'string')
    ? JSON.parse(r.rows[0].horoscope_data || '{}')
    : (r.rows[0].horoscope_data || {});

  if (!hd.chart_data) {
    throw new Error('No chart data found for this order. Generate the horoscope (or fetch the chart) first.');
  }

  const config = await db.getPluginConfig(clientId, 'horoscope_reading');
  const { sections, systemPrompt } = resolveMarriageConfig(config);

  console.log(`[MARRIAGE] Generating ${sections.length} sections for order ${orderId}`);
  console.log(`[MARRIAGE] systemPrompt (${systemPrompt.length} chars):\n` + systemPrompt);

  const out = [];
  for (const sec of sections) {
    const content = await generateMarriageSectionText({
      chartData:    hd.chart_data,
      systemPrompt,
      label:        sec.label,
      guide:        sec.guide || '',
    });
    out.push({ label: sec.label, content });
  }

  const updated = {
    ...hd,
    marriage_sections_data: out,
    marriage_generated_at:  new Date().toISOString(),
  };
  delete updated.marriage_generating;
  delete updated.marriage_error;

  await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(updated), orderId]);
  console.log(`[MARRIAGE] Saved ${out.length} sections for order ${orderId}`);

  // Auto-generate the WhatsApp message if a prompt is configured
  if (config.marriage_wa_prompt && config.marriage_wa_prompt.trim()) {
    try {
      await generateMarriageWaMessage(orderId, out, config.marriage_wa_prompt);
      console.log('[MARRIAGE] WA message generated for', orderId);
    } catch (e) {
      console.error('[MARRIAGE] WA message generation failed (non-fatal):', e.message);
    }
  }

  return out;
}

/**
 * Generate (or regenerate) the WhatsApp summary message for a marriage reading.
 * Saves to horoscope_data.marriage_wa_message.
 */
async function generateMarriageWaMessage(orderId, sectionsData, waPrompt) {
  const contextText = ['=== විවාහ පලාපල වාර්තාව ===']
    .concat((sectionsData || []).map(s => `\n--- ${s.label} ---\n${s.content}`))
    .join('\n');

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.7, topP: 0.9, topK: 40 },
    systemInstruction: waPrompt,
  });
  const chat   = model.startChat({});
  const result = await chat.sendMessage(contextText);
  const message = result.response.text();
  const usage   = result.response.usageMetadata;
  console.log(`[MARRIAGE-WA] order=${orderId} tokens in=${usage?.promptTokenCount ?? '?'} out=${usage?.candidatesTokenCount ?? '?'} chars=${message.length}`);

  await db.pgQuery(
    `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{marriage_wa_message}', $1::jsonb) WHERE order_id=$2`,
    [JSON.stringify(message), orderId]
  );
  return message;
}

/**
 * Build the marriage Word document.
 */
async function buildMarriageDoc({ customerName, sections, specialNote, birthDate, birthTime, sectionOrder }) {
  // Order by plugin config if provided; saved data may predate a reorder.
  let ordered = Array.isArray(sections) ? sections.map(s => ({ ...s })) : [];
  if (Array.isArray(sectionOrder) && sectionOrder.length > 0) {
    const byLabel  = Object.fromEntries(ordered.map(s => [s.label, s]));
    const sorted   = sectionOrder.map(o => byLabel[o.label]).filter(Boolean);
    const inConfig = new Set(sectionOrder.map(o => o.label));
    ordered.filter(s => !inConfig.has(s.label)).forEach(s => sorted.push(s));
    ordered = sorted;
  }

  return await buildSectionsDoc({
    customerName,
    reportTitle: MARRIAGE_REPORT_TITLE,
    sections:    ordered,
    specialNote,
    birthDate,
    birthTime,
  });
}

module.exports = {
  generateMarriageReading,
  generateMarriageSectionText,
  generateMarriageWaMessage,
  buildMarriageDoc,
  resolveMarriageConfig,
  MARRIAGE_REPORT_TITLE,
  DEFAULT_MARRIAGE_SECTIONS,
  DEFAULT_MARRIAGE_SYSTEM_PROMPT,
};
