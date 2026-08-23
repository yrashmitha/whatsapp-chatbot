import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

/**
 * The events an operator logs most often, one tap each.
 *
 * Ordered roughly by how a chase actually goes, so the one you want is usually
 * near where you last looked. These are operational labels rather than anything
 * client-specific, so the same list suits every tenant.
 */
const QUICK_REMARKS = [
  'Called', 'No Answer', '2nd Call', '3rd Call',
  'Messaged', 'Reminder Sent',
  'Payment Notified', 'Payment Received',
  'Confirmed', 'Rescheduled', 'Cancelled',
];

/**
 * The running log an operator keeps against an order.
 *
 * Deliberately separate from `notes`, which holds the AI's own summary and is
 * rewritten whenever it changes. Remarks are append-only history: "called, no
 * answer", "asked for a clearer slip". Losing those to an overwrite is how a
 * customer ends up being chased twice.
 *
 * @param {{orderId: string, remarks: Array, clientId: string|null}} props
 */
export default function OrderRemarks({ orderId, remarks, clientId }) {
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const params = clientId ? { client_id: clientId } : {};

  let list = remarks || [];
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) list = [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['orders'] });

  const add = useMutation({
    mutationFn: (body) => api.post(`/orders/${orderId}/remarks`, { text: body ?? text.trim() }, { params }),
    onSuccess: (_d, body) => { if (!body) setText(''); refresh(); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not add the remark'),
  });

  const remove = useMutation({
    mutationFn: (index) => api.delete(`/orders/${orderId}/remarks/${index}`, { params }),
    onSuccess: refresh,
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not remove the remark'),
  });

  const submit = (e) => {
    e?.preventDefault();
    if (text.trim() && !add.isPending) add.mutate();
  };

  const when = (ts) => {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 mb-1.5">
        Remarks{list.length ? ` (${list.length})` : ''}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {QUICK_REMARKS.map(chip => (
          <button
            key={chip}
            onClick={() => add.mutate(chip)}
            disabled={add.isPending}
            className="text-xs px-2.5 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600
                       hover:bg-violet-50 hover:border-violet-400 hover:text-violet-700
                       transition-colors cursor-pointer disabled:opacity-40"
          >{chip}</button>
        ))}
      </div>

      {list.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-2">
          {list.map((r, i) => (
            <div key={i} className="group flex items-start gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-700 whitespace-pre-wrap break-words">{r.text}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {when(r.ts)}{r.by ? ` · ${r.by}` : ''}
                </div>
              </div>
              <button
                onClick={() => remove.mutate(i)}
                disabled={remove.isPending}
                title="Remove this remark"
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-slate-300 hover:text-red-500 bg-transparent border-0 cursor-pointer px-1 shrink-0"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {list.length === 0 && (
        <div className="text-xs italic text-slate-400 mb-2">No remarks yet</div>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Add a remark…"
          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-violet-400 bg-white"
        />
        <button
          type="submit"
          disabled={!text.trim() || add.isPending}
          className="shrink-0 text-xs px-3 py-1.5 rounded-lg border-0 cursor-pointer font-medium bg-violet-600 text-white disabled:opacity-40"
        >{add.isPending ? 'Adding…' : 'Add'}</button>
      </form>
    </div>
  );
}
