/**
 * @module db/adRules
 * @description Per-ad overrides: a specific welcome message and whether the
 * bot may reply at all to a customer who arrived through that ad.
 *
 * An ad with no row here is untouched — the normal bot flow runs exactly as
 * it does for a customer who arrived with no ad at all. This table only ever
 * narrows what happens, never changes the default.
 */

'use strict';

const { pool, db, IS_PG } = require('./connection');

/**
 * The rule for one ad, or null if that ad is unconfigured.
 *
 * @param {string} clientId
 * @param {string} adId
 * @returns {Promise<{welcome_message: string|null, off_mode: string}|null>}
 */
async function getAdRule(clientId, adId) {
  if (!adId) return null;
  if (IS_PG) {
    const r = await pool.query(
      `SELECT welcome_message, off_mode FROM ad_rules WHERE client_id=$1 AND ad_id=$2`,
      [clientId, adId]);
    return r.rows[0] || null;
  }
  const row = db.prepare(
    `SELECT welcome_message, off_mode FROM ad_rules WHERE client_id=? AND ad_id=?`
  ).get(clientId, adId);
  return row || null;
}

/**
 * Every configured ad for a client, joined with what is known about the ad
 * itself (name, campaign, thumbnail) so a settings page can list them by name
 * rather than by id.
 *
 * @param {string} clientId
 */
async function listAdRules(clientId) {
  if (!IS_PG) return [];
  const r = await pool.query(
    `SELECT r.ad_id, r.welcome_message, r.off_mode, r.updated_at,
            d.name AS ad_name, d.campaign_name, d.effective_status
       FROM ad_rules r
       LEFT JOIN ad_details d ON d.ad_id = r.ad_id
      WHERE r.client_id=$1
      ORDER BY r.updated_at DESC`,
    [clientId]);
  return r.rows;
}

/**
 * Ads a settings page can pick a rule for: every ad this client has received
 * clicks from, newest first, followed by the ads Meta lists for the ad account
 * that nobody has clicked into a chat yet. The second group exists so a welcome
 * message and bot mode can be set before the first click, not after the first
 * customer has already been answered the normal way. They only appear once Sync
 * from Meta has filled ad_details.
 *
 * @param {string} clientId
 */
async function listSeenAds(clientId) {
  if (!IS_PG) return [];
  const r = await pool.query(
    `SELECT * FROM (
       SELECT r.source_id AS ad_id, max(r.headline) AS headline, max(r.thumb_url) AS thumb_url,
              max(r.created_at) AS last_seen, count(*)::int AS clicks,
              d.name AS ad_name, d.campaign_name
         FROM ad_referrals r
         LEFT JOIN ad_details d ON d.ad_id = r.source_id
        WHERE r.client_id=$1 AND r.source_id IS NOT NULL
        GROUP BY r.source_id, d.name, d.campaign_name
       UNION ALL
       SELECT d.ad_id, NULL, NULL, NULL::timestamptz, 0, d.name, d.campaign_name
         FROM ad_details d
        WHERE d.client_id=$1
          AND COALESCE(d.effective_status, '') NOT IN ('DELETED', 'ARCHIVED')
          AND NOT EXISTS (SELECT 1 FROM ad_referrals r
                           WHERE r.client_id=$1 AND r.source_id = d.ad_id)
     ) ads
     ORDER BY last_seen DESC NULLS LAST, ad_name
     LIMIT 200`,
    [clientId]);
  return r.rows;
}

/**
 * Create or replace the rule for one ad.
 *
 * @param {string} clientId
 * @param {string} adId
 * @param {{welcomeMessage: string|null, offMode: 'off_immediately'|'off_after_reply'}} rule
 */
async function upsertAdRule(clientId, adId, { welcomeMessage, offMode }) {
  if (!IS_PG) return;
  await pool.query(
    `INSERT INTO ad_rules (client_id, ad_id, welcome_message, off_mode, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (client_id, ad_id)
     DO UPDATE SET welcome_message=$3, off_mode=$4, updated_at=NOW()`,
    [clientId, adId, welcomeMessage || null, offMode]);
}

/**
 * Remove an ad's rule, returning it to normal bot flow.
 */
async function deleteAdRule(clientId, adId) {
  if (!IS_PG) return;
  await pool.query(`DELETE FROM ad_rules WHERE client_id=$1 AND ad_id=$2`, [clientId, adId]);
}

/**
 * Mark that a customer is owed exactly one more bot reply before the chat
 * goes manual — the 'off_after_reply' ad had no welcome message, so the
 * bot's own next generated reply is the one reply, and the pause has to
 * happen just after it is sent.
 */
async function setOwedOneReply(clientId, phone) {
  if (!IS_PG) return;
  await pool.query(
    `INSERT INTO customer_settings (phone_number, client_id, ad_off_after_reply)
     VALUES ($1,$2,TRUE)
     ON CONFLICT (phone_number, client_id) DO UPDATE SET ad_off_after_reply=TRUE`,
    [phone, clientId]);
}

/**
 * Whether this customer is owed exactly one more bot reply before the chat
 * goes manual, and clear the flag either way — it is a one-shot check.
 *
 * @returns {Promise<boolean>}
 */
async function consumeOwedReply(clientId, phone) {
  if (!IS_PG) return false;
  const r = await pool.query(
    `UPDATE customer_settings SET ad_off_after_reply=FALSE
      WHERE client_id=$1 AND phone_number=$2 AND ad_off_after_reply=TRUE
      RETURNING phone_number`,
    [clientId, phone]);
  return r.rows.length > 0;
}

module.exports = {
  getAdRule, listAdRules, listSeenAds, upsertAdRule, deleteAdRule,
  setOwedOneReply, consumeOwedReply,
};
