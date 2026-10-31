'use strict';

/**
 * @module services/sectionReport
 * @description Generic "cover page plus titled sections plus the customer's own
 * questions" reading, for every report that is built like the marriage report.
 * Abroad (foreign travel and migration) and pregnancy (conception and
 * childbirth) are the two kinds today; adding another is one entry in KINDS.
 *
 * Same pipeline as marriage: the order's saved chart is the Gemini system
 * instruction, then one message per configured section in one shared chat
 * session so later sections do not repeat earlier ones.
 *
 * Config lives under the `horoscope_reading` plugin, one set of keys per kind:
 *   <kind>_system_prompt, <kind>_sections [{label, guide}], <kind>_special_note,
 *   <kind>_wa_prompt, <kind>_report_title, <kind>_fixed_instructions,
 *   <kind>_questions_title, <kind>_question_instructions, <kind>_ai_fill_prompt
 *
 * Results are saved on orders.horoscope_data:
 *   <kind>_sections_data, <kind>_special_questions, <kind>_special_answers,
 *   <kind>_wa_message, <kind>_generated_at, <kind>_generating,
 *   <kind>_generating_at, <kind>_error
 */

const db = require('../db');
const { getGenAI } = require('./clientKeys');
const { sendRequiredMeta, sendChecked } = require('./aiRetry');
const { makeMeter, recordOrderGenCost } = require('./genCost');
const { todayContextBlock } = require('./dateContext');
const {
  buildMarriageSectionPrompt, buildMarriageQuestionPrompt,
  historyFromSections, buildMarriageDoc,
} = require('./marriage');

/**
 * Per-kind facts that are not editorial content. Titles, prompts and sections
 * belong to the client and live in plugin config, never here.
 */
const KINDS = {
  abroad: {
    label:        'Abroad',
    waHeader:     'විදේශගත වීමේ වාර්තාව',
    fileSuffix:   'abroad',
  },
  pregnancy: {
    label:        'Pregnancy',
    waHeader:     'දරු සම්භවය පිළිබඳ වාර්තාව',
    fileSuffix:   'pregnancy',
  },
};

const KIND_LIST = Object.keys(KINDS);

function isKind(kind) { return Object.prototype.hasOwnProperty.call(KINDS, kind); }

/** The horoscope_data key for a kind, e.g. hdKey('abroad', 'sections_data'). */
function hdKey(kind, name) { return `${kind}_${name}`; }

/** Every horoscope_data key a generated report of this kind owns (delete wipes these). */
function reportKeys(kind) {
  return ['sections_data', 'special_answers', 'generated_at', 'wa_message',
    'progress', 'generating', 'generating_at', 'error'].map(n => hdKey(kind, n));
}

/** Every plugin config key a kind owns, so save and load stay in step. */
const CONFIG_FIELDS = ['system_prompt', 'sections', 'special_note', 'wa_prompt',
  'report_title', 'fixed_instructions', 'questions_title', 'question_instructions',
  'ai_fill_prompt'];

function configKeys(kind) { return CONFIG_FIELDS.map(f => hdKey(kind, f)); }

/**
 * Effective config for a kind. Client-owned content only: no built-in persona
 * or section list, so a client that has not written theirs gets a clear error
 * instead of another client's wording.
 */
function resolveConfig(kind, config = {}) {
  const get = (f) => config[hdKey(kind, f)];
  const raw = get('sections');
  return {
    sections: Array.isArray(raw) ? raw.filter(s => s && s.label) : [],
    systemPrompt:         String(get('system_prompt') || '').trim(),
    specialNote:          String(get('special_note') || '').trim(),
    reportTitle:          String(get('report_title') || '').trim(),
    fixedInstructions:    String(get('fixed_instructions') || '').trim(),
    questionsTitle:       String(get('questions_title') || '').trim(),
    questionInstructions: String(get('question_instructions') || '').trim(),
    waPrompt:             String(get('wa_prompt') || '').trim(),
    aiFillPrompt:         String(get('ai_fill_prompt') || '').trim(),
  };
}

/** The chart is constant across sections, so it goes in the system instruction. */
async function buildModel({ clientId, chartData, systemPrompt }) {
  const chartDataJson  = JSON.stringify(chartData, null, 2) + todayContextBlock();
  const sysInstruction = systemPrompt + '\n\nමෙම කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n' + chartDataJson;
  return (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, topP: 0.8, topK: 40 },
    systemInstruction: sysInstruction,
  });
}

