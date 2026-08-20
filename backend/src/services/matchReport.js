'use strict';

/**
 * @module services/matchReport
 * @description Couple compatibility (ගැළපීම / match-making) reading generation service.
 *
 * Port of the standalone `app/breakup.py` script. Same shape as the marriage reading —
 * chart data as the Gemini system instruction, then one Gemini call per configurable
 * section — but it takes TWO charts (boy + girl) instead of one, and answers the
 * couple's custom questions at the end.
 *
 * Like breakup.py (and unlike the pre-existing Node readings, which used to start a
 * fresh chat per section), the whole run shares ONE chat session so each section can
 * see everything written before it. That is what makes the "do not repeat earlier
 * sections" rule in the client's fixed instructions actually enforceable. The session is a
 * local variable — one per order per run, discarded when the run ends, so no couple's
 * chart data can ever leak into another order's report.
 *
 * Config lives under the existing `horoscope_reading` plugin:
 *   match_system_prompt   — Gemini system instruction (blank → built-in default)
 *   match_sections        — [{ label, guide }]        (blank → no sections generated)
 *   match_special_note    — closing note appended to the document
 *
 * Results are saved on orders.horoscope_data:
 *   match_boy / match_girl   — { name, birth_date, birth_time, lat, lng, lagna, chart_data }
 *   match_sections_data      — [{ label, content }]
 *   match_special_answers    — [{ question, prompt, answer }]
 */

const db        = require('../db');
const { getGenAI } = require('./clientKeys');
const { sendChecked, sendRequired } = require('./aiRetry');
const { buildSectionsDoc } = require('./horoscope');
const { todayContextBlock } = require('./dateContext');





// The 5 fixed rules appended to every section prompt (breakup.py task_prompt).

// Rules for the couple's own questions, answered after the sections (breakup.py q_prompt).

/**
 * Per-section user prompt. Summary/conclusion sections get a tighter word limit, matching
 * the `සාරාංශය`/`නිගමනය` special case in breakup.py.
 */
function buildMatchSectionPrompt(label, guide, fixedInstructions) {
  const isSummary = label.includes('සාරාංශය') || label.includes('නිගමනය');
  const limitText = isSummary
    ? 'වචන 600කට වඩා අඩු, ඉතා සංක්ෂිප්ත සහ සෘජු විග්‍රහයක් ලබා දෙන්න.'
    : 'වෘත්තීය මට්ටමේ සවිස්තරාත්මක විග්‍රහයක් ලබා දෙන්න (වචන 300-500 පමණ).';
  const guideText = guide
    ? `මෙම මාතෘකාව ලිවීම සඳහා විශේෂ උපදෙස්: ${guide}\n\n`
    : '';
  return (
    `මාතෘකාව: [${label}]\n` +
    `${guideText}` +
    `${limitText}\n\n` +
    (fixedInstructions || '')
  );
}

function buildMatchQuestionPrompt(questionText, questionInstructions) {
  return (
    `මෙම විශේෂ ප්‍රශ්නයට සෘජු සහ සවිස්තරාත්මක පිළිතුරක් ලබා දෙන්න: '${questionText}'\n\n` +
    (questionInstructions || '')
  );
}

/**
 * Resolve the effective match-making config for a client (falling back to built-in defaults).
 */
function resolveMatchConfig(config) {
  // Every value here is the client's own editorial content, so there are no
  // built-in defaults: one client's persona, section list or credibility note
  // must never turn up in another client's paid report.
  const sections = (Array.isArray(config.match_sections) && config.match_sections.length > 0)
    ? config.match_sections.filter(s => s && s.label)
    : [];
  return {
    sections,
    systemPrompt:         (config.match_system_prompt || '').trim(),
    specialNote:          (config.match_special_note || '').trim(),
    reportTitle:          (config.match_report_title || '').trim(),
    questionsTitle:       (config.match_questions_title || '').trim(),
    fixedInstructions:    (config.match_fixed_instructions || '').trim(),
    questionInstructions: (config.match_question_instructions || '').trim(),
  };
}

/**
 * Serialise both charts into one clearly-labelled block. The role labels are explicit and
 * in Sinhala so the model can never mix up whose placement is whose — the single biggest
 * failure mode for a two-chart reading.
 */
function buildCoupleContext(hd) {
  const couple = [
    {
      role:  'පිරිමි (Male / Boy)',
      name:  hd.match_boy?.name || '',
      birth: [hd.match_boy?.birth_date, hd.match_boy?.birth_time, hd.match_boy?.birth_place_name].filter(Boolean).join(' · '),
      chart: hd.match_boy?.chart_data,
    },
    {
      role:  'ගැහැනු (Female / Girl)',
      name:  hd.match_girl?.name || '',
      birth: [hd.match_girl?.birth_date, hd.match_girl?.birth_time, hd.match_girl?.birth_place_name].filter(Boolean).join(' · '),
      chart: hd.match_girl?.chart_data,
    },
  ];
  return JSON.stringify(couple, null, 2) + todayContextBlock();
}

