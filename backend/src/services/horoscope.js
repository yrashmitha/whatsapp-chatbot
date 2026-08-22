'use strict';

/**
 * @module services/horoscope
 * @description Full Vedic horoscope reading generation service.
 * Calls freeastroapi for chart data, then calls Gemini in a multi-turn
 * chat session for 10 sections, and generates a Word document.
 */

const axios  = require('axios');
const db     = require('../db');
const { getFreeAstroKey, getGeminiKey, getGenAI } = require('./clientKeys');
const { sendChecked, sendRequired } = require('./aiRetry');
const { DEFAULT_BRAND, footerText } = require('./branding');
const { extractPlanetDegreesSum, generateQuantumCode, generateQuantumReading, generateQuantumSections } = require('./quantumCode');
const { todayContextBlock } = require('./dateContext');
// Lazy-loaded on first use to avoid crashing the server on startup if the
// package isn't installed yet (e.g. stale Railway build cache).
let Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak, Footer, PageNumber, NumberFormat, ImageRun;
function ensureDocx() {
  if (!Document) {
    ({ Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak, Footer, PageNumber, NumberFormat, ImageRun } = require('docx'));
  }
}

// ─── Sinhala parsers (shared with AstroChartModal on the FE) ─────────────────

const SINHALA_MONTHS = {
  'ජනවාරි': 1, 'පෙබරවාරි': 2, 'මාර්තු': 3, 'අප්‍රේල්': 4,
  'මැයි': 5,   'ජූනි': 6,     'ජූලි': 7,   'අගෝස්තු': 8,
  'සැප්තැම්බර්': 9, 'ඔක්තෝබර්': 10, 'නොවැම්බර්': 11, 'දෙසැම්බර්': 12,
};

function parseSinhalaDate(raw) {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return { year: y, month: m, day: d };
  }
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 3) {
    const year  = parseInt(parts[0], 10);
    const month = SINHALA_MONTHS[parts[1]] || parseInt(parts[1], 10);
    const day   = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) return { year, month, day };
  }
  return null;
}

function parseSinhalaTime(raw) {
  if (!raw) return null;
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(':').map(Number);
    return { hour: h, minute: m };
  }
  const isPM = raw.includes('රාත්‍රී') || raw.includes('රාත්රී') ||
               raw.includes('දහවල්') ||
               (raw.includes('ප.ව') && !raw.includes('පෙ.ව')) ||
               raw.includes('සවස');
  const timePart = raw.replace(/[^\d.]/g, '').trim();
  const [h, m] = timePart.split('.').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  let hour = h;
  if (isPM && hour < 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;
  return { hour, minute: m };
}

// ─── 10 sections ─────────────────────────────────────────────────────────────






function buildSectionPrompt(sec, guidesOverride, fixedInstructions) {
  // Writing guides are the client's own; there is no built-in set to fall back on.
  const guides = (guidesOverride && typeof guidesOverride === 'object') ? guidesOverride : {};
  const guide = guides[sec] || '';
  const specificPromptText = guide
    ? `**මෙම අංශය සඳහා අනිවාර්යයෙන්ම ඇතුළත් කළ යුතු කරුණු:** ${guide}\n`
    : '';

  let limitText;
  if (sec.includes('සාරාංශය')) {
    limitText = 'වචන 400කට වඩා අඩු, ඉතා සංක්ෂිප්ත සාරාංශයක් ලබා දෙන්න. කිසිදු පිළියමක් මෙහි ඇතුළත් නොකරන්න.';
  } else if (sec.includes('දරු පල')) {
    limitText = (
      'ලග්න කේන්ද්‍රයේ සහ නවාංශකයේ 5 වැන්න සහ 5 අධිපතිගේ \'සැබෑ බලය\' සසඳා බලන්න. ' +
      'අනවශ්‍ය ලෙස \'ප්‍රමාද වීම්\' ගැන සඳහන් නොකර, ගුරුගේ දෘෂ්ටිය පවතී නම් එය ඉතා සුබ පලයක් ලෙස දක්වන්න. ' +
      'කිසිදු ශාන්තිකර්මයක් හෝ පිළියමක් මෙහි ඇතුළත් නොකරන්න.'
    );
  } else if (sec.includes('පොදු ශාස්ත්‍රීය සහ බෞද්ධ පිළියම්')) {
    limitText = (
      'මෙම කේන්ද්‍රයේ ඇති ප්‍රධානතම දුර්වලතා හෝ අපල හඳුනාගෙන, මුළු ජීවිතයටම බලපාන පරිදි සවිස්තරාත්මක ශාස්ත්‍රීය සහ බෞද්ධ පිළියම් ලබා දෙන්න. \n' +
      'අනිවාර්ය ආකෘතිය (Formatting): ' +
      '1. ග්‍රහයාගේ නම හෝ යෝගය අනිවාර්යයෙන්ම \'###\' සලකුණෙන් ආරම්භ කර ප්‍රධාන අනු-මාතෘකාවක් ලෙස දක්වන්න (උදා: ### ගුරු චණ්ඩාල යෝගය සමනය කිරීම සඳහා). අදාල ග්‍රහ පිහිටිම නිසා ජීවිතයට සිදු වන බලපෑම උදාහරන සහිතව විස්තර කරන්න.' +
      '2. එම මාතෘකාවට ඉදිරියෙන් කිසිදු විටෙක Bullet points (- හෝ *) නොයොදන්න. ' +
      '3. මාතෘකාව යටතේ ඇති පිළියම් (වර්ණය, මල්, දෛනික පුරුදු) පමණක් එක් පේළියකට එක බැගින් \'-\' සලකුණ යොදා Bullet points ලෙස ඉදිරිපත් කරන්න.' +
      'ශාස්ත්‍රීය පිළියම් සහ බෞද්ධ වත්පිළිවෙත් (Remedial Measures): අසුබ පල පවතින විට හෝ පවතින ශක්තීන් වර්ධනය කර ගැනීමට පිළියම් ලබා දීමේදී, පහත සඳහන් ව්‍යුහය අනුගමනය කරමින් ඉතාමත් සවිස්තරාත්මකව කරුණු දක්වන්න:\n' +
      'ග්‍රහයාට අදාළ විශේෂිත වතාවත්: අදාළ ග්‍රහයාගේ වර්ණය සහ බලපෑම අනුව (උදා: කුජ වෙනුවෙන් රතු මල්, ශනි වෙනුවෙන් නිල් මල්) බෝධි පූජා හෝ දේව වන්දනා නිර්දේශ කරන්න.\n' +
      'ශාස්ත්‍රීය සහ භෞතික හේතු දැක්වීම: පිළියම මඟින් පුද්ගලයාගේ ජීව විද්‍යාත්මක හෝ මානසික මට්ටමට සිදුවන බලපෑම පැහැදිලි කරන්න.\n' +
      'උදාහරණ: රවි 11 වැන්නේ සිටින බැවින් සූර්ය වන්දනාවේ යෙදීමෙන් සිරුරට ලැබෙන හිරු රැස් මඟින් අලස බව දුරු වී ක්‍රියාශීලී බව වර්ධනය වේ.\n' +
      'විශේෂිත පිරිත් සහ සූත්‍ර: මානසික ඒකාග්‍රතාවය සහ ග්‍රහ අපල සමනය සඳහා බෞද්ධ දර්ශනයට අනුකූල පිරිත් (උදා: අභිසම්භිධාන පිරිත, මෝර පිරිත) නිර්දේශ කරන්න.\n' +
      'දේව ආශිර්වාදය සහ මනෝවිද්‍යාත්මක ශක්තිය: බිය හෝ මැලි බව දුරු කර ගැනීමට ගැළපෙන දේව වන්දනා (උදා: කතරගම දෙවියන්, ගණ දෙවියන්) සහ ඒවා තුළින් ලැබෙන ආත්ම විශ්වාසය විස්තර කරන්න.\n' +
      'දෛනික ප්‍රායෝගික පුරුදු: ස්නානය කරන ජලයට කහ එකතු කිරීම වැනි සරල නමුත් ශාස්ත්‍රීය පදනමක් සහිත පවිත්‍රතා ක්‍රමවේද ඇතුළත් කරන්න.\n'
    );
  } else if (sec.includes('විශේෂ VIP')) {
    limitText = (
      'මෙම කේන්ද්‍රයේ දැනට පවතින ප්‍රබලම ග්‍රහ අපල (උදා: සෙනසුරු ඒරාෂ්ටකය, රාහු දශාව) හඳුනාගන්න. ' +
      'එම අපල දුරු කිරීම සඳහා ගායනා කළ හැකි (Rhythmic/Melodic) ස්තෝත්‍ර පද පේළි 8-16 කින් යුත් (මෙය ' +
      'mp3 එකක් ලෙස ලබා දෙනු ඇත.)\n' +
      'සුවිශේෂී \'ශාන්ති ස්තෝත්‍රයක්\' නිර්මාණය කරන්න.\n' +
      'පහත ආකෘතිය භාවිතා කරන්න:\n' +
      '1. ### විශේෂ ශාන්ති ස්තෝත්‍රය (පද මාලාව මෙහි දක්වන්න)\n' +
      '2. ### ස්තෝත්‍රයේ තේරුම (පේලියෙන් පේලිය අර්තය දක්වන්න)\n' +
      '4. ### භාවිතා කළ යුතු ආකාරය (දිනකට කී වතාවක්ද, වේලාව සහ වර්ණය දක්වන්න)\n' +
      '4. ස්තෝත්‍රය කියවන අතරතුර කළ යුතු \'විශේෂ මානසික ඒකායන භාවනාව\' කෙටියෙන් දක්වන්න.'
    );
  } else {
    limitText = 'වෘත්තීය මට්ටමේ, ගලාගෙන යන ශාස්ත්‍රීය විග්‍රහයක් ලබා දෙන්න.';
  }

  return (
    `ඔබ දැන් විශ්ලේෂණය කළ යුත්තේ කේන්ද්‍රයේ [${sec}] යන අංශය පිළිබඳව පමනයි, මෙම විස්තර කිරීමෙදී වෙනත් කිසිදු අංශයක් ගැන විස්තර දමන්න එපා (උදා:- විවාහය ගැන කියද්දී දරු පල කියන්න් එපා ). ${limitText}\n\n` +
    `${specificPromptText}\n` +
    (fixedInstructions || '')
  );
}

