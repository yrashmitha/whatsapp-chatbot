import { format, formatDistanceToNow, parseISO } from 'date-fns';

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

export function timeAgo(iso) {
  if (!iso) return '';
  try {
    return formatDistanceToNow(typeof iso === 'string' ? parseISO(iso) : iso, { addSuffix: true });
  } catch { return ''; }
}

export function formatPrice(price, priceMax, currency = 'LKR') {
  if (price == null) return '—';
  const fmt = n => Number(n).toLocaleString();
  return priceMax ? `${currency} ${fmt(price)}–${fmt(priceMax)}` : `${currency} ${fmt(price)}`;
}

export function cls(...args) {
  return args.filter(Boolean).join(' ');
}

export const STATUS_COLORS = {
  pending:          'bg-amber-100 text-amber-800',
  payment_received: 'bg-blue-100 text-blue-800',
  paid:             'bg-violet-100 text-violet-800',
  complete:         'bg-emerald-100 text-emerald-800',
  cancelled:        'bg-red-100 text-red-800',
};

export const STATUS_OPTIONS = ['pending', 'payment_received', 'paid', 'complete', 'cancelled'];
