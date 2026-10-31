'use strict';

/**
 * @module services/sectionSpec
 * @description Structured section specs for section reports, and the pure helpers
 * that go with them: parsing, the prompts built from a spec, and the checks that
 * need no AI.
 *
 * A spec is one JSON object a client pastes into Plugins:
 *   { reportTitle, globalRules: {...}, sections: [{ order, sectionKey, title,
 *     targetWords, maxWords, allowedTopics[], excludedTopics[], astrologicalFocus[],
 *     requiredCustomerContext[], outputRequirements[] }] }
 *
 * With a spec, a report is written by independent section calls that share a
 * short ledger of what earlier sections concluded (not their full text), then
 * reviewed once as a whole and only the flagged sections are rewritten. Without
 * one, a kind keeps the older shared-chat behaviour.
 */

const LIST_FIELDS = ['allowedTopics', 'excludedTopics', 'astrologicalFocus', 'requiredCustomerContext', 'outputRequirements'];

const strList = (v) => (Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean) : []);

/**
 * Parse and normalise a spec. Returns the spec, or null when the text is empty or
 * has no usable sections. Throws a plain Error with the reason when it is malformed,
 * so the Plugins page can say what is wrong.
 *
 * @param {string|object|null} raw
 * @returns {{reportTitle:string, globalRules:object, sections:object[]}|null}
 */
function parseSpec(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch (e) { throw new Error(`Spec is not valid JSON: ${e.message}`); }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Spec must be a JSON object');
  if (!Array.isArray(obj.sections) || obj.sections.length === 0) throw new Error('Spec has no sections');

  const sections = obj.sections.map((s, i) => {
    if (!s || !String(s.title || '').trim()) throw new Error(`Section ${i + 1} has no title`);
    const target = Number(s.targetWords) || 0;
    const max = Number(s.maxWords) || (target ? Math.round(target * 1.25) : 0);
    const out = {
      order: Number(s.order) || i + 1,
      sectionKey: String(s.sectionKey || `section_${i + 1}`),
      title: String(s.title).trim(),
      targetWords: target,
      maxWords: max,
      minWords: Number(s.minWords) || 0,
      // The written description of the section, in the client's own words. Optional.
      guide: String(s.guide || '').trim(),
    };
    for (const f of LIST_FIELDS) out[f] = strList(s[f]);
    return out;
  }).sort((a, b) => a.order - b.order);

  const titles = new Set();
  for (const s of sections) {
    if (titles.has(s.title)) throw new Error(`Two sections share the title "${s.title}"`);
    titles.add(s.title);
  }
  return {
    reportTitle: String(obj.reportTitle || '').trim(),
    globalRules: obj.globalRules && typeof obj.globalRules === 'object' ? obj.globalRules : {},
    sections,
  };
}

/** Same as parseSpec but returns null instead of throwing, for read paths. */
function tryParseSpec(raw) {
  try { return parseSpec(raw); } catch { return null; }
}

/**
 * The plain {label, guide} list a spec stands for, so the editor, the Word
 * document and anything else that knows only sections keep working.
 */
function specToSections(spec) {
  return spec.sections.map(s => ({
    label: s.title,
    // The client's own description wins; the structured fields are the fallback.
    guide: s.guide || [
      s.allowedTopics.length && `ඇතුළත් කළ යුතු: ${s.allowedTopics.join('; ')}`,
      s.excludedTopics.length && `නොලිය යුතු: ${s.excludedTopics.join('; ')}`,
      s.outputRequirements.length && `අවශ්‍යතා: ${s.outputRequirements.join('; ')}`,
    ].filter(Boolean).join('\n'),
  }));
}

