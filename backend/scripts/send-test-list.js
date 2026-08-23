#!/usr/bin/env node
/**
 * @file Send one of a client's interactive list menus to a real WhatsApp number.
 *
 * A list cannot be judged from JSON — the only way to know whether the titles
 * fit, the descriptions read well, and the tap works is to look at it on a
 * phone. This sends a configured menu so you can.
 *
 * WhatsApp only delivers interactive messages inside the 24-hour customer
 * service window, so message the bot from the target number first, then run
 * this within 24 hours. Outside the window Meta rejects it and the error is
 * printed rather than swallowed.
 *
 * Usage:
 *   node backend/scripts/send-test-list.js <clientId> --list          # show configured menus
 *   node backend/scripts/send-test-list.js <clientId> <menuId> <phone>
 */

'use strict';

require('dotenv').config();
const clientRouter = require('../src/services/clientRouter');
const { sendWhatsAppInteractiveList } = require('../src/services/whatsapp');

/** Meta's per-field limits, mirrored here so a preview can flag them. */
const LIMITS = { rowTitle: 24, rowDescription: 72, button: 20, header: 60, footer: 60, body: 1024 };

function preview(menu) {
  const flag = (v, max) => (String(v || '').length > max ? `  ⚠ ${String(v).length}/${max} — will be trimmed` : '');
  console.log(`  header : ${menu.header || '(none)'}${flag(menu.header, LIMITS.header)}`);
  console.log(`  body   : ${(menu.body || '').slice(0, 60)}${flag(menu.body, LIMITS.body)}`);
  console.log(`  button : ${menu.button || '(none)'}${flag(menu.button, LIMITS.button)}`);
  let n = 0;
  for (const sec of menu.sections || []) {
    console.log(`  section: ${sec.title || '(untitled)'}`);
    for (const r of sec.rows || []) {
      n++;
      console.log(`     ${n}. [${r.id}] ${r.title}${flag(r.title, LIMITS.rowTitle)}`);
      if (r.description) console.log(`        ${r.description}${flag(r.description, LIMITS.rowDescription)}`);
    }
  }
  if (n > 10) console.log(`  ⚠ ${n} rows — WhatsApp allows 10, the rest are dropped`);
}

async function main() {
  const [clientId, menuId, phone] = process.argv.slice(2);
  if (!clientId) {
    console.error('Usage: node backend/scripts/send-test-list.js <clientId> <menuId> <phone>');
    console.error('       node backend/scripts/send-test-list.js <clientId> --list');
    process.exit(1);
  }

  const client = await clientRouter.getClientById(clientId);
  if (!client) { console.error(`Client "${clientId}" not found.`); process.exit(1); }

  const menus = client.interactive_menus || {};
  const ids = Object.keys(menus);

  if (!menuId || menuId === '--list') {
    console.log(`Menus configured for ${clientId}: ${ids.length ? '' : '(none)'}`);
    for (const id of ids) {
      console.log(`\n[[LIST:${id}]]`);
      preview(menus[id]);
    }
    if (!ids.length) {
      console.log('  Set client_configs.interactive_menus to a JSON object of');
      console.log('  { "<id>": { body, button, sections: [{ title, rows: [{ id, title, description }] }] } }');
    }
    process.exit(0);
  }

  const menu = menus[menuId];
  if (!menu) {
    console.error(`No menu "${menuId}" for ${clientId}. Configured: ${ids.join(', ') || '(none)'}`);
    process.exit(1);
  }
  if (!phone) { console.error('A phone number is required to send.'); process.exit(1); }

  console.log(`Sending "${menuId}" to ${phone} as ${clientId}:\n`);
  preview(menu);

  const ok = await sendWhatsAppInteractiveList(phone, menu, client);
  if (!ok) {
    console.error('\nSend failed. The usual cause is the 24-hour window being shut —');
    console.error('message the bot from that number first, then run this again.');
    process.exit(1);
  }
  console.log('\nSent. Check the phone; tapping a row sends its title back as a normal message.');
  process.exit(0);
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
