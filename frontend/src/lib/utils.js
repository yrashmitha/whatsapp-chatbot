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
  // Current statuses
  pending:          'bg-amber-100 text-amber-800',
  started:          'bg-blue-100 text-blue-800',
  delivered:        'bg-violet-100 text-violet-800',
  done:             'bg-emerald-100 text-emerald-800',
  cancelled:        'bg-red-100 text-red-800',
  // Legacy statuses (display only — existing orders may still have these values)
  payment_received: 'bg-blue-100 text-blue-800',
  paid:             'bg-violet-100 text-violet-800',
  complete:         'bg-emerald-100 text-emerald-800',
};

export const STATUS_OPTIONS = ['pending', 'started', 'delivered', 'done', 'cancelled', 'payment_received'];

// All statuses including legacy values — used in filter dropdowns so old orders remain filterable
export const STATUS_FILTER_OPTIONS = ['pending', 'started', 'delivered', 'done', 'cancelled', 'payment_received', 'paid', 'complete'];