/** Global rules as instructions. Unknown keys are ignored rather than guessed at. */
function renderGlobalRules(rules = {}) {
  const r = rules || {};
  const lines = [];
  if (r.language === 'si') lines.push('සම්පූර්ණ වාර්තාව ස්වභාවික සිංහලෙන් ලියන්න. ඉංග්‍රීසි වචන හෝ අකුරු භාවිත නොකරන්න.');
  if (r.addressCustomerAs) lines.push(`ජන්මියා ඇමතීමට "${r.addressCustomerAs}" යන වචනය පමණක් භාවිත කරන්න.`);
  if (r.answerFirst) lines.push('සෑම අංශයක්ම ආරම්භයේම ප්‍රධාන පිළිතුර ලබාදෙන්න.');
  if (r.avoidGenericContent) lines.push('ඕනෑම කෙනෙකුට ගැලපෙන සාමාන්‍ය ප්‍රකාශ නොලියන්න. මෙම කේන්දරයේ සාධක මත පමණක් පදනම් වන්න.');
  if (r.avoidRepetition) lines.push('පෙර අංශවල සාරාංශයේ ඇති කරුණු, කාල සහ නිගමන නැවත විස්තර නොකරන්න.');
  if (r.maxAstrologicalFactorsPerSection) lines.push(`එක් අංශයක ප්‍රධාන ග්‍රහ සාධක ${r.maxAstrologicalFactorsPerSection}කට වඩා විස්තර නොකරන්න.`);
  if (r.defaultParagraphCount) lines.push(`අංශයේ වෙනත් උපදෙසක් නොමැති නම් ඡේද ${r.defaultParagraphCount}ක් ලියන්න.`);
  if (r.doNotInventPlanetaryPositions || r.doNotInventDashaDates || r.doNotInventPercentages) {
    lines.push('ලබාදී ඇති කේන්ද්‍ර දත්තවල නොමැති ග්‍රහ පිහිටීම්, දශා දින හෝ ප්‍රතිශත කිසිවිටෙක නිර්මාණය නොකරන්න. දත්තයක් නොමැති නම් එය නොමැති බව පවසන්න.');
  }
  if (r.doNotGuaranteeRealWorldOutcomes) lines.push('වීසා, රැකියා, පිටත්වීම වැනි සැබෑ ලෝකයේ ප්‍රතිඵල සහතික නොකරන්න.');
  if (r.outputOnlySectionContent) lines.push('ප්‍රතිචාරයේ content ක්ෂේත්‍රයේ අංශයේ අන්තර්ගතය පමණක් තබන්න. මාතෘකාව, හැඳින්වීම හෝ අවසාන සටහන් එක් නොකරන්න.');
  return lines;
}

const bulletList = (title, items) => (items.length ? `${title}:\n${items.map(i => `- ${i}`).join('\n')}\n` : '');

/** What earlier sections concluded, shortest useful form. */
function renderLedger(ledger) {
  const rows = (ledger || []).filter(e => e && e.items && e.items.length);
  if (!rows.length) return '';
  return 'පෙර අංශවල දැනටමත් සඳහන් කළ කරුණු (මේවා නැවත විස්තර නොකරන්න; අවශ්‍ය නම් වාක්‍ය කොටසකින් පමණක් සඳහන් කරන්න):\n'
    + rows.map(e => `- [${e.title}] ${e.items.join(' | ')}`).join('\n') + '\n';
}

/** The writer prompt for one section of a spec. */
function buildSpecSectionPrompt(section, { ledger, fixedInstructions, issues } = {}) {
  const max = section.maxWords || (section.targetWords ? Math.round(section.targetWords * 1.25) : 0);
  const words = section.minWords && max
    ? `වචන ප්‍රමාණය: වචන ${section.minWords} ත් ${max} ත් අතර. කෙටි නොවී, උපරිමය ඉක්මවා නොයන්න.\n`
    : section.targetWords
      ? `වචන ප්‍රමාණය: ආසන්න වශයෙන් ${section.targetWords}, උපරිම ${max}.\n`
      : '';
  return [
    `ඔබ දැන් ලිවිය යුත්තේ [${section.title}] යන අංශය පමණි. වෙනත් අංශ ගැන මෙහිදී විස්තර නොකරන්න.`,
    words,
    section.guide ? `මෙම අංශය සඳහා විස්තරය:\n${section.guide}\n` : '',
    bulletList('මෙම අංශයේ ඇතුළත් කළ හැකි මාතෘකා', section.allowedTopics),
    bulletList('මෙම අංශයේ කිසිවිටෙක නොලිය යුතු මාතෘකා (වෙනත් අංශවලට අයිතියි)', section.excludedTopics),
    bulletList('අවධානය යොමු කළ යුතු ජ්‍යෝතිෂ සාධක', section.astrologicalFocus),
    bulletList('අංශය ලිවීමට අවශ්‍ය පාරිභෝගික තොරතුරු (ඇණවුමේ තොරතුරුවල ඇත්නම් පමණක් භාවිත කරන්න)', section.requiredCustomerContext),
    bulletList('ප්‍රතිචාරයේ අවශ්‍යතා', section.outputRequirements),
    renderLedger(ledger),
    fixedInstructions ? `${fixedInstructions}\n` : '',
    issues && issues.length
      ? `මෙම අංශයේ වත්මන් අනුවාදයේ ඇති ගැටලු. මේවා විසඳා, හොඳ කොටස් එලෙසම තබා නැවත ලියන්න:\n${issues.map(i => `- ${i}`).join('\n')}\n`
      : '',
    'ප්‍රතිචාරය JSON ලෙස ලබාදෙන්න: "content" (අංශයේ සම්පූර්ණ පාඨය) සහ "ledger" (මෙම අංශයේ ඔබ සඳහන් කළ ප්‍රධාන නිගමන, කාල හෝ ග්‍රහ සාධක 2 සිට 4 දක්වා, සෑම එකක්ම වචන 15 ට අඩු කෙටි වාක්‍යයක්).',
  ].filter(Boolean).join('\n');
}

