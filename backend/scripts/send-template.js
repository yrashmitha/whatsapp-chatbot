/**
 * Send an approved WhatsApp template to customers who never paid.
 *
 * 266 people gave their birth details, got a price, and stopped. Nothing in the
 * bot can reach them: the 24-hour window closed long ago and only an approved
 * template gets through after that. This is the one route to the largest pool of
 * near-customers the business has.
 *
 * It is also the easiest thing here to do damage with. A marketing template is
 * charged per message, it lands on a phone unprompted, and a careless send is
 * how a business earns itself blocks and a quality-rating downgrade that hurts
 * every future message. So the defaults are cautious and everything is opt-in:
 *
 *   - dry run unless --apply
 *   - --limit caps a run, and is small by default
 *   - --days skips people who went quiet months ago, who did not ask for this
 *   - anyone messaged in the last 24 hours is skipped: they are reachable for
 *     free with an ordinary message, which is better and cheaper
 *   - anyone who already had this template is skipped, always
 *   - a pause between sends, so a burst does not look like a blast
 *
 * Every send is written into messages, so the CRM thread shows exactly what the
 * customer received and the operator is not answering blind.
 *
 *   node scripts/send-template.js --template re_engage_with_offer
 *   node scripts/send-template.js --template re_engage_with_offer --days 30 --limit 20 --apply
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const axios = require('axios');
const db = require('../src/db');
const { PAID_STATUSES } = require('../src/services/salesCredit');

const CLIENT = process.env.TEMPLATE_CLIENT || 'pj';
const APPLY = process.argv.includes('--apply');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const TEMPLATE = arg('--template', '');
const DAYS     = parseInt(arg('--days', '30'), 10);
const LIMIT    = parseInt(arg('--limit', '20'), 10);
const GAP_MS   = parseInt(arg('--gap', '3000'), 10);

/** Marked on every row we send, so a second run can see what the first did. */
const SENT_TAG = 'template_sent';

