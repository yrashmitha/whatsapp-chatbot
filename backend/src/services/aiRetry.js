/**
 * @module services/aiRetry
 * @description Sends a chat turn and insists on getting text back.
 *
 * A model can return a response with no text — a transient failure, a safety
 * stop, or a hit token ceiling. `response.text()` yields `''` for all of these,
 * which is indistinguishable from a real answer to calling code that does not
 * look. That is how a paid report shipped with a blank section: the run
 * recorded no error, saved the empty string, and nobody found out until the
 * customer read it.
 *
 * Everything here exists so an empty result is loud rather than silent.
 */

'use strict';

/** How many extra attempts to make after an empty first response. */
const DEFAULT_RETRIES = 1;

/**
 * Send a prompt on an existing chat session and return its text.
 *
 * Retries once when the response comes back empty, since the common cause is
 * transient. Reports the finish reason either way so a genuine refusal
 * (`SAFETY`) is distinguishable from a truncation (`MAX_TOKENS`) or a blip.
 *
 * @param {Object} chat    - Live chat session from `model.startChat()`
 * @param {string} prompt  - Message to send
 * @param {string} label   - Human-readable name for logs, e.g. the section title
 * @param {Object} [opts]
 * @param {number} [opts.retries=1] - Extra attempts after an empty response
 * @returns {Promise<{text: string, finishReason: string|null, usage: Object|undefined, attempts: number}>}
 *          `text` is empty only when every attempt came back empty.
 */
async function sendChecked(chat, prompt, label, opts = {}) {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  let finishReason = null;
  let usage;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const result = await chat.sendMessage(prompt);
    const response = result.response;
    const candidate = (response.candidates || [])[0] || {};
    finishReason = candidate.finishReason || null;
    usage = response.usageMetadata;

    let text = '';
    try {
      text = (response.text() || '').trim();
    } catch (err) {
      // text() throws when the response was blocked outright.
      console.warn(`[AI] "${label}" attempt ${attempt}: text() threw — ${err.message}`);
    }

    if (text) return { text, finishReason, usage, attempts: attempt };

    const blocked = (candidate.safetyRatings || []).filter(s => s.blocked);
    console.warn(
      `[AI] "${label}" attempt ${attempt}/${retries + 1} returned no text`
      + ` (finishReason=${finishReason || 'none'}`
      + (blocked.length ? `, blocked=${blocked.map(b => b.category).join(',')}` : '')
      + `)${attempt <= retries ? ' — retrying' : ''}`
    );
  }

  return { text: '', finishReason, usage, attempts: retries + 1 };
}

/**
 * As `sendChecked`, but throws when no attempt produced text.
 *
 * For content whose absence would corrupt the document — a report section is a
 * heading with nothing under it — failing the run is better than saving a gap,
 * because a failed run is visible and a gap is not.
 *
 * @param {Object} chat
 * @param {string} prompt
 * @param {string} label
 * @param {Object} [opts]
 * @returns {Promise<string>} Non-empty text
 * @throws {Error} With `statusCode` 502 when every attempt came back empty.
 */
async function sendRequired(chat, prompt, label, opts = {}) {
  const { text, finishReason, attempts } = await sendChecked(chat, prompt, label, opts);
  if (text) return text;

  const reason = finishReason === 'SAFETY'
    ? 'the request was declined on safety grounds'
    : finishReason === 'MAX_TOKENS'
      ? 'the response hit the length limit before producing any text'
      : `no text was returned (finishReason=${finishReason || 'none'})`;

  const err = new Error(`"${label}" could not be written after ${attempts} attempts — ${reason}. Nothing was saved; try generating again, and reword the prompt if it keeps failing.`);
  err.statusCode = 502;
  err.label = label;
  err.finishReason = finishReason;
  throw err;
}

module.exports = { sendChecked, sendRequired };
