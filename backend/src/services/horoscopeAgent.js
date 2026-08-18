/**
 * @module services/horoscopeAgent
 * @description Multi-agent "Generator ⇄ Critic" reflection loop for producing
 * long-form (30–40 page) horoscope / life-strategy reports with high quality.
 *
 * STANDALONE — this module is wired to nothing in the live pipeline. Integrate it
 * explicitly when ready (see runHoroscopeAgent docstring).
 *
 * Architecture (a LangGraph-style state machine, hand-rolled in Node):
 *
 *      ┌─────────────┐      ┌──────────┐      router
 *      │  GENERATOR  │ ───▶ │  CRITIC  │ ───▶ passed? ──▶ RENDER (done)
 *      │ (write/edit)│      │ (review) │           │
 *      └─────────────┘      └──────────┘           │ issues + under cap
 *            ▲                                       │
 *            └───────────────────────────────────────┘  (revise with feedback)
 *
 * - GENERATOR: first pass writes every section, using each section's `guide` as the
 *   plan to produce a deep, multi-page treatment. On later passes it EDITS only the
 *   sections the critic flagged (never a full rewrite).
 * - CRITIC: reviews the whole assembled report for redundancy, tone/flow and
 *   structural issues; emits a structured, actionable issue list.
 * - ROUTER: loops back to the generator with feedback, bounded by MAX_ITERATIONS.
 *
 * Profile: "balanced" — flash critic, up to 2 iterations (good quality, modest cost).
 */

'use strict';

const { getGenAI } = require('./clientKeys');

// ─── Tunables (balanced profile) ────────────────────────────────────────────────
/** Maximum critic⇄generator round-trips before we stop and render best-effort. */
const MAX_ITERATIONS = 2;
/** Model used for writing/editing sections (cheap, fast, output-capped). */
const WRITER_MODEL = 'gemini-2.5-flash';
/** Model used for reviewing. Balanced profile uses flash; bump to pro for max quality. */
const CRITIC_MODEL = 'gemini-2.5-flash';
/** Per-call transient-error retries (503 / overloaded / rate limit). */
const MAX_RETRIES = 3;
/** Soft ceiling on critic input size (chars). Above this we review in batches. */
const CRITIC_INPUT_CHAR_LIMIT = 600_000; // ≈150k tokens — well under Gemini's 1M

// ─── Low-level Gemini call with retry + size-aware error handling ───────────────
/**
 * Single-shot Gemini generation with retry on transient errors and explicit
 * handling of context-window / size failures.
 *
 * @param {Object}   opts
 * @param {string}   opts.model              - Model id
 * @param {string}   opts.systemInstruction  - System instruction
 * @param {string}   opts.prompt             - User prompt
 * @param {Object}   [opts.generationConfig] - Extra generation config
 * @param {Object}   [opts.responseSchema]   - JSON schema (enables JSON mode)
 * @returns {Promise<{text: string, usage: Object}>}
 */
