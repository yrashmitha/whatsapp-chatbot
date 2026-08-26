import { format, formatDistanceToNow, parseISO, isSameDay, subDays } from 'date-fns';

export function formatTime(iso) {
  if (!iso) return '';
  try {
    return format(typeof iso === 'string' ? parseISO(iso) : iso, 'HH:mm');
  } catch { return ''; }
}

export function formatDate(iso) {
  if (!iso) return '';
  try {
    return format(typeof iso === 'string' ? parseISO(iso) : iso, 'MMM d, yyyy');
  } catch { return ''; }
}

export function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return format(typeof iso === 'string' ? parseISO(iso) : iso, 'MMM d, yyyy HH:mm');
  } catch { return ''; }
}

export function formatMessageTime(iso) {
  if (!iso) return '';
  try {
    const d = typeof iso === 'string' ? parseISO(iso) : iso;
    const now = new Date();
    if (isSameDay(d, now)) return format(d, 'HH:mm');
    if (isSameDay(d, subDays(now, 1))) return `Yesterday ${format(d, 'HH:mm')}`;
    return format(d, 'MMM d, HH:mm');
  } catch { return ''; }
}

export function timeAgo(iso) {
  if (!iso) return '';
  try {
    return formatDistanceToNow(typeof iso === 'string' ? parseISO(iso) : iso, { addSuffix: true });
  } catch { return ''; }
}

/**
 * A compact relative time, for places where width is the scarce thing.
 *
 * "less than a minute ago" is 22 characters in a column that has to share a
 * 290px row with a name, a status and several chips. WhatsApp shows "now" and
 * "23h" for the same reason.
 *
 * @param {string|Date} iso
 * @returns {string}
 */
export function timeAgoShort(iso) {
  if (!iso) return '';
  const then = typeof iso === 'string' ? parseISO(iso) : iso;
  const secs = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}

/**
 * Keys a customer name has been stored under, newest mistake last.
 *
 * The name goes wherever the client's order fields say, and pj's key has moved:
 * `name`, then `customer_name`, then `b` from 22 August after somebody edited
 * the field and mangled the key. Readers checked two of the three, so the name
 * silently stopped appearing. Mirrors backend/src/utils/customerName.js.
 */
const NAME_KEYS = ['customer_name', 'name', 'full_name', 'b'];

/**
 * The customer's name from an order's custom_fields, whatever key it is under.
 *
 * @param {Object|string|null} customFields
 * @param {string} [fallback]
 * @returns {string}
 */
export function customerNameFrom(customFields, fallback = '') {
  if (!customFields) return fallback;
  let cf = customFields;
  if (typeof cf === 'string') {
    try { cf = JSON.parse(cf); } catch { return fallback; }
  }
  if (typeof cf !== 'object') return fallback;
  for (const key of NAME_KEYS) {
    const v = cf[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return fallback;
}

export function formatPrice(price, priceMax, currency = 'LKR') {
  if (price == null) return '-';
  const fmt = n => Number(n).toLocaleString();
  return priceMax ? `${currency} ${fmt(price)}–${fmt(priceMax)}` : `${currency} ${fmt(price)}`;
}

export function cls(...args) {
  return args.filter(Boolean).join(' ');
}

export const STATUS_COLORS = {
  // Current statuses
  pending:          'bg-amber-100 text-amber-800',
  started:          'bg-blue-100 text-blue-800',
  // A slip has arrived and nobody has checked the bank yet. Amber on purpose:
  // it is a queue to work through, not a state to leave things in.
  payment_identified: 'bg-amber-100 text-amber-800',
  delivered:        'bg-violet-100 text-violet-800',
  done:             'bg-emerald-100 text-emerald-800',
  cancelled:        'bg-red-100 text-red-800',
  // Legacy statuses (display only — existing orders may still have these values)
  payment_received: 'bg-blue-100 text-blue-800',
  paid:             'bg-violet-100 text-violet-800',
  complete:         'bg-emerald-100 text-emerald-800',
};

export const STATUS_OPTIONS = ['pending', 'started', 'payment_identified', 'delivered', 'done', 'cancelled', 'payment_received'];

// All statuses including legacy values — used in filter dropdowns so old orders remain filterable
export const STATUS_FILTER_OPTIONS = ['pending', 'started', 'payment_identified', 'delivered', 'done', 'cancelled', 'payment_received', 'paid', 'complete'];