(async () => {
  if (!db.IS_PG) { console.error('This needs Postgres.'); process.exit(1); }
  if (!TEMPLATE) { console.error('Which template? Pass --template <name>.'); process.exit(1); }

  const { rows: cfgRows } = await db.pgQuery(
    `SELECT waba_id, wa_token, phone_number_id FROM client_configs WHERE client_id=$1`, [CLIENT]);
  const cfg = cfgRows[0];
  if (!cfg?.wa_token || !cfg?.phone_number_id) {
    console.error('No WhatsApp credentials for this client.'); process.exit(1);
  }

  // Read the template from Meta rather than trusting a local copy: it has to be
  // approved right now, and its components tell us what has to be supplied.
  const tplRes = await axios.get(
    `https://graph.facebook.com/v18.0/${cfg.waba_id}/message_templates`,
    { params: { access_token: cfg.wa_token, limit: 100 } }
  );
  const tpl = tplRes.data.data.find(t => t.name === TEMPLATE);
  if (!tpl) { console.error(`No template named "${TEMPLATE}" on this account.`); process.exit(1); }
  if (tpl.status !== 'APPROVED') {
    console.error(`"${TEMPLATE}" is ${tpl.status}, not APPROVED. Refusing to send.`); process.exit(1);
  }

  const header = (tpl.components || []).find(c => c.type === 'HEADER');
  const body   = (tpl.components || []).find(c => c.type === 'BODY');
  const bodyVars = (body?.text.match(/\{\{\d+\}\}/g) || []).length;
  if (bodyVars) {
    console.error(`"${TEMPLATE}" has ${bodyVars} variable(s) in its body; this script only sends`);
    console.error('templates with fixed text. Add the substitutions before using it.');
    process.exit(1);
  }

  // The approved sample image. Reusing it means what customers see is exactly
  // what Meta reviewed.
  const headerImage = arg('--image', header?.example?.header_handle?.[0] || '');
  if (header?.format === 'IMAGE' && !headerImage) {
    console.error('This template has an image header and no image was available.'); process.exit(1);
  }

  // Who to reach. Never paid anything, ordered recently enough to remember
  // doing so, quiet for at least a day, and not already sent this.
  const { rows: targets } = await db.pgQuery(
    `SELECT o.phone_number,
            MAX(o.created_at)  AS last_order,
            COUNT(*)::int      AS orders,
            MAX(cu.name)       AS name
       FROM orders o
       LEFT JOIN customers cu ON cu.phone_number = o.phone_number AND cu.client_id = o.client_id
      WHERE o.client_id = $1
        AND NOT (o.status = ANY($2))
        AND o.created_at > NOW() - ($3 || ' days')::interval
        AND o.phone_number IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM orders p
           WHERE p.phone_number = o.phone_number AND p.client_id = o.client_id
             AND p.status = ANY($2))
        AND NOT EXISTS (
          SELECT 1 FROM messages m
           WHERE m.phone_number = o.phone_number AND m.client_id = o.client_id
             AND m.created_at > NOW() - INTERVAL '24 hours')
        AND NOT EXISTS (
          SELECT 1 FROM messages m
           WHERE m.phone_number = o.phone_number AND m.client_id = o.client_id
             AND m.message_text LIKE $4)
      GROUP BY o.phone_number
      ORDER BY last_order DESC
      LIMIT $5`,
    [CLIENT, PAID_STATUSES, String(DAYS), `%[${SENT_TAG}:${TEMPLATE}]%`, LIMIT]
  );

  console.log(`  template : ${TEMPLATE} (${tpl.language}, ${tpl.category}, ${tpl.status})`);
  console.log(`  audience : never paid, ordered in the last ${DAYS} days, quiet 24h+`);
  console.log(`  matched  : ${targets.length} (capped at ${LIMIT})`);
  if (tpl.category === 'MARKETING') {
    console.log('  note     : MARKETING templates are charged per message and count');
    console.log('             towards each person\'s marketing limit.');
  }
  console.log('');
  targets.forEach(t => console.log(
    `    ...${t.phone_number.slice(-4)}  ${t.orders} unpaid order(s)  last ${t.last_order.toISOString().slice(0, 10)}  ${t.name || ''}`));

  if (!APPLY) {
    console.log('');
    console.log('  dry run - nothing sent. Re-run with --apply.');
    process.exit(0);
  }

  const components = [];
  if (header?.format === 'IMAGE') {
    components.push({ type: 'header', parameters: [{ type: 'image', image: { link: headerImage } }] });
  }

  let sent = 0, failed = 0;
  for (const t of targets) {
    try {
      const r = await axios.post(
        `https://graph.facebook.com/v18.0/${cfg.phone_number_id}/messages`,
        {
          messaging_product: 'whatsapp',
          to: t.phone_number,
          type: 'template',
          template: {
            name: TEMPLATE,
            language: { code: tpl.language },
            ...(components.length && { components }),
          },
        },
        { headers: { Authorization: `Bearer ${cfg.wa_token}`, 'Content-Type': 'application/json' } }
      );

      // Into the thread, so the CRM shows what they were sent and whoever picks
      // up the reply is not guessing what prompted it.
      const wamid = r.data?.messages?.[0]?.id || null;
      await db.pgQuery(
        `INSERT INTO messages (phone_number, client_id, sender_type, message_text, wamid, sent_by, sent_manual)
         VALUES ($1,$2,'bot',$3,$4,NULL,TRUE)`,
        [t.phone_number, CLIENT,
         `[${SENT_TAG}:${TEMPLATE}]\n${body?.text || ''}`, wamid]
      ).catch(e => console.warn('    (could not record in the thread:', e.message + ')'));

      sent++;
      console.log(`    sent ...${t.phone_number.slice(-4)}`);
    } catch (e) {
      failed++;
      const err = e?.response?.data?.error;
      console.warn(`    FAILED ...${t.phone_number.slice(-4)}: ${err?.error_data?.details || err?.message || e.message}`);
    }
    // Deliberate pause. A burst reads as a blast, to Meta and to people.
    await new Promise(r => setTimeout(r, GAP_MS));
  }

  console.log('');
  console.log(`  sent ${sent}, failed ${failed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