async function callGemini({ clientId, model, systemInstruction, prompt, generationConfig = {}, responseSchema = null }) {
  const cfg = { temperature: 0.6, topP: 0.9, ...generationConfig };
  if (responseSchema) {
    cfg.responseMimeType = 'application/json';
    cfg.responseSchema = responseSchema;
  }
  const genAI = await getGenAI(clientId);
  const gm = genAI.getGenerativeModel({ model, systemInstruction, generationConfig: cfg });

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await gm.generateContent(prompt);
      return { text: result.response.text(), usage: result.response.usageMetadata || {} };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (/(token|context length|exceeds|too large|payload)/i.test(msg)) {
        // Not retryable by waiting — surface a typed error so callers can chunk.
        const e = new Error(`CONTEXT_TOO_LARGE: ${msg}`);
        e.code = 'CONTEXT_TOO_LARGE';
        throw e;
      }
      const transient = /(503|overloaded|unavailable|429|rate limit|deadline)/i.test(msg);
      if (attempt < MAX_RETRIES && transient) {
        await new Promise(r => setTimeout(r, 800 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ─── State ───────────────────────────────────────────────────────────────────
/**
 * @typedef {Object} SectionDef
 * @property {string} key   - Section title / identifier (also the sections-map key)
 * @property {string} guide - Per-section guidance; doubles as the depth/plan brief
 *
 * @typedef {Object} CritiqueIssue
 * @property {string} section     - Section key the issue belongs to
 * @property {('redundancy'|'tone'|'flow'|'structure')} type
 * @property {('high'|'medium'|'low')} severity
 * @property {string} instruction - Concrete, actionable fix for the generator
 * @property {string} [overlaps_with] - For redundancy: the other section it duplicates
 *
 * @typedef {Object} AgentState
 * @property {Object}  input         - { systemPrompt, chartDataJson, sectionDefs: SectionDef[] }
 * @property {Object<string,string>} sections - Section key → generated text
 * @property {CritiqueIssue[]} critique        - Open issues from the last critic pass
 * @property {number}  iteration     - Completed critic⇄generator round-trips
 * @property {number}  maxIterations
 * @property {('writing'|'reviewing'|'passed'|'capped'|'error')} status
 * @property {string[]} errors
 * @property {string[]} log
 * @property {string}  [report]      - Final assembled report
 */

/**
 * Build the initial workflow state.
 * @param {Object} input - { clientId, systemPrompt, chartDataJson, sectionDefs, maxIterations? }
 * @returns {AgentState}
 */
function createInitialState(input) {
  return {
    input,
    sections: {},
    critique: [],         // open issues being acted on (consumed each revision)
    critiqueHistory: [],   // [{ iteration, issues }] — full audit trail, never cleared
    iteration: 0,
    maxIterations: input.maxIterations || MAX_ITERATIONS,
    status: 'writing',
    errors: [],
    log: [],
  };
}

const baseSystemInstruction = (state) =>
  `${state.input.systemPrompt}\n\nමෙම කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n${state.input.chartDataJson}`;

/**
 * Fire an optional progress event (e.g. to persist live status for the UI).
 * Never throws — a progress-write failure must not break generation.
 * @param {AgentState} state
 * @param {Object} evt
 */
async function emit(state, evt) {
  if (typeof state.input.onEvent !== 'function') return;
  try { await state.input.onEvent(evt); } catch (_) { /* progress is best-effort */ }
}

/** Assemble the full report text (used by the critic + final render). */
function assembleReport(state) {
  return state.input.sectionDefs
    .map(({ key }) => `## ${key}\n\n${state.sections[key] || ''}`)
    .join('\n\n');
}

/**
 * Compact, serialisable audit of the run — persist this into horoscope_data
 * (e.g. `hd.agent_audit = buildAudit(result)`) so admins can see why it
 * iterated and what the critic fixed.
 * @param {AgentState} state
 * @returns {{status:string, iterations:number, totalIssues:number, critiqueHistory:Array, errors:string[], log:string[], finishedAt:string}}
 */
function buildAudit(state) {
  return {
    status: state.status,
    iterations: state.iteration,
    totalIssues: state.critiqueHistory.reduce((n, p) => n + p.issues.length, 0),
    critiqueHistory: state.critiqueHistory,
    errors: state.errors,
    log: state.log,
    finishedAt: new Date().toISOString(),
  };
}

// ─── Node: Generator ───────────────────────────────────────────────────────────
/**
 * GENERATOR node.
 *  - First pass (no critique): write every section, using its `guide` as the plan
 *    to produce a deep, multi-page treatment.
 *  - Revision pass: edit ONLY the sections the critic flagged, addressing each
 *    issue while preserving everything that was correct.
 *
 * @param {AgentState} state
 * @returns {Promise<AgentState>}
 */
async function generatorNode(state) {
  const sys = baseSystemInstruction(state);

  if (state.critique.length === 0) {
    // ── First draft: write each section independently (keeps every call small) ──
    state.log.push('[GEN] First-pass full draft');
    const total = state.input.sectionDefs.length;
    let idx = 0;
    for (const { key, guide } of state.input.sectionDefs) {
      idx += 1;
      await emit(state, { phase: 'writing', detail: key, index: idx, total });
      const prompt =
        `"${key}" යන කොටස සිංහලෙන් ලියන්න.\n\n` +
        (guide
          ? `── මෙම කොටසේ සැලැස්ම/මාර්ගෝපදේශය (මෙය අනුගමනය කර ගැඹුරින් ආවරණය කරන්න) ──\n${guide}\n\n`
          : '') +
        `ඉහත මාර්ගෝපදේශයේ සෑම අංගයක්ම ආවරණය වන පරිදි, පිටු කිහිපයක් දිගට විහිදෙන ගැඹුරු, ` +
        `මනා ව්‍යුහගත කොටසක් ලියන්න. ගැඹුරු, පෞද්ගලික, මානුෂීය හා විශ්වාසනීය ස්වරයකින් ලියන්න. ` +
        `වෙනත් කොටස් වල අන්තර්ගතය නැවත නොකියන්න.`;
      const { text } = await callGemini({
        clientId: state.input.clientId,
        model: WRITER_MODEL,
        systemInstruction: sys,
        prompt,
        generationConfig: { temperature: 0.5, maxOutputTokens: 8192 },
      });
      state.sections[key] = text.trim();
    }
    return state;
  }

  // ── Revision pass: group issues by section, edit each flagged section once ──
  const bySection = new Map();
  for (const issue of state.critique) {
    if (!bySection.has(issue.section)) bySection.set(issue.section, []);
    bySection.get(issue.section).push(issue);
  }
  state.log.push(`[GEN] Revising ${bySection.size} flagged section(s) (iter ${state.iteration})`);
  await emit(state, { phase: 'revising', detail: String(bySection.size), iteration: state.iteration });

  for (const [key, issues] of bySection) {
    const current = state.sections[key];
    if (current == null) continue; // critic referenced an unknown section — skip safely

    const feedback = issues
      .map((it, i) => `${i + 1}. [${it.type}/${it.severity}] ${it.instruction}`)
      .join('\n');

    // For redundancy, give the writer the overlapping section as read-only context
    // so it knows exactly what to trim without re-reading the whole report.
    const overlapContext = issues
      .filter(it => it.overlaps_with && state.sections[it.overlaps_with])
      .map(it => `── "${it.overlaps_with}" කොටසේ දැනටමත් ඇති අන්තර්ගතය ──\n${state.sections[it.overlaps_with]}`)
      .join('\n\n');

    const prompt =
      `පහත "${key}" කොටසේ පවතින පෙළ සංස්කරණය කරන්න. සම්පූර්ණයෙන් නැවත නොලියන්න — ` +
      `පහත සංස්කාරක ප්‍රතිපෝෂණයට අදාළ කොටස් පමණක් වෙනස් කරන්න, නිවැරදි අන්තර්ගතය ආරක්ෂා කරගන්න.\n\n` +
      `── වර්තමාන පෙළ ──\n${current}\n\n` +
      (overlapContext ? `${overlapContext}\n\n` : '') +
      `── සංස්කාරක ප්‍රතිපෝෂණය ──\n${feedback}\n\n` +
      `සංශෝධිත සම්පූර්ණ කොටස ආපසු ලබා දෙන්න.`;

    const { text } = await callGemini({
      clientId: state.input.clientId,
      model: WRITER_MODEL,
      systemInstruction: sys,
      prompt,
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    });
    state.sections[key] = text.trim();
  }

  // Consume the critique — the next critic pass produces a fresh list.
  state.critique = [];
  return state;
}

// ─── Node: Critic ────────────────────────────────────────────────────────────
const CRITIC_SYSTEM = `You are a strict, senior editor reviewing a long Sinhala horoscope & life-strategy report.
Judge the report against three axes and report ONLY real, fixable problems:
1. redundancy  — the same prediction/advice/phrasing repeated across sections.
2. tone / flow — robotic, repetitive, or inconsistent voice; it must read natural, deeply human, comforting yet authoritative.
3. structure   — formatting/heading errors, broken or missing structure.
Be specific and conservative: if a section is good, do not invent issues. Each issue MUST name the section and give a concrete, actionable fix instruction (in Sinhala, matching the report's language). For redundancy, set "overlaps_with" to the other section involved.`;

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section:       { type: 'string' },
          type:          { type: 'string', enum: ['redundancy', 'tone', 'flow', 'structure'] },
          severity:      { type: 'string', enum: ['high', 'medium', 'low'] },
          instruction:   { type: 'string' },
          overlaps_with: { type: 'string' },
        },
        required: ['section', 'type', 'severity', 'instruction'],
      },
    },
  },
  required: ['passed', 'issues'],
};

