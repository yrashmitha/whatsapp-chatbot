import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

/**
 * The follow-up queue: who to message now, and what to say.
 *
 * A work queue rather than a report — it should empty as someone works it. Only
 * people who can still be messaged for free appear, so nothing on the list is
 * something you cannot act on.
 */

const TEMP = {
  hot:  { label: 'Hot',  dot: 'bg-red-500',   chip: 'bg-red-50 text-red-700 border-red-200' },
  warm: { label: 'Warm', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  cold: { label: 'Cold', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-500 border-slate-200' },
};

/** Hours left, coloured by how close the window is to shutting. */
function WindowLeft({ hours }) {
  const tone = hours <= 2 ? 'text-red-600 font-semibold'
    : hours <= 4 ? 'text-amber-600 font-medium'
    : 'text-slate-500';
  const label = hours < 1 ? `${Math.round(hours * 60)} min left` : `${hours}h left`;
  return <span className={`text-xs ${tone}`} title="Time left to message them without a template">{label}</span>;
}

function Card({ item, onOpen }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState(item.draft || '');
  const [done, setDone] = useState('');
  // Pre-filled with the moment the model picked, which it chose knowing the
  // customer's local clock and when their window shuts.
  const [when, setWhen] = useState((item.suggestedSendAt || '').replace(' ', 'T'));
  const [showLater, setShowLater] = useState(false);
  const t = TEMP[item.temp] || TEMP.warm;

  const body = () => ({
    message: text.trim(),
    angle: item.angle,
    temp: item.temp,
    // Whether the wording was changed is part of the measurement: an angle only
    // earned a reply if the message that went out was actually its own.
    edited: text.trim() !== (item.draft || '').trim(),
  });

  const send = useMutation({
    mutationFn: () => api.post(`/follow-ups/${item.orderId}/send`, body()).then(r => r.data),
    onSuccess: () => {
      setDone('Sent');
      toast.success('Sent');
      qc.invalidateQueries({ queryKey: ['follow-up-stats'] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not send'),
  });

  const later = useMutation({
    mutationFn: () => api.post(`/follow-ups/${item.orderId}/schedule`,
      { ...body(), send_at: when.replace('T', ' ') }).then(r => r.data),
    onSuccess: () => {
      setDone('Scheduled');
      toast.success('Scheduled');
      qc.invalidateQueries({ queryKey: ['follow-ups-scheduled'] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not schedule'),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy — select the text instead');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${t.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{item.name || item.phone}</div>
          <div className="text-xs text-slate-400">
            {item.phone} · {item.orderId}{item.package ? ` · Rs. ${item.package}` : ''}
          </div>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
          <WindowLeft hours={item.hoursLeft} />
          <div className="flex gap-1">
            {item.due && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">due</span>}
            {item.closingSoon && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">closing</span>}
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5 break-words">
        <span className="text-slate-400">they said </span>
        “{item.lastFromThem || '—'}”
      </div>

      {/* The facts, not the model's opinion of them. */}
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className={`px-1.5 py-0.5 rounded-full border ${t.chip}`}>{t.label}</span>
        {item.theySpokeLast && (
          <span className="px-1.5 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-700">we never replied</span>
        )}
        <span className={`px-1.5 py-0.5 rounded-full border ${item.readOurLast
          ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
          {item.readOurLast ? 'read our last' : `last message ${item.lastFromUsStatus}`}
        </span>
        {item.detailsGiven.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
            gave {item.detailsGiven.length} details
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-500">
          quiet {item.minutesQuiet < 60 ? `${item.minutesQuiet}m` : `${Math.round(item.minutesQuiet / 60)}h`}
        </span>
      </div>

      <div className="text-xs text-slate-500 italic">{item.why}</div>

      {item.angle && (
        <div className="text-[10px] text-violet-500 font-medium uppercase tracking-wide">
          angle: {item.angle}
        </div>
      )}

      {item.draft && (
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          disabled={!!done}
          className="w-full text-xs text-slate-700 border border-violet-200 bg-violet-50/40 rounded-lg px-2.5 py-2
                     outline-none focus:border-violet-400 resize-y disabled:opacity-60"
        />
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => send.mutate()}
          disabled={!!done || send.isPending || !text.trim()}
          className="text-xs px-3 py-1.5 rounded-lg border-0 bg-violet-600 text-white cursor-pointer hover:bg-violet-700 disabled:opacity-40"
        >{done || (send.isPending ? 'Sending…' : 'Send now')}</button>

        {item.draft && !done && (
          <button
            onClick={() => setShowLater(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border cursor-pointer ${showLater
              ? 'border-violet-400 text-violet-700 bg-violet-50'
              : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300'}`}
          >Later…</button>
        )}
        {item.draft && !done && (
          <button
            onClick={copy}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-violet-300 cursor-pointer"
          >{copied ? 'Copied' : 'Copy'}</button>
        )}
        <button
          onClick={() => onOpen(item)}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-violet-300 cursor-pointer"
        >Open chat</button>
      </div>

      {showLater && !done && (
        <div className="border border-violet-200 bg-violet-50/40 rounded-lg px-2.5 py-2 flex flex-col gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">
            Send later{item.whenWhy ? ` — ${item.whenWhy}` : ''}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="datetime-local"
              value={when}
              onChange={e => setWhen(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-violet-400 bg-white"
            />
            <button
              onClick={() => later.mutate()}
              disabled={!when || !text.trim() || later.isPending}
              className="text-xs px-3 py-1.5 rounded-lg border-0 bg-violet-600 text-white cursor-pointer disabled:opacity-40"
            >{later.isPending ? 'Scheduling…' : 'Schedule'}</button>
          </div>
          <p className="text-[10px] text-slate-400">
            Their local time. It will not go if they reply first, pay, or their window closes.
          </p>
        </div>
      )}
    </div>
  );
}

export default function FollowUps() {
  const { user, selectedClientId } = useAuthStore();
  const navigate = useNavigate();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;
  const [onlyDue, setOnlyDue] = useState(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['follow-ups', clientId],
    queryFn: () => api.get('/follow-ups', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
  });

  const { data: stats } = useQuery({
    queryKey: ['follow-up-stats', clientId],
    queryFn: () => api.get('/follow-ups/stats', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
    staleTime: 5 * 60_000,
  });

  const qc = useQueryClient();
  const { data: queued } = useQuery({
    queryKey: ['follow-ups-scheduled', clientId],
    queryFn: () => api.get('/follow-ups/scheduled', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const cancelQueued = useMutation({
    mutationFn: (id) => api.delete(`/follow-ups/scheduled/${id}`, { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-ups-scheduled'] }),
  });

  const items = (data?.items || []).filter(i => !onlyDue || i.due);
  const c = data?.counts;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <Layout>
      <div className="p-4 md:p-6 overflow-y-auto h-full">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-lg font-bold text-slate-800">Follow-ups</h1>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer disabled:opacity-50"
          >{isFetching ? 'Checking…' : 'Refresh'}</button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          People who ordered but have not paid, and can still be messaged without a template.
          Hottest first, then whoever we are about to lose.
          {!clientId && <span className="text-amber-600 font-medium"> Select a client from the sidebar first.</span>}
        </p>

        {c && (
          <div className="flex flex-wrap gap-2 mb-4">
            {[['total', c.total, 'bg-slate-100 text-slate-600'],
              ['hot', c.hot, 'bg-red-50 text-red-700'],
              ['warm', c.warm, 'bg-amber-50 text-amber-700'],
              ['due now', c.due, 'bg-violet-100 text-violet-700'],
              ['closing soon', c.closingSoon, 'bg-red-100 text-red-700']].map(([label, n, cls]) => (
              <span key={label} className={`text-xs px-2.5 py-1 rounded-full font-medium ${cls}`}>{n} {label}</span>
            ))}
            <label className="text-xs flex items-center gap-1.5 text-slate-500 ml-auto cursor-pointer">
              <input type="checkbox" checked={onlyDue} onChange={e => setOnlyDue(e.target.checked)} className="accent-violet-600" />
              only due
            </label>
          </div>
        )}

        {isFetching && !data && (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-8">
            <Spinner size="sm" /> Reading the conversations…
          </div>
        )}

        {data && items.length === 0 && (
          <div className="text-sm text-slate-400 py-8 text-center">
            {onlyDue ? 'Nothing due right now.' : 'Nobody is waiting. Everyone who ordered has either paid or fallen outside the window.'}
          </div>
        )}

        {queued?.items?.length > 0 && (
          <div className="mb-4 bg-white border border-violet-200 rounded-xl p-3">
            <div className="text-xs font-semibold text-slate-600 mb-2">
              Waiting to go out ({queued.items.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {queued.items.map(q => (
                <div key={q.id} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-violet-700 shrink-0">{q.send_at_local}</span>
                  <span className="text-slate-400 shrink-0">{q.name || q.phone_number}</span>
                  <span className="text-slate-600 flex-1 min-w-0 truncate">{q.message}</span>
                  <button
                    onClick={() => cancelQueued.mutate(q.id)}
                    disabled={cancelQueued.isPending}
                    className="text-slate-300 hover:text-red-500 bg-transparent border-0 cursor-pointer px-1 shrink-0"
                    title="Call it back"
                  >✕</button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              Times are {queued.items[0]?.timezone || 'local'}. Any of these stands down automatically if the
              customer replies, pays, or their window closes first.
            </p>
          </div>
        )}

        {stats?.totals?.sent > 0 && (
          <div className="mb-4 bg-white border border-slate-200 rounded-xl p-3">
            <div className="text-xs font-semibold text-slate-600 mb-2">
              What each approach earns · last {stats.days} days
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="text-slate-400 text-left">
                    <th className="pb-1 pr-4 font-medium">approach</th>
                    <th className="pb-1 pr-4 font-medium">sent</th>
                    <th className="pb-1 pr-4 font-medium">replied</th>
                    <th className="pb-1 font-medium">paid after</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.angles.map(a => (
                    <tr key={a.angle} className="border-t border-slate-100">
                      <td className="py-1 pr-4 text-slate-700">{a.angle}</td>
                      <td className="py-1 pr-4 text-slate-500">{a.sent}</td>
                      <td className="py-1 pr-4 font-medium text-slate-700">{pct(a.replied, a.sent)}</td>
                      <td className="py-1 font-medium text-emerald-700">{pct(a.paid, a.sent)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 font-semibold text-slate-700">
                    <td className="py-1 pr-4">all</td>
                    <td className="py-1 pr-4">{stats.totals.sent}</td>
                    <td className="py-1 pr-4">{pct(stats.totals.replied, stats.totals.sent)}</td>
                    <td className="py-1 text-emerald-700">{pct(stats.totals.paid, stats.totals.sent)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {stats.totals.sent < 30 && (
              <p className="text-[11px] text-slate-400 mt-2">
                Too few sent to compare approaches yet — treat these as a running tally, not a verdict.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map(i => (
            <Card key={i.orderId} item={i} onOpen={() => navigate(`/chat?phone=${encodeURIComponent(i.phone)}`)} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
