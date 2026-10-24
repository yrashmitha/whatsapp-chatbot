/**
 * Read-only facts about an order row, derived once so the list and the detail
 * drawer agree on them. Orders arrive with JSON columns that may be strings or
 * objects depending on the driver, so every parse goes through here.
 */

export function parseJson(raw, fallback = null) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** "payment_identified" reads better as "Payment identified". */
export function statusLabel(s) {
  if (!s) return '';
  const t = String(s).replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const toNumber = (v) => {
  const m = String(v ?? '').match(/[0-9][0-9, ]*(?:[.][0-9]+)?/);
  return m ? Number(m[0].replace(/[ ,]/g, '')) : 0;
};

/** What the customer is paying: a confirmed slip first, then the chosen package. */
export function orderAmount(cf) {
  if (!cf) return 0;
  const slip = toNumber(cf.payment_identified?.amount);
  if (slip) return slip;
  const direct = toNumber(cf.price);
  if (direct) return direct;
  if (Array.isArray(cf.items)) return cf.items.reduce((s, i) => s + toNumber(i?.price), 0);
  return 0;
}

export function orderFacts(o) {
  const cf = parseJson(o.custom_fields);
  const hd = parseJson(o.horoscope_data, {}) || {};
  const td = parseJson(o.tarot_data, {}) || {};
  const amount = orderAmount(cf);
  const product = cf?.product ? String(cf.product).split(/\s*[—–-]\s*Rs/i)[0].trim() : '';

  const marriageDone = Array.isArray(hd.marriage_sections_data) && hd.marriage_sections_data.length > 0;
  const matchDone = Array.isArray(hd.match_sections_data) && hd.match_sections_data.length > 0;
  const horoscopeDone = !!(hd.sections && Object.keys(hd.sections).length > 0);
  const tarotDone = !!(td.reading && td.cards);

  const generating = hd.generating === true || hd.quantum_generating === true
    || hd.marriage_generating === true || hd.match_generating === true || td.generating === true;
  const failed = !!(hd.error || hd.marriage_error || (hd.match_error && !matchDone) || td.error);

  // Which report this order is waiting on, by what was sold, so the list can
  // offer the right one without opening anything. Anything not clearly tarot
  // is a horoscope: that is what the business mostly sells.
  const isTarot = /tarot/i.test(String(cf?.product || '')) || tarotDone || td.generating === true || !!td.error;

  // What is being made right now, in words and with progress when the
  // generator reports it, so a row can say more than "generating".
  let activity = null;
  if (hd.generating === true || hd.quantum_generating === true) {
    activity = { label: 'Horoscope', percent: hd.progress?.percent ?? null, phase: hd.progress?.phase || null };
  } else if (hd.marriage_generating === true) {
    activity = { label: 'Marriage report', percent: null, phase: null };
  } else if (hd.match_generating === true) {
    activity = { label: 'Match making', percent: hd.match_progress?.percent ?? null, phase: hd.match_progress?.phase || null };
  } else if (td.generating === true) {
    activity = { label: 'Tarot reading', percent: null, phase: null };
  }

  return {
    cf, hd, td, isTarot, activity,
    name: o.customer_name || o.phone || o.phone_number || 'Unknown',
    phone: o.phone || o.phone_number || '',
    product,
    amount,
    summaryLine: [product, amount ? `Rs ${amount.toLocaleString()}` : ''].filter(Boolean).join(' · '),
    paymentIdentified: cf?.payment_identified || null,
    horoscopeDone, horoscopeError: hd.error || null,
    marriageDone, marriageError: hd.marriage_error || null,
    matchDone, matchError: hd.match_error || null,
    tarotDone, tarotError: td.error || null,
    generating, failed,
  };
}