/**
 * Generate one section's text. Pass `chat` to keep a run's shared session, or
 * `history` (from already saved sections) to rebuild one for a single redo.
 */
async function generateSectionText({ kind, clientId, chartData, systemPrompt, label, guide, chat, history, fixedInstructions, meter }) {
  const tag = kind.toUpperCase();
  const prompt = buildMarriageSectionPrompt(label, guide, fixedInstructions);
  console.log(`[${tag}] request: "${label}"`);

  const activeChat = chat
    || (await buildModel({ clientId, chartData, systemPrompt })).startChat({ history: history || [] });
  const { text, usage } = await sendRequiredMeta(activeChat, prompt, label);
  if (meter) meter.add(usage);
  console.log(`[${tag}] response: "${label}" chars=${text.length}`);
  return text;
}

function parseJson(v) {
  return typeof v === 'string' ? JSON.parse(v || '{}') : (v || {});
}

/**
 * Generate every configured section for an order, answer the customer's own
 * questions, save the result, and build the WhatsApp message when a prompt is set.
 * Requires chart_data on the order (fetched by Check Lagna).
 */
async function generateReading(kind, clientId, orderId) {
  const tag = kind.toUpperCase();
  const r = await db.pgQuery('SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]);
  if (!r.rows.length) throw new Error('Order not found');
  const hd = parseJson(r.rows[0].horoscope_data);

  if (!hd.chart_data) {
    throw new Error('No chart data found for this order. Press Check Lagna first.');
  }

  const config = await db.getPluginConfig(clientId, 'horoscope_reading');
  const cfg = resolveConfig(kind, config);
  if (!cfg.systemPrompt) {
    const err = new Error(`No ${KINDS[kind].label} system prompt configured for this client. Set it in Plugins > Horoscope Reading before generating.`);
    err.statusCode = 422;
    throw err;
  }
  if (!cfg.sections.length) {
    const err = new Error(`No ${KINDS[kind].label} sections configured for this client. Define them in Plugins > Horoscope Reading before generating.`);
    err.statusCode = 422;
    throw err;
  }

  console.log(`[${tag}] generating ${cfg.sections.length} sections for order ${orderId}`);

  // One session for the whole run: every section sees what came before it.
  const chat = (await buildModel({ clientId, chartData: hd.chart_data, systemPrompt: cfg.systemPrompt })).startChat({});

  const meter = makeMeter();
  const out = [];
  for (const sec of cfg.sections) {
    const content = await generateSectionText({
      kind, clientId, label: sec.label, guide: sec.guide || '',
      fixedInstructions: cfg.fixedInstructions, chat, meter,
    });
    out.push({ label: sec.label, content });
  }

  // The customer's own questions, answered in the same session so the answers
  // do not restate what the sections already covered.
  const questions = Array.isArray(hd[hdKey(kind, 'special_questions')]) ? hd[hdKey(kind, 'special_questions')] : [];
  const answers = [];
  for (const q of questions) {
    const questionText = (q.prompt && q.prompt.trim()) ? q.prompt : (q.question || '');
    if (!questionText.trim()) continue;
    const { text: answer, finishReason, usage } = await sendChecked(
      chat, buildMarriageQuestionPrompt(questionText, cfg.questionInstructions), `question: ${q.question || questionText}`);
    meter.add(usage);
    const entry = { question: q.question || questionText, prompt: q.prompt || '', answer };
    if (!answer) {
      // Saved rather than thrown: losing every section over one unanswered
      // question is the worse outcome. The flag makes the gap visible.
      entry.error = finishReason === 'SAFETY'
        ? 'Declined on safety grounds. Try rewording this question.'
        : `No answer returned (${finishReason || 'unknown reason'}). Regenerate this question.`;
      console.error(`[${tag}] unanswered question "${q.question || questionText}": ${entry.error}`);
    }
    answers.push(entry);
  }

  const updated = {
    ...hd,
    [hdKey(kind, 'sections_data')]:   out,
    [hdKey(kind, 'special_answers')]: answers,
    [hdKey(kind, 'generated_at')]:    new Date().toISOString(),
  };
  delete updated[hdKey(kind, 'generating')];
  delete updated[hdKey(kind, 'error')];

  await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(updated), orderId]);
  await recordOrderGenCost(orderId, kind, meter, { sections: out.length, questions: answers.length });

  if (cfg.waPrompt) {
    try {
      await generateWaMessage(kind, clientId, orderId, out, cfg.waPrompt);
    } catch (e) {
      console.error(`[${tag}] WhatsApp message failed (non-fatal):`, e.message);
    }
  }
  return out;
}

