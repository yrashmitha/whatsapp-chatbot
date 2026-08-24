import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  const [copied, setCopied] = useState(false);
  const t = TEMP[item.temp] || TEMP.warm;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.draft);
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

      {item.draft && (
        <div className="border border-violet-200 bg-violet-50/50 rounded-lg px-2.5 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">Suggested message</div>
          <div className="text-xs text-slate-700 whitespace-pre-wrap break-words">{item.draft}</div>
        </div>
      )}

      <div className="flex gap-2">
        {item.draft && (
          <button
            onClick={copy}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700 cursor-pointer"
          >{copied ? 'Copied' : 'Copy message'}</button>
        )}
        <button
          onClick={() => onOpen(item)}
          className="text-xs px-3 py-1.5 rounded-lg border-0 bg-violet-600 text-white cursor-pointer hover:bg-violet-700"
        >Open chat</button>
      </div>
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

  const items = (data?.items || []).filter(i => !onlyDue || i.due);
  const c = data?.counts;

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

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map(i => (
            <Card key={i.orderId} item={i} onOpen={() => navigate(`/chat?phone=${encodeURIComponent(i.phone)}`)} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
