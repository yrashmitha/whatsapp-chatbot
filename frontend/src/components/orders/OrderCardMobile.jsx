import { useState } from 'react';
import { formatDateTime } from '../../lib/utils';

const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

/** What a report button looks like in each state. Idle is quiet; the others earn colour. */
const REPORT_STYLE = {
  idle:  { background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border)' },
  busy:  { background: 'rgba(99,102,241,0.12)', color: 'var(--accent)', border: '1px solid transparent' },
  done:  { background: 'rgba(16,185,129,0.12)', color: '#047857', border: '1px solid transparent' },
  error: { background: '#fee2e2', color: '#b91c1c', border: '1px solid transparent' },
  locked: { background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)' },
};

/** One small report button: Horoscope, Match or Tarot, in whatever state it is in. */
export function ReportButton({ r }) {
  const state = r.busy ? 'busy' : r.error ? 'error' : r.done ? 'done' : r.locked ? 'locked' : 'idle';
  const text = r.busy ? `${r.label}${r.pct != null ? ` ${r.pct}%` : '...'}`
    : r.error ? `${r.label} !`
    : r.done ? `${r.label} ✓`
    : r.locked ? `🔒 ${r.label}`
    : r.label;
  return (
    <button type="button" disabled={r.busy} onClick={r.onClick}
      title={r.error ? `Failed: ${r.error}` : r.busy ? 'Generating' : r.done ? 'Open the report' : r.locked ? 'See what this does' : `Generate ${r.label.toLowerCase()}`}
      className="text-xs font-medium rounded-md px-2 py-1.5 cursor-pointer whitespace-nowrap flex items-center gap-1 disabled:cursor-default"
      style={REPORT_STYLE[state]}>
      {r.busy && (
        <span className="w-2.5 h-2.5 border-2 rounded-full animate-spin inline-block"
          style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
      )}
      {text}
    </button>
  );
}

/**
 * One order on a phone: three lines of what you scan by, the status and the
 * three reports on the fourth, and the AI summary underneath in small type.
 *
 * Phones get their own card rather than a squeezed table row. The web list
 * keeps its columns; this is the same order, laid out for a thumb. Tapping the
 * summary opens the rest (full summary, notes, last remark) in place, so
 * reading one never costs a trip into the drawer.
 *
 * @param {object}   props
 * @param {object}   props.o             the order row
 * @param {object}   props.f             orderFacts(o)
 * @param {boolean}  props.needsPayment  a slip arrived and payment is not confirmed
 * @param {boolean}  props.isOpen        its detail drawer is open
 * @param {boolean}  props.checked
 * @param {Function} props.onCheck       (checked) => void
 * @param {Function} props.onOpen        open the detail drawer
 * @param {Function} props.onChat        open the conversation
 * @param {object}   props.statusControl the status select, built by the page
 * @param {object}   props.metaMarker    the Lead / Purchase marks
 * @param {Array}    props.reports       [{key, label, busy, pct, done, error, locked, onClick}]
 */
export default function OrderCardMobile({
  o, f, needsPayment, isOpen, checked, onCheck, onOpen, onChat, statusControl, metaMarker, reports,
}) {
  const [more, setMore] = useState(false);
  const remarks = Array.isArray(o.remarks) ? o.remarks : [];
  const lastRemark = remarks.length ? remarks[remarks.length - 1] : null;
  const summary = o.ai_summary || '';
  const hasMore = !!(o.notes || lastRemark) || summary.length > 110;

  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}
      className="md:hidden rounded-xl px-3 py-2.5 cursor-pointer"
      style={{
        background: isOpen ? 'rgba(99,102,241,0.08)' : 'var(--bg-card)',
        border: `1px solid ${needsPayment ? '#f59e0b' : f.generating ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      <div className="flex items-start gap-2.5">
        <input type="checkbox" aria-label={`Select order ${o.order_id}`}
          checked={checked}
          onChange={e => onCheck(e.target.checked)}
          onClick={e => e.stopPropagation()}
          className="cursor-pointer mt-1" />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" title="Open chat"
              onClick={e => { e.stopPropagation(); onChat(); }}
              className="font-medium text-left bg-transparent border-0 p-0 cursor-pointer break-words min-w-0"
              style={{ color: 'var(--text-1)' }}>
              {f.name}
            </button>
            {f.amount > 0 && (
              <span className="text-sm font-medium shrink-0" style={{ color: 'var(--text-1)' }}>
                Rs {f.amount.toLocaleString()}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
              {f.phone} · #{o.order_id || o.id} · {formatDateTime(o.created_at)}
            </span>
            <span className="shrink-0" onClick={e => e.stopPropagation()}>{metaMarker}</span>
          </div>

          {needsPayment && (
            <div className="text-xs font-medium mt-1" style={{ color: '#92400e' }}>Slip received, confirm payment</div>
          )}

          <div className="flex items-center gap-1.5 mt-2 flex-wrap" onClick={e => e.stopPropagation()}>
            {statusControl}
            {reports.map(r => <ReportButton key={r.key} r={r} />)}
          </div>

          {(summary || hasMore) && (
            <div
              onClick={e => { e.stopPropagation(); if (hasMore) setMore(v => !v); }}
              className="mt-2 text-[11px] leading-snug"
              style={{ color: 'var(--text-2)', cursor: hasMore ? 'pointer' : 'default' }}>
              {summary && (
                <div className="break-words" style={{ whiteSpace: 'pre-wrap', ...(more ? {} : clamp2) }}>{summary}</div>
              )}
              {more && o.notes && (
                <div className="mt-1 break-words" style={{ whiteSpace: 'pre-wrap' }}>
                  <span style={{ color: 'var(--text-3)' }}>Notes: </span>{o.notes}
                </div>
              )}
              {more && lastRemark && (
                <div className="mt-1 break-words">
                  <span style={{ color: 'var(--text-3)' }}>Last remark: </span>{lastRemark.text}
                </div>
              )}
              {hasMore && (
                <span className="font-medium" style={{ color: 'var(--accent)' }}>{more ? 'Less' : 'More'}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
