import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

/** "2026-11-24 09:30" -> "Nov 24, 9:30 AM" for reading. */
function pretty(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(local || '');
  if (!m) return local || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A time a little ahead, as the date picker wants it: "YYYY-MM-DDTHH:mm". */
function inAnHour() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** What is scheduled for this chat, and the window it must fit in. */
export function useScheduled(phone, clientId) {
  return useQuery({
    queryKey: ['scheduled-msgs', phone, clientId],
    queryFn: () => api.get(`/customers/${phone}/scheduled`, { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!phone,
    refetchInterval: 60_000,
    retry: false,
  });
}

/**
 * The bar above the message box: each message waiting to go, with Cancel.
 * Shows nothing when nothing is scheduled.
 */
export function ScheduledBar({ phone, clientId }) {
  const { data } = useScheduled(phone, clientId);
  const qc = useQueryClient();
  const toast = useToast();
  const items = data?.scheduled || [];
  if (!items.length) return null;
  const cancel = (id) => api.delete(`/customers/${phone}/scheduled/${id}`, { params: clientId ? { client_id: clientId } : {} })
    .then(() => { toast.success('Scheduled message cancelled'); qc.invalidateQueries({ queryKey: ['scheduled-msgs', phone] }); })
    .catch(() => toast.error('Could not cancel it. Try again.'));
  return (
    <div className="px-3 py-2 border-t border-slate-200 bg-amber-50 space-y-1.5">
      {items.map(s => (
        <div key={s.id} className="flex items-start gap-2 text-xs text-amber-900">
          <span className="shrink-0">⏰</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">Scheduled for {pretty(s.send_at_local)}{s.cancel_if_reply ? ' · stops if they reply first' : ''}</div>
            <div className="truncate text-amber-800">{s.message}</div>
          </div>
          <button type="button" onClick={() => cancel(s.id)}
            className="shrink-0 text-xs font-semibold text-red-600 bg-transparent border-0 cursor-pointer px-1">Cancel</button>
        </div>
      ))}
    </div>
  );
}

/** The "Schedule a message" window. */
export function ScheduleDialog({ phone, clientId, initialText = '', onClose }) {
  const { data } = useScheduled(phone, clientId);
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(initialText);
  const [when, setWhen] = useState(inAnHour());
  const [cancelIfReply, setCancelIfReply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closes = data?.window_closes_local;

  const save = async () => {
    setError(''); setBusy(true);
    try {
      await api.post(`/customers/${phone}/schedule`,
        { message: text, send_at: when.replace('T', ' '), cancel_if_reply: cancelIfReply },
        { params: clientId ? { client_id: clientId } : {} });
      qc.invalidateQueries({ queryKey: ['scheduled-msgs', phone] });
      toast.success('Message scheduled');
      onClose();
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not schedule it. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-800 mb-2">Schedule a message</h2>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4} autoFocus
          placeholder="Write the message to send later"
          className="w-full text-base border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 resize-y mb-2" />
        <label className="block text-xs text-slate-500 mb-1">Send at</label>
        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
          className="w-full text-base border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 mb-1" />
        <div className="text-xs mb-2" style={{ color: closes ? '#64748b' : '#dc2626' }}>
          {closes
            ? `WhatsApp delivers until ${pretty(closes)} (24 hours after their last message).`
            : data ? 'Their 24 hour window is closed, so WhatsApp will not deliver a normal message now.' : ' '}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 mb-2 cursor-pointer">
          <input type="checkbox" checked={cancelIfReply} onChange={e => setCancelIfReply(e.target.checked)} />
          Don't send if they reply before then
        </label>
        {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-transparent border border-slate-200 text-slate-600 cursor-pointer">Cancel</button>
          <button type="button" onClick={save} disabled={busy || !text.trim() || !when}
            className="px-4 py-2 text-sm font-semibold rounded-lg border-0 bg-violet-600 text-white cursor-pointer disabled:opacity-50">
            {busy ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