function buildSpecialQuestionPrompt(question, systemPrompt, birthDataJson) {
  return (
    `${systemPrompt}\n\n` +
    `${birthDataJson}\n\n` +
    `මෙම විශේෂ ප්‍රශ්නයට සෘජු පිළිතුරක් අවශ්‍යයි: '${question}'\n\n` +
    'උපදෙස් (අනිවාර්යයෙන්ම පිළිපදින්න):\n' +
    '1. අතිශය වැදගත් (Strict Rule): පාරිභෝගිකයා අසා ඇති ගැටලුවට පමණක් සෘජුවම පිළිතුරු දෙන්න. ගැටලුවට අදාළ නැති අනෙකුත් ග්‍රහයන්, රාශි (1 සිට 12 දක්වා), පෞරුෂය, විවාහය හෝ දරු පල ආදිය කිසිසේත් විස්තර නොකරන්න.\n' +
    '2. ගැටලුවට අදාළ වන ග්‍රහ පිහිටීම් පමණක් යොදාගෙන කෙලින්ම පිළිතුර ගොඩනඟන්න (උදා: විදෙස් ගමන් ගැන ඇසුවොත් 9, 12 භාව සහ රාහු පමණක් විස්තර කිරීම).\n' +
    `3. වර්තමාන කාලය ${new Date().getFullYear()} ලෙස සලකා, ඊට අදාළ දශා කාලයන් පමණක් දක්වමින් ප්‍රශ්නයට අදාළ සාර්ථකම කාලය පවසන්න.\n` +
    '4. කතා කරන භාෂාවෙන් (Conversational tone), කෙටි සහ පැහැදිලි ඡේද ලෙස ලියන්න. කිසිදු විටෙක වාක්‍ය අගට \'නේද?\' යන්න නොයොදන්න.\n' +
    '5. සෑම ප්‍රධාන උප-මාතෘකාවක්ම \'###\' සලකුණෙන් ආරම්භ කරන්න. \n' +
    '6. Sinhala only, 300-500 words.\n' + 
    '7. අදාල ගැටලුව සදහා බලපාන ග්‍රහ පිහිටීම දක්වා ඒ සදහා පිලියම් කිරීමට උනන්දු කරවන්න. පිලියම් ලබා දෙන්න එපා. ඒවා මීට පෙරදී ලබා දී ඇත.'
  );
}

// ─── Word document builder ────────────────────────────────────────────────────

/**
 * Cover-page logo paragraph, or nothing when the client has not set one.
 *
 * @param {Object} brand
 * @returns {Array} Zero or one Paragraph
 */
