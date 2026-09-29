import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { useToast } from './ui/Toast';

/**
 * Which ads the bot must stay off of.
 *
 * Every ad clicked so far shows up here, whether or not it has an override.
 * Leaving one alone changes nothing: the bot answers it exactly as it would
 * any customer with no ad at all. Giving it a welcome message and a mode is
 * what hands that ad's chats to an operator.
 */

const MODES = [
  { value: 'off_after_reply', label: 'Bot off after first reply', hint: 'One reply goes out (the welcome message below, or the bot’s own normal reply if none is set), then the chat goes manual.' },
  { value: 'off_immediately', label: 'Bot off completely', hint: 'No automatic reply at all, even the welcome message below is the only thing ever sent.' },
];

function AdRow({ ad, rule, clientId, qc, toast }) {
  const [open, setOpen] = useState(false);
  const [welcome, setWelcome] = useState(rule?.welcome_message || '');
  const [mode, setMode] = useState(rule?.off_mode || 'off_after_reply');
  const configured = !!rule;

  const params = { client_id: clientId };

  const save = useMutation({
    mutationFn: () => api.put(`/plugins/ads/rules/${encodeURIComponent(ad.ad_id)}`,
      { welcome_message: welcome, off_mode: mode }, { params }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['ad-rules', clientId] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not save'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/plugins/ads/rules/${encodeURIComponent(ad.ad_id)}`, { params }),
    onSuccess: () => {
      toast.success('Back to normal bot flow');
      qc.invalidateQueries({ queryKey: ['ad-rules', clientId] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not remove'),
  });

  const title = ad.ad_name || ad.headline || ad.ad_id;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left bg-white hover:bg-slate-50"
      >
        {ad.thumb_url && (
          <img src={ad.thumb_url} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-800 truncate">{title}</div>
          {ad.campaign_name && <div className="text-xs text-slate-400 truncate">{ad.campaign_name}</div>}
        </div>
        {configured ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
            {MODES.find(m => m.value === rule.off_mode)?.label || rule.off_mode}
          </span>
        ) : (
          <span className="text-xs text-slate-400 shrink-0">Normal bot flow</span>
        )}
        <span className="text-slate-400 shrink-0">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="px-3 py-3 border-t border-slate-100 bg-slate-50 flex flex-col gap-3">
          <label className="block">
            <div className="text-xs font-medium text-slate-600 mb-1">Welcome message (optional)</div>
            <textarea
              value={welcome}
              onChange={e => setWelcome(e.target.value)}
              rows={3}
              placeholder="Leave empty to let the bot answer normally, then go manual."
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y bg-white"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            {MODES.map(m => (
              <label key={m.value} className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="radio" name={`mode-${ad.ad_id}`} className="mt-0.5" checked={mode === m.value}
                  onChange={() => setMode(m.value)} />
                <span>
                  <span className="font-medium text-slate-700">{m.label}</span>
                  <span className="block text-xs text-slate-400">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            {configured && (
              <button
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer hover:bg-slate-100 disabled:opacity-50"
              >
                Remove override
              </button>
            )}
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="text-xs px-3 py-1.5 rounded-lg border-0 bg-violet-600 text-white cursor-pointer hover:bg-violet-700 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdRulesPanel({ clientId }) {
  const toast = useToast();
  const qc = useQueryClient();
  const params = { client_id: clientId };

  const { data: seen, isLoading: seenLoading } = useQuery({
    queryKey: ['ad-seen', clientId],
    queryFn: () => api.get('/plugins/ads/seen', { params }).then(r => r.data.ads),
    enabled: !!clientId,
  });
  const { data: rules } = useQuery({
    queryKey: ['ad-rules', clientId],
    queryFn: () => api.get('/plugins/ads/rules', { params }).then(r => r.data.rules),
    enabled: !!clientId,
  });

  const sync = useMutation({
    mutationFn: () => api.post('/plugins/ads/sync', {}, { params }),
    onSuccess: (r) => {
      toast.success(`Synced ${r.data.synced} ad${r.data.synced === 1 ? '' : 's'} from Meta`);
      qc.invalidateQueries({ queryKey: ['ad-seen', clientId] });
      qc.invalidateQueries({ queryKey: ['ad-rules', clientId] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not sync from Meta'),
  });

  if (!clientId) return <p className="text-sm text-slate-400">Select a client from the sidebar first.</p>;
  if (seenLoading) return <p className="text-sm text-slate-400">Loading…</p>;

  const ruleByAd = new Map((rules || []).map(r => [r.ad_id, r]));
  const ads = seen || [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          Every ad someone has clicked to start a chat, newest first. An ad with no override
          behaves exactly as if it had never been clicked: the bot answers normally. Give an
          ad a welcome message and a mode below to hand its chats to an operator instead.
        </p>
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          title="Pull each ad's real name, campaign and spend from Meta"
          className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
        >
          {sync.isPending ? 'Syncing…' : '↻ Sync from Meta'}
        </button>
      </div>
      {!ads.length && (
        <p className="text-sm text-slate-400">No ad clicks recorded yet for this client.</p>
      )}
      {ads.map(ad => (
        <AdRow key={ad.ad_id} ad={ad} rule={ruleByAd.get(ad.ad_id)} clientId={clientId} qc={qc} toast={toast} />
      ))}
    </div>
  );
}
