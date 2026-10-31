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
const {
  tryParseSpec, specToSections, renderGlobalRules, renderLedger,
  buildSpecSectionPrompt, buildReviewPrompt, REVIEW_SCHEMA,
  wordCount, codeChecks,
} = require('./sectionSpec');

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
  return ['sections_data', 'special_answers', 'generated_at', 'wa_message', 'review',
    'progress', 'generating', 'generating_at', 'error'].map(n => hdKey(kind, n));
}

/** Every plugin config key a kind owns, so save and load stay in step. */
const CONFIG_FIELDS = ['system_prompt', 'sections', 'special_note', 'wa_prompt',
  'report_title', 'fixed_instructions', 'questions_title', 'question_instructions',
  'ai_fill_prompt', 'spec'];

function configKeys(kind) { return CONFIG_FIELDS.map(f => hdKey(kind, f)); }

/**
 * Effective config for a kind. Client-owned content only: no built-in persona
 * or section list, so a client that has not written theirs gets a clear error
 * instead of another client's wording.
 */
function resolveConfig(kind, config = {}) {
  const get = (f) => config[hdKey(kind, f)];
  const raw = get('sections');
  // A valid spec is the source of the section list, so the editor, the document
  // and generation can never disagree about which sections exist.
  const spec = tryParseSpec(get('spec'));
  return {
    spec,
    sections: spec ? specToSections(spec) : (Array.isArray(raw) ? raw.filter(s => s && s.label) : []),
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
  const r = await db.pgQuery('SELECT horoscope_data, custom_fields FROM orders WHERE order_id=$1', [orderId]);
  if (!r.rows.length) throw new Error('Order not found');
  const hd = parseJson(r.rows[0].horoscope_data);
  const cf = parseJson(r.rows[0].custom_fields);

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

  console.log(`[${tag}] generating ${cfg.sections.length} sections for order ${orderId}${cfg.spec ? ' (spec mode)' : ''}`);

  if (cfg.spec) return generateSpecReading({ kind, clientId, orderId, hd, cf, cfg, config });

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

// ─── Spec mode: ledger, review, targeted fixes ───────────────────────────────

const SECTION_SCHEMA = {
  type: 'object',
  properties: { content: { type: 'string' }, ledger: { type: 'array', items: { type: 'string' } } },
  required: ['content', 'ledger'],
};

/** How many review rounds may rewrite flagged sections before the report is accepted as it is. */
const MAX_REVIEW_ROUNDS = 2;

/**
 * The chart, the customer's own order details, the client's house style and the
 * spec's global rules, as one system instruction. Constant across every call.
 */
function specSystemInstruction({ systemPrompt, spec, cf, chartData }) {
  const rules = renderGlobalRules(spec.globalRules);
  return [
    systemPrompt,
    rules.length ? `ගෝලීය නීති:\n${rules.map(r => `- ${r}`).join('\n')}` : '',
    `ජන්මියාගේ ඇණවුමේ තොරතුරු (ඉල්ලීම, අරමුණු, සුදුසුකම් ආදිය):\n${describeOrderDetails(cf)}`,
    `මෙම කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n${JSON.stringify(chartData, null, 2)}${todayContextBlock()}`,
  ].filter(Boolean).join('\n\n');
}

async function specModel(clientId, systemInstruction, { schema, temperature = 0.4 } = {}) {
  return (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
    generationConfig: {
      temperature, topP: 0.8, topK: 40,
      ...(schema && { responseMimeType: 'application/json', responseSchema: schema }),
    },
  });
}

/** How long one model call may take before it is abandoned and retried. */
const CALL_TIMEOUT_MS = 150 * 1000;

/** Reject if `promise` has not settled in `ms`. A model call that never returns would otherwise leave a report "generating" forever. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`"${label}" timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** One JSON reply, retried once when it comes back empty, unparsable or too slow. */
async function jsonCall(model, prompt, label, meter) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await withTimeout(model.generateContent(prompt), CALL_TIMEOUT_MS, label);
      if (meter) meter.add(result.response.usageMetadata);
      const parsed = JSON.parse(result.response.text().trim());
      if (parsed && typeof parsed === 'object') return parsed;
      lastErr = new Error('reply was not an object');
    } catch (e) { lastErr = e; }
  }
  const err = new Error(`"${label}" could not be written (${lastErr && lastErr.message}). Nothing was saved; try generating again.`);
  err.statusCode = 502;
  throw err;
}