function logoParagraphs(brand) {
  if (!brand.logo) return [];
  return [new Paragraph({
    children: [new ImageRun({
      data: brand.logo.buffer,
      type: brand.logo.type,
      transformation: { width: brand.logo.width, height: brand.logo.height },
    })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  })];
}

/**
 * Substitute a {year} token with the current year.
 *
 * Report headings used to hardcode the year, which silently went stale every
 * January. Clients write "... ({year} onwards)" and it stays correct.
 *
 * @param {string} text
 * @returns {string}
 */
function renderYear(text) {
  return (text || '').replace(/\{year\}/g, String(new Date().getFullYear()));
}

function parseContentToRuns(line, font) {
  // Parse **bold** markers into TextRun array
  const runs = [];
  const marker = '**';
  if (!line.includes(marker) && !line.includes('*')) {
    runs.push(new TextRun({ text: line, size: 24, font }));
    return runs;
  }
  // Normalise: replace ** with single *
  const normalised = line.replace(/\*\*/g, '*');
  const parts = normalised.split('*');
  parts.forEach((part, i) => {
    if (part) runs.push(new TextRun({ text: part, bold: i % 2 !== 0, size: 24, font }));
  });
  return runs;
}

function contentToParagraphs(content, font) {
  const paragraphs = [];
  if (!content) return paragraphs;

  const blocks = content.replace(/\n\n/g, '[[PARA]]').split('[[PARA]]');

  for (const block of blocks) {
    const lines = block.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('###')) {
        // Sub-heading
        const text = line.replace(/^###\s*/, '').replace(/\*/g, '').trim();
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text, bold: true, size: 32, font })],
          alignment: AlignmentType.LEFT,
          spacing: { before: 240, after: 120 },
        }));
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        // Bullet point
        const text = line.slice(2).trim();
        paragraphs.push(new Paragraph({
          children: parseContentToRuns(text, font),
          bullet: { level: 0 },
          alignment: AlignmentType.LEFT,
          spacing: { after: 80 },
        }));
      } else if (/^\d+[.)]\s/.test(line)) {
        // Numbered list
        const text = line.replace(/^\d+[.)]\s*/, '');
        paragraphs.push(new Paragraph({
          children: parseContentToRuns(text, font),
          numbering: { reference: 'default-numbering', level: 0 },
          alignment: AlignmentType.LEFT,
          spacing: { after: 80 },
        }));
      } else {
        // Normal justified paragraph
        paragraphs.push(new Paragraph({
          children: parseContentToRuns(line, font),
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 160 },
        }));
      }
    }
  }
  return paragraphs;
}


/**
 * Publish how far a generation has got, so the CRM can show a percentage
 * instead of an indefinite spinner.
 *
 * Written after each step rather than only at the end, because the run takes
 * minutes and an agent watching a bare "Generating…" has no way to tell
 * progress from a stall. Best-effort: a failed progress write must never
 * abort the report itself.
 *
 * @param {string} orderId
 * @param {string} key     - horoscope_data key to write, e.g. 'progress'
 * @param {number} done    - Steps finished
 * @param {number} total   - Steps expected
 * @param {string} phase   - What is happening now, shown as a tooltip
 * @returns {Promise<void>}
 */
