/**
 * @module services/tarot
 * @description Tarot card reading service.
 * Randomly draws a 3-card spread (Past / Present / Future) from the local
 * 78-card deck — with reversed card support — then passes the cards and the
 * customer's question to Gemini for an interpreted reading.
 */

'use strict';

const { getGenAI } = require('./clientKeys');
const { DEFAULT_BRAND, footerText } = require('./branding');
const { makeMeter, recordOrderGenCost } = require('./genCost');

let Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak, Footer, PageNumber, NumberFormat;
function ensureDocx() {
  if (!Document) {
    ({ Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak, Footer, PageNumber, NumberFormat } = require('docx'));
  }
}

/** @type {{ nhits: number, cards: Array }} */
const CARD_DATA = require('./tarot_cards.json');

/** All 78 cards as a flat array. */
const ALL_CARDS = CARD_DATA.cards;

/** Probability that a drawn card is reversed. */
const REVERSAL_CHANCE = 0.3;

/**
 * The 3-card spread positions and their meanings.
 * @type {string[]}
 */
const SPREAD_POSITIONS = ['Past', 'Present', 'Future'];

/**
 * Default Gemini prompt template, used when a client has not written their own
 * in Plugins → Tarot Reading.
 *
 * Placeholders replaced at runtime:
 *   {question}   — the customer's one real problem
 *   {spread}     — formatted 3-card spread (Past / Present / Future)
 *   {chart}      — the customer's Vedic birth chart JSON, or "" when none
 *
 * The product rule: one paid reading answers ONE real question about one area of
 * the customer's life (love, money, work, health, family, a decision). The more
 * honest and specific that question is, the more useful the reading — so the
 * reading is written to take the stated problem seriously and answer it
 * directly, not to give a vague all-purpose fortune.
 */
const DEFAULT_TAROT_PROMPT = `You are an experienced counsellor and tarot reader. The customer below has ONE real problem they need read. Stay on that one topic.

The brief (the customer's situation and what to determine):
{question}

The 3 cards drawn (interpret ONLY these, invent no others):
{spread}

The customer's Vedic birth chart (background context — may be empty):
{chart}

How to write the reading:
- The 3 cards are the reading. Use the birth chart only as supporting background — to ground timing and the nature of the problem — never to override the cards, and never quote planetary positions to the customer.
- Think like a counsellor first. Weigh the realistic explanations for how the situation came to be. For most problems only one or two causes are truly in play — say which one the cards and the story point to, and why, rather than hedging across every possibility.
- When another person is involved (a partner, family member, employer), read THEIR likely emotional state and motives too, not just the customer's.
- Give a clear, honest verdict: what most likely happened, where it stands now, and where it is heading. Do not soften a hard answer into a both-ways answer.
- Past card: the root — how it came to this. Present card: where things stand now and the forces at play. Future card: the direction, and what the customer must do to change it.
- End with 3-4 short, concrete pieces of advice — what to do and what to avoid.
- Compassionate but truthful tone; the customer should feel understood and should get real clarity.
- Reply in the same language the customer used. About 12-18 lines.`;

/**
 * Randomly draw N unique cards from the deck, each with a chance of reversal.
 *
 * @param {number} count - Number of cards to draw
 * @returns {Array<{ card: Object, reversed: boolean }>}
 */
