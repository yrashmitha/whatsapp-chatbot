#!/usr/bin/env node
/**
 * @file Clear generation flags left behind by a process that died mid-run.
 *
 * Report generation runs as a detached background promise: the handler sets
 * `generating: true`, answers the browser, and lets the work continue. If the
 * process dies before it finishes — a redeploy, a restart, an out-of-memory
 * kill — nothing clears the flag and nothing records an error. The order then
 * shows a spinner forever and the CRM will not offer the generate button, so
 * an agent cannot retry a paid order at all.
 *
 * This finds those orders and clears the flags so they can be run again. It
 * never touches generated content, only the in-progress markers.
 *
 * A flag is only considered stale once `staleMinutes` have passed since it was
 * set. Orders whose flag predates the `*_generating_at` timestamps fall back to
 * the order's creation time, which is old enough to be unambiguous.
 *
 * Usage:
 *   node backend/scripts/clear-stuck-generation.js                 # list
 *   node backend/scripts/clear-stuck-generation.js --apply         # clear
 *   node backend/scripts/clear-stuck-generation.js --apply --minutes 30
 *   node backend/scripts/clear-stuck-generation.js --apply --order "PJ2026-0486"
 */

'use strict';

require('dotenv').config();
const { pgQuery } = require('../src/db/connection');

/** Flag key → the timestamp key written alongside it. */
const FLAGS = {
  generating:          'generating_at',
  match_generating:    'match_generating_at',
  marriage_generating: 'marriage_generating_at',
  quantum_generating:  'quantum_generating_at',
};

/** A run still going after this long is treated as dead. */
const DEFAULT_STALE_MINUTES = 20;

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const staleMinutes = parseInt(argValue('--minutes', DEFAULT_STALE_MINUTES), 10);
  const onlyOrder = argValue('--order', null);

  const conditions = Object.keys(FLAGS).map(f => `(horoscope_data->>'${f}')='true'`).join(' OR ');
  const params = [];
  let sql = `SELECT order_id, client_id, status, created_at, horoscope_data AS hd
               FROM orders WHERE (${conditions})`;
  if (onlyOrder) {
    params.push(onlyOrder);
    sql += ` AND order_id = $1`;
  }
  sql += ' ORDER BY created_at';

  const { rows } = await pgQuery(sql, params);
  if (!rows.length) {
    console.log('No orders are flagged as generating.');
    process.exit(0);
  }

  console.log(`${apply ? 'CLEARING' : 'DRY RUN'} — stale after ${staleMinutes} min\n`);
  let cleared = 0;
  let running = 0;

  for (const row of rows) {
    const hd = row.hd || {};
    const active = Object.keys(FLAGS).filter(f => String(hd[f]) === 'true');

    // Age from the flag's own timestamp when present, else the order's creation
    // time — anything from before timestamps existed is long dead by now.
    const stamps = active
      .map(f => hd[FLAGS[f]])
      .filter(Boolean)
      .map(t => new Date(t).getTime())
      .filter(n => !Number.isNaN(n));
    const startedAt = stamps.length ? Math.max(...stamps) : new Date(row.created_at).getTime();
    const ageMin = Math.floor((Date.now() - startedAt) / 60000);
    const stale = ageMin >= staleMinutes;

    const sections = hd.sections ? Object.keys(hd.sections).length : 0;
    const detail = `${row.order_id.padEnd(22)} ${String(row.client_id).padEnd(6)}`
      + ` flags=[${active.join(', ')}]`
      + ` age=${ageMin}min sections=${sections} status=${row.status}`;

    if (!stale) {
      running++;
      console.log(`  SKIP  ${detail}  — still within the window, may be running`);
      continue;
    }

    cleared++;
    console.log(`  ${apply ? 'CLEAR' : 'would clear'} ${detail}`);

    if (apply) {
      // Remove only the in-progress markers. Generated content is untouched,
      // and the guard below means a run that finished in the meantime is safe.
      const keys = active.flatMap(f => [f, FLAGS[f]]);
      const { rowCount } = await pgQuery(
        `UPDATE orders
            SET horoscope_data = horoscope_data - $1::text[]
          WHERE order_id = $2
            AND (${active.map(f => `(horoscope_data->>'${f}')='true'`).join(' OR ')})`,
        [keys, row.order_id]
      );
      if (!rowCount) console.log('        (already cleared by someone else — skipped)');
    }
  }

  console.log(`\n${cleared} stale, ${running} possibly still running.`);
  console.log(apply ? 'Done — these orders can be generated again from the CRM.'
                    : 'Dry run only — re-run with --apply to clear.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