// ─── Checks that need no AI ──────────────────────────────────────────────────

/** Whitespace-separated words that contain a letter or digit. */
function wordCount(text) {
  return String(text || '').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Latin letters in running text. A fully Sinhala report should have none. */
function englishLetters(text) {
  const t = String(text || '').replace(/\*\*|###/g, '');
  const m = t.match(/[A-Za-z]{2,}/g);
  return m ? [...new Set(m)].slice(0, 6) : [];
}

function shingles(text, n = 6) {
  const w = String(text || '').split(/\s+/).filter(x => /[\p{L}\p{N}]/u.test(x));
  const out = new Set();
  for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(' '));
  return out;
}

/** How many 6-word runs two texts share. Real repetition shows here; a shared name does not. */
function sharedRuns(a, b) {
  const sa = shingles(a);
  let n = 0;
  for (const s of shingles(b)) if (sa.has(s)) n += 1;
  return n;
}

/**
 * Per-section findings from code alone.
 *
 * @param {{section:object, content:string}[]} items  in report order
 * @param {{language?:string}} rules
 * @returns {Map<number, string[]>} section index to plain-language issues
 */
function codeChecks(items, rules = {}) {
  const found = new Map();
  const add = (i, msg) => { found.set(i, [...(found.get(i) || []), msg]); };
  items.forEach(({ section, content }, i) => {
    const words = wordCount(content);
    // A few words either side of the range is counting noise, not a miss.
    const floor = section.minWords || (section.targetWords ? section.targetWords * 0.5 : 0);
    if (section.maxWords && words > section.maxWords * 1.05) add(i, `Too long: ${words} words, the limit is ${section.maxWords}. Cut it down without losing the main answer.`);
    if (floor && words < floor * 0.9) add(i, `Too short: ${words} words, it should be ${section.minWords ? `at least ${section.minWords}` : `about ${section.targetWords}`}. Develop the section further with new substance from the chart, not repeated points.`);
    if (rules.language === 'si') {
      const eng = englishLetters(content);
      if (eng.length) add(i, `Contains English text (${eng.join(', ')}). Write these in Sinhala.`);
    }
    for (let j = 0; j < i; j += 1) {
      const shared = sharedRuns(items[j].content, content);
      if (shared >= 3) add(i, `Repeats wording from the section "${items[j].section.title}" (${shared} shared passages). Say it differently or leave it to that section.`);
    }
  });
  return found;
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section_index: { type: 'integer' },
          type: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['section_index', 'type', 'note'],
      },
    },
  },
  required: ['issues'],
};

/** The reviewer prompt: the whole report against each section's own scope. */
function buildReviewPrompt(items, rules) {
  const body = items.map(({ section, content }, i) => (
    `### SECTION ${i}: ${section.title}\n`
    + `Must NOT cover (belongs to other sections): ${section.excludedTopics.join('; ') || 'n/a'}\n`
    + `Limit: ${section.maxWords || 'none'} words\n`
    + `TEXT:\n${content}\n`
  )).join('\n');
  return [
    'You are the editor of a Sinhala astrology report written by several writers who could not see each other\'s full text.',
    'Review the whole report below and list only REAL problems, each tied to one section_index (0-based):',
    '- repetition: the same fact, date, conclusion or idea appears in more than one section (report it on the LATER section);',
    '- contradiction: two sections give different years, periods or conclusions for the same thing (report it on the later one);',
    '- scope: a section substantially covers a topic listed in its "Must NOT cover";',
    '- rule: it guarantees a real-world outcome (visa, job, departure date), invents planetary data, or is not in Sinhala.',
    'Do NOT flag style, tone, or small overlaps that are needed to follow a section. If the report is fine, return an empty list.',
    'For each issue, "note" is one short instruction to the writer in English saying what to change.',
    rules && rules.language === 'si' ? 'The report must be entirely in Sinhala.' : '',
    '',
    body,
  ].filter(x => x !== undefined).join('\n');
}

module.exports = {
  parseSpec, tryParseSpec, specToSections, renderGlobalRules, renderLedger,
  buildSpecSectionPrompt, buildReviewPrompt, REVIEW_SCHEMA,
  wordCount, englishLetters, sharedRuns, codeChecks,
};
