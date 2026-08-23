/**
 * @module services/horoscopeQa
 * @description Drafts a casual WhatsApp-style reply to a customer's follow-up
 * question about a report they have already received.
 *
 * Replaces the manual workflow of copying the report text into a separate chat,
 * asking there, and copying the answer back.
 *
 * The reply is deliberately written as a text message, not a report: the
 * customer is mid-conversation, and pasting report prose into a chat reads
 * like a machine answered.
 */

'use strict';

const db = require('../db');
const { getGenAI } = require('./clientKeys');
const { computePorondam } = require('./porondamReport');

const SYSTEM_INSTRUCTION = `You are replying to a customer directly on WhatsApp, continuing a conversation with someone who already received their horoscope/porondam reading. This is a casual, warm, one-on-one WhatsApp text message — NOT a formal report. Do not use headers, bullet points, numbered lists, or long structured sections. Write the way a real astrologer would text a client back: a few natural, flowing sentences, like two people texting.

Use the horoscope data below only as background knowledge to answer the question accurately — do not repeat it verbatim or describe what's "in the data". Just answer what was asked, naturally.

Match the language and tone the customer has been using in the conversation. Reply with the WhatsApp message text only — no labels, quotes, prefaces, or explanations.`;

/**
 * @param {Array<{label: string, content: string}>} sections
 * @returns {string}
 */
function formatSections(sections) {
  return (sections || []).map(s => `## ${s.label}\n${s.content}`).join('\n\n');
}

/**
 * The twenty-porondam scores for a couple.
 *
 * Computed here from both charts rather than read from storage: the report
 * only ever persists its written sections, and the scores are derived at
 * download time. Recomputing means the numbers are available for every past
 * order too, and can never drift from the charts they came from.
 *
 * Asked "how many porondam matched?", a model given only prose will produce a
 * number that sounds right — which for a paid reading is worse than refusing.
 *
 * @param {Object} boy  - Normalised person with chartData
 * @param {Object} girl
 * @returns {string} Empty when either chart is missing or unusable.
 */
function porondamBlock(boy, girl) {
  if (!boy?.chartData || !girl?.chartData) return '';
  try {
    const p = computePorondam(boy.chartData, girl.chartData);
    const lines = (p.factors || []).map(f =>
      `${f.id}. ${f.name_si} (${f.name_en}): ${f.score}/${f.max_score}`
      + `${f.matched ? ' — matched' : ' — not matched'}`
      + `${f.critical_dosha ? ' [CRITICAL DOSHA]' : ''}`
      + `${f.explanation ? ` — ${f.explanation}` : ''}`);
    return `TWENTY PORONDAM SCORES (authoritative — use these exact numbers, never estimate):\n`
      + `Total: ${p.total_score}/${p.max_score} (${p.compatibility_percent}%)\n`
      + `${p.critical_dosha?.length ? `Critical dosha: ${p.critical_dosha.join(', ')}\n` : ''}`
      + lines.join('\n');
  } catch (e) {
    // A chart without a usable Moon position cannot yield porondam. Better to
    // omit the block than to fail the whole answer.
    console.warn('[HOROSCOPE-QA] porondam unavailable:', e.message);
    return '';
  }
}

/**
 * Build the report context injected into the prompt, covering both the
 * single-reading and couple shapes.
 *
 * @param {Object} record - Normalised record from deliveredHoroscope
 * @returns {string}
 */
function formatHoroscopeContext(record) {
  if (!record) return '';

  // The birth chart matters as much as the written report. A follow-up is
  // frequently about something the report never covered, and prose alone leaves
  // nothing to reason from — the model can only paraphrase what is already
  // there. With the chart it answers from positions and dasha periods, which is
  // what the report generator itself works from.
  const chartBlock = (label, chartData) => (chartData
    ? `${label} BIRTH CHART (JSON):\n${JSON.stringify(chartData)}`
    : '');

  // What the customer was already told, so a follow-up builds on the report
  // rather than contradicting it.
  const answersBlock = (answers) => {
    const asked = (answers || []).filter(a => (a.answer || '').trim());
    if (!asked.length) return '';
    return 'QUESTIONS THIS CUSTOMER ALREADY ASKED, AND THE ANSWERS THEY WERE GIVEN '
      + '(do not contradict these):\n'
      + asked.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');
  };

  if (record.type === 'match') {
    const { boy, girl } = record.match || {};
    const line = (label, p) => (p
      ? `${label}: ${p.name || 'unknown'} — born ${p.birthDate || '?'} ${p.birthTime || ''}`
        + `${p.birthPlace ? ` in ${p.birthPlace}` : ''} — lagna: ${p.lagna || 'unknown'}`
      : null);
    return [
      'COUPLE COMPATIBILITY (PORONDAM) DATA:\n'
        + [line('Person A', boy), line('Person B', girl)].filter(Boolean).join('\n'),
      porondamBlock(boy, girl),
      chartBlock('PERSON A', boy?.chartData),
      chartBlock('PERSON B', girl?.chartData),
      formatSections(record.match?.sections),
      answersBlock(record.match?.answers),
    ].filter(Boolean).join('\n\n');
  }

  const p = record.single || {};
  const header = `Name: ${p.name || 'unknown'} — born ${p.birthDate || '?'} ${p.birthTime || ''} `
    + `${p.birthPlace ? `in ${p.birthPlace}` : ''} — lagna: ${p.lagna || 'unknown'}`;
  return [
    `HOROSCOPE DATA:\n${header}`,
    chartBlock('CUSTOMER', p.chartData),
    formatSections(p.sections),
    answersBlock(p.answers),
  ].filter(Boolean).join('\n\n');
}

/**
 * A short transcript of the recent conversation, so the reply matches the
 * language and register the customer has actually been using.
 *
 * @param {Array<{sender_type: string, message_text: string}>} messages
 * @returns {string}
 */
function recentTranscript(messages) {
  return (messages || [])
    .filter(m => m.message_text && m.message_text.trim())
    .slice(-10)
    .map(m => `${m.sender_type === 'user' ? 'Customer' : 'Agent'}: ${m.message_text.trim()}`)
    .join('\n');
}

/**
 * Draft a WhatsApp-style reply to a follow-up question.
 *
 * @param {string} clientId
 * @param {string} phone
 * @param {Object} horoscopeRecord - Normalised record (single or match)
 * @param {string} question - The customer's question, as entered by the agent
 * @returns {Promise<string>} Drafted reply text
 * @throws {Error} With statusCode 502 when nothing usable comes back.
 */
async function draftHoroscopeReply(clientId, phone, horoscopeRecord, question) {
  const messages = await db.getMessagesByPhone(phone, clientId).catch(() => []);
  const transcript = recentTranscript(messages);

  const prompt = [
    SYSTEM_INSTRUCTION,
    formatHoroscopeContext(horoscopeRecord),
    transcript ? `RECENT CONVERSATION:\n${transcript}` : '',
    `CUSTOMER'S QUESTION: ${question}`,
  ].filter(Boolean).join('\n\n---\n\n');

  // Billed to the client's own key, like every other generation path.
  const model = (await getGenAI(clientId)).getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(prompt);

  let text = '';
  try { text = (result.response.text() || '').trim(); } catch { text = ''; }

  if (!text) {
    // An empty draft silently pasted into a chat is worse than an error.
    const reason = (result.response.candidates || [])[0]?.finishReason || 'none';
    const err = new Error(`No reply was drafted (${reason}). Try rewording the question.`);
    err.statusCode = 502;
    throw err;
  }
  return text;
}

module.exports = { draftHoroscopeReply, formatHoroscopeContext };