/**
 * Build the Gemini model for a match run. The couple context is constant across every
 * section, so it lives in the systemInstruction and the model is built once per run.
 */
async function buildMatchModel({ clientId, coupleContext, systemPrompt }) {
  const sysInstruction = systemPrompt
    + '\n\nමෙම යුවලගේ කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n'
    + coupleContext;
  return (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, topP: 0.8, topK: 40 },
    systemInstruction: sysInstruction,
  });
}

/**
 * Rebuild a chat history from already-saved sections, for the regenerate-one-section path
 * where the run's live session no longer exists. The section being redone is excluded so
 * the model rewrites it instead of echoing it back.
 */
function historyFromSections(sectionsData, excludeLabel) {
  return (sectionsData || [])
    .filter(s => s && s.label && s.content && s.label !== excludeLabel)
    .flatMap(s => [
      { role: 'user',  parts: [{ text: `මාතෘකාව: [${s.label}]` }] },
      { role: 'model', parts: [{ text: s.content }] },
    ]);
}

/**
 * Generate one match-making section.
 * Pass an existing `chat` to stay inside the run's shared session (preferred); omit it and
 * a one-off session is built from `coupleContext` + optional `history`.
 * @returns {Promise<string>} the section text
 */
async function generateMatchSectionText({ clientId, coupleContext, systemPrompt, label, guide, chat, history, fixedInstructions }) {
  const prompt = buildMatchSectionPrompt(label, guide, fixedInstructions);

  console.log(`[MATCH] ── REQUEST: "${label}"`);
  console.log('[MATCH] userPrompt:\n' + prompt);

  const activeChat = chat
    || (await buildMatchModel({ clientId, coupleContext, systemPrompt })).startChat({ history: history || [] });
  const text = await sendRequired(activeChat, prompt, label);
  const usage = undefined;
  console.log(`[MATCH] ── RESPONSE: "${label}" tokens in=${usage?.promptTokenCount ?? '?'} out=${usage?.candidatesTokenCount ?? '?'} chars=${text.length}`);
  return text;
}

/**
 * Generate every configured section (and every custom question) for an order, then save.
 * Requires BOTH partners' chart_data to already exist — the modal's two "Check Sign"
 * buttons are what put them there.
 *
 * @param {string} clientId
 * @param {string} orderId
 * @returns {Promise<Array<{label: string, content: string}>>}
 */

/**
 * Live progress for the match-making run. Same rationale as the horoscope
 * version: the run takes minutes and a bare spinner cannot be told from a stall.
 *
 * @param {string} orderId
 * @param {number} done
 * @param {number} total
 * @param {string} phase
 * @returns {Promise<void>}
 */
async function publishMatchProgress(orderId, done, total, phase) {
  if (!total) return;
  try {
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{match_progress}', $1::jsonb, true) WHERE order_id=$2`,
      [JSON.stringify({ done, total, percent: Math.min(99, Math.round((done / total) * 100)), phase, at: new Date().toISOString() }), orderId]
    );
  } catch (e) {
    console.warn(`[PROGRESS] ${orderId} match write failed:`, e.message);
  }
}

