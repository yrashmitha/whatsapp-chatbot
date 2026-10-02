import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';
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

/**
 * Everything an operator does to a lead, in the order they do it: set the
 * status, log what happened on the call, read what was tried before. Status and
 * outcome buttons save on one tap. It lives in a popover on a narrow screen and
 * is laid out in the open on a wide one, so it carries no chrome of its own.
 */
export function LeadBody({ phone, clientId, lead, canEdit = true }) {
  const toast = useToast();
  const refresh = useRefreshLeads();
  const [pickingDate, setPickingDate] = useState(false);
  const [note, setNote] = useState('');
  const params = clientId ? { client_id: clientId } : {};
  const base = `/customers/${encodeURIComponent(phone)}`;

  const setStatus = useMutation({
    mutationFn: (status) => api.patch(`${base}/lead-status`, { status: status === 'new' ? null : status }, { params }),
    onSuccess: () => refresh(phone),
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not change status'),
  });
  const logCall = useMutation({
    mutationFn: ({ outcome, callback_on }) => api.post(`${base}/calls`, { outcome, note, callback_on }, { params }),
    onSuccess: (_r, v) => {
      toast.success(v.outcome === 'note' ? 'Note saved' : 'Call logged');
      setNote(''); setPickingDate(false); refresh(phone);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not save'),
  });

  const hasNote = note.trim().length > 0;
  const heading = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5';

  return (
    <div className="flex flex-col gap-4 text-left">
      <section>
        <div className={heading}>Status</div>
        <div className="flex flex-wrap gap-1.5">
          {LEAD_STATUSES.map(st => {
            const on = (lead?.lead_status || 'new') === st.key;
            return (
              <button key={st.key} disabled={!canEdit || setStatus.isPending}
                onClick={() => !on && setStatus.mutate(st.key)}
                className="text-xs px-2.5 py-1.5 rounded-full cursor-pointer disabled:opacity-60"
                style={on ? { background: st.fg, color: '#fff', border: `1px solid ${st.fg}` }
                          : { background: 'transparent', color: st.fg, border: `1px solid ${st.bg}` }}
              >{st.label}</button>
            );
          })}
        </div>
      </section>

      {canEdit && (
        <section>
          <div className={heading}>Log a call (tap to save)</div>
          <div className="flex flex-wrap gap-1.5">
            {CALL_OUTCOMES.map(o => (
              <button key={o.key} disabled={logCall.isPending}
                onClick={() => (o.key === 'call_back' ? setPickingDate(true) : logCall.mutate({ outcome: o.key }))}
                className={`text-xs px-2.5 py-1.5 rounded-full border cursor-pointer disabled:opacity-50 ${
                  o.key === 'call_back' && pickingDate
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'}`}
              >{o.label}</button>
            ))}
          </div>
          {pickingDate && (
            <label className="mt-2 text-xs text-slate-500 flex items-center gap-2">
              Call on
              <input type="date" min={todayStr()} autoFocus
                onChange={e => e.target.value && logCall.mutate({ outcome: 'call_back', callback_on: e.target.value })}
                className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
            </label>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
            placeholder="Note (optional, saved with the call you tap)"
            className="mt-2 w-full text-sm md:text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400 resize-none" />
          {hasNote && (
            <button onClick={() => logCall.mutate({ outcome: 'note' })} disabled={logCall.isPending}
              className="mt-1.5 text-xs px-3 py-1.5 rounded-lg border-0 bg-emerald-600 text-white cursor-pointer disabled:opacity-40"
            >{logCall.isPending ? 'Saving…' : 'Save note only'}</button>
          )}
        </section>
      )}

      <section>
        <div className={heading}>History</div>
        <CallHistory phone={phone} clientId={clientId} />
      </section>
    </div>
  );
}

/**
 * The lead control for a narrow screen: a chip that reads as a summary (status,
 * last call, promised day) and opens the whole body in a panel.
 */
export function LeadPanel({ phone, clientId, lead, canEdit = true }) {
  const [open, setOpen] = useState(false);
  const m = statusMeta(lead?.lead_status);
  const last = lead?.last_call;
  const overdue = lead?.next_call_at && lead.next_call_at < todayStr();

  return (
    <div className="relative min-w-0">
      <button onClick={() => setOpen(v => !v)} title="Lead status, call log and history"
        aria-haspopup="dialog" aria-expanded={open}
        className="max-w-full flex items-center gap-1.5 text-xs pl-2.5 pr-2 py-1.5 rounded-full border-0 cursor-pointer"
        style={{ background: m.bg, color: m.fg }}>
        <span className="font-semibold shrink-0">{m.label}</span>
        {last && <span className="truncate opacity-80">· {outcomeLabel(last.outcome)} {shortDate(last.created_at)}</span>}
        {lead?.next_call_at && (
          <span className="shrink-0 font-semibold" style={overdue ? { color: '#dc2626' } : undefined}>
            · {overdue ? 'Overdue' : 'Call'} {shortDate(lead.next_call_at)}
          </span>
        )}
        <span className="shrink-0 opacity-60">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Lead"
            className="fixed inset-x-3 top-16 md:absolute md:inset-x-auto md:right-0 md:left-auto md:top-full md:mt-1 md:w-96 z-40 max-h-[75vh] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl p-3">
            <div className="flex items-center mb-2">
              <div className="text-sm font-semibold text-slate-700">Lead</div>
              <button onClick={() => setOpen(false)}
                className="ml-auto text-sm px-1 border-0 bg-transparent text-slate-500 cursor-pointer" aria-label="Close">✕</button>
            </div>
            <LeadBody phone={phone} clientId={clientId} lead={lead} canEdit={canEdit} />
          </div>
        </>
      )}
    </div>
  );
}
