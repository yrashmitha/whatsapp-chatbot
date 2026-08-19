#!/usr/bin/env node
/**
 * @file Seed a client's report branding and plugin config from a JSON file.
 *
 * Written for the white-label migration: values that used to be hardcoded
 * defaults now live per client, and an existing client needs theirs written
 * once. It is equally usable for onboarding, as an alternative to typing
 * everything into the CRM by hand.
 *
 * The values live in a JSON file passed on the command line, never in this
 * repo — a client's personas and disclaimers are their content, not product
 * code, and committing one client's text is exactly what this migration
 * exists to undo.
 *
 * Non-destructive by design: a key that already has a value is left alone and
 * reported as "kept". Re-running is therefore safe. Dry-run unless --apply.
 *
 * Usage:
 *   node backend/scripts/seed-client-config.js <clientId> <values.json>
 *   node backend/scripts/seed-client-config.js <clientId> <values.json> --apply
 *
 * Expected JSON shape:
 *   {
 *     "branding":          { "report_signature": "...", "pdf_title": "...", ... },
 *     "horoscope_reading": { "fixed_instructions": "...", "match_sections": [...] },
 *     "tarot_reading":     { "page1_heading": "..." },
 *     "addons":            ["match_making", "income_summary"]
 *   }
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pgQuery, IS_PG } = require('../src/db/connection');

/** Branding columns this script is allowed to write. */
const BRANDING_COLUMNS = [
  'report_signature', 'report_footer', 'report_invocation', 'report_divider',
  'report_font', 'report_logo_url', 'pdf_title', 'pdf_author', 'pdf_subject', 'pdf_producer',
];

/** Column definitions, so the script works before the app has migrated the schema. */
const COLUMN_DDL = [
  ...BRANDING_COLUMNS.map(c => `${c} TEXT`),
  'report_logo_width INT NOT NULL DEFAULT 160',
  'report_logo_height INT NOT NULL DEFAULT 160',
  'freeastro_api_key TEXT',
  'use_system_freeastro_key BOOLEAN NOT NULL DEFAULT FALSE',
];

/** True when a config value counts as "already set". */
function isSet(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function preview(v) {
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v && typeof v === 'object') return `object(${Object.keys(v).length})`;
  const s = String(v);
  return s.length > 45 ? `${s.slice(0, 45)}… (${s.length} chars)` : s;
}