/** Generate (or regenerate) the WhatsApp summary and save it on the order. */
async function generateWaMessage(kind, clientId, orderId, sectionsData, waPrompt) {
  const contextText = [`=== ${KINDS[kind].waHeader} ===`]
    .concat((sectionsData || []).map(s => `\n--- ${s.label} ---\n${s.content}`))
    .join('\n');

  const model = (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.7, topP: 0.9, topK: 40 },
    systemInstruction: waPrompt,
  });
  const meter = makeMeter();
  const { text: message, usage } = await sendRequiredMeta(model.startChat({}), contextText, `${kind} WhatsApp message`);
  meter.add(usage);
  await recordOrderGenCost(orderId, 'wa_message', meter, { report: kind });

  await db.pgQuery(
    `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), $1::text[], $2::jsonb) WHERE order_id=$3`,
    [[hdKey(kind, 'wa_message')], JSON.stringify(message), orderId]
  );
  return message;
}

/** The Word document: same layout as the marriage report. */
function buildDoc(opts) { return buildMarriageDoc(opts); }

// ─── AI Fill ────────────────────────────────────────────────────────────────

/**
 * Shared opening of every AI Fill prompt: read the birth details out of the
 * chat. Identical for every kind; only the special-question guidance differs.
 */
const BIRTH_BLOCK = `## Order Details
- Customer name: {{customer_name}}
- Birth date (raw): {{birth_date}}
- Birth time (raw): {{birth_time}}
- Birth place (raw): {{birth_place}}
- Other details on the order:
{{order_details}}

## Full Customer Chat Conversation
{{chat_log}}

## Your Task: return the exact JSON schema below, nothing else.

### Sources
Use BOTH the chat and the order details above. The chat may be empty (a customer who ordered another way), in which case work from the order details alone. Every birth field may be null when it is genuinely not there: never guess one. Even then, still return the special_questions you can support from what the customer wrote.

### birth_date_iso
Normalize the birth date to exactly "YYYY-MM-DD" (e.g. "1990-03-15").
Sinhala month names: ජනවාරි=01 පෙබරවාරි=02 මාර්තු=03 අප්‍රේල්=04 මැයි=05 ජූනි=06 ජූලි=07 අගෝස්තු=08 සැප්තැම්බර්=09 ඔක්තෝබර්=10 නොවැම්බර්=11 දෙසැම්බර්=12
Return null if genuinely unknown.

### birth_time_24h
Normalize to exactly "HH:MM" 24-hour format.
CRITICAL: "ප.ව" means afternoon/PM. Add 12 to hours 1 to 11 for PM. Examples: "ප.ව 3.30" is "15:30", "ප.ව 9.00" is "21:00", "ප.ව 12.00" is "12:00".
"පෙ.ව" or "උදෑසන" or "උදේ" = AM (do NOT add 12). Example: "පෙ.ව 6.30" is "06:30".
"සවස" or "රාත්‍රී" or "රාත්රී" or "දහවල්" = PM.
Midnight = "00:00". Noon = "12:00". Return null if genuinely unknown.

### birth_place_en
The English name of the birth place (translated from Sinhala if needed). Just the place name, no country suffix.

### lat / lng
Latitude and longitude (decimal degrees) of the birth place. Use your geographic knowledge and return precise coordinates with a minimum of 4 decimal places. Return numbers, not strings. Example: 8.4983 / 80.6015, not 8.5 / 80.6.

### special_questions
Two fields each:
- "question": the SHORT, polished Sinhala question shown to the customer in the final PDF. One clear sentence they will recognise as their own concern.
- "prompt": a DETAILED Sinhala instruction written FOR GEMINI ONLY (the customer never sees it). Spell out the customer's exact situation from the chat, the angle to analyse, and what the answer must cover.
`;