async function publishProgress(orderId, key, done, total, phase) {
  if (!total) return;
  try {
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), $1::text[], $2::jsonb, true) WHERE order_id=$3`,
      [
        [key],
        JSON.stringify({
          done,
          total,
          percent: Math.min(99, Math.round((done / total) * 100)),
          phase,
          at: new Date().toISOString(),
        }),
        orderId,
      ]
    );
  } catch (e) {
    console.warn(`[PROGRESS] ${orderId} ${key} write failed:`, e.message);
  }
}

async function buildHoroscopeDoc({ customerName, sections, specialAnswers, specialNote, birthDate, birthTime, sectionOrder, brand = DEFAULT_BRAND, remediesLabel = '', specialQuestionsTitle = '' }) {
  ensureDocx();
  const children = [];

  // ── Cover page ──────────────────────────────────────────────────────────────
  const _spacers = brand.logo ? 3 : 5;
  for (let i = 0; i < _spacers; i++) children.push(new Paragraph({ children: [], spacing: { after: 400 } }));
  children.push(...logoParagraphs(brand));
  if (brand.divider) children.push(new Paragraph({
    children: [new TextRun({ text: brand.divider, size: 26, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 280 },
  }));
  if (brand.invocation) children.push(new Paragraph({
    children: [new TextRun({ text: brand.invocation, bold: true, size: 56, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 280 },
  }));
  if (brand.divider) children.push(new Paragraph({
    children: [new TextRun({ text: brand.divider, size: 26, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 640 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: customerName || '', bold: true, size: 72, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));
  if (birthDate || birthTime) {
    const dateTimeText = [birthDate, birthTime].filter(Boolean).join('  ·  ');
    children.push(new Paragraph({
      children: [new TextRun({ text: dateTimeText, size: 24, font: brand.font })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }));
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));
  // ── End cover ───────────────────────────────────────────────────────────────

  // Order keys by plugin config if provided; JSONB retrieval doesn't preserve insertion order
  const allKeys = Object.keys(sections || {});
  const currentSections = (() => {
    if (Array.isArray(sectionOrder) && sectionOrder.length > 0) {
      const configLabels = sectionOrder.map(s => s.label || s);
      const keySet = new Set(allKeys);
      const sorted = configLabels.filter(l => keySet.has(l));
      const inConfig = new Set(configLabels);
      allKeys.filter(k => !inConfig.has(k)).forEach(k => sorted.push(k));
      return sorted;
    }
    return allKeys;
  })();

  // Which section starts the remedies half of the document. A structural
  // marker, not decoration: with no match the split is a no-op and every
  // section renders in one run.
  const splitIdx = remediesLabel ? currentSections.indexOf(remediesLabel) : -1;
  const beforeRemedies = splitIdx === -1 ? currentSections : currentSections.slice(0, splitIdx);
  const fromRemedies = splitIdx === -1 ? [] : currentSections.slice(splitIdx);

  // Render sections before remedies
  beforeRemedies.forEach((sec, idx) => {
    children.push(new Paragraph({
      children: [
        ...(idx > 0 ? [new PageBreak()] : []),
        new TextRun({ text: sec, bold: true, size: 36, font: brand.font }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    }));
    children.push(...contentToParagraphs(sections[sec] || '', brand.font));
  });

  // Special questions (before remedies section)
  if (specialAnswers && specialAnswers.length > 0) {
    children.push(new Paragraph({
      children: [new PageBreak(), new TextRun({ text: renderYear(specialQuestionsTitle), bold: true, size: 36, font: brand.font })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    }));

    specialAnswers.forEach((qa, i) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: `ගැටලුව ${i + 1}: ${qa.question}`, bold: true, size: 26, font: brand.font })],
        spacing: { before: 400, after: 160 },
      }));
      children.push(...contentToParagraphs(qa.answer || '', brand.font));
      children.push(new Paragraph({
        children: [new TextRun({ text: '─'.repeat(40), size: 20, font: brand.font })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 160 },
      }));
    });
  }

  // Render remedies section and any sections after it
  fromRemedies.forEach((sec) => {
    children.push(new Paragraph({
      children: [new PageBreak(), new TextRun({ text: sec, bold: true, size: 36, font: brand.font })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    }));
    children.push(...contentToParagraphs(sections[sec] || '', brand.font));
  });

  // Special note page
  if (specialNote && specialNote.trim()) {
    const noteLines = specialNote.split('\n');
    let firstLine = true;
    for (const noteLine of noteLines) {
      const trimmed = noteLine.trim();
      if (!trimmed) { children.push(new Paragraph({ children: [] })); continue; }
      const isHeading = trimmed.includes('විශේෂ ශාස්ත්‍රීය සටහන');
      children.push(new Paragraph({
        children: [
          ...(firstLine ? [new PageBreak()] : []),
          new TextRun({ text: trimmed, bold: isHeading, size: isHeading ? 36 : 24, font: brand.font }),
        ],
        alignment: isHeading ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
        spacing: { after: 160 },
      }));
      firstLine = false;
    }
  }

  // Signature
  children.push(new Paragraph({
    children: [new TextRun({ text: 'මෙයට,', bold: true, size: 24, font: brand.font })],
    alignment: AlignmentType.RIGHT,
    spacing: { before: 600 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: brand.signature, bold: true, size: 24, font: brand.font })],
    alignment: AlignmentType.RIGHT,
  }));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: brand.font, size: 24 },
          paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 360, lineRule: 'auto' } },
        },
      },
    },
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
    sections: [{
      properties: {
        page: {
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: footerText(brand), size: 20, font: brand.font }),
              new TextRun({ children: [PageNumber.CURRENT], size: 20, font: brand.font }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children,
    }],
  });

  return await Packer.toBuffer(doc);
}

// ─── Generic section-based document builder ───────────────────────────────────

/**
 * Build a Word document from an ordered list of {label, content} sections.
 * Used by any reading that is "cover page + N titled sections" (e.g. marriage, matchmaking).
 *
 * Optional params (omit for the original single-person layout):
 *   subtitleLines  — replaces the `birthDate · birthTime` cover line, for reports about
 *                    more than one person (matchmaking prints both partners here).
 *   specialAnswers — [{question, answer}] rendered as a Q&A block after the sections.
 */
async function buildSectionsDoc({
  customerName, reportTitle, sections, specialNote, birthDate, birthTime,
  subtitleLines = null,
  specialAnswers = null,
  specialQuestionsTitle = 'විශේෂ උපදේශනය සහ විසඳුම් සේවාව',
  // Optional non-text blocks (currently birth-chart tables) appended after the
  // written sections. Each entry is { heading, table }, where `table` is a
  // docx Table instance. Defaults to null so every existing caller is
  // unaffected.
  extraBlocks = null,
  brand = DEFAULT_BRAND,
}) {
  ensureDocx();
  const children = [];

  const _spacers = brand.logo ? 3 : 5;
  for (let i = 0; i < _spacers; i++) children.push(new Paragraph({ children: [], spacing: { after: 400 } }));
  children.push(...logoParagraphs(brand));
  if (brand.divider) children.push(new Paragraph({
    children: [new TextRun({ text: brand.divider, size: 26, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 280 },
  }));
  if (brand.invocation) children.push(new Paragraph({
    children: [new TextRun({ text: brand.invocation, bold: true, size: 56, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));
  if (reportTitle) {
    children.push(new Paragraph({
      children: [new TextRun({ text: reportTitle, bold: true, size: 40, font: brand.font })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }));
  }
  if (brand.divider) children.push(new Paragraph({
    children: [new TextRun({ text: brand.divider, size: 26, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 640 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: customerName || '', bold: true, size: 72, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));
  if (Array.isArray(subtitleLines) && subtitleLines.length > 0) {
    subtitleLines.filter(Boolean).forEach((line) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: line, size: 28, font: brand.font })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      }));
    });
  } else if (birthDate || birthTime) {
    children.push(new Paragraph({
      children: [new TextRun({ text: [birthDate, birthTime].filter(Boolean).join('  ·  '), size: 24, font: brand.font })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }));
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));

  (sections || []).forEach((sec, idx) => {
    if (!sec || !sec.content) return;
    children.push(new Paragraph({
      children: [
        ...(idx > 0 ? [new PageBreak()] : []),
        new TextRun({ text: sec.label || '', bold: true, size: 36, font: brand.font }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    }));
    children.push(...contentToParagraphs(sec.content, brand.font));
  });

  // Non-text blocks (birth-chart tables), each starting a fresh page so a
  // chart is never split across a page boundary.
  if (Array.isArray(extraBlocks) && extraBlocks.length > 0) {
    for (const block of extraBlocks) {
      if (!block || !block.table) continue;
      children.push(new Paragraph({
        children: [
          new PageBreak(),
          new TextRun({ text: block.heading || '', bold: true, size: 32, font: brand.font }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
      }));
      children.push(block.table);
      children.push(new Paragraph({ children: [], spacing: { after: 200 } }));
    }
  }

  // Custom questions the customer asked, answered individually (same layout the
  // horoscope document uses at buildHoroscopeDoc).
  if (Array.isArray(specialAnswers) && specialAnswers.length > 0) {
    children.push(new Paragraph({
      children: [new PageBreak(), new TextRun({ text: specialQuestionsTitle, bold: true, size: 36, font: brand.font })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    }));

    specialAnswers.forEach((qa, i) => {
      if (!qa || !qa.answer) return;
      children.push(new Paragraph({
        children: [new TextRun({ text: `ගැටලුව ${i + 1}: ${qa.question || ''}`, bold: true, size: 26, font: brand.font })],
        spacing: { before: 400, after: 160 },
      }));
      children.push(...contentToParagraphs(qa.answer, brand.font));
      children.push(new Paragraph({
        children: [new TextRun({ text: '─'.repeat(40), size: 20, font: brand.font })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 160 },
      }));
    });
  }

  if (specialNote && specialNote.trim()) {
    let firstLine = true;
    for (const rawLine of specialNote.split('\n')) {
      const trimmed = rawLine.trim();
      if (!trimmed) { children.push(new Paragraph({ children: [] })); continue; }
      children.push(new Paragraph({
        children: [
          ...(firstLine ? [new PageBreak()] : []),
          new TextRun({ text: trimmed, size: 24, font: brand.font }),
        ],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 160 },
      }));
      firstLine = false;
    }
  }

  children.push(new Paragraph({
    children: [new TextRun({ text: 'මෙයට,', bold: true, size: 24, font: brand.font })],
    alignment: AlignmentType.RIGHT,
    spacing: { before: 600 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: brand.signature, bold: true, size: 24, font: brand.font })],
    alignment: AlignmentType.RIGHT,
  }));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: brand.font, size: 24 },
          paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 360, lineRule: 'auto' } },
        },
      },
    },
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
    sections: [{
      properties: { page: { pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: footerText(brand), size: 20, font: brand.font }),
              new TextRun({ children: [PageNumber.CURRENT], size: 20, font: brand.font }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children,
    }],
  });

  return await Packer.toBuffer(doc);
}

// ─── Standalone Quantum / Aura document builder ──────────────────────────────

async function buildQuantumDoc({ customerName, quantumData, auraAnalysis, quantumReading, quantumSectionsData, brand = DEFAULT_BRAND, reportTitle = '' }) {
  ensureDocx();
  if (!quantumData || quantumData.status !== 'Success' || !auraAnalysis) {
    throw new Error('Quantum data or aura analysis not available');
  }
  const children = [];

  // ── Cover page ──────────────────────────────────────────────────────────────
  const _spacers = brand.logo ? 2 : 4;
  for (let i = 0; i < _spacers; i++) children.push(new Paragraph({ children: [], spacing: { after: 400 } }));
  children.push(...logoParagraphs(brand));
  if (brand.divider) children.push(new Paragraph({
    children: [new TextRun({ text: brand.divider, size: 26, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 280 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: reportTitle, bold: true, size: 56, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 280 },
  }));
  if (brand.divider) children.push(new Paragraph({
    children: [new TextRun({ text: brand.divider, size: 26, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 560 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: customerName || '', bold: true, size: 72, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 280 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: quantumData.quantum_id, bold: true, size: 64, font: brand.font })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
  }));
  children.push(new Paragraph({ children: [new PageBreak()] }));
  // ── End cover ───────────────────────────────────────────────────────────────

  // Aura subsection
  children.push(new Paragraph({
    children: [new TextRun({ text: 'ඕරා ශක්ති විශ්ලේෂණය  (Aura Frequency Analysis)', bold: true, size: 30, font: brand.font })],
    alignment: AlignmentType.LEFT,
    spacing: { after: 160 },
  }));

  const auraRows = [
    [`ශක්ති ලකුණු (Af Score)`,     `${auraAnalysis.af_score.toFixed(2)} / 1.0`],
    [`ශක්ති මට්ටම (Energy Level)`,    auraAnalysis.energy_level || '—'],
    [`ඕරා වර්ණය (Dominant Color)`,   auraAnalysis.dominant_color || '—'],
    [`ප්‍රධාන චක්‍රය (Primary Chakra)`, auraAnalysis.primary_chakra || '—'],
    [`ඕරා ස්ථාවරත්වය (Stability)`,    auraAnalysis.aura_stability || '—'],
  ];
  for (const [label, value] of auraRows) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${label}: `, bold: true, size: 24, font: brand.font }),
        new TextRun({ text: value, size: 24, font: brand.font }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
    }));
  }

  if (Array.isArray(auraAnalysis.detected_blockages) && auraAnalysis.detected_blockages.length) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'ශක්ති රටා (Detected Energy Patterns):', bold: true, size: 24, font: brand.font })],
      spacing: { before: 120, after: 60 },
    }));
    for (const b of auraAnalysis.detected_blockages) {
      children.push(new Paragraph({
        children: [new TextRun({ text: b, size: 24, font: brand.font })],
        bullet: { level: 0 },
        spacing: { after: 60 },
      }));
    }
  }

  const hints2 = Array.isArray(auraAnalysis.recommendation_hint) ? auraAnalysis.recommendation_hint : (auraAnalysis.recommendation_hint ? [auraAnalysis.recommendation_hint] : []);
  if (hints2.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'නිර්දේශය (Recommendation):', bold: true, size: 24, font: brand.font })],
      spacing: { before: 120, after: 60 },
    }));
    for (const h of hints2) {
      children.push(new Paragraph({
        children: [new TextRun({ text: h, size: 24, font: brand.font })],
        bullet: { level: 0 },
        spacing: { after: 60 },
      }));
    }
  }

  // Quantum metrics subsection
  children.push(new Paragraph({
    children: [new TextRun({ text: 'ක්වොන්ටම් ගණනය  (Quantum Resonance Metrics)', bold: true, size: 30, font: brand.font })],
    alignment: AlignmentType.LEFT,
    spacing: { before: 200, after: 160 },
  }));

  const qcRows = [
    ['Active Name (Ia ගණනය)',      quantumData.active_name || '—'],
    ['Base Frequency — Fb',         quantumData.base_frequency.toFixed(6)],
    ['Identity Vibration — Ia',     quantumData.identity_vibration.toFixed(6)],
    ['Quantum Core Score — QC',     quantumData.qc_score.toFixed(6)],
  ];
  for (const [label, value] of qcRows) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${label}: `, bold: true, size: 24, font: brand.font }),
        new TextRun({ text: value, size: 24, font: brand.font }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
    }));
  }

  // Quantum sections (configurable multi-section output) — preferred over single reading
  if (Array.isArray(quantumSectionsData) && quantumSectionsData.length > 0) {
    for (let i = 0; i < quantumSectionsData.length; i++) {
      const { label, content } = quantumSectionsData[i];
      if (!content) continue;
      children.push(new Paragraph({
        children: [
          ...(i > 0 ? [new PageBreak()] : []),
          new TextRun({ text: label, bold: true, size: 32, font: brand.font }),
        ],
        alignment: AlignmentType.LEFT,
        spacing: { before: i === 0 ? 320 : 0, after: 200 },
      }));
      children.push(...contentToParagraphs(content, brand.font));
    }
  } else if (quantumReading) {
    // Fallback: legacy single-block reading
    children.push(new Paragraph({
      children: [new TextRun({ text: 'ක්වොන්ටම් ජීවන වාර්තාව  (Quantum Life Architect Reading)', bold: true, size: 30, font: brand.font })],
      alignment: AlignmentType.LEFT,
      spacing: { before: 320, after: 200 },
    }));
    children.push(...contentToParagraphs(quantumReading, brand.font));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: brand.font, size: 24 },
          paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 360, lineRule: 'auto' } },
        },
      },
    },
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
    sections: [{
      properties: {
        page: { pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: footerText(brand), size: 20, font: brand.font }),
              new TextRun({ children: [PageNumber.CURRENT], size: 20, font: brand.font }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children,
    }],
  });

  return await Packer.toBuffer(doc);
}

// ─── Main generation function ─────────────────────────────────────────────────

async function generateHoroscope(clientId, orderId, birthOverrides, lat, lng, birth_place_name, overrideAstro, specialQuestions = [], isVip = false, includeQuantum = false, activeName = '', selectedSections = null, useAgent = false) {
  // 1. Fetch order
  const orderRes = await db.pgQuery(
    'SELECT custom_fields, horoscope_data FROM orders WHERE order_id=$1',
    [orderId]
  );
  if (!orderRes.rows.length) throw new Error('Order not found');
  const row = orderRes.rows[0];

  const existingCf = (typeof row.custom_fields === 'string')
    ? JSON.parse(row.custom_fields || '{}')
    : (row.custom_fields || {});

  const existingHd = (typeof row.horoscope_data === 'string')
    ? JSON.parse(row.horoscope_data || '{}')
    : (row.horoscope_data || {});

  // Merge: overrides (from modal edits) take precedence
  const effectiveFields = { ...existingCf, ...(birthOverrides || {}) };

  // 2. Parse birth date/time
  const dateInfo = parseSinhalaDate(effectiveFields.birth_date || '');
  const timeInfo = parseSinhalaTime(effectiveFields.birth_time || '');

  if (!dateInfo) throw new Error(`Cannot parse birth_date: "${effectiveFields.birth_date}"`);
  if (!timeInfo) throw new Error(`Cannot parse birth_time: "${effectiveFields.birth_time}"`);

  const { year, month, day } = dateInfo;
  const { hour, minute } = timeInfo;

  // 2.5 Fast path: if sections already exist and quantum is the only new thing,
  //     skip all Gemini calls and just compute / update the QC block.
  const hasExistingSections = !!(existingHd.sections && Object.keys(existingHd.sections).length > 0);
  if (includeQuantum && hasExistingSections && !overrideAstro) {
    console.log('[HOROSCOPE] Fast path: sections exist — computing QC only for', orderId);
    if (!existingHd.aura_analysis) throw new Error('Aura analysis not found. Please upload a photo for aura analysis first.');
    if (!existingHd.chart_data)    throw new Error('No chart data found in existing horoscope. Cannot compute Quantum Code.');

    const fastPlanetSum = extractPlanetDegreesSum(existingHd.chart_data);
    if (fastPlanetSum === null)    throw new Error('Cannot extract planet degrees from saved chart data.');

    const fastBirthMin = hour * 60 + minute;
    if (fastBirthMin === 0)        throw new Error('Birth time resolves to midnight (0 minutes) — cannot compute Base Frequency.');

    const fastQR = generateQuantumCode({
      full_name:           activeName,
      lat:                 parseFloat(lat),
      long:                parseFloat(lng),
      planet_degrees_sum:  fastPlanetSum,
      birth_time_min:      fastBirthMin,
      aura_score:          existingHd.aura_analysis.af_score,
    });
    if (fastQR.status === 'Error') throw new Error(`Quantum Code generation failed: ${fastQR.message}`);

    const fastConfig = await db.getPluginConfig(clientId, 'horoscope_reading');
    const fastHasConfigSections = Array.isArray(fastConfig.quantum_sections) && fastConfig.quantum_sections.length > 0;

    let fastReading = null;
    let fastSectionsData = null;
    if (fastHasConfigSections) {
      fastSectionsData = await generateQuantumSections(
        fastQR, existingHd.aura_analysis,
        fastConfig.quantum_sections, await getGeminiKey(clientId),
        fastConfig.quantum_system_prompt || '',
        existingHd.chart_data?.vimshottari_dasha || null
      );
    } else {
      fastReading = await generateQuantumReading(fastQR, existingHd.aura_analysis, await getGeminiKey(clientId), fastConfig.quantum_system_prompt || '');
    }

    const fastUpdated = {
      ...existingHd,
      quantum_data:    fastQR,
      quantum_id:      fastQR.quantum_id,
      ...(fastReading      && { quantum_reading: fastReading }),
      ...(fastSectionsData && { quantum_sections_data: fastSectionsData }),
    };
    delete fastUpdated.generating;
    await db.pgQuery(
      'UPDATE orders SET horoscope_data=$1 WHERE order_id=$2',
      [JSON.stringify(fastUpdated), orderId]
    );
    console.log('[HOROSCOPE] Fast path: QC + reading saved for', orderId, fastQR.quantum_id);
    return fastUpdated;
  }

  // 3. Get plugin config
  const config = await db.getPluginConfig(clientId, 'horoscope_reading');
  const apiKey              = await getFreeAstroKey(clientId);
  const systemPrompt        = config.system_prompt || '';
  const fixedInstructions   = config.fixed_instructions || '';
  const specialNote         = config.special_note || '';
  if (!systemPrompt.trim()) {
    const err = new Error('No horoscope system prompt configured for this client. Set it in Plugins > Horoscope Reading before generating.');
    err.statusCode = 422;
    throw err;
  }
  const quantumSystemPrompt = config.quantum_system_prompt || '';

  console.log('[HOROSCOPE] config.quantum_system_prompt:', quantumSystemPrompt ? `(${quantumSystemPrompt.length} chars) "${quantumSystemPrompt.slice(0, 120)}${quantumSystemPrompt.length > 120 ? '...' : ''}"` : '(empty — will use built-in default)');

  // 4. Astro chart — reuse or fetch
  let chartData;
  if (existingHd.chart_data && !overrideAstro) {
    chartData = existingHd.chart_data;
    console.log('[HOROSCOPE] Reusing saved chart_data for', orderId);
  } else {
    console.log('[HOROSCOPE] Fetching chart (cached) for', orderId);
    const { calculateVedicChart } = require('./vedicChart');
    const { data: fetched, cached } = await calculateVedicChart(
      { year, month, day, hour, minute, lat: parseFloat(lat), lng: parseFloat(lng) },
      apiKey
    );
    chartData = fetched;
    console.log(`[HOROSCOPE] Chart ${cached ? 'served from cache' : 'fetched from freeastroapi'} for`, orderId);
    // Save chart immediately so it's available even if Gemini fails
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{chart_data}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(chartData), orderId]
    );
    console.log('[HOROSCOPE] Chart data saved for', orderId);
  }

  // 4.5. Quantum Code computation (full path — runs before Gemini so a QC
  //      failure hard-fails the job before burning expensive API calls).
  let quantumResult = null;
  if (includeQuantum) {
    const savedAura = existingHd.aura_analysis;
    if (!savedAura) throw new Error('Aura analysis not found. Please upload a photo for aura analysis before generating.');

    const planetSum = extractPlanetDegreesSum(chartData);
    if (planetSum === null) throw new Error('Cannot extract planet degrees from chart data. Quantum Code cannot be computed.');

    const birthTimeMin = hour * 60 + minute;
    if (birthTimeMin === 0) throw new Error('Birth time resolves to midnight (0 minutes) — cannot compute Base Frequency.');

    quantumResult = generateQuantumCode({
      full_name:          activeName,
      lat:                parseFloat(lat),
      long:               parseFloat(lng),
      planet_degrees_sum: planetSum,
      birth_time_min:     birthTimeMin,
      aura_score:         savedAura.af_score,
    });
    if (quantumResult.status === 'Error') throw new Error(`Quantum Code generation failed: ${quantumResult.message}`);
    console.log('[HOROSCOPE] Quantum Code computed:', quantumResult.quantum_id);
    // Quantum Gemini calls run at step 8.5, after all horoscope sections + special questions
  }

  // 5. Only send chart data to Gemini — no order/customer details
  const chartDataJson = JSON.stringify(chartData, null, 2) + todayContextBlock();

  // Normalise specialQuestions: accept legacy string[], legacy {question, sections}[],
  // and new {question, prompt, sections}[] format.
  // `question` = short customer-facing text (PDF); `prompt` = detailed Gemini-only input.
  const normalisedQuestions = specialQuestions.map(q => {
    if (typeof q === 'string') return { question: q, prompt: q, sections: [] };
    return {
      question: q.question || '',
      prompt:   (q.prompt && q.prompt.trim()) ? q.prompt : (q.question || ''),
      sections: Array.isArray(q.sections) ? q.sections : [],
    };
  });

  // 6. Create Gemini chat session (base system instruction without per-section question refs)
  const baseSystemInstruction = systemPrompt + '\n\nමෙම කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n' + chartDataJson;
  console.log('[HORO-CHAT] ══ SESSION START ══════════════════════════════════════');
  console.log('[HORO-CHAT] model: gemini-2.5-flash  temperature=0.4  topP=0.8  topK=40');
  console.log(`[HORO-CHAT] systemInstruction (${baseSystemInstruction.length} chars total, chart data omitted):\n` + systemPrompt);
  console.log('[HORO-CHAT] ══════════════════════════════════════════════════════');

  // 7. Horoscope sections
  // If horoscope_sections config is set, use that order + guides; otherwise fall back to defaults.
  let activeSections;
  let sectionGuidesOverride;
  if (Array.isArray(config.horoscope_sections) && config.horoscope_sections.length > 0) {
    activeSections = config.horoscope_sections.map(s => s.label).filter(Boolean);
    sectionGuidesOverride = Object.fromEntries(
      config.horoscope_sections.map(s => [s.label, s.guide || ''])
    );
  } else {
    // No built-in section list: a client's report structure is their own product
    // definition, so an unconfigured client generates nothing rather than
    // inheriting someone else's table of contents.
    activeSections = [];
    sectionGuidesOverride = config.section_guides || null;
  }

  // Filter to only the sections the user selected (if a selection was provided)
  if (Array.isArray(selectedSections) && selectedSections.length > 0) {
    const selSet = new Set(selectedSections);
    activeSections = activeSections.filter(s => selSet.has(s));
    console.log('[HOROSCOPE] Generating selected sections only:', activeSections);
  }

  const sectionsMap = {};
  let agentAudit = null;
  // Sections plus special questions — the two phases an agent waits through.
  const totalSteps = activeSections.length + (Array.isArray(specialQuestions) ? specialQuestions.length : 0);
  let doneSteps = 0;
  await publishProgress(orderId, 'progress', 0, totalSteps, 'Starting');
  if (useAgent) {
    // ── Agentic path: Generator⇄Critic reflection loop (opt-in via UI button) ──
    const { runHoroscopeAgent, buildAudit } = require('./horoscopeAgent');
    const sectionDefs = activeSections.map(key => ({
      key,
      guide: (sectionGuidesOverride && sectionGuidesOverride[key]) || '',
    }));
    console.log(`[HOROSCOPE] Agentic generation (reflection loop) for ${activeSections.length} sections`);
    // Persist live progress into horoscope_data.agent_progress so the UI can poll it (PG only).
    const onEvent = db.IS_PG
      ? async (evt) => {
          try {
            await db.pgQuery(
              `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{agent_progress}', $1::jsonb, true) WHERE order_id=$2`,
              [JSON.stringify({ ...evt, updatedAt: new Date().toISOString() }), orderId]
            );
          } catch (e) { console.warn('[HOROSCOPE] progress write failed:', e.message); }
        }
      : undefined;
    const agentResult = await runHoroscopeAgent({ clientId, systemPrompt, chartDataJson, sectionDefs, onEvent });
    Object.assign(sectionsMap, agentResult.sections);
    doneSteps = activeSections.length;
    await publishProgress(orderId, 'progress', doneSteps, totalSteps, 'Sections complete');
    agentAudit = buildAudit(agentResult);
    console.log(`[HOROSCOPE] Agent finished: status=${agentAudit.status} iterations=${agentAudit.iterations} issues=${agentAudit.totalIssues}`);
  } else {
    // ONE chat session for the whole run, so each section sees everything written before
    // it and the "do not repeat earlier sections" rule in FIXED_INSTRUCTIONS actually has
    // something to act on. The session is local to this call — it is created per order per
    // report and discarded when the run ends, so no chart data ever crosses orders.
    const geminiModel = (await getGenAI(clientId)).getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.4, topP: 0.8, topK: 40 },
      systemInstruction: baseSystemInstruction,
    });
    const chat = geminiModel.startChat({});

    for (const sec of activeSections) {
      // Sections are generated purely from the system prompt + chart data.
      // Special questions are NOT injected here — they are answered separately (step 8).
      const sectionPrompt = buildSectionPrompt(sec, sectionGuidesOverride, fixedInstructions);
      console.log(`\n[HORO-CHAT] ── REQUEST: "${sec}" ${'─'.repeat(Math.max(0, 50 - sec.length))}`);
      console.log('[HORO-CHAT] userPrompt:\n' + sectionPrompt);
      console.log('[HORO-CHAT] ──────────────────────────────────────────────────────');
      const sectionText = await sendRequired(chat, sectionPrompt, sec);
      const usage = undefined;
      await publishProgress(orderId, 'progress', ++doneSteps, totalSteps, sec);
      console.log(`[HORO-CHAT] ── RESPONSE: "${sec}" ${'─'.repeat(Math.max(0, 49 - sec.length))}`);
      console.log(sectionText);
      console.log(`[HORO-CHAT] tokens in=${usage?.promptTokenCount ?? '?'}  out=${usage?.candidatesTokenCount ?? '?'}  chars=${sectionText.length}`);
      console.log('[HORO-CHAT] ──────────────────────────────────────────────────────');
      sectionsMap[sec] = sectionText;
    }
  }

  // 8. Special questions — answer every question as standalone Q&A
  const specialAnswers = [];
  if (normalisedQuestions.length > 0) {
    const specialSystemInstruction = systemPrompt + '\n\n' + chartDataJson;
    console.log('\n[HORO-SPECIAL] ══ SESSION START ═════════════════════════════════');
    console.log('[HORO-SPECIAL] model: gemini-2.5-flash  temperature=0.4  topP=0.8  topK=40');
    console.log(`[HORO-SPECIAL] systemInstruction (${specialSystemInstruction.length} chars total, chart data omitted):\n` + systemPrompt);
    console.log('[HORO-SPECIAL] ══════════════════════════════════════════════════');

    const specialModel = (await getGenAI(clientId)).getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.4, topP: 0.8, topK: 40 },
      systemInstruction: specialSystemInstruction,
    });
    const specialChat = specialModel.startChat({});
    for (const qObj of normalisedQuestions) {
      const question = qObj.question;             // short, customer-facing (PDF)
      const aiPrompt = qObj.prompt || question;   // detailed, Gemini-only input
      const qPrompt = buildSpecialQuestionPrompt(aiPrompt, systemPrompt, chartDataJson);
      console.log(`\n[HORO-SPECIAL] ── REQUEST (display): "${question}"`);
      console.log('[HORO-SPECIAL] userPrompt (AI):\n' + qPrompt);
      console.log('[HORO-SPECIAL] ─────────────────────────────────────────────────');
      const { text: qText, finishReason: qReason } = await sendChecked(specialChat, qPrompt, `question: ${question}`);
      const qUsage = undefined;
      console.log(`[HORO-SPECIAL] ── RESPONSE: "${question}"`);
      console.log(qText);
      console.log(`[HORO-SPECIAL] tokens in=${qUsage?.promptTokenCount ?? '?'}  out=${qUsage?.candidatesTokenCount ?? '?'}  chars=${qText.length}`);
      console.log('[HORO-SPECIAL] ─────────────────────────────────────────────────');
      const qEntry = { question, prompt: aiPrompt, sections: qObj.sections || [], answer: qText };
      if (!qText) {
        qEntry.error = qReason === 'SAFETY'
          ? 'Declined on safety grounds — try rewording this question.'
          : `No answer returned (${qReason || 'unknown reason'}) — regenerate this question.`;
        console.error(`[HORO-SPECIAL] !! UNANSWERED: "${question}" — ${qEntry.error}`);
      }
      specialAnswers.push(qEntry);
      await publishProgress(orderId, 'progress', ++doneSteps, totalSteps, `Question: ${question}`);
    }
  }

  // 8.5. Quantum Gemini calls — run after all horoscope sections + special questions
  if (quantumResult) {
    const savedAuraForQ = existingHd.aura_analysis;
    const hasConfigSections = Array.isArray(config.quantum_sections) && config.quantum_sections.length > 0;

    if (hasConfigSections) {
      quantumResult._sections_data = await generateQuantumSections(
        quantumResult, savedAuraForQ,
        config.quantum_sections, await getGeminiKey(clientId),
        quantumSystemPrompt,
        chartData?.vimshottari_dasha || null
      );
    } else {
      // No UI sections configured — fall back to the legacy single reading
      quantumResult._reading = await generateQuantumReading(quantumResult, savedAuraForQ, await getGeminiKey(clientId), quantumSystemPrompt);
    }
  }

  // 9. Save all results
  const horoscopeData = {
    // Preserve aura_analysis if it was saved by the analyze-aura endpoint
    ...(existingHd.aura_analysis && { aura_analysis: existingHd.aura_analysis }),
    chart_data:       chartData,
    sections:         sectionsMap,
    special_answers:  specialAnswers,
    progress:         null,
    ...(agentAudit && { agent_audit: agentAudit }),
    generated_at:     new Date().toISOString(),
    birth_place_name: birth_place_name || '',
    lat:              parseFloat(lat),
    lng:              parseFloat(lng),
    ...(quantumResult && {
      quantum_data:    quantumResult,
      quantum_id:      quantumResult.quantum_id,
      quantum_reading: quantumResult._reading || null,
      ...(quantumResult._sections_data && { quantum_sections_data: quantumResult._sections_data }),
    }),
  };
  await db.pgQuery(
    'UPDATE orders SET horoscope_data=$1 WHERE order_id=$2',
    [JSON.stringify(horoscopeData), orderId]
  );
  console.log('[HOROSCOPE] All sections saved for', orderId);

  // 10. Auto-generate WA message if prompt is configured
  if (config.wa_message_prompt && config.wa_message_prompt.trim()) {
    try {
      await generateWaMessage(clientId, orderId, horoscopeData, config.wa_message_prompt);
      console.log('[HOROSCOPE] WA message generated for', orderId);
    } catch (e) {
      console.error('[HOROSCOPE] WA message generation failed (non-fatal):', e.message);
    }
  }

  return horoscopeData;
}

