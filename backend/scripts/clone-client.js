#!/usr/bin/env node
/**
 * @file Create a new white-label client by cloning an existing client's
 * report setup (prompt, order fields, report plugin configs, add-ons).
 *
 * Built for report-only clients: no WhatsApp number, AI chat off, no knowledge
 * base, no catalog. The new client gets their own identity and brings their own
 * API keys.
 *
 * What is deliberately NOT copied, because it is the source client's identity,
 * a secret, or must be unique:
 *   - WhatsApp ids and tokens, webhook token, owner/contact phone
 *   - Gemini and freeastroapi keys (and the system-key opt-ins: both stay OFF,
 *     so a missing key fails closed instead of billing the platform)
 *   - order id prefix, brand name, logo, signature, invocation, divider,
 *     PDF metadata, package/billing fields, pixel/CAPI settings
 *   - orders, customers, messages, knowledge chunks
 *
 * After cloning it scans the copied text for the source client's name, id,
 * prefix and phone numbers and lists every hit, so a prompt that still says
 * "Pahantharu" is caught before a customer sees it. It reports; it never
 * rewrites your prompt.
 *
 * Dry run unless --apply. With --apply the source config is first written to a
 * timestamped JSON backup in the current directory, then everything is created
 * in one transaction.
 *
 * Usage:
 *   node backend/scripts/clone-client.js --id aj --name "Divine Whispers by AJ" --prefix DW
 *   node backend/scripts/clone-client.js --id aj --name "Divine Whispers by AJ" --prefix DW --apply
 *   ... [--from pj] [--footer "Divine Whispers by AJ"] [--font "Abhaya Libre"]
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, pgQuery, IS_PG } = require('../src/db/connection');

/** Columns never copied, by exact name. */
const NEVER_COPY = new Set([
  'client_id', 'created_at', 'updated_at',
  'phone_number_id', 'wa_token_env', 'wa_token', 'use_system_wa_token', 'webhook_verify_token',
  'gemini_api_key', 'use_system_gemini_key', 'freeastro_api_key', 'use_system_freeastro_key',
  'order_id_prefix', 'brand_name', 'logo_url', 'contact_number', 'owner_phone', 'admin_password_env',
  'package_id', 'bonus_messages', 'overage_limit', 'per_message_cost',
  'report_signature', 'report_footer', 'report_invocation', 'report_divider',
  'report_logo_url', 'report_logo_width', 'report_logo_height',
  'pdf_title', 'pdf_author', 'pdf_subject', 'pdf_producer',
  'waba_id', 'wa_dataset_id', 'crm_password_hash',
]);

/** Anything that looks like a credential, a phone number or an ad-tracking id. */
const RISKY_NAME = /token|secret|key|password|phone|pixel|capi|meta_|waba|whatsapp|dataset/i;

/**
 * Plugin configs and add-ons that send conversion events to Meta. Cloning these
 * would make the new client report its sales into the source client's dataset
 * and corrupt that client's ad optimisation, so they are never copied. The new
 * client gets none until their own pixel and token are set up.
 */
const META_EVENT_ID = /meta|capi|pixel|conversion|dataset/i;

/**
 * Plugins and add-ons that are the source client's private business or only make
 * sense with WhatsApp chat: operator commission, and chat follow-up messages
 * (which carry the source's phone number). Add to this when a client needs them.
 */
const NOT_FOR_REPORT_ONLY = /^(commission|follow_up_generator|crm_media_send|horoscope_followup_qa)$/i;

/** Forced values for a report-only client. */
const FORCED = {
  ai_enabled: false,
  plugin_enabled: false,
  knowledge_base_enabled: false,
  product_catalog_enabled: false,
  order_flow_enabled: true,
};

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}

/** Build the strings that identify the source client inside copied text. */
function sourceTerms(src, cfg) {
  const raw = [
    src.id, src.name, cfg.brand_name, cfg.order_id_prefix,
    cfg.contact_number, cfg.owner_phone, 'pahantharu',
  ];
  return [...new Set(raw
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(v => v.length >= 2))];
}

