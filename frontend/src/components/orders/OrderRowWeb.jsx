import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';
import { formatDateTime } from '../../lib/utils';
import { ReportButton } from './OrderCardMobile';

/** The grid the list header and every row share, so columns line up. */
export const WEB_COLS = '22px minmax(190px,1.2fr) minmax(120px,0.8fr) 168px auto 104px';

const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

/**
 * Add a remark without opening the order. Enter saves; the last remark shows
 * above the box so you see what was already said before adding to it.
 */
function InlineRemark({ o, clientId }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const remarks = Array.isArray(o.remarks) ? o.remarks : [];
  const last = remarks.length ? remarks[remarks.length - 1] : null;

  const add = useMutation({
    mutationFn: (body) => api.post(`/orders/${o.order_id}/remarks`, { text: body },
      clientId ? { params: { client_id: clientId } } : {}),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['orders'] }); toast.success('Remark added'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not add the remark'),
  });
  const submit = () => { const t = text.trim(); if (t && !add.isPending) add.mutate(t); };

  return (
    <div className="w-72 shrink-0" onClick={e => e.stopPropagation()}>
      {last && (
        <div className="text-[11px] truncate mb-1" style={{ color: 'var(--text-3)' }} title={last.text}>
          Last remark: {last.text}
        </div>
      )}
      <div className="flex gap-1.5">
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="Add a remark, press Enter"
          aria-label={`Add a remark to order ${o.order_id}`}
          className="flex-1 min-w-0 text-xs rounded-lg px-2.5 py-1.5 outline-none"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-1)', border: '1px solid var(--border)' }} />
        {text.trim() && (
          <button type="button" onClick={submit} disabled={add.isPending}
            className="text-xs font-medium text-white rounded-lg px-2.5 cursor-pointer border-0 disabled:opacity-60"
            style={{ background: 'var(--accent)' }}>
            {add.isPending ? '...' : 'Add'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One order on a desktop screen: everything an operator reaches for, in the row.
 *
 * Top line: who, what, status, the three reports, when. Underneath: the AI
 * summary (click to read it all) and a remark box. Only rare things, editing
 * order details and deleting, still need the drawer.
 *
 * @param {object}   props
 * @param {object}   props.o
 * @param {object}   props.f             orderFacts(o)
 * @param {boolean}  props.needsPayment
 * @param {boolean}  props.isOpen
 * @param {boolean}  props.checked
 * @param {Function} props.onCheck
 * @param {Function} props.onOpen        open the detail drawer
 * @param {Function} props.onChat
 * @param {object}   props.statusControl
 * @param {object}   props.metaMarker
 * @param {Array}    props.reports       same shape the phone card takes
 * @param {object}   [props.templateSent]
 * @param {boolean}  [props.showClient]  superadmin: show which client owns it
 * @param {string}   props.clientId
 */
export default function OrderRowWeb({
  o, f, needsPayment, isOpen, checked, onCheck, onOpen, onChat,
  statusControl, metaMarker, reports, templateSent, showClient, clientId,
}) {
  const [more, setMore] = useState(false);
  const summary = o.ai_summary || '';
  const notes = o.notes || '';
  const longText = summary.length > 150 || notes.length > 0;

  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}
      className="hidden md:block rounded-xl px-3 py-3 cursor-pointer"
      style={{
        background: isOpen ? 'rgba(99,102,241,0.08)' : 'var(--bg-card)',
        border: `1px solid ${needsPayment ? '#f59e0b' : f.generating ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      <div className="grid items-center gap-3" style={{ gridTemplateColumns: WEB_COLS }}>
        <input type="checkbox" aria-label={`Select order ${o.order_id}`}
          checked={checked}
          onChange={e => onCheck(e.target.checked)}
          onClick={e => e.stopPropagation()}
          className="cursor-pointer" />

        <div className="min-w-0">
          <button type="button" title="Open chat"
            onClick={e => { e.stopPropagation(); onChat(); }}
            className="font-medium text-left bg-transparent border-0 p-0 cursor-pointer break-words"
            style={{ color: 'var(--text-1)', ...clamp2 }}>
            {f.name}
          </button>
          <div className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
            {f.phone} · #{o.order_id || o.id}{showClient && o.client_id ? ` · ${o.client_id}` : ''}
          </div>
        </div>

        <div className="min-w-0">
          <div className="text-sm truncate" style={{ color: f.product ? 'var(--text-2)' : 'var(--text-3)' }}
            title={f.product || undefined}>
            {f.product || 'No product yet'}
          </div>
          <div className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>
            {f.amount > 0 ? `Rs ${f.amount.toLocaleString()}` : ''}
          </div>
        </div>

        <div onClick={e => e.stopPropagation()}>
          {statusControl}
          {needsPayment && (
            <div className="text-[11px] font-medium mt-1" style={{ color: '#92400e' }}>Slip received, confirm payment</div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
          {reports.map(r => <ReportButton key={r.key} r={r} />)}
        </div>

        <div className="text-xs text-right" onClick={e => e.stopPropagation()}>
          <div style={{ color: 'var(--text-3)' }}>{formatDateTime(o.created_at)}</div>
          <div className="mt-1 flex justify-end">{metaMarker}</div>
        </div>
      </div>

      <div className="flex items-start gap-4 mt-2.5 pl-[34px]">
        <div className="flex-1 min-w-0 text-xs leading-snug"
          onClick={e => { e.stopPropagation(); if (longText) setMore(v => !v); }}
          style={{ color: 'var(--text-2)', cursor: longText ? 'pointer' : 'default' }}>
          {templateSent && (
            <span className="inline-block text-[11px] px-1.5 py-0.5 rounded-md font-medium mr-2"
              style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309' }}
              title={`Already sent "${templateSent.template}" on ${new Date(templateSent.at).toLocaleString()}. Sending again is refused.`}>
              Template sent
            </span>
          )}
          {summary ? (
            <div className="break-words" style={{ whiteSpace: 'pre-wrap', ...(more ? {} : clamp2) }}>{summary}</div>
          ) : (
            <span style={{ color: 'var(--text-3)' }}>No summary yet</span>
          )}
          {more && notes && (
            <div className="mt-1 break-words" style={{ whiteSpace: 'pre-wrap' }}>
              <span style={{ color: 'var(--text-3)' }}>Notes: </span>{notes}
            </div>
          )}
          {longText && (
            <span className="font-medium" style={{ color: 'var(--accent)' }}>{more ? 'Less' : 'More'}</span>
          )}
        </div>
        <InlineRemark o={o} clientId={clientId} />
      </div>
    </div>
  );
}
