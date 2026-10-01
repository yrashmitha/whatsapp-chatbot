/**
 * Lead statuses and call outcomes. The keys mirror LEAD_STATUSES and
 * CALL_OUTCOMES in backend/src/controllers/leads.controller.js; a null status
 * is "new", a lead nobody has judged yet.
 */

export const LEAD_STATUSES = [
  { key: 'new',            label: 'New',            bg: 'rgba(148,163,184,0.18)', fg: '#64748b' },
  { key: 'interested',     label: 'Interested',     bg: 'rgba(34,197,94,0.16)',   fg: '#16a34a' },
  { key: 'thinking',       label: 'Thinking',       bg: 'rgba(245,158,11,0.18)',  fg: '#d97706' },
  { key: 'promised_payment', label: 'Promised payment', bg: 'rgba(20,184,166,0.18)', fg: '#0d9488' },
  { key: 'not_interested', label: 'Not interested', bg: 'rgba(239,68,68,0.16)',   fg: '#dc2626' },
  { key: 'wrong_number',   label: 'Wrong number',   bg: 'rgba(168,85,247,0.16)',  fg: '#9333ea' },
  { key: 'bought',         label: 'Bought',         bg: 'rgba(59,130,246,0.16)',  fg: '#2563eb' },
];

export const CALL_OUTCOMES = [
  { key: 'answered',      label: 'Answered' },
  { key: 'no_answer',     label: 'No answer' },
  { key: 'busy',          label: 'Busy' },
  { key: 'switched_off',  label: 'Switched off' },
  { key: 'not_reachable', label: 'Not reachable' },
  { key: 'call_back',     label: 'Call back later' },
];

/** A note with no call attached; shown in history, never offered as a call button. */
const NOTE_OUTCOME = { key: 'note', label: 'Note' };

export const statusMeta = (key) =>
  LEAD_STATUSES.find(s => s.key === (key || 'new')) || LEAD_STATUSES[0];

export const outcomeLabel = (key) =>
  [...CALL_OUTCOMES, NOTE_OUTCOME].find(o => o.key === key)?.label || key || '';

/** Today as YYYY-MM-DD on the viewer's clock (for date inputs and overdue colouring). */
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "5 Oct" from a YYYY-MM-DD string. */
export const shortDate = (s) => {
  if (!s) return '';
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