/** Find source-identity terms in a block of text. */
function scan(label, text, terms) {
  const hits = [];
  if (!text) return hits;
  for (const term of terms) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let m;
    let count = 0;
    let first = null;
    while ((m = re.exec(text)) !== null) {
      count++;
      if (!first) {
        const s = Math.max(0, m.index - 30);
        first = text.slice(s, m.index + term.length + 30).replace(/\s+/g, ' ');
      }
    }
    if (count) hits.push({ label, term, count, sample: first });
  }
  return hits;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const from = arg('--from', 'pj');
  const id = arg('--id');
  const name = arg('--name');
  const prefix = arg('--prefix');
  const footer = arg('--footer', '{brand}');
  const font = arg('--font');

  if (!id || !name || !prefix) {
    console.error('Usage: node backend/scripts/clone-client.js --id <id> --name "<Brand>" --prefix <ORDER_PREFIX> [--from pj] [--footer "<text>"] [--font "<font>"] [--apply]');
    process.exit(1);
  }
  if (!/^[a-z0-9_-]{2,30}$/.test(id)) {
    console.error('--id must be 2-30 chars of lowercase letters, digits, - or _.');
    process.exit(1);
  }
  if (!IS_PG) {
    console.error('Refusing to run: no PostgreSQL DATABASE_URL configured.');
    process.exit(1);
  }

  const { rows: [src] } = await pgQuery('SELECT * FROM clients WHERE id=$1', [from]);
  const { rows: [srcCfg] } = await pgQuery('SELECT * FROM client_configs WHERE client_id=$1', [from]);
  if (!src || !srcCfg) {
    console.error(`Source client "${from}" not found.`);
    process.exit(1);
  }

  const { rows: exists } = await pgQuery('SELECT 1 FROM clients WHERE id=$1', [id]);
  if (exists.length) { console.error(`Client "${id}" already exists. Nothing done.`); process.exit(1); }
  const { rows: userClash } = await pgQuery('SELECT 1 FROM crm_users WHERE username=$1', [id]);
  if (userClash.length) {
    console.error(`A CRM user named "${id}" already exists; the client login would be shadowed. Pick another id.`);
    process.exit(1);
  }
  const { rows: pfx } = await pgQuery(
    'SELECT client_id FROM client_configs WHERE LOWER(order_id_prefix)=LOWER($1)', [prefix]);
  if (pfx.length) {
    console.error(`Order prefix "${prefix}" is already used by "${pfx[0].client_id}". Pick another.`);
    process.exit(1);
  }

  // Decide which config columns are copied.
  const copied = {};
  const skippedRisky = [];
  for (const [col, val] of Object.entries(srcCfg)) {
    if (NEVER_COPY.has(col) || col in FORCED) continue;
    if (RISKY_NAME.test(col)) { skippedRisky.push(col); continue; }
    copied[col] = val;
  }

  const { rows: allPlugins } = await pgQuery(
    'SELECT plugin_id, config FROM plugin_configs WHERE client_id=$1', [from]);
  const { rows: allAddons } = await pgQuery(
    'SELECT addon_id, enabled FROM client_addons WHERE client_id=$1', [from]);

  // Meta conversion events must never be inherited (see META_EVENT_ID).
  const plugins = allPlugins.filter(p => !META_EVENT_ID.test(p.plugin_id) && !NOT_FOR_REPORT_ONLY.test(p.plugin_id));
  const addons  = allAddons.filter(a => !META_EVENT_ID.test(a.addon_id) && !NOT_FOR_REPORT_ONLY.test(a.addon_id));
  const otherSkipped = allPlugins.filter(p => NOT_FOR_REPORT_ONLY.test(p.plugin_id)).map(p => p.plugin_id);
  const metaSkipped = [
    ...allPlugins.filter(p => META_EVENT_ID.test(p.plugin_id)).map(p => `plugin:${p.plugin_id}`),
    ...allAddons.filter(a => META_EVENT_ID.test(a.addon_id)).map(a => `addon:${a.addon_id}`),
  ];
  // Dataset ids to hunt for in copied text, so none can hide in a prompt.
  const datasetIds = [
    srcCfg.wa_dataset_id,
    ...allPlugins.filter(p => META_EVENT_ID.test(p.plugin_id)).map(p => p.config && p.config.pixel_id),
  ].filter(Boolean).map(String);

  // The legacy freeastro key used to live inside the plugin config. Never clone it.
  for (const p of plugins) {
    if (p.config && typeof p.config === 'object') delete p.config.api_key;
  }

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}: clone "${from}" -> "${id}" (${name})`);
  console.log('='.repeat(72));
  console.log(`clients row        type=${src.type}`);
  console.log(`client_configs     ${Object.keys(copied).length} columns copied`);
  console.log(`  forced           ${Object.entries(FORCED).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  own identity     brand_name="${name}", order prefix=${prefix}, footer="${footer}"`
    + (font ? `, font=${font}` : ''));
  console.log(`  keys             Gemini + freeastro EMPTY, system-key opt-ins OFF (fails closed)`);
  if (skippedRisky.length) console.log(`  also skipped     ${skippedRisky.join(', ')}`);
  console.log(`plugin_configs     ${plugins.map(p => p.plugin_id).join(', ') || 'none'}`);
  console.log(`client_addons      ${addons.map(a => `${a.addon_id}${a.enabled ? '' : ' (off)'}`).join(', ') || 'none'}`);
  if (otherSkipped.length) console.log(`not for report-only NOT copied: ${otherSkipped.join(', ')}`);
  console.log(`META EVENTS        NOT copied: ${metaSkipped.join(', ') || '(source has none)'}`
    + `\n                   new client has no pixel, dataset or token, so it sends no events to ${from}'s dataset`);

  // Scan everything textual that is about to be copied.
  const terms = [...sourceTerms(src, srcCfg), ...datasetIds];
  const hits = [];
  for (const [col, val] of Object.entries(copied)) {
    if (val == null) continue;
    hits.push(...scan(`client_configs.${col}`, typeof val === 'string' ? val : JSON.stringify(val), terms));
  }
  for (const p of plugins) {
    hits.push(...scan(`plugin_configs.${p.plugin_id}`, JSON.stringify(p.config), terms));
  }
  console.log(`\nSource-identity scan for: ${terms.join(' | ')}`);
  if (!hits.length) {
    console.log('  clean: no hits in the copied text.');
  } else {
    for (const h of hits) {
      console.log(`  ${String(h.count).padStart(3)}x "${h.term}" in ${h.label}\n        ...${h.sample}...`);
    }
    console.log('  Fix these in the new client\'s settings after cloning.');
  }

  if (!apply) {
    console.log('\n' + '='.repeat(72));
    console.log('Dry run only. Re-run with --apply to create the client.');
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${from}_backup_before_clone_${id}_${stamp}.json`;
  fs.writeFileSync(backup, JSON.stringify({ client: src, config: srcCfg, plugins, addons }, null, 2));
  console.log(`\nBackup written: ${backup}`);
  console.log('WARNING: that backup contains the source client\'s secrets. Do not commit it.');

  // The owner login is the client id plus this password (same model as pj's).
  // Generated here and shown once; only the bcrypt hash is stored.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const password = Array.from(crypto.randomBytes(14), b => alphabet[b % alphabet.length]).join('');
  const passwordHash = await bcrypt.hash(password, 10);

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query('INSERT INTO clients (id, name, type) VALUES ($1,$2,$3)', [id, name, src.type]);

    const row = {
      ...copied,
      ...FORCED,
      client_id: id,
      brand_name: name,
      order_id_prefix: prefix,
      report_footer: footer,
      crm_password_hash: passwordHash,
      use_system_gemini_key: false,
      use_system_freeastro_key: false,
    };
    if (font) row.report_font = font;
    const cols = Object.keys(row);
    const vals = cols.map(c => {
      const v = row[c];
      // pg serialises plain objects as JSON already, but arrays need an explicit string for JSONB.
      return Array.isArray(v) ? JSON.stringify(v) : v;
    });
    await conn.query(
      `INSERT INTO client_configs (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      vals
    );

    for (const p of plugins) {
      await conn.query(
        'INSERT INTO plugin_configs (client_id, plugin_id, config) VALUES ($1,$2,$3)',
        [id, p.plugin_id, JSON.stringify(p.config || {})]);
    }
    for (const a of addons) {
      await conn.query(
        'INSERT INTO client_addons (client_id, addon_id, enabled) VALUES ($1,$2,$3)',
        [id, a.addon_id, a.enabled]);
    }
    // Belt and braces: prove the new client cannot send Meta events.
    const leak = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM client_addons WHERE client_id=$1 AND addon_id ~* 'meta|capi|pixel|conversion') AS addons,
         (SELECT COUNT(*) FROM plugin_configs WHERE client_id=$1 AND plugin_id ~* 'meta|capi|pixel|conversion') AS plugins,
         (SELECT COALESCE(waba_id,'') || COALESCE(wa_dataset_id,'') FROM client_configs WHERE client_id=$1) AS wa`,
      [id]);
    const l = leak.rows[0];
    if (Number(l.addons) || Number(l.plugins) || l.wa) {
      throw new Error('Meta event settings leaked into the new client; rolled back.');
    }
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }

  console.log(`\nCreated client "${id}".`);
  console.log('\nLOGIN (shown once, not stored anywhere in plain text):');
  console.log(`  username: ${id}`);
  console.log(`  password: ${password}`);
  console.log('\nStill to do by hand:');
  console.log('  1. Paste his Gemini key and freeastroapi key in Clients settings');
  console.log('  2. Set report_signature / report_invocation / logo if he wants them');
  console.log('  3. Fix any prompt hits listed above');
  console.log('  4. Create a test order, generate each report, check the footer, then delete it');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
