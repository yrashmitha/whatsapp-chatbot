/**
 * @module services/tarot
 * @description Tarot card reading service.
 * Randomly draws a 3-card spread (Past / Present / Future) from the local
 * 78-card deck — with reversed card support — then passes the cards and the
 * customer's question to Gemini for an interpreted reading.
 */

'use strict';

const { genAI } = require('./gemini');

let Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak;
function ensureDocx() {
  if (!Document) {
    ({ Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak } = require('docx'));
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
 * Default Gemini prompt template.
 * Placeholders replaced at runtime:
 *   {question}   — the customer's question / problem
 *   {spread}     — formatted card spread text
 */
const DEFAULT_TAROT_PROMPT = `You are a warm, insightful tarot reader. A customer has come to you with the following question or situation:

"{question}"

You have drawn the following 3-card spread for them:

{spread}

Please provide a thoughtful, compassionate tarot reading that:
1. Interprets each card in the context of its position (Past, Present, Future)
2. Connects the cards to the customer's specific question or situation
3. Offers guidance and insight based on the overall message of the spread
4. Ends with an encouraging, supportive closing message

Keep the tone warm, empathetic, and spiritual. Write in a flowing, readable style suitable for WhatsApp.`;

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
    const position = SPREAD_POSITIONS[i] || `Position ${i + 1}`;
    const orientation = reversed ? '(Reversed)' : '(Upright)';
    const meaning = reversed ? card.meaning_rev : card.meaning_up;
    return `**${position}: ${card.name} ${orientation}**\nMeaning: ${meaning}`;
  }).join('\n\n');
}

/**
 * Generate a tarot reading for a customer.
 *
 * @param {string}      clientId - Multi-tenant client ID
 * @param {string}      question - The customer's question or problem
 * @param {string|null} customPrompt - Optional prompt override from plugin config
 * @returns {Promise<{ reading: string, cards: Array }>}
 */
async function generateTarotReading(clientId, question, customPrompt = null) {
  const drawn = drawCards(3);
  const spreadText = formatSpread(drawn);

  const promptTemplate = customPrompt || DEFAULT_TAROT_PROMPT;
  const prompt = promptTemplate
    .replace('{question}', question)
    .replace('{spread}', spreadText);

  console.log(`[TAROT] client=${clientId} | drawing 3 cards`);
  drawn.forEach(({ card, reversed }, i) => {
    console.log(`[TAROT]   ${SPREAD_POSITIONS[i]}: ${card.name} ${reversed ? '(Reversed)' : '(Upright)'}`);
  });
  console.log(`[TAROT] Gemini prompt:\n${prompt}`);

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(prompt);
  const reading = result.response.text();

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
function parseRuns(line) {
  const runs = [];
  if (!line.includes('**') && !line.includes('*')) {
    runs.push(new TextRun({ text: line, size: 24, font: 'Calibri' }));
    return runs;
  }
  const normalised = line.replace(/\*\*/g, '*');
  const parts = normalised.split('*');
  parts.forEach((part, i) => {
    if (part) runs.push(new TextRun({ text: part, bold: i % 2 !== 0, size: 24, font: 'Calibri' }));
  });
  return runs;
}

/**
 * Convert Gemini reading text into docx Paragraph array.
 * @param {string} content
 * @returns {Paragraph[]}
 */
function contentToParagraphs(content) {
  const paragraphs = [];
  if (!content) return paragraphs;
  const lines = content.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      paragraphs.push(new Paragraph({ children: [], spacing: { after: 80 } }));
      continue;
    }
    if (line.startsWith('###') || line.startsWith('##') || line.startsWith('#')) {
      const text = line.replace(/^#+\s*/, '').replace(/\*/g, '').trim();
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text, bold: true, size: 28, font: 'Calibri' })],
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
        children: parseRuns(line),
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 160 },
      }));
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

async function buildTarotDoc({ question, reading, cards }) {
  ensureDocx();

  const children = [];

  // Question heading
  children.push(new Paragraph({
    children: [new TextRun({ text: SINHALA_QUESTION_HEADING, bold: true, size: 28, font: 'Calibri' })],
    alignment: AlignmentType.LEFT,
    spacing: { before: 160, after: 120 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: question, size: 24, font: 'Calibri', italics: true })],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 320 },
  }));

  // Cards drawn heading
  children.push(new Paragraph({
    children: [new TextRun({ text: SINHALA_CARDS_HEADING, bold: true, size: 28, font: 'Calibri' })],
    alignment: AlignmentType.LEFT,
    spacing: { before: 160, after: 200 },
  }));

  for (const c of cards) {
    const posLabel   = SINHALA_POSITIONS[c.position] || c.position;
    const oriLabel   = c.reversed ? SINHALA_REVERSED : SINHALA_UPRIGHT;
    const cardName   = c.sinhala_name || c.name;
    const cardMeaning = c.sinhala_meaning || c.meaning;

    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${posLabel}: `, bold: true, size: 24, font: 'Calibri' }),
        new TextRun({ text: `${cardName} (${oriLabel})`, size: 24, font: 'Calibri' }),
      ],
      spacing: { after: 60 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: cardMeaning, size: 22, font: 'Calibri', color: '555555' })],
      spacing: { after: 160 },
    }));
  }

  // Reading
  children.push(new PageBreak());
  children.push(new Paragraph({
    children: [new TextRun({ text: SINHALA_READING_HEADING, bold: true, size: 36, font: 'Calibri' })],
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 280 },
  }));

  children.push(...contentToParagraphs(reading));

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateTarotReading, buildTarotDoc, DEFAULT_TAROT_PROMPT };