const KIND_AI_FILL = {
  abroad: `{{BIRTH}}
The following are ALREADY covered by the report's standard sections, so do NOT create questions duplicating them:
- the general indication of living or working abroad (foreign travel yoga)
- which country or direction suits the person
- the likely timing of departure
- work, study or business abroad in general
- common visa and travel obstacles in general
- settling abroad versus returning home
- remedies

A special question is ONLY valid if it targets something SPECIFIC this person personally mentioned: a named country, a job offer, an agent or sponsor they are dealing with, a visa interview or a refusal they already had, a date they were given, a spouse or family member who will travel with them, a loan or money worry tied to the trip, a previous failed attempt, a health worry, and so on.

If the chat contains no such specific concern, return an EMPTY array. Do not invent questions.`,

  pregnancy: `{{BIRTH}}
Whose chart: the report is for ONE person, the woman who is expecting or hoping to conceive. If the chat gives birth details for both partners, use the woman's. If only one set is clear, use that.

The following are ALREADY covered by the report's standard sections, so do NOT create questions duplicating them:
- the general indication of having children and the timing
- health and the periods needing extra care during pregnancy
- common reasons for delay
- the child's general nature and future
- remedies

A special question is ONLY valid if it targets something SPECIFIC this person personally mentioned: how many years they have been trying, a previous miscarriage or loss, a treatment or IVF plan they are considering, a date a doctor has given, a family pressure, a worry about a particular period, and so on.

Never create a question that asks to predict the baby's sex, and never create one that asks whether to stop or change medical treatment. Those are not for an astrology report to answer.

If the chat contains no such specific concern, return an EMPTY array. Do not invent questions.`,
};

const KIND_AI_FILL_INTRO = {
  abroad:    'You are an expert Vedic astrology assistant and Sinhala language expert preparing a FOREIGN TRAVEL AND LIVING ABROAD (විදේශගත වීම) reading for ONE person.\n\n',
  pregnancy: 'You are an expert Vedic astrology assistant and Sinhala language expert preparing a CHILDBIRTH AND PREGNANCY (දරු සම්භවය) reading for ONE person.\n\n',
};

/** The built-in AI Fill prompt for a kind. Used when the client has not written one. */
function defaultAiFillPrompt(kind) {
  return KIND_AI_FILL_INTRO[kind] + KIND_AI_FILL[kind].replace('{{BIRTH}}', () => BIRTH_BLOCK);
}

/** Order fields the prompt already carries on their own line, so they are not repeated. */
const COVERED_FIELDS = new Set(['customer_name', 'birth_date', 'birth_time', 'birth_place']);

/**
 * The order's own details as prompt lines. A manual order has no chat, and what
 * the customer wanted (their "needs", problem, country) is written here, so this
 * is often the only thing AI Fill has to read.
 *
 * @param {object} cf  the order's custom_fields
 * @returns {string}   "- key: value" lines, or "(none)"
 */
function describeOrderDetails(cf = {}) {
  const lines = [];
  for (const [k, v] of Object.entries(cf || {})) {
    if (COVERED_FIELDS.has(k) || v == null || typeof v === 'object') continue;
    const text = String(v).trim();
    if (!text || /^(n\/?a|na|-)$/i.test(text)) continue;
    lines.push(`- ${k.replace(/_/g, ' ')}: ${text.slice(0, 800)}`);
  }
  return lines.length ? lines.join('\n') : '(none)';
}

/**
 * Fill a prompt template for one order. A client template written before
 * {{order_details}} existed does not have it, so the details are added ahead of
 * the task section rather than silently dropped.
 */
function buildAiFillPrompt(template, { customerName, cf = {}, chatLog }) {
  const details = describeOrderDetails(cf);
  let t = template;
  if (!t.includes('{{order_details}}') && details !== '(none)') {
    const block = `## Other details on the order\n${details}\n\n`;
    t = t.includes('## Your Task') ? t.replace('## Your Task', () => `${block}## Your Task`) : `${t}\n\n${block}`;
  }
  return t
    .replace(/\{\{customer_name\}\}/g, () => customerName || '')
    .replace(/\{\{birth_date\}\}/g,    () => cf.birth_date || '')
    .replace(/\{\{birth_time\}\}/g,    () => cf.birth_time || '')
    .replace(/\{\{birth_place\}\}/g,   () => cf.birth_place || '')
    .replace(/\{\{order_details\}\}/g, () => details)
    .replace(/\{\{chat_log\}\}/g,      () => chatLog || '(no messages found)');
}

module.exports = {
  KINDS, KIND_LIST, isKind, hdKey, reportKeys, configKeys, CONFIG_FIELDS,
  resolveConfig, generateReading, generateSectionText, generateWaMessage,
  historyFromSections, buildDoc, defaultAiFillPrompt, buildAiFillPrompt, describeOrderDetails,
};