/**
 * CRITIC node. Reviews the assembled report and returns structured issues.
 * Falls back to per-section batches if the report is too large for one call.
 *
 * @param {AgentState} state
 * @returns {Promise<AgentState>}
 */
async function criticNode(state) {
  state.status = 'reviewing';
  await emit(state, { phase: 'reviewing', iteration: state.iteration + 1 });
  const report = assembleReport(state);
  const sectionList = state.input.sectionDefs.map(s => s.key).join(', ');

  let issues;
  try {
    if (report.length > CRITIC_INPUT_CHAR_LIMIT) {
      state.log.push('[CRITIC] Report over size limit — batching');
      issues = await criticInBatches(state);
    } else {
      const { text } = await callGemini({
        clientId: state.input.clientId,
        model: CRITIC_MODEL,
        systemInstruction: CRITIC_SYSTEM,
        prompt:
          `Section keys (use these EXACT strings for "section"): ${sectionList}\n\n` +
          `── REPORT ──\n${report}\n\n` +
          `Return JSON: { "passed": boolean, "issues": [...] }. "passed" must be true ONLY if there are zero issues.`,
        generationConfig: { temperature: 0.2 },
        responseSchema: CRITIC_SCHEMA,
      });
      issues = JSON.parse(text).issues || [];
    }
  } catch (err) {
    if (err.code === 'CONTEXT_TOO_LARGE') {
      state.log.push('[CRITIC] Context too large — batching');
      issues = await criticInBatches(state);
    } else {
      // Critic failure must not kill the run — log and treat as "no blocking issues".
      state.errors.push(`[CRITIC] ${err.message}`);
      state.log.push('[CRITIC] errored — proceeding without new issues');
      issues = [];
    }
  }

  state.critique = Array.isArray(issues) ? issues : [];
  state.iteration += 1;
  // Record this pass in the audit trail BEFORE the next revision consumes state.critique.
  state.critiqueHistory.push({ iteration: state.iteration, issues: state.critique.slice() });
  state.log.push(`[CRITIC] iter ${state.iteration}: ${state.critique.length} issue(s)`);
  await emit(state, { phase: 'reviewed', iteration: state.iteration, issues: state.critique.length });
  return state;
}