/**
 * Generate (or regenerate) a WhatsApp message summarising the full report.
 * Saves the result to horoscope_data.wa_message for the given order.
 */
async function generateWaMessage(clientId, orderId, horoscopeData, waMessagePrompt) {
  const sections         = horoscopeData.sections || {};
  const specialAnswers   = horoscopeData.special_answers || [];
  const quantumData      = horoscopeData.quantum_data || null;
  const quantumSections  = horoscopeData.quantum_sections_data || null;

  const contextParts = [];

  const sectionKeys = Object.keys(sections);
  if (sectionKeys.length > 0) {
    contextParts.push('=== හොරොස්කෝප් වාර්තාව ===');
    for (const key of sectionKeys) {
      contextParts.push(`\n--- ${key} ---\n${sections[key]}`);
    }
  }

  if (specialAnswers.length > 0) {
    contextParts.push('\n=== විශේෂ ප්‍රශ්නෝත්තර ===');
    specialAnswers.forEach((qa, i) => {
      contextParts.push(`\nප්‍රශ්නය ${i + 1}: ${qa.question}\nපිළිතුර: ${qa.answer}`);
    });
  }

  if (quantumSections && quantumSections.length > 0) {
    contextParts.push('\n=== ක්වොන්ටම් ශක්ති කේතය ===');
    quantumSections.forEach(sec => {
      contextParts.push(`\n--- ${sec.label} ---\n${sec.content}`);
    });
  } else if (quantumData?._reading) {
    contextParts.push('\n=== ක්වොන්ටම් ශක්ති කේතය ===\n' + quantumData._reading);
  }

  const contextText = contextParts.join('\n');

  const model = (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.7, topP: 0.9, topK: 40 },
    systemInstruction: waMessagePrompt,
  });

  const chat = model.startChat({});
  const waMessage = await sendRequired(chat, contextText, 'WhatsApp message');
  console.log(`[WA-MESSAGE] order=${orderId} chars=${waMessage.length}`);

  await db.pgQuery(
    `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{wa_message}', $1::jsonb) WHERE order_id=$2`,
    [JSON.stringify(waMessage), orderId]
  );

  return waMessage;
}

