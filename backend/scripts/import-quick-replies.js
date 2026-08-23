#!/usr/bin/env node
/**
 * @file Import quick replies for a client from a JSON export.
 *
 * Written for moving a client off the wwjs service, where the quick_replies
 * table has the same shape, but it takes any file of
 * `[{ title, text, sort_order? }]`.
 *
 * Existing replies are never silently discarded: --replace writes the current
 * set to a backup file first and prints where it went, so a bad import is one
 * command to undo.
 *
 * Usage:
 *   node backend/scripts/import-quick-replies.js <clientId> <file.json>            # add, skip existing titles
 *   node backend/scripts/import-quick-replies.js <clientId> <file.json> --replace  # backup, then swap
 *   node backend/scripts/import-quick-replies.js <clientId> <file.json> --dry-run
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

/** Titles are typed after a slash, so a leading slash would need two. */
function normaliseTitle(raw) {
  return String(raw || '').replace(/^\/+/, '').trim();
}

async function main() {
  const [clientId, file, ...flags] = process.argv.slice(2);
  const replace = flags.includes('--replace');
  const dryRun = flags.includes('--dry-run');

  if (!clientId || !file) {
    console.error('Usage: node backend/scripts/import-quick-replies.js <clientId> <file.json> [--replace] [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }

  let incoming;
  try {
    incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`${file} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(incoming) || !incoming.length) {
    console.error('Expected a non-empty array of { title, text }');
    process.exit(1);
  }

  const rows = [];
  const seen = new Set();
  incoming.forEach((r, i) => {
    const title = normaliseTitle(r.title);
    const text = String(r.text || '');
    if (!title || !text.trim()) {
      console.warn(`  skipping entry ${i + 1}: needs both a title and text`);
      return;
    }
    if (seen.has(title)) {
      console.warn(`  skipping entry ${i + 1}: "/${title}" appears twice in the file`);
      return;
    }
    seen.add(title);
    rows.push({ title, text, sort_order: Number.isFinite(r.sort_order) ? r.sort_order : rows.length });
  });

  const { rows: existing } = await db.pgQuery(
    'SELECT id, title, text, sort_order FROM quick_replies WHERE client_id=$1 ORDER BY sort_order, id',
    [clientId]
  );

  console.log(`client        : ${clientId}`);
  console.log(`in the file   : ${rows.length}`);
  console.log(`already there : ${existing.length}${existing.length ? ' (' + existing.map(e => '/' + e.title).join(', ') + ')' : ''}`);
  console.log(`mode          : ${replace ? 'replace' : 'add, skipping titles that exist'}${dryRun ? ' (dry run)' : ''}`);

  const existingTitles = new Set(existing.map(e => normaliseTitle(e.title)));
  const toInsert = replace ? rows : rows.filter(r => !existingTitles.has(r.title));
  const skipped = rows.length - toInsert.length;

  console.log('');
  toInsert.forEach(r => console.log(`  + /${r.title}  (${r.text.length} chars)`));
  if (skipped) console.log(`  ${skipped} skipped because that title already exists`);

  if (dryRun) {
    console.log('\nDry run: nothing written.');
    process.exit(0);
  }
  if (!toInsert.length) {
    console.log('\nNothing to do.');
    process.exit(0);
  }

  if (replace && existing.length) {
    const backup = path.join(
      path.dirname(file),
      `quick-replies-${clientId}-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );
    fs.writeFileSync(backup, JSON.stringify(existing, null, 2), 'utf8');
    console.log(`\nCurrent set backed up to:\n  ${backup}`);
    await db.pgQuery('DELETE FROM quick_replies WHERE client_id=$1', [clientId]);
    console.log(`Removed ${existing.length} existing repl${existing.length === 1 ? 'y' : 'ies'}.`);
  }

  for (const r of toInsert) {
    await db.pgQuery(
      'INSERT INTO quick_replies (client_id, title, text, sort_order) VALUES ($1, $2, $3, $4)',
      [clientId, r.title, r.text, r.sort_order]
    );
  }

  const { rows: after } = await db.pgQuery(
    'SELECT title FROM quick_replies WHERE client_id=$1 ORDER BY sort_order, id', [clientId]
  );
  console.log(`\nDone. ${clientId} now has ${after.length}: ${after.map(a => '/' + a.title).join(', ')}`);
  process.exit(0);
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
