#!/usr/bin/env node
/**
 * @file Re-answer a single match-making special question and save it.
 *
 * The full "Regenerate All" rewrites all sections and every answer, which is a
 * lot to redo when one answer came back empty. This redoes exactly one, in the
 * same session shape as the real run so the answer still does not restate the
 * sections, and writes only that entry back.
 *
 * Dry-run unless --apply, and it refuses to overwrite a non-empty answer unless
 * --force, so it cannot silently discard something an agent has edited.
 *
 * Usage:
 *   node backend/scripts/answer-match-question.js "<orderId>" <questionNumber>
 *   node backend/scripts/answer-match-question.js "<orderId>" <questionNumber> --apply
 */

'use strict';

require('dotenv').config();
const { pgQuery } = require('../src/db/connection');
const db = require('../src/db');
const { buildCoupleContext, resolveMatchConfig, historyFromSections } = require('../src/services/matchReport');
const { getGenAI } = require('../src/services/clientKeys');

async function main() {
  const orderId = process.argv[2];
  const qNumber = parseInt(process.argv[3] || '0', 10);
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  if (!orderId || !qNumber) {
    console.error('Usage: node backend/scripts/answer-match-question.js "<orderId>" <questionNumber> [--apply] [--force]');
    process.exit(1);
  }

  const r = await pgQuery('SELECT client_id, horoscope_data AS hd FROM orders WHERE order_id=$1', [orderId]);
  if (!r.rows.length) throw new Error(`Order "${orderId}" not found`);
  const clientId = r.rows[0].client_id;
  const hd = r.rows[0].hd || {};

  const questions = hd.match_special_questions || [];
  const answers = (hd.match_special_answers || []).map(a => ({ ...a }));
  const idx = qNumber - 1;
  const q = questions[idx];
  if (!q) throw new Error(`Question ${qNumber} does not exist (order has ${questions.length})`);

  const existing = (answers[idx] && answers[idx].answer || '').trim();
  if (existing && !force) {
    console.error(`Question ${qNumber} already has a ${existing.length}-character answer. `
      + 'Pass --force to replace it.');
    process.exit(1);
  }

  const config = await db.getPluginConfig(clientId, 'horoscope_reading');
  const { systemPrompt, questionInstructions } = resolveMatchConfig(config);
  if (!systemPrompt) throw new Error('No match system prompt configured for this client');

  const coupleContext = buildCoupleContext(hd);
  const questionText = (q.prompt && q.prompt.trim()) ? q.prompt : (q.question || '');
  if (!questionText.trim()) throw new Error('Question has no text and no instruction');

  console.log(`order    : ${orderId} (${clientId})`);
  console.log(`question : ${q.question}`);
  console.log(`existing : ${existing ? existing.length + ' chars (will be replaced)' : 'empty'}`);
  console.log(`mode     : ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  const model = (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, topP: 0.8, topK: 40 },
    systemInstruction: systemPrompt
      + '\n\nමෙම යුවලගේ කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n'
      + coupleContext,
  });
  // Replay the saved sections as history, exactly as the real run keeps one
  // session open, so the answer does not repeat what the report already says.
  const chat = model.startChat({ history: historyFromSections(hd.match_sections_data, null) });

  const result = await chat.sendMessage(
    `මෙම විශේෂ ප්‍රශ්නයට සෘජු සහ සවිස්තරාත්මක පිළිතුරක් ලබා දෙන්න: '${questionText}'\n\n`
    + (questionInstructions || '')
  );
  const cand = (result.response.candidates || [])[0] || {};
  const answer = (result.response.text() || '').trim();

  console.log(`finishReason: ${cand.finishReason || '(none)'}`);
  console.log(`answer      : ${answer.length} chars\n`);
  if (!answer) throw new Error('Model returned an empty answer — nothing written');

  console.log('─'.repeat(70));
  console.log(answer);
  console.log('─'.repeat(70) + '\n');

  if (!apply) {
    console.log('Dry run only — re-run with --apply to save.');
    process.exit(0);
  }

  while (answers.length < questions.length) answers.push({ question: '', prompt: '', answer: '' });
  answers[idx] = {
    question: q.question || questionText,
    prompt:   q.prompt || '',
    answer,
  };

  // Re-read immediately before writing so a concurrent generation started in the
  // UI is not clobbered by this one.
  const fresh = await pgQuery('SELECT horoscope_data AS hd FROM orders WHERE order_id=$1', [orderId]);
  const freshHd = fresh.rows[0].hd || {};
  if (freshHd.match_generating) {
    throw new Error('A match generation is currently running for this order — try again once it finishes');
  }
  await pgQuery(
    `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{match_special_answers}', $1::jsonb) WHERE order_id=$2`,
    [JSON.stringify(answers), orderId]
  );
  console.log(`Saved to match_special_answers[${idx}].`);
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