const cleanLedger = (v) => (Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean).slice(0, 5) : []);

/** Write (or rewrite) one section of a spec. Returns { content, ledger }. */
async function writeSpecSection({ model, section, ledger, fixedInstructions, issues, current, meter }) {
  let prompt = buildSpecSectionPrompt(section, { ledger, fixedInstructions, issues });
  if (current) prompt = `වත්මන් අනුවාදය:\n${current}\n\n${prompt}`;
  const out = await jsonCall(model, prompt, section.title, meter);
  const content = String(out.content || '').trim();
  if (!content) {
    const err = new Error(`"${section.title}" came back empty. Nothing was saved; try generating again.`);
    err.statusCode = 502;
    throw err;
  }
  return { content, ledger: cleanLedger(out.ledger) };
}

/** The review record saved beside the sections: counts, and per-section words and open issues. */
function buildReviewRecord(items, rounds, found, spec, reviewError, detail = []) {
  const open = codeChecks(items, spec.globalRules);
  const sections = {};
  items.forEach(({ section, content, remaining }, i) => {
    sections[section.title] = {
      words: wordCount(content), target: section.targetWords || null, min: section.minWords || null, max: section.maxWords || null,
      issues: [...(open.get(i) || []), ...(remaining || [])],
    };
  });
  const remainingCount = Object.values(sections).reduce((n, s) => n + s.issues.length, 0);
  return {
    rounds, found, fixed: Math.max(0, found - remainingCount), remaining: remainingCount,
    ...(reviewError && { review_error: reviewError }),
    detail,
    checked_at: new Date().toISOString(), sections,
  };
}

/**
 * Whole-report review followed by targeted rewrites.
 *
 * Each round: code checks (length, English text, repeated wording) plus one AI
 * read of the entire report for repetition, contradictions and scope breaches.
 * Only sections with findings are rewritten, with the findings in the prompt.
 * Stops when a round finds nothing or after MAX_REVIEW_ROUNDS.
 *
 * Mutates `items` ({section, content, ledger}) in place.
 */
async function reviewAndFix({ items, spec, writer, reviewer, fixedInstructions, meter }) {
  let found = 0;
  let rounds = 0;
  let reviewError = null;
  const detail = [];

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round += 1) {
    const flagged = new Map(); // index -> notes
    let codeFound = 0;
    let aiFound = 0;
    for (const [i, notes] of codeChecks(items, spec.globalRules)) { flagged.set(i, [...notes]); codeFound += notes.length; }

    if (!reviewError) {
      try {
        const res = await jsonCall(reviewer, buildReviewPrompt(items, spec.globalRules), 'report review', meter);
        for (const iss of (Array.isArray(res.issues) ? res.issues : [])) {
          const i = Number(iss.section_index);
          if (Number.isInteger(i) && i >= 0 && i < items.length && String(iss.note || '').trim()) {
            flagged.set(i, [...(flagged.get(i) || []), `${iss.type || 'issue'}: ${String(iss.note).trim()}`]);
            aiFound += 1;
          }
        }
      } catch (e) {
        // A review that cannot run must not cost the report. The code checks still apply.
        reviewError = e.message;
        console.warn('[SECTION-REVIEW] AI review skipped:', e.message);
      }
    }

    if (flagged.size === 0) break;
    rounds = round;
    detail.push({ round, code_findings: codeFound, ai_findings: aiFound, rewritten: [...flagged.keys()].map(i => items[i].section.title) });
    found += [...flagged.values()].reduce((n, notes) => n + notes.length, 0);

    for (const [i, notes] of flagged) {
      const others = items.map((it, j) => ({ title: it.section.title, items: it.ledger })).filter((_, j) => j !== i);
      const redo = await writeSpecSection({
        model: writer, section: items[i].section, ledger: others, fixedInstructions,
        issues: notes, current: items[i].content, meter,
      });
      items[i] = { ...items[i], content: redo.content, ledger: redo.ledger.length ? redo.ledger : items[i].ledger };
    }
  }
  return { found, rounds, reviewError, detail };
}

