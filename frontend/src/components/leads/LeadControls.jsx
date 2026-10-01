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

/** Button that opens a small form to record a call. */
export function LogCallButton({ phone, clientId, label = '📞 Log call', className = '', nextCallAt }) {
  const toast = useToast();
  const refresh = useRefreshLeads();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');

  const reset = () => { setOutcome(''); setDate(''); setNote(''); };
  const save = useMutation({
    mutationFn: () => api.post(`/customers/${encodeURIComponent(phone)}/calls`,
      { outcome, note, callback_on: outcome === 'call_back' ? date : undefined },
      { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => { toast.success('Call logged'); setOpen(false); reset(); refresh(phone); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not log call'),
  });

  const ready = outcome && (outcome !== 'call_back' || date);
  return (
    <div className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        className={className || 'text-xs px-2.5 py-1 rounded-full font-medium transition-colors bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-0 cursor-pointer'}
        title={nextCallAt ? `Call back on ${shortDate(nextCallAt)}` : 'Record a phone call'}
      >{nextCallAt ? `📞 ${shortDate(nextCallAt)}` : label}</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-3 flex flex-col gap-2 text-left">
          <div className="text-xs font-semibold text-slate-600">What happened on the call?</div>
          <div className="flex flex-wrap gap-1.5">
            {CALL_OUTCOMES.map(o => (
              <button key={o.key} onClick={() => setOutcome(o.key)}
                className={`text-xs px-2 py-1 rounded-full border cursor-pointer ${
                  outcome === o.key ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200'}`}
              >{o.label}</button>
            ))}
          </div>
          {outcome === 'call_back' && (
            <input type="date" value={date} min={todayStr()} onChange={e => setDate(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
            placeholder="Note (what they said, what they want)"
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400 resize-none" />
          <div className="flex gap-2">
            <button onClick={() => save.mutate()} disabled={!ready || save.isPending}
              className="text-xs px-3 py-1.5 rounded-lg border-0 bg-emerald-600 text-white cursor-pointer disabled:opacity-40"
            >{save.isPending ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setOpen(false)}
              className="text-xs px-2 py-1.5 rounded-lg border-0 bg-transparent text-slate-400 cursor-pointer ml-auto">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The full call history for one chat. */
export function CallHistory({ phone, clientId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['calls', phone, clientId],
    queryFn: () => api.get(`/customers/${encodeURIComponent(phone)}/calls`,
      { params: clientId ? { client_id: clientId } : {} }).then(r => r.data.calls),
  });
  if (isLoading) return <div className="text-xs text-slate-400 py-1">Loading…</div>;
  if (!data?.length) return <div className="text-xs text-slate-400 py-1">No calls logged yet.</div>;
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
      {data.map(c => (
        <li key={c.id} className="text-xs text-slate-600">
          <span className="font-semibold">{outcomeLabel(c.outcome)}</span>
          {c.callback_on && <span className="text-emerald-700"> → {shortDate(c.callback_on)}</span>}
          <span className="text-slate-400"> · {new Date(c.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{c.by_name ? ` · ${c.by_name}` : ''}</span>
          {c.note && <div className="text-slate-500">{c.note}</div>}
        </li>
      ))}
    </ul>
  );
}