/**
 * Regenerate a single horoscope section using saved chart data.
 * Returns the new section text.
 */
async function regenerateHoroscopeSection({ clientId, chartData, systemPrompt, sectionKey, sectionGuide, specialAnswers = [], otherSections = null, fixedInstructions = '' }) {
  const chartDataJson = JSON.stringify(chartData, null, 2) + todayContextBlock();
  // Section regeneration uses only the system prompt + chart data — special questions
  // are never injected into sections (they are answered separately).
  const sysInstruction = systemPrompt + '\n\nමෙම කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n' + chartDataJson;

  const guidesOverride = sectionGuide ? { [sectionKey]: sectionGuide } : null;
  const prompt = buildSectionPrompt(sectionKey, guidesOverride, fixedInstructions);

  console.log(`[REGEN-SECTION] key="${sectionKey}"`);
  console.log(`[REGEN-SECTION] systemInstruction (${sysInstruction.length} chars total, chart data omitted):\n` + systemPrompt);
  console.log('[REGEN-SECTION] userPrompt:\n' + prompt);

  const model = (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, topP: 0.8, topK: 40 },
    systemInstruction: sysInstruction,
  });

  // The generation run's chat session is long gone by the time a single section is
  // regenerated from the editor drawer, so rebuild the conversation from the sections
  // already saved (excluding this one). Without it the rewrite has no idea what the rest
  // of the report says and tends to repeat its neighbours.
  const history = otherSections
    ? Object.entries(otherSections)
        .filter(([label, content]) => label !== sectionKey && content)
        .flatMap(([label, content]) => [
          { role: 'user',  parts: [{ text: `මාතෘකාව: [${label}]` }] },
          { role: 'model', parts: [{ text: content }] },
        ])
    : [];
  if (history.length) console.log(`[REGEN-SECTION] replaying ${history.length / 2} earlier section(s) as history`);

  const chat = model.startChat({ history });
  const text = await sendRequired(chat, prompt, sectionKey);
  console.log(`[REGEN-SECTION] chars=${text.length}`);
  return text;
}

module.exports = {
  generateHoroscope,
  buildHoroscopeDoc,
  buildQuantumDoc,
  buildSectionsDoc,
  regenerateHoroscopeSection,
  generateWaMessage,
  parseSinhalaDate,
  parseSinhalaTime,
  renderYear,
};