function drawCards(count) {
  const shuffled = [...ALL_CARDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(card => ({
    card,
    reversed: Math.random() < REVERSAL_CHANCE,
  }));
}

/**
 * Format the drawn cards into a readable spread block for the Gemini prompt.
 *
 * @param {Array<{ card: Object, reversed: boolean }>} drawn
 * @returns {string}
 */
function formatSpread(drawn) {
  return drawn.map(({ card, reversed }, i) => {
    const position    = SPREAD_POSITIONS[i] || `Position ${i + 1}`;
    const orientation = reversed ? '(Reversed)' : '(Upright)';
    const meaning     = reversed ? card.meaning_rev : card.meaning_up;
    // Include Sinhala name alongside English so Gemini uses the right name in its response
    const nameLabel   = card.sinhala_name
      ? `${card.sinhala_name} (${card.name})`
      : card.name;
    return `**${position}: ${nameLabel} ${orientation}**\nMeaning: ${meaning}`;
  }).join('\n\n');
}

/**
 * Generate a tarot reading for a customer.
 *
 * @param {string}      clientId - Multi-tenant client ID
 * @param {string}      question - The customer's question or problem
 * @param {string|null} customPrompt - Optional prompt override from plugin config
 * @param {string|null} orderId - Order to bill the Gemini cost to (optional)
 * @param {string}      chartContext - Vedic birth chart JSON to give Gemini as background (optional)
 * @returns {Promise<{ reading: string, cards: Array }>}
 */
async function generateTarotReading(clientId, question, customPrompt = null, orderId = null, chartContext = '') {
  // Fall back to the built-in prompt rather than refusing — a client that
  // enabled the addon but never opened Plugins should still get a usable
  // reading, and the default already encodes the "one real problem" framing.
  const usingDefault = !(customPrompt || '').trim();
  if (usingDefault) {
    console.log(`[TAROT] client=${clientId} has no custom prompt — using DEFAULT_TAROT_PROMPT`);
    customPrompt = DEFAULT_TAROT_PROMPT;
  }
  const drawn = drawCards(3);
  const spreadText = formatSpread(drawn);

  console.log(`[TAROT] client=${clientId} | drawing 3 cards`);
  drawn.forEach(({ card, reversed }, i) => {
    console.log(`[TAROT]   ${SPREAD_POSITIONS[i]}: ${card.sinhala_name || card.name} (${card.name}) ${reversed ? '(Reversed)' : '(Upright)'}`);
  });

  const promptTemplate = (customPrompt || '').trim();

  const chart = (chartContext || '').trim();

  // Replace {question}, {spread} and {chart} placeholders
  let prompt = promptTemplate
    .replace('{question}', question)
    .replace('{spread}', spreadText)
    .replace('{chart}', chart || '(no birth chart available)');

  // Safety guard: if customPrompt didn't include {spread}, append the cards explicitly
  if (customPrompt && !customPrompt.includes('{spread}')) {
    prompt += `\n\n---\nCUSTOMER'S QUESTION: ${question}\n\nDRAWN CARDS (interpret ONLY these 3, no others):\n${spreadText}`;
    console.log(`[TAROT] WARNING: custom prompt missing {spread} — appended cards explicitly`);
  }
  // If the prompt has no {chart} slot but we have one, append it as background.
  if (chart && !promptTemplate.includes('{chart}')) {
    prompt += `\n\n---\nCUSTOMER'S VEDIC BIRTH CHART (background context only — the 3 cards remain the reading; do not quote planetary positions to the customer):\n${chart}`;
    console.log('[TAROT] appended birth chart as background context');
  }

  console.log(`[TAROT] Injected spread:\n${spreadText}`);
  console.log(`[TAROT] Full prompt sent to Gemini:\n${prompt}`);

  // Use systemInstruction to hard-enforce the card constraint with thinking models
  const model = (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `You are a tarot card reader providing a personalised reading.
STRICT RULES:
1. Interpret ONLY the exact 3 cards listed in the prompt. Do NOT invent, substitute, or mention any other tarot cards.
2. Use the card names exactly as given (use the Sinhala name if provided).
3. Respond in the same language the customer used in their question.`,
  });

  const result = await model.generateContent(prompt);

  const meter = makeMeter();
  meter.add(result.response.usageMetadata);
  await recordOrderGenCost(orderId, 'tarot', meter);

  // Filter out thought/thinking parts — same pattern as gemini.js
  // result.response.text() includes thinking tokens; we want only the final response
  const rawParts = result.response.candidates?.[0]?.content?.parts || [];
  const reading  = rawParts
    .filter(p => !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('') || result.response.text();

  console.log(`[TAROT] Gemini reading (${reading.length} chars)`);

  const cards = drawn.map(({ card, reversed }, i) => ({
    position: SPREAD_POSITIONS[i],
    name: card.name,
    sinhala_name: card.sinhala_name || card.name,
    type: card.type,
    reversed,
    meaning: reversed ? card.meaning_rev : card.meaning_up,
    sinhala_meaning: reversed
      ? (card.sinhala_meaning_rev || card.meaning_rev)
      : (card.sinhala_meaning_up  || card.meaning_up),
  }));

  return { reading, cards };
}

/**
 * Parse **bold** markers into docx TextRun array.
 * @param {string} line
 * @returns {TextRun[]}
 */
function parseRuns(line, font) {
  const runs = [];
  if (!line.includes('**') && !line.includes('*')) {
    runs.push(new TextRun({ text: line, size: 24, font }));
    return runs;
  }
  const normalised = line.replace(/\*\*/g, '*');
  const parts = normalised.split('*');
  parts.forEach((part, i) => {
    if (part) runs.push(new TextRun({ text: part, bold: i % 2 !== 0, size: 24, font }));
  });
  return runs;
}

/**
 * Convert Gemini reading text into docx Paragraph array.
 * @param {string} content
 * @returns {Paragraph[]}
 */
function contentToParagraphs(content, font) {
  const paragraphs = [];
  if (!content) return paragraphs;
  // Split into paragraph blocks on double newlines; treat single newlines as continuations
  const blocks = content.replace(/\n\n/g, '[[PARA]]').split('[[PARA]]');
  for (const block of blocks) {
    const lines = block.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue; // skip blank lines — use paragraph spacing instead
      if (line.startsWith('###') || line.startsWith('##') || line.startsWith('#')) {
        const text = line.replace(/^#+\s*/, '').replace(/\*/g, '').trim();
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text, bold: true, size: 32, font })],
          alignment: AlignmentType.LEFT,
          spacing: { before: 240, after: 120 },
        }));
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        paragraphs.push(new Paragraph({
          children: parseRuns(line.slice(2).trim()),
          bullet: { level: 0 },
          alignment: AlignmentType.LEFT,
          spacing: { after: 80 },
        }));
      } else {
        paragraphs.push(new Paragraph({
          children: parseRuns(line, font),
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 160 },
        }));
      }
    }
  }
  return paragraphs;
}

