/**
 * Repair payment amounts that were stored with their currency attached.
 *
 * One-off. The write path now cleans these on the way in; this fixes what is
 * already there. The original string is preserved as amount_raw so nobody has
 * to trust that this script read the slip the same way a human would.
 */
require(require('path').join(__dirname,'..','node_modules','dotenv')).config({ path: require('path').join(__dirname, '..', '.env') });
const db = require(require('path').join(__dirname,'..','src','db'));

function parseSlipAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const runs = String(raw).replace(/,/g, '').match(/[0-9]+(?:\.[0-9]+)?/g);
  if (!runs) return null;
  const n = parseFloat(runs.sort((a, b) => b.length - a.length)[0]);
  return Number.isFinite(n) ? n : null;
}

(async () => {
  const { rows: bad } = await db.pgQuery(
    "SELECT order_id, client_id, custom_fields->'payment_identified'->>'amount' AS amt " +
    "  FROM orders " +
    " WHERE custom_fields->'payment_identified'->>'amount' IS NOT NULL " +
    "   AND custom_fields->'payment_identified'->>'amount' !~ '^[0-9]+([.][0-9]+)?$'");

  for (const r of bad) {
    const clean = parseSlipAmount(r.amt);
    if (clean === null) { console.log('  skip (nothing numeric):', r.order_id, JSON.stringify(r.amt)); continue; }
    await db.pgQuery(
      "UPDATE orders SET custom_fields = jsonb_set(" +
      "    jsonb_set(custom_fields, '{payment_identified,amount_raw}', to_jsonb($2::text))," +
      "    '{payment_identified,amount}', to_jsonb($3::text)) " +
      " WHERE order_id = $1", [r.order_id, String(r.amt), clean.toFixed(2)]);
    console.log('  fixed', r.order_id, JSON.stringify(r.amt), '->', clean.toFixed(2));
  }
  if (!bad.length) console.log('  nothing to fix');
  process.exit(0);
})();
