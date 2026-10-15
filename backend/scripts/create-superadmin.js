#!/usr/bin/env node
/**
 * @file Create (or re-password) a superadmin login in crm_users.
 *
 * Superadmin is never created through the app's own API (crmUsers.controller
 * only ever inserts role='client' operators, scoped to one client) — it's a
 * deliberate gap, so escalating to it is a one-off operator action, not
 * something any logged-in account can do to itself or anyone else.
 *
 * Dry-run unless --apply, same convention as seed-client-config.js.
 *
 * Usage:
 *   node backend/scripts/create-superadmin.js <username> <password>
 *   node backend/scripts/create-superadmin.js <username> <password> --apply
 */

'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pgQuery } = require('../src/db/connection');

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--apply');
  const apply = process.argv.includes('--apply');
  const [username, password] = args;

  if (!username || !password) {
    console.error('Usage: node backend/scripts/create-superadmin.js <username> <password> [--apply]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const existing = await pgQuery(`SELECT id, role FROM crm_users WHERE username=$1`, [username]);
  const clash = await pgQuery(`SELECT 1 FROM clients WHERE id=$1`, [username]);
  if (clash.rows.length && !existing.rows.length) {
    console.error(`"${username}" is a client id. A crm_users username must not collide with one — that shadows the client's own login.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);

  if (!apply) {
    if (existing.rows.length) {
      console.log(`[dry run] Would reset the password for existing user "${username}" (current role: ${existing.rows[0].role}) and set role=superadmin.`);
    } else {
      console.log(`[dry run] Would create a new superadmin user "${username}".`);
    }
    console.log('Re-run with --apply to write it.');
    process.exit(0);
  }

  if (existing.rows.length) {
    await pgQuery(`UPDATE crm_users SET password_hash=$2, role='superadmin' WHERE username=$1`, [username, hash]);
    console.log(`Updated "${username}": password reset, role=superadmin.`);
  } else {
    await pgQuery(
      `INSERT INTO crm_users (username, password_hash, role) VALUES ($1,$2,'superadmin')`,
      [username, hash]
    );
    console.log(`Created superadmin "${username}".`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