/**
 * Spec-mode generation: independent section calls that share a short ledger,
 * then review and targeted fixes, then the customer's own questions.
 */
async function generateSpecReading({ kind, clientId, orderId, hd, cf, cfg, config }) {
  const tag = kind.toUpperCase();
  const { spec } = cfg;
  const system = specSystemInstruction({ systemPrompt: cfg.systemPrompt, spec, cf, chartData: hd.chart_data });
  const writer = await specModel(clientId, system, { schema: SECTION_SCHEMA });
  const reviewer = await specModel(clientId, 'You are a careful editor of Sinhala astrology reports. Answer only in the requested JSON.', { schema: REVIEW_SCHEMA, temperature: 0.1 });
  const meter = makeMeter();

  const items = [];
  for (const section of spec.sections) {
    const ledger = items.map(it => ({ title: it.section.title, items: it.ledger }));
    const w = await writeSpecSection({ model: writer, section, ledger, fixedInstructions: cfg.fixedInstructions, meter });
    items.push({ section, content: w.content, ledger: w.ledger });
    console.log(`[${tag}] "${section.title}" ${wordCount(w.content)} words`);
  }

  const { found, rounds, reviewError, detail } = await reviewAndFix({
    items, spec, writer, reviewer, fixedInstructions: cfg.fixedInstructions, meter,
  });
  console.log(`[${tag}] review: ${rounds} round(s), ${found} finding(s)`);

  // The customer's own questions, told what the sections already covered.
  const questions = Array.isArray(hd[hdKey(kind, 'special_questions')]) ? hd[hdKey(kind, 'special_questions')] : [];
  const answers = [];
  if (questions.length) {
    const answerer = await specModel(clientId, system);
    const covered = renderLedger(items.map(it => ({ title: it.section.title, items: it.ledger })));
    for (const q of questions) {
      const questionText = (q.prompt && q.prompt.trim()) ? q.prompt : (q.question || '');
      if (!questionText.trim()) continue;
      const entry = { question: q.question || questionText, prompt: q.prompt || '', answer: '' };
      try {
        const result = await withTimeout(
          answerer.generateContent(`${buildMarriageQuestionPrompt(questionText, cfg.questionInstructions)}\n\n${covered}`),
          CALL_TIMEOUT_MS, `question: ${entry.question}`);
        meter.add(result.response.usageMetadata);
        entry.answer = String(result.response.text() || '').trim();
        if (!entry.answer) entry.error = 'No answer returned. Regenerate this question.';
      } catch (e) { entry.error = `Could not answer: ${e.message}`; }
      answers.push(entry);
    }
  }

  const fresh = (await db.pgQuery('SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId])).rows[0];
  const base = parseJson(fresh && fresh.horoscope_data);
  const sectionsData = items.map(it => ({ label: it.section.title, content: it.content, ledger: it.ledger }));
  const updated = {
    ...base,
    [hdKey(kind, 'sections_data')]:   sectionsData,
    [hdKey(kind, 'special_answers')]: answers,
    [hdKey(kind, 'review')]:          buildReviewRecord(items, rounds, found, spec, reviewError, detail),
    [hdKey(kind, 'generated_at')]:    new Date().toISOString(),
  };
  delete updated[hdKey(kind, 'generating')];
  delete updated[hdKey(kind, 'error')];
  await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(updated), orderId]);
  await recordOrderGenCost(orderId, kind, meter, { sections: items.length, questions: answers.length, review_rounds: rounds, mode: 'spec' });

  if (cfg.waPrompt) {
    try { await generateWaMessage(kind, clientId, orderId, sectionsData, cfg.waPrompt); }
    catch (e) { console.error(`[${tag}] WhatsApp message failed (non-fatal):`, e.message); }
  }
  return sectionsData;
}

