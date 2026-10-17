import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { useToast } from './ui/Toast';

/**
 * The welcome a customer gets when they open a chat without clicking an ad.
 *
 * It is one of the client's quick replies, picked per strategy, and it is sent
 * as the whole reply to their first message whatever that message says. Edit the
 * text under Quick Replies. Leaving a strategy on "None" lets the bot answer the
 * first message itself.
 */

const sel = 'w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-violet-400 bg-white';

export default function NoAdWelcomePanel({ clientId }) {
  const toast = useToast();
  const qc = useQueryClient();
  const params = { client_id: clientId };
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  const { data: settings } = useQuery({
    queryKey: ['settings', clientId],
    queryFn: () => api.get('/settings', { params }).then(r => r.data),
    enabled: !!clientId,
  });
  const { data: replies } = useQuery({
    queryKey: ['quick-replies', clientId],
    queryFn: () => api.get('/quick-replies', { params }).then(r => r.data),
    enabled: !!clientId,
  });

  useEffect(() => {
    if (!settings) return;
    setA(settings.first_message_block_a || '');
    setB(settings.first_message_block_b || '');
  }, [settings]);

  const titles = [...new Set((replies || []).map(r => r.title))].sort();
  // A saved title that no longer exists must still show, or the dropdown would lie.
  const options = (current) => (current && !titles.includes(current) ? [current, ...titles] : titles);
  const textOf = (title) => (replies || []).find(r => r.title === title && !r.strategy)?.text
    || (replies || []).find(r => r.title === title)?.text || '';

  const save = useMutation({
    mutationFn: () => api.put('/settings/first-message-blocks',
      { first_message_block_a: a, first_message_block_b: b }, { params }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['settings', clientId] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not save'),
  });

  if (!clientId) return null;
  const dirty = settings && (a !== (settings.first_message_block_a || '') || b !== (settings.first_message_block_b || ''));

  const Pick = ({ label, value, onChange }) => (
    <div className="flex-1 min-w-[240px]">
      <div className="text-xs font-medium text-slate-600 mb-1">{label}</div>
      <select className={sel} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">None (the bot answers the first message)</option>
        {options(value).map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {value && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-snug bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-600">
          {textOf(value) || 'No text found for this quick reply.'}
        </pre>
      )}
    </div>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
      <h2 className="text-sm font-semibold text-slate-700 mb-1">Welcome for chats without an ad</h2>
      <p className="text-xs text-slate-400 mb-4">
        Sent as the whole reply to the first message of a chat that did not come from an ad,
        whatever the customer writes. Pick a quick reply for each strategy; edit its text under
        Quick Replies. Ad chats are not affected.
      </p>
      <div className="flex flex-wrap gap-4">
        <Pick label="Strategy A" value={a} onChange={setA} />
        <Pick label="Strategy B" value={b} onChange={setB} />
      </div>
      <button
        onClick={() => save.mutate()}
        disabled={!dirty || save.isPending}
        className="mt-4 text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white cursor-pointer hover:bg-violet-700 disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