async function generateMatchReading(clientId, orderId) {
  const r = await db.pgQuery('SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]);
  if (!r.rows.length) throw new Error('Order not found');

  const hd = (typeof r.rows[0].horoscope_data === 'string')
    ? JSON.parse(r.rows[0].horoscope_data || '{}')
    : (r.rows[0].horoscope_data || {});

  const missing = [];
  if (!hd.match_boy?.chart_data)  missing.push('පිරිමි (boy)');
  if (!hd.match_girl?.chart_data) missing.push('ගැහැනු (girl)');
  if (missing.length) {
    throw new Error(
      `No chart data for ${missing.join(' and ')}. Open the order, go to the Match Making tab, `
      + 'fill both sides and press "Check Sign" for each before generating.'
    );
  }

  const config = await db.getPluginConfig(clientId, 'horoscope_reading');
  const { sections, systemPrompt, fixedInstructions, questionInstructions } = resolveMatchConfig(config);
  if (!systemPrompt) {
    const err = new Error('No match-making system prompt configured for this client. Set it in Plugins > Horoscope Reading before generating.');
    err.statusCode = 422;
    throw err;
  }
  if (!sections.length) {
    const err = new Error('No match-making sections configured for this client. Define them in Plugins > Horoscope Reading before generating.');
    err.statusCode = 422;
    throw err;
  }
  const coupleContext = buildCoupleContext(hd);

  console.log(`[MATCH] Generating ${sections.length} sections for order ${orderId}`);
  console.log(`[MATCH] systemPrompt (${systemPrompt.length} chars):\n` + systemPrompt);
  console.log(`[MATCH] coupleContext: ${coupleContext.length} chars`);

  // ONE session for the whole run (see module docstring).
  const chat = (await buildMatchModel({ clientId, coupleContext, systemPrompt })).startChat({});

  const totalSteps = sections.length + (Array.isArray(hd.match_special_questions) ? hd.match_special_questions.length : 0);
  let doneSteps = 0;
  const out = [];
  for (const sec of sections) {
    const content = await generateMatchSectionText({
      clientId,
      fixedInstructions,
      label: sec.label,
      guide: sec.guide || '',
      chat,
    });
    out.push({ label: sec.label, content });
    await publishMatchProgress(orderId, ++doneSteps, totalSteps, sec.label);
  }

  // The couple's own questions, answered in the same session so answers do not
  // restate what the sections already covered.
  const questions = Array.isArray(hd.match_special_questions) ? hd.match_special_questions : [];
  const answers = [];
  for (const q of questions) {
    const questionText = (q.prompt && q.prompt.trim()) ? q.prompt : (q.question || '');
    if (!questionText.trim()) continue;
    console.log(`[MATCH-Q] ── REQUEST: "${q.question || questionText}"`);
    const label = `question: ${q.question || questionText}`;
    const { text: answer, finishReason } = await sendChecked(
      chat, buildMatchQuestionPrompt(questionText, questionInstructions), label);
    console.log(`[MATCH-Q] ── RESPONSE: chars=${answer.length}`);
    const entry = { question: q.question || questionText, prompt: q.prompt || '', answer };
    if (!answer) {
      // Saved rather than thrown: losing every generated section over one
      // unanswered question is the worse outcome. The flag makes it visible
      // so the report is not sent out with a silent gap.
      entry.error = finishReason === 'SAFETY'
        ? 'Declined on safety grounds — try rewording this question.'
        : `No answer returned (${finishReason || 'unknown reason'}) — regenerate this question.`;
      console.error(`[MATCH-Q] !! UNANSWERED: "${q.question || questionText}" — ${entry.error}`);
    }
    answers.push(entry);
    await publishMatchProgress(orderId, ++doneSteps, totalSteps, `Question: ${q.question || questionText}`);
  }

  const updated = {
    ...hd,
    match_progress:        null,
    match_sections_data:   out,
    match_special_answers: answers,
    match_generated_at:    new Date().toISOString(),
  };
  delete updated.match_generating;
  delete updated.match_error;

  await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(updated), orderId]);
  console.log(`[MATCH] Saved ${out.length} sections + ${answers.length} answers for order ${orderId}`);

  return out;
}

/**
 * Build the match-making Word document.
 */
async function buildMatchDoc({ hd, sections, specialNote, sectionOrder, specialAnswers, brand, reportTitle, questionsTitle }) {
  // Order by plugin config if provided; saved data may predate a reorder.
  let ordered = Array.isArray(sections) ? sections.map(s => ({ ...s })) : [];
  if (Array.isArray(sectionOrder) && sectionOrder.length > 0) {
    const byLabel  = Object.fromEntries(ordered.map(s => [s.label, s]));
    const sorted   = sectionOrder.map(o => byLabel[o.label]).filter(Boolean);
    const inConfig = new Set(sectionOrder.map(o => o.label));
    ordered.filter(s => !inConfig.has(s.label)).forEach(s => sorted.push(s));
    ordered = sorted;
  }

  const boy  = hd.match_boy  || {};
  const girl = hd.match_girl || {};
  const personLine = (p) => [p.name, p.birth_date, p.birth_time].filter(Boolean).join('  ·  ');

  return await buildSectionsDoc({
    brand,
    customerName: [boy.name, girl.name].filter(Boolean).join('  ⚭  '),
    reportTitle:  reportTitle || '',
    sections:     ordered,
    specialNote,
    specialAnswers,
    specialQuestionsTitle: questionsTitle || '',
    subtitleLines: [personLine(boy), '⚭', personLine(girl)].filter(Boolean),
  });
}

module.exports = {
  generateMatchReading,
  generateMatchSectionText,
  buildMatchDoc,
  buildCoupleContext,
  resolveMatchConfig,
  historyFromSections,
};