/**
 * Rewrite one section of a spec report from the saved report: the other
 * sections' ledgers go in, not their text. Updates the section's review entry.
 * @returns {Promise<string>} the new content
 */
async function regenerateSpecSection({ kind, clientId, orderId, label, hd, cf, cfg }) {
  const { spec } = cfg;
  const section = spec.sections.find(s => s.title === label);
  if (!section) { const e = new Error(`Section "${label}" not found in the spec.`); e.statusCode = 404; throw e; }
  const dataKey = hdKey(kind, 'sections_data');
  const existing = Array.isArray(hd[dataKey]) ? hd[dataKey] : [];

  const system = specSystemInstruction({ systemPrompt: cfg.systemPrompt, spec, cf, chartData: hd.chart_data });
  const writer = await specModel(clientId, system, { schema: SECTION_SCHEMA });
  const meter = makeMeter();
  const ledger = existing.filter(s => s.label !== label).map(s => ({ title: s.label, items: cleanLedger(s.ledger) }));
  const w = await writeSpecSection({ model: writer, section, ledger, fixedInstructions: cfg.fixedInstructions, meter });
  await recordOrderGenCost(orderId, 'section', meter, { report: kind, section: label, mode: 'spec' });

  const idx = existing.findIndex(s => s.label === label);
  const next = idx >= 0
    ? existing.map((s, i) => (i === idx ? { ...s, content: w.content, ledger: w.ledger } : s))
    : [...existing, { label, content: w.content, ledger: w.ledger }];

  const review = { ...(hd[hdKey(kind, 'review')] || {}) };
  const ordered = spec.sections.map(s => ({ section: s, content: (next.find(n => n.label === s.title) || {}).content || '' }));
  const own = codeChecks(ordered, spec.globalRules).get(ordered.findIndex(o => o.section.title === label)) || [];
  review.sections = { ...(review.sections || {}), [label]: { words: wordCount(w.content), target: section.targetWords || null, min: section.minWords || null, max: section.maxWords || null, issues: own } };
  await db.pgQuery(
    `UPDATE orders SET horoscope_data = jsonb_set(jsonb_set(COALESCE(horoscope_data,'{}'::jsonb), ARRAY[$1]::text[], $2::jsonb), ARRAY[$3]::text[], $4::jsonb) WHERE order_id=$5`,
    [dataKey, JSON.stringify(next), hdKey(kind, 'review'), JSON.stringify(review), orderId]
  );
  return w.content;
}

/**
 * Keep <kind>_sections in step with a spec being saved, without losing the plain
 * list it replaces. The first time a spec is saved the existing list is set aside
 * as <kind>_sections_before_spec; clearing the spec puts it back.
 *
 * @param {string} kind
 * @param {object} existing  the stored config before this save
 * @param {object} update    the config being written (mutated)
 * @param {string} specText  the spec field from the request
 * @returns {string|null} the reason a spec was refused, or null
 */
function syncSectionsWithSpec(kind, existing, update, specText) {
  const sectionsKey = hdKey(kind, 'sections');
  const backupKey = hdKey(kind, 'sections_before_spec');
  const hadSpec = !!String(existing[hdKey(kind, 'spec')] || '').trim();
  let spec;
  try { spec = require('./sectionSpec').parseSpec(specText); } catch (e) { return e.message; }

  if (spec) {
    if (!hadSpec && Array.isArray(existing[sectionsKey]) && existing[sectionsKey].length) update[backupKey] = existing[sectionsKey];
    update[sectionsKey] = specToSections(spec);
  } else if (hadSpec && Array.isArray(existing[backupKey])) {
    update[sectionsKey] = existing[backupKey];
    delete update[backupKey];
  }
  return null;
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
  regenerateSpecSection, reviewAndFix, generateSpecReading, syncSectionsWithSpec,
};
