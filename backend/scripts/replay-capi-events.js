/**
 * Send stored conversions to a dataset that was not reachable at the time.
 *
 * pj's sales currently go to the WhatsApp dataset, which carries proper
 * click-to-WhatsApp attribution, and are mirrored to one the spending ad account
 * can actually see. When Meta unlocks the new business portfolio and the good
 * dataset becomes reachable, the sales made in between still need to get there.
 * Every event body is kept in meta_capi_log for exactly that.
 *
 * READ THIS BEFORE PLANNING A REPLAY
 *
 * Meta rejects events whose event_time is more than **7 days** old. That is the
 * hard limit on this whole idea: a sale from three weeks ago cannot be replayed
 * with its real timestamp, and re-stamping it as today would tell Meta a sale
 * happened when it did not, corrupting the attribution windows the replay
 * exists to serve. So this is a catch-up tool for a gap of days, not months.
 *
 * For anything older, Meta's offline conversions upload accepts a 62 day window
 * and is the right route - --csv writes a file for it.
 *
 * Deduplication is handled: each event carries event_id, so a sale that somehow
 * reaches a dataset twice is still counted once.
 *
 *   node scripts/replay-capi-events.js --to 937202389422096
 *   node scripts/replay-capi-events.js --to 937202389422096 --apply
 *   node scripts/replay-capi-events.js --to 937202389422096 --csv out.csv
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs   = require('fs');
const axios = require('axios');
const db   = require('../src/db');

const CLIENT = process.env.REPLAY_CLIENT || 'pj';
const APPLY  = process.argv.includes('--apply');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

const TARGET   = arg('--to');
const CSV_PATH = arg('--csv');
const SINCE    = arg('--since') || '30 days';

/** Meta refuses anything older than this. */
const MAX_AGE_DAYS = 7;

(async () => {
  if (!db.IS_PG) { console.error('This needs Postgres.'); process.exit(1); }
  if (!TARGET)   { console.error('Which dataset? Pass --to <dataset_id>.'); process.exit(1); }

  // Sales this dataset has not already been told about. A single sale can have
  // rows for several datasets, so the check is per dataset, not per order.
  const { rows } = await db.pgQuery(
    `SELECT DISTINCT ON (event_id) id, event_name, event_id, order_id, payload, created_at
       FROM meta_capi_log
      WHERE client_id = $1
        AND status = 'ok'
        AND payload IS NOT NULL
        AND created_at > NOW() - $2::interval
        AND event_id NOT IN (
          SELECT event_id FROM meta_capi_log
           WHERE client_id = $1 AND dataset_id = $3 AND status = 'ok' AND event_id IS NOT NULL
        )
      ORDER BY event_id, created_at DESC`,
    [CLIENT, SINCE, TARGET]
  );

  if (!rows.length) {
    console.log(`  nothing to replay to ${TARGET} — it already has everything from the last ${SINCE}`);
    process.exit(0);
  }

  const cutoff = Date.now() / 1000 - MAX_AGE_DAYS * 86400;
  const fresh  = rows.filter(r => (r.payload?.event_time || 0) >= cutoff);
  const stale  = rows.filter(r => (r.payload?.event_time || 0) < cutoff);

  console.log(`  ${rows.length} event(s) missing from ${TARGET}`);
  console.log(`    ${fresh.length} within Meta's ${MAX_AGE_DAYS}-day window, replayable`);
  if (stale.length) {
    console.log(`    ${stale.length} older than ${MAX_AGE_DAYS} days — Meta will refuse these.`);
    console.log(`      Use --csv and upload them as offline conversions (62-day window) instead.`);
  }

  if (CSV_PATH) {
    // Meta's offline conversions upload wants its own shape. The phone is
    // already hashed in the payload; that is the form the upload expects.
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['email,phone,event_time,event_name,value,currency,order_id'];
    for (const r of rows) {
      const p = r.payload || {};
      lines.push([
        '', esc((p.user_data?.ph || [])[0]),
        esc(new Date((p.event_time || 0) * 1000).toISOString()),
        esc(p.event_name), esc(p.custom_data?.value ?? ''),
        esc(p.custom_data?.currency ?? ''), esc(r.order_id),
      ].join(','));
    }
    fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf8');
    console.log(`\n  wrote ${rows.length} row(s) to ${CSV_PATH}`);
  }

  if (!APPLY) {
    console.log('\n  dry run — nothing sent. Re-run with --apply.');
    process.exit(0);
  }

  // The dataset decides the credential: the WhatsApp one only accepts the
  // WhatsApp token, and any other only accepts the plugin's.
  const cfgRow = await db.pgQuery(
    'SELECT wa_token, wa_dataset_id FROM client_configs WHERE client_id=$1', [CLIENT]);
  const plugin = await db.getPluginConfig(CLIENT, 'meta_conversions');
  const token  = (TARGET === cfgRow.rows[0]?.wa_dataset_id)
    ? cfgRow.rows[0].wa_token
    : plugin.api_key;
  if (!token) { console.error('  no access token for that dataset'); process.exit(1); }

  let sent = 0, failed = 0;
  for (const r of fresh) {
    try {
      const res = await axios.post(
        `https://graph.facebook.com/v18.0/${TARGET}/events`,
        { data: [r.payload], access_token: token },
        { headers: { 'Content-Type': 'application/json' } }
      );
      sent += res.data.events_received || 0;
      await db.pgQuery(
        `INSERT INTO meta_capi_log
           (client_id, event_name, phone_last4, status, detail,
            payload, dataset_id, event_id, order_id, action_source, replayed_at)
         VALUES ($1,$2,$3,'ok',$4,$5,$6,$7,$8,$9,NOW())`,
        [CLIENT, r.event_name, null, `replayed to ${TARGET}`,
         JSON.stringify(r.payload), TARGET, r.event_id, r.order_id,
         r.payload.action_source]
      ).catch(() => {});
    } catch (e) {
      failed++;
      const err = e?.response?.data?.error;
      console.warn(`    ${r.event_id}: ${err?.error_user_msg || err?.message || e.message}`);
    }
  }

  console.log(`\n  replayed ${sent}, failed ${failed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
