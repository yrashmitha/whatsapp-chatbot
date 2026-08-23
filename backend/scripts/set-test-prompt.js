#!/usr/bin/env node
/**
 * @file Load a draft system prompt into a client's Test Chat sandbox.
 *
 * Writes client_configs.test_system_prompt, which only ever applies to
 * `web:test_*` sessions. Live customers keep the saved custom_prompt until
 * someone deliberately copies the draft across, so a prompt can be tried
 * against real behaviour with nothing at stake.
 *
 * Usage:
 *   node backend/scripts/set-test-prompt.js <clientId> <prompt.txt>
 *   node backend/scripts/set-test-prompt.js <clientId> --clear
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pgQuery, IS_PG } = require('../src/db/connection');

async function main() {
  const [clientId, arg] = process.argv.slice(2);
  if (!clientId || !arg) {
    console.error('Usage: node backend/scripts/set-test-prompt.js <clientId> <prompt.txt|--clear>');
    process.exit(1);
  }
  if (!IS_PG) {
    console.error('Refusing to run: no PostgreSQL DATABASE_URL configured.');
    process.exit(1);
  }

  const clearing = arg === '--clear';
  const prompt = clearing ? null : fs.readFileSync(path.resolve(arg), 'utf8');

  const { rowCount } = await pgQuery(
    'UPDATE client_configs SET test_system_prompt = $1 WHERE client_id = $2',
    [prompt, clientId]
  );
  if (!rowCount) {
    console.error(`Client "${clientId}" has no config row.`);
    process.exit(1);
  }

  console.log(clearing
    ? `Cleared the Test Chat draft prompt for ${clientId}.`
    : `Loaded a ${prompt.length}-character draft prompt into Test Chat for ${clientId}.`);
  console.log('Live customers are unaffected — this applies to test sessions only.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
