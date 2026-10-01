import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';
import Modal from '../ui/Modal';
import { LEAD_STATUSES, CALL_OUTCOMES, statusMeta, outcomeLabel, todayStr, shortDate } from '../../lib/leads';

/** Every list that shows lead data refreshes after a change here. */
function useRefreshLeads() {
  const qc = useQueryClient();
  return (phone) => {
    qc.invalidateQueries({ queryKey: ['leads'] });
    qc.invalidateQueries({ queryKey: ['leads-summary'] });
    qc.invalidateQueries({ queryKey: ['lead'] });
    qc.invalidateQueries({ queryKey: ['customers'] });
    if (phone) qc.invalidateQueries({ queryKey: ['calls', phone] });
  };
}

export function StatusBadge({ status }) {
  const m = statusMeta(status);
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
          style={{ background: m.bg, color: m.fg }}>{m.label}</span>
  );
}

/** One-click lead status picker, coloured like the badge it sets. */
export function LeadStatusSelect({ phone, clientId, value, disabled }) {
  const toast = useToast();
  const refresh = useRefreshLeads();
  const m = statusMeta(value);
  const save = useMutation({
    mutationFn: (status) => api.patch(`/customers/${encodeURIComponent(phone)}/lead-status`,
      { status: status === 'new' ? null : status }, { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => refresh(phone),
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not change status'),
  });
  return (
    <select
      value={value || 'new'}
      disabled={disabled || save.isPending}
      onChange={e => save.mutate(e.target.value)}
      onClick={e => e.stopPropagation()}
      className="text-xs font-medium rounded-full px-2 py-1 border-0 outline-none cursor-pointer disabled:opacity-60"
      style={{ background: m.bg, color: m.fg }}
      title="Lead quality"
    >
      {LEAD_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  );
}

/**
 * Button that opens a small panel to record a call.
 *
 * Clicking an outcome saves it straight away (any note already typed goes with
 * it). "Call back later" is the one exception: it needs a day, and choosing the
 * day saves. A note on its own gets a Save button only once there is text.
 */
export function LogCallButton({ phone, clientId, label = '📞 Log call', className = '', nextCallAt }) {
  const toast = useToast();
  const refresh = useRefreshLeads();
  const [open, setOpen] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const [note, setNote] = useState('');

  const close = () => { setOpen(false); setPickingDate(false); setNote(''); };
  const save = useMutation({
    mutationFn: ({ outcome, callback_on }) => api.post(`/customers/${encodeURIComponent(phone)}/calls`,
      { outcome, note, callback_on },
      { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: (_r, v) => {
      toast.success(v.outcome === 'note' ? 'Note saved' : 'Call logged');
      close(); refresh(phone);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not save'),
  });

  const hasNote = note.trim().length > 0;
  return (
    <div className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        className={className || 'text-xs px-2.5 py-1 rounded-full font-medium transition-colors bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-0 cursor-pointer'}
        title={nextCallAt ? `Call back on ${shortDate(nextCallAt)}` : 'Record a phone call'}
      >{nextCallAt ? `📞 ${shortDate(nextCallAt)}` : label}</button>
      {open && (
        <div className="fixed inset-x-3 top-28 md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-1 z-40 md:w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-3 flex flex-col gap-2 text-left">
          <div className="flex items-center">
            <div className="text-xs font-semibold text-slate-600">What happened on the call?</div>
            <button onClick={close}
              className="text-xs px-2 py-0.5 border-0 bg-transparent text-slate-400 cursor-pointer ml-auto">✕</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CALL_OUTCOMES.map(o => (
              <button key={o.key} disabled={save.isPending}
                onClick={() => (o.key === 'call_back' ? setPickingDate(true) : save.mutate({ outcome: o.key }))}
                className={`text-xs px-2 py-1 rounded-full border cursor-pointer disabled:opacity-50 ${
                  o.key === 'call_back' && pickingDate
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'}`}
              >{o.label}</button>
            ))}
          </div>
          {pickingDate && (
            <label className="text-xs text-slate-500 flex items-center gap-2">
              Call on
              <input type="date" min={todayStr()} autoFocus
                onChange={e => e.target.value && save.mutate({ outcome: 'call_back', callback_on: e.target.value })}
                className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
            </label>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
            placeholder="Note (optional)"
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400 resize-none" />
          {hasNote && (
            <button onClick={() => save.mutate({ outcome: 'note' })} disabled={save.isPending}
              className="text-xs px-3 py-1.5 rounded-lg border-0 bg-emerald-600 text-white cursor-pointer disabled:opacity-40 self-start"
            >{save.isPending ? 'Saving…' : 'Save note'}</button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The last call and the promised day, as a compact right-aligned button that
 * sits in the orders row. Clicking it opens the full history, so an operator
 * never needs the Leads page to check what was tried.
 */
export function LeadStrip({ phone, name, clientId, lead }) {
  const [open, setOpen] = useState(false);
  const last = lead?.last_call;
  if (!last && !lead?.next_call_at) return null;
  const overdue = lead.next_call_at && lead.next_call_at < todayStr();
  return (
    <>
      <button onClick={() => setOpen(true)} title="View call history"
        className="min-w-0 flex items-center gap-1.5 pl-2 pr-3 py-1.5 text-xs bg-transparent border-0 cursor-pointer hover:bg-slate-50">
        <span>📞</span>
        {last && (
          <span className="min-w-0 truncate text-slate-600">
            <span className="font-semibold">{outcomeLabel(last.outcome)}</span>
            <span className="text-slate-400"> · {shortDate(last.created_at)}</span>
            {last.note && <span className="hidden md:inline text-slate-500"> · {last.note}</span>}
          </span>
        )}
        {lead.next_call_at && (
          <span className={`font-medium shrink-0 ${overdue ? 'text-red-600' : 'text-emerald-700'}`}>
            {overdue ? 'Overdue ' : 'Call '}{shortDate(lead.next_call_at)}
          </span>
        )}
        {lead.call_count > 0 && <span className="shrink-0 text-slate-400">({lead.call_count})</span>}
      </button>
      <LeadHistoryModal open={open} onClose={() => setOpen(false)} phone={phone} name={name}
        clientId={clientId} status={lead?.lead_status} nextCallAt={lead?.next_call_at} />
    </>
  );
}

const OUTCOME_TONE = {
  answered:      { bg: 'rgba(34,197,94,0.16)',   fg: '#16a34a' },
  no_answer:     { bg: 'rgba(239,68,68,0.14)',   fg: '#dc2626' },
  busy:          { bg: 'rgba(245,158,11,0.18)',  fg: '#d97706' },
  switched_off:  { bg: 'rgba(148,163,184,0.2)',  fg: '#64748b' },
  not_reachable: { bg: 'rgba(148,163,184,0.2)',  fg: '#64748b' },
  call_back:     { bg: 'rgba(59,130,246,0.16)',  fg: '#2563eb' },
  note:          { bg: 'rgba(168,85,247,0.14)',  fg: '#9333ea' },
};

const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The full call history for one chat, newest first, notes in full. */
export function CallHistory({ phone, clientId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['calls', phone, clientId],
    queryFn: () => api.get(`/customers/${encodeURIComponent(phone)}/calls`,
      { params: clientId ? { client_id: clientId } : {} }).then(r => r.data.calls),
  });
  if (isLoading) return <div className="text-sm text-slate-400 py-2">Loading…</div>;
  if (!data?.length) return <div className="text-sm text-slate-400 py-2">No calls or notes logged yet.</div>;
  // Attempts are counted oldest first (the list is newest first), notes excluded.
  const calls = data.filter(c => c.outcome !== 'note');
  const attemptNo = new Map(calls.slice().reverse().map((c, i) => [c.id, i + 1]));
  const tally = {};
  calls.forEach(c => { tally[c.outcome] = (tally[c.outcome] || 0) + 1; });
  return (
    <>
    {calls.length > 0 && (
      <div className="text-xs text-slate-500 mb-3">
        <span className="font-semibold text-slate-700">{calls.length} call attempt{calls.length > 1 ? 's' : ''}</span>
        {' · '}{Object.entries(tally).map(([k, n]) => `${n} ${outcomeLabel(k)}`).join(', ')}
      </div>
    )}
    <ul className="m-0 p-0 list-none flex flex-col gap-3">
      {data.map(c => {
        const tone = OUTCOME_TONE[c.outcome] || OUTCOME_TONE.note;
        return (
          <li key={c.id} className="border border-slate-100 rounded-lg px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {attemptNo.has(c.id) && <span className="text-xs font-semibold text-slate-400">#{attemptNo.get(c.id)}</span>}
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: tone.bg, color: tone.fg }}>
                {outcomeLabel(c.outcome)}
              </span>
              {c.callback_on && <span className="text-xs font-medium text-blue-700">Call back {shortDate(c.callback_on)}</span>}
              <span className="text-xs text-slate-400 ml-auto">{when(c.created_at)}{c.by_name ? ` · ${c.by_name}` : ''}</span>
            </div>
            {c.note && <div className="text-sm text-slate-700 mt-1.5 whitespace-pre-wrap break-words">{c.note}</div>}
          </li>
        );
      })}
    </ul>
    </>
  );
}

/** A popup with everything logged for one number. */
export function LeadHistoryModal({ open, onClose, phone, name, clientId, status, nextCallAt }) {
  const overdue = nextCallAt && nextCallAt < todayStr();
  return (
    <Modal open={open} onClose={onClose} title={name ? `${name} · ${phone}` : phone} maxWidth="max-w-xl">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <StatusBadge status={status} />
        {nextCallAt
          ? <span className={`text-xs font-medium ${overdue ? 'text-red-600' : 'text-emerald-700'}`}>
              {overdue ? 'Overdue, was due ' : 'Call back '}{shortDate(nextCallAt)}</span>
          : <span className="text-xs text-slate-400">No call-back set</span>}
      </div>
      <CallHistory phone={phone} clientId={clientId} />
    </Modal>
  );
}
