/**
 * Deterministic unit test for the Generator⇄Critic reflection loop.
 * Mocks the Gemini layer so the orchestration (draft → critique → targeted
 * revision → re-critique → render) and the iteration-cap guardrail are verified
 * with ZERO API calls / cost.
 *
 *   node backend/test-horoscope-agent.js
 */
'use strict';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';

// Load the real gemini module (singleton genAI), then patch its model factory.
const gemini = require('./src/services/gemini');

const resp = (text) => ({ response: { text: () => text, usageMetadata: {} } });

/**
 * Install a fake genAI.getGenerativeModel that scripts critic responses.
 * Writer calls (no responseSchema) return incrementing stub text so we can
 * detect whether a section was actually revised.
 * @param {(criticCall:number)=>Array} criticScript
 */
function installFake(criticScript) {
  let writerCalls = 0;
  let criticCalls = 0;
  gemini.genAI.getGenerativeModel = (opts) => ({
    generateContent: async () => {
      const isCritic = !!opts.generationConfig?.responseSchema;
      if (isCritic) {
        criticCalls += 1;
        const issues = criticScript(criticCalls);
        return resp(JSON.stringify({ passed: issues.length === 0, issues }));
      }
      writerCalls += 1;
      return resp(`text#${writerCalls}`);
    },
  });
  return { stats: () => ({ get writerCalls() { return writerCalls; }, get criticCalls() { return criticCalls; } }) };
}

// Require AFTER gemini is loaded so the agent shares the patched singleton.
const { runHoroscopeAgent, buildAudit } = require('./src/services/horoscopeAgent');

const SECTION_DEFS = [
  { key: 'Personality', guide: 'g1' },
  { key: 'Career',      guide: 'g2' },
  { key: 'Health',      guide: 'g3' },
];
const baseInput = () => ({ systemPrompt: 'sys', chartDataJson: '{}', sectionDefs: SECTION_DEFS, maxIterations: 2 });

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { failures += 1; console.log(`  ✗ ${name} ${detail}`); }
}

(async () => {
  // ── Scenario A: converges (1 issue, then clean) ──────────────────────────────
  console.log('\nScenario A — converges after one revision:');
  installFake((call) =>
    call === 1
      ? [{ section: 'Career', type: 'redundancy', severity: 'high', instruction: 'trim', overlaps_with: 'Personality' }]
      : []
  );
  let r = await runHoroscopeAgent(baseInput());
  const careerDraft = 'text#2'; // Career is the 2nd section written on first pass
  check('status passed', r.status === 'passed', `(got ${r.status})`);
  check('iteration === 2', r.iteration === 2, `(got ${r.iteration})`);
  check('Career was revised (text changed)', r.sections.Career !== careerDraft, `(got ${r.sections.Career})`);
  check('untouched section unchanged', r.sections.Personality === 'text#1', `(got ${r.sections.Personality})`);
  check('critiqueHistory has 2 passes', r.critiqueHistory.length === 2, `(got ${r.critiqueHistory.length})`);
  check('audit totalIssues === 1', buildAudit(r).totalIssues === 1, `(got ${buildAudit(r).totalIssues})`);
  check('final critique consumed (empty)', r.critique.length === 0);

  // ── Scenario B: never converges → hits the iteration cap ─────────────────────
  console.log('\nScenario B — hits the iteration cap:');
  installFake(() => [{ section: 'Health', type: 'tone', severity: 'medium', instruction: 'warmer' }]);
  r = await runHoroscopeAgent(baseInput());
  check('status capped', r.status === 'capped', `(got ${r.status})`);
  check('iteration === maxIterations (2)', r.iteration === 2, `(got ${r.iteration})`);
  check('critiqueHistory has 2 passes', r.critiqueHistory.length === 2, `(got ${r.critiqueHistory.length})`);
  check('report assembled', typeof r.report === 'string' && r.report.includes('## Health'));

  // ── Scenario C: critic error is non-fatal ────────────────────────────────────
  console.log('\nScenario C — critic throws, run still completes:');
  installFake(() => { throw new Error('boom'); });
  r = await runHoroscopeAgent(baseInput());
  check('status passed (no issues recorded on error)', r.status === 'passed', `(got ${r.status})`);
  check('error logged', r.errors.some(e => /boom/.test(e)), `(errors=${JSON.stringify(r.errors)})`);

  console.log(`\n${failures === 0 ? 'ALL PASSED ✅' : failures + ' CHECK(S) FAILED ❌'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST CRASHED:', e); process.exit(1); });