/**
 * Build a Word (.docx) buffer for a tarot reading.
 *
 * @param {Object} params
 * @param {string} params.question   - The customer's question / situation
 * @param {string} params.reading    - Gemini's full reading text
 * @param {Array}  params.cards      - Array of { position, name, reversed, meaning }
 * @returns {Promise<Buffer>} docx buffer
 */
// Sinhala labels used in the document
const SINHALA_POSITIONS = { Past: 'අතීතය', Present: 'වර්තමානය', Future: 'අනාගතය' };
const SINHALA_UPRIGHT   = 'ඍජු';
const SINHALA_REVERSED  = 'ආපසු';
const SINHALA_QUESTION_HEADING = 'ඔබේ ප්‍රශ්නය / තත්ත්වය';
const SINHALA_CARDS_HEADING    = 'ඔබට ඇදුනු කාඩ් - අතීතය · වර්තමානය · අනාගතය';
const SINHALA_READING_HEADING  = 'ඔබේ කියවීම';

// ── Constant page content ────────────────────────────────────────────────────

/** Page 1 — What is Tarot? */

/** Page 2 — How does Tarot work? */

/** Final page — Spiritual disclaimer */

/**
 * Helper: heading paragraph for constant pages.
 * Pass pageBreak=true to embed a page break before the heading text (like horoscope pattern).
 */
function makeHeading(text, font, pageBreak = false) {
  return new Paragraph({
    children: [
      ...(pageBreak ? [new PageBreak()] : []),
      new TextRun({ text, bold: true, size: 36, font, color: '000000' }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: pageBreak ? 0 : 480, after: 320 },
  });
}

/** Helper: build body paragraphs for constant pages from a newline-separated string */
function makeBodyParagraphs(text, font) {
  return text.split('\n').filter(l => l.trim()).map(line => new Paragraph({
    children: [new TextRun({ text: line, size: 24, font })],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 200 },
  }));
}

async function buildTarotDoc({ question, reading, cards, page1_body, page2_body, page4_body, brand = DEFAULT_BRAND, page1_heading = '', page2_heading = '', page4_heading = '' }) {
  ensureDocx();

  const children = [];

  // ── Page 1: ටැරෝ කාඩ්පත් යනු කුමක්ද? ──────────────────────────────────
  children.push(makeHeading(page1_heading, brand.font));
  children.push(...makeBodyParagraphs(page1_body || '', brand.font));

  // ── Page 2: ටැරෝ කාඩ්පත් ක්‍රියා කරන්නේ කෙසේද? — page break embedded in heading
  children.push(makeHeading(page2_heading, brand.font, true));
  children.push(...makeBodyParagraphs(page2_body || '', brand.font));

  // ── Page 3: Question + Cards drawn — page break embedded in heading
  children.push(new Paragraph({
    children: [
      new PageBreak(),
      new TextRun({ text: SINHALA_QUESTION_HEADING, bold: true, size: 28, font: brand.font }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 120 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: question, size: 24, font: brand.font, italics: true })],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 320 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: SINHALA_CARDS_HEADING, bold: true, size: 28, font: brand.font })],
    alignment: AlignmentType.LEFT,
    spacing: { before: 160, after: 200 },
  }));

  for (const c of cards) {
    const posLabel    = SINHALA_POSITIONS[c.position] || c.position;
    const oriLabel    = c.reversed ? SINHALA_REVERSED : SINHALA_UPRIGHT;
    const cardName    = c.sinhala_name || c.name;
    const cardMeaning = c.sinhala_meaning || c.meaning;

    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${posLabel}: `, bold: true, size: 24, font: brand.font }),
        new TextRun({ text: `${cardName} (${oriLabel})`, size: 24, font: brand.font }),
      ],
      spacing: { after: 60 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: cardMeaning, size: 22, font: brand.font, color: '555555' })],
      spacing: { after: 160 },
    }));
  }

  // ── Reading — page break embedded in heading
  children.push(new Paragraph({
    children: [
      new PageBreak(),
      new TextRun({ text: SINHALA_READING_HEADING, bold: true, size: 36, font: brand.font }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 280 },
  }));

  children.push(...contentToParagraphs(reading, brand.font));

  // ── Final page: ආධ්‍යාත්මික වගකීම් ප්‍රකාශය — page break embedded in heading
  children.push(makeHeading(page4_heading, brand.font, true));
  children.push(...makeBodyParagraphs(page4_body || '', brand.font));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: brand.font, size: 24 },
          paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 } },
        },
      },
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

  return Packer.toBuffer(doc);
}

module.exports = { generateTarotReading, buildTarotDoc, DEFAULT_TAROT_PROMPT };