async function main() {
  const [clientId, valuesPath] = process.argv.slice(2);
  const apply = process.argv.includes('--apply');

  if (!clientId || !valuesPath) {
    console.error('Usage: node backend/scripts/seed-client-config.js <clientId> <values.json> [--apply]');
    process.exit(1);
  }
  if (!IS_PG) {
    console.error('Refusing to run: no PostgreSQL DATABASE_URL configured.');
    process.exit(1);
  }

  const values = JSON.parse(fs.readFileSync(path.resolve(valuesPath), 'utf8'));

  const { rows: clientRows } = await pgQuery('SELECT id, name FROM clients WHERE id = $1', [clientId]);
  if (!clientRows.length) {
    console.error(`Client "${clientId}" does not exist.`);
    process.exit(1);
  }

  console.log(`\n${apply ? 'APPLYING TO' : 'DRY RUN for'}  ${clientRows[0].name} (${clientId})`);
  console.log('='.repeat(72));

  // ── Columns ────────────────────────────────────────────────────────────────
  // Nullable additions, invisible to any older code still running against this
  // database, so this is safe to run before the new build is deployed.
  if (apply) {
    for (const ddl of COLUMN_DDL) {
      await pgQuery(`ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS ${ddl}`);
    }
    console.log(`\n[schema]  ensured ${COLUMN_DDL.length} columns exist on client_configs`);
  } else {
    const { rows } = await pgQuery(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'client_configs' AND column_name = ANY($1)`,
      [BRANDING_COLUMNS]
    );
    console.log(`\n[schema]  ${rows.length}/${BRANDING_COLUMNS.length} branding columns present`
      + (rows.length ? '' : ' — would be added'));
  }

  // ── Branding ───────────────────────────────────────────────────────────────
  const branding = values.branding || {};
  const brandingKeys = Object.keys(branding).filter(k => BRANDING_COLUMNS.includes(k));
  if (brandingKeys.length) {
    let current = {};
    if (apply) {
      const { rows } = await pgQuery(
        `SELECT ${BRANDING_COLUMNS.join(', ')} FROM client_configs WHERE client_id = $1`, [clientId]);
      current = rows[0] || {};
    }
    console.log('\n[branding]');
    const setCols = [];
    const setVals = [];
    for (const k of brandingKeys) {
      if (apply && isSet(current[k])) {
        console.log(`  kept  ${k.padEnd(20)} (already set)`);
        continue;
      }
      setVals.push(branding[k]);
      setCols.push(`${k}=$${setVals.length}`);
      console.log(`  set   ${k.padEnd(20)} ${preview(branding[k])}`);
    }
    if (apply && setCols.length) {
      setVals.push(clientId);
      await pgQuery(
        `UPDATE client_configs SET ${setCols.join(', ')}, updated_at=NOW() WHERE client_id=$${setVals.length}`,
        setVals
      );
    }
  }

  // ── Plugin configs ─────────────────────────────────────────────────────────
  for (const pluginId of Object.keys(values)) {
    if (pluginId === 'branding' || pluginId === 'addons') continue;
    const incoming = values[pluginId];

    const { rows } = await pgQuery(
      'SELECT config FROM plugin_configs WHERE client_id=$1 AND plugin_id=$2', [clientId, pluginId]);
    const existing = (rows[0] && rows[0].config) || {};
    const merged = { ...existing };

    console.log(`\n[${pluginId}]`);
    let changed = 0;
    for (const [k, v] of Object.entries(incoming)) {
      if (v === '__FROM_CLIENT_SECTIONS__') {
        // The remedies label drives the document split, so it must match one of
        // the client's own section labels character for character. Resolve it
        // from their stored sections instead of trusting a transcribed string.
        const sections = merged.horoscope_sections || [];
        const hit = sections.find(s => /පිළියම්|පිලියම්|remed/i.test(s.label || ''));
        if (!hit) {
          console.log(`  SKIP  ${k.padEnd(28)} (no remedies-like section found to match)`);
          continue;
        }
        if (isSet(merged[k])) { console.log(`  kept  ${k.padEnd(28)} (already set)`); continue; }
        merged[k] = hit.label;
        changed++;
        console.log(`  set   ${k.padEnd(28)} ${preview(hit.label)}  ← matched from this client's sections`);
        continue;
      }
      if (isSet(merged[k])) {
        console.log(`  kept  ${k.padEnd(28)} (already set, ${preview(merged[k])})`);
        continue;
      }
      merged[k] = v;
      changed++;
      console.log(`  set   ${k.padEnd(28)} ${preview(v)}`);
    }

    if (apply && changed) {
      await pgQuery(
        `INSERT INTO plugin_configs (client_id, plugin_id, config)
         VALUES ($1, $2, $3)
         ON CONFLICT (client_id, plugin_id) DO UPDATE SET config = EXCLUDED.config`,
        [clientId, pluginId, JSON.stringify(merged)]
      );
    }
  }

  // ── Migrate the freeastroapi key out of plugin_configs ─────────────────────
  if (apply) {
    const { rows } = await pgQuery(
      `SELECT pc.config->>'api_key' AS k FROM plugin_configs pc
        WHERE pc.client_id=$1 AND pc.plugin_id='horoscope_reading'`, [clientId]);
    const legacyKey = rows[0] && rows[0].k;
    if (legacyKey) {
      const { rowCount } = await pgQuery(
        `UPDATE client_configs SET freeastro_api_key=$1
          WHERE client_id=$2 AND (freeastro_api_key IS NULL OR freeastro_api_key='')`,
        [legacyKey, clientId]
      );
      console.log(`\n[keys]    freeastroapi key ${rowCount ? 'copied to client_configs' : 'already set'}`);
    }
    // Without an explicit opt-in the new resolver fails closed, which would take
    // an existing client offline. Record the fallback they are already using.
    const { rowCount: g } = await pgQuery(
      `UPDATE client_configs SET use_system_gemini_key=TRUE
        WHERE client_id=$1 AND COALESCE(gemini_api_key,'')='' AND use_system_gemini_key=FALSE`,
      [clientId]
    );
    if (g) console.log('[keys]    no own Gemini key — recorded explicit system-key opt-in');
    const { rowCount: f } = await pgQuery(
      `UPDATE client_configs SET use_system_freeastro_key=TRUE
        WHERE client_id=$1 AND COALESCE(freeastro_api_key,'')='' AND use_system_freeastro_key=FALSE`,
      [clientId]
    );
    if (f) console.log('[keys]    no own freeastroapi key — recorded explicit system-key opt-in');
  }

  // ── Addons ─────────────────────────────────────────────────────────────────
  if (Array.isArray(values.addons) && values.addons.length) {
    console.log('\n[addons]');
    for (const addonId of values.addons) {
      const { rows } = await pgQuery(
        'SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id=$2', [clientId, addonId]);
      if (rows.length) {
        console.log(`  kept  ${addonId.padEnd(20)} (already ${rows[0].enabled ? 'enabled' : 'disabled'})`);
        continue;
      }
      console.log(`  set   ${addonId.padEnd(20)} enabled`);
      if (apply) {
        await pgQuery(
          `INSERT INTO client_addons (client_id, addon_id, enabled) VALUES ($1,$2,TRUE)
           ON CONFLICT (client_id, addon_id) DO NOTHING`, [clientId, addonId]);
      }
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log(apply ? 'Done.' : 'Dry run only — re-run with --apply to write.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