/**
 * Size fallback: review sections in batches. Cross-section redundancy is best-effort
 * here (each batch sees only its own sections), but tone/structure are fully covered.
 * @param {AgentState} state
 * @returns {Promise<CritiqueIssue[]>}
 */
async function criticInBatches(state) {
  const defs = state.input.sectionDefs;
  const BATCH = 5;
  const all = [];
  for (let i = 0; i < defs.length; i += BATCH) {
    const slice = defs.slice(i, i + BATCH);
    const body = slice.map(({ key }) => `## ${key}\n\n${state.sections[key] || ''}`).join('\n\n');
    const keys = slice.map(s => s.key).join(', ');
    const { text } = await callGemini({
      clientId: state.input.clientId,
      model: CRITIC_MODEL,
      systemInstruction: CRITIC_SYSTEM,
      prompt:
        `Section keys (use EXACT strings): ${keys}\n\n── REPORT (partial) ──\n${body}\n\n` +
        `Return JSON: { "passed": boolean, "issues": [...] }.`,
      generationConfig: { temperature: 0.2 },
      responseSchema: CRITIC_SCHEMA,
    });
    all.push(...(JSON.parse(text).issues || []));
  }
  return all;
}

// ─── Conditional router ─────────────────────────────────────────────────────────
/**
 * Decide the next node after the critic.
 * @param {AgentState} state
 * @returns {'generate'|'render'}
 */
function route(state) {
  if (state.critique.length === 0) { state.status = 'passed'; return 'render'; }
  if (state.iteration >= state.maxIterations) { state.status = 'capped'; return 'render'; }
  return 'generate';
}

// ─── Compiled workflow ──────────────────────────────────────────────────────────
/**
 * Run the full reflection loop and return the finished state.
 *
 * Wire-in example (replacing the per-section loop in generateHoroscope):
 *   const { runHoroscopeAgent } = require('./horoscopeAgent');
 *   const result = await runHoroscopeAgent({
 *     systemPrompt,                       // existing per-client system prompt
 *     chartDataJson: JSON.stringify(chartData, null, 2),
 *     sectionDefs: activeSections.map(key => ({ key, guide: sectionGuidesOverride?.[key] || '' })),
 *   });
 *   // result.sections → feed straight into buildHoroscopeDoc({ sections, sectionOrder, ... })
 *   // hd.agent_audit = buildAudit(result)  → persist the critic's issue list for auditing.
 *
 * @param {Object} input - { clientId, systemPrompt, chartDataJson, sectionDefs, maxIterations? }
 * @returns {Promise<AgentState>}
 */
async function runHoroscopeAgent(input) {
  let state = createInitialState(input);
  try {
    state = await generatorNode(state);          // initial full draft
    // eslint-disable-next-line no-constant-condition
    while (true) {
      state = await criticNode(state);           // review
      if (route(state) === 'render') break;      // pass or hit the cap
      state = await generatorNode(state);         // targeted revision
    }
  } catch (err) {
    state.status = 'error';
    state.errors.push(`[FATAL] ${err.message}`);
    // Return whatever we have — partial sections still render.
  }
  state.report = assembleReport(state);
  await emit(state, {
    phase: 'done',
    status: state.status,
    iteration: state.iteration,
    totalIssues: state.critiqueHistory.reduce((n, p) => n + p.issues.length, 0),
  });
  console.log(`[HORO-AGENT] done status=${state.status} iter=${state.iteration} errors=${state.errors.length}`);
  state.log.forEach(l => console.log('  ' + l));
  return state;
}

module.exports = {
  runHoroscopeAgent,
  // exported for unit testing / advanced composition:
  createInitialState,
  generatorNode,
  criticNode,
  route,
  assembleReport,
  buildAudit,
  callGemini,
  MAX_ITERATIONS,
};
