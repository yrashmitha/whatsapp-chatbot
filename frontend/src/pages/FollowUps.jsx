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

/**
 * The instructions behind the queue, editable in place.
 *
 * Every change of tone so far came from reading a draft that felt wrong. That
 * should not need a deploy — the business knows how it wants to speak to its
 * customers better than the code does.
 */
function PromptEditor({ clientId, onSaved }) {
  const toast = useToast();
  const params = clientId ? { client_id: clientId } : {};
  const [open, setOpen] = useState(false);
  const [edited, setEdited] = useState(null);

  const { data } = useQuery({
    queryKey: ['follow-up-prompt', clientId],
    queryFn: () => api.get('/follow-ups/prompt', { params }).then(r => r.data),
    enabled: !!clientId && open,
  });

  // Blank means "use the built-in", so the box is seeded with the built-in text
  // rather than leaving someone staring at an empty field.
  const value = edited ?? (data ? (data.prompt || data.default_prompt) : '');

  const save = useMutation({
    mutationFn: (text) => api.put('/follow-ups/prompt', { prompt: text }, { params }).then(r => r.data),
    onSuccess: (d) => {
      setEdited(null);
      toast.success(d.using_default ? 'Back to the built-in instructions' : 'Saved — the queue is being re-read');
      onSaved?.();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not save'),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer hover:border-violet-300"
      >Edit instructions</button>
    );
  }

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-xs font-semibold text-slate-600">
          How the queue judges and writes
          {data && !data.using_default && (
            <span className="ml-2 text-[10px] font-medium text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded-full">edited</span>
          )}
        </div>
        <button
          onClick={() => { setOpen(false); setEdited(null); }}
          className="text-xs text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer"
        >Close</button>
      </div>
      <p className="text-xs text-slate-400 mb-2">
        These decide who counts as hot, what each message says, and when it is sent. Changing them
        re-reads every conversation in the queue, which costs a moment and a fraction of a cent.
      </p>
      <textarea
        value={value}
        onChange={e => setEdited(e.target.value)}
        rows={16}
        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl outline-none focus:border-violet-400 resize-y font-mono"
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => save.mutate(value)}
          disabled={save.isPending}
          className="text-xs px-3 py-1.5 rounded-lg border-0 bg-violet-600 text-white cursor-pointer disabled:opacity-40"
        >{save.isPending ? 'Saving…' : 'Save'}</button>
        <button
          onClick={() => setEdited(data?.default_prompt || '')}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer"
        >Restore the built-in</button>
        {data && !data.using_default && (
          <button
            onClick={() => save.mutate('')}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 cursor-pointer"
            title="Clear the saved copy and go back to the built-in"
          >Use built-in</button>
        )}
      </div>
    </div>
  );
}

/** "2h ago" — precise enough to judge whether it is worth chasing again. */
function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

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
    <div className={`border rounded-xl p-3 flex flex-col gap-2 ${
      item.handled ? 'bg-slate-50 border-slate-200 opacity-75' : 'bg-white border-slate-200'}`}>
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
        {item.followedUpAt && (
          <span className="px-1.5 py-0.5 rounded-full border border-emerald-300 bg-emerald-100 text-emerald-800 font-semibold">
            ✓ followed up {ago(item.followedUpAt)}
          </span>
        )}
        {item.scheduledFor && !item.followedUpAt && (
          <span className="px-1.5 py-0.5 rounded-full border border-violet-300 bg-violet-100 text-violet-800 font-semibold">
            ⏱ queued for {String(item.scheduledFor).slice(11, 16)}
          </span>
        )}
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
          >{item.suggestedSendAt ? `Later — ${item.suggestedSendAt.slice(11)}` : 'Later…'}</button>
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
          <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">Send later</div>

          {item.suggestedSendAt ? (
            <button
              onClick={() => setWhen(item.suggestedSendAt.replace(' ', 'T'))}
              className={`text-left text-xs rounded-lg px-2.5 py-1.5 border cursor-pointer ${
                when === item.suggestedSendAt.replace(' ', 'T')
                  ? 'border-violet-400 bg-violet-100 text-violet-800'
                  : 'border-violet-200 bg-white text-slate-700 hover:border-violet-400'}`}
            >
              <span className="font-semibold">{item.suggestedSendAt}</span>
              {item.whenWhy && <span className="text-slate-500"> — {item.whenWhy}</span>}
            </button>
          ) : (
            <div className="text-xs text-amber-700">
              No good time left — their window closes at {item.windowClosesLocal || 'soon'}. Send now instead.
            </div>
          )}

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
            {item.timezone || 'Their'} time · must be before {item.windowClosesLocal || 'their window closes'}.
            It will not go if they reply first, pay, or the window shuts.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A reminder that has come due — a day the operator pinned to this chat because
 * the customer named one. No message has been queued; the operator sends by hand.
 */
function ReminderCard({ item, clientId, onOpen }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState(item.draft || '');
  const [done, setDone] = useState('');
  const params = clientId ? { client_id: clientId } : {};

  const send = useMutation({
    mutationFn: () => api.post(`/follow-ups/${item.orderId}/send`,
      { message: text.trim(), angle: 'reminder', temp: 'warm', edited: text.trim() !== (item.draft || '').trim() },
      { params }).then(r => r.data),
    onSuccess: () => {
      setDone('Sent');
      toast.success('Sent');
      qc.invalidateQueries({ queryKey: ['follow-up-reminders'] });
      qc.invalidateQueries({ queryKey: ['follow-up-stats'] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not send'),
  });

  const resolve = useMutation({
    mutationFn: (status) => api.patch(`/follow-ups/reminders/${item.id}`, { status }, { params }),
    onSuccess: () => { setDone('Closed'); qc.invalidateQueries({ queryKey: ['follow-up-reminders'] }); },
    onError: () => toast.error('Could not update'),
  });

  return (
    <div className={`border rounded-xl p-3 flex flex-col gap-2 ${done ? 'bg-slate-50 border-slate-200 opacity-70' : 'bg-white border-violet-300'}`}>
      <div className="flex items-start gap-2">
        <span className="text-base leading-none mt-0.5">🔔</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{item.name || item.phone}</div>
          <div className="text-xs text-slate-400">
            {item.phone} · {item.orderId}{item.package ? ` · Rs. ${item.package}` : ''}
          </div>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium shrink-0">
          {item.remindOnLocal}
        </span>
      </div>

      {item.note && (
        <div className="text-xs text-slate-700 bg-violet-50 border border-violet-100 rounded-lg px-2.5 py-1.5">
          <span className="text-violet-400">your note </span>{item.note}
        </div>
      )}
      <div className="text-xs text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5 break-words">
        <span className="text-slate-400">they said </span>“{item.lastFromThem || '—'}”
      </div>

      {item.windowOpen ? (
        <>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            disabled={!!done}
            placeholder={item.draft ? '' : 'No draft — write the message'}
            className="w-full text-xs text-slate-700 border border-violet-200 bg-violet-50/40 rounded-lg px-2.5 py-2 outline-none focus:border-violet-400 resize-y disabled:opacity-60"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => send.mutate()}
              disabled={!!done || send.isPending || !text.trim()}
              className="text-xs px-3 py-1.5 rounded-lg border-0 bg-violet-600 text-white cursor-pointer hover:bg-violet-700 disabled:opacity-40"
            >{done || (send.isPending ? 'Sending…' : 'Send now')}</button>
            <button onClick={() => onOpen(item)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-violet-300 cursor-pointer">Open chat</button>
            <button onClick={() => resolve.mutate('done')} disabled={!!done} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 cursor-pointer ml-auto">Done</button>
            <button onClick={() => resolve.mutate('dismissed')} disabled={!!done} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 cursor-pointer">Dismiss</button>
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            Their 24-hour window is closed — send an approved template from the order (Orders page).
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onOpen(item)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-violet-300 cursor-pointer">Open chat</button>
            <button onClick={() => resolve.mutate('done')} disabled={!!done} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 cursor-pointer ml-auto">Done</button>
            <button onClick={() => resolve.mutate('dismissed')} disabled={!!done} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 cursor-pointer">Dismiss</button>
          </div>
        </>
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
  const [showHandled, setShowHandled] = useState(false);

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

  const { data: reminders } = useQuery({
    queryKey: ['follow-up-reminders', clientId],
    queryFn: () => api.get('/follow-ups/reminders', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });
  const remDue = (reminders?.items || []).filter(r => r.due);
  const remUpcoming = (reminders?.items || []).filter(r => !r.due);

  const cancelReminder = useMutation({
    mutationFn: (id) => api.patch(`/follow-ups/reminders/${id}`, { status: 'dismissed' }, { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-reminders'] }),
  });

  const all = data?.items || [];
  const items = all
    .filter(i => (showHandled ? true : !i.handled))
    .filter(i => !onlyDue || i.due);
  const c = data?.counts;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <Layout>
      <div className="p-4 md:p-6 overflow-y-auto h-full">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-lg font-bold text-slate-800">Follow-ups</h1>
          <div className="flex gap-2">
            <PromptEditor clientId={clientId} onSaved={() => refetch()} />
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer disabled:opacity-50"
            >{isFetching ? 'Checking…' : 'Refresh'}</button>
          </div>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          People who ordered but have not paid, and can still be messaged without a template.
          Hottest first, then whoever we are about to lose.
          {!clientId && <span className="text-amber-600 font-medium"> Select a client from the sidebar first.</span>}
        </p>

        {c && (
          <div className="flex flex-wrap gap-2 mb-4">
            {[['still to do', c.waiting ?? c.total, 'bg-slate-100 text-slate-600'],
              ['hot', c.hot, 'bg-red-50 text-red-700'],
              ['warm', c.warm, 'bg-amber-50 text-amber-700'],
              ['due now', c.due, 'bg-violet-100 text-violet-700'],
              ['closing soon', c.closingSoon, 'bg-red-100 text-red-700']].map(([label, n, cls]) => (
              <span key={label} className={`text-xs px-2.5 py-1 rounded-full font-medium ${cls}`}>{n} {label}</span>
            ))}
            {c.handled > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-50 text-emerald-700">
                {c.handled} done
              </span>
            )}
            <div className="flex gap-3 ml-auto">
              <label className="text-xs flex items-center gap-1.5 text-slate-500 cursor-pointer">
                <input type="checkbox" checked={onlyDue} onChange={e => setOnlyDue(e.target.checked)} className="accent-violet-600" />
                only due
              </label>
              <label className="text-xs flex items-center gap-1.5 text-slate-500 cursor-pointer">
                <input type="checkbox" checked={showHandled} onChange={e => setShowHandled(e.target.checked)} className="accent-violet-600" />
                show done
              </label>
            </div>
          </div>
        )}

        {isFetching && !data && (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-8">
            <Spinner size="sm" /> Reading the conversations…
          </div>
        )}

        {data && items.length === 0 && (
          <div className="text-sm text-slate-400 py-8 text-center">
            {onlyDue ? 'Nothing due right now.'
              : all.length > 0 ? 'All caught up — everyone reachable has been followed up. Tick “show done” to see them.'
              : 'Nobody is waiting. Everyone who ordered has either paid or fallen outside the window.'}
          </div>
        )}

        {remDue.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-violet-700 mb-2">
              🔔 Reminders due ({remDue.length}) — you pinned these dates
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {remDue.map(r => (
                <ReminderCard key={r.id} item={r} clientId={clientId}
                  onOpen={() => navigate(`/chat?phone=${encodeURIComponent(r.phone)}`)} />
              ))}
            </div>
          </div>
        )}

        {remUpcoming.length > 0 && (
          <div className="mb-4 bg-white border border-slate-200 rounded-xl p-3">
            <div className="text-xs font-semibold text-slate-600 mb-2">
              🔔 Upcoming reminders ({remUpcoming.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {remUpcoming.map(r => (
                <div key={r.id} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-violet-700 shrink-0">{r.remindOnLocal}</span>
                  <span className="text-slate-400 shrink-0">{r.name || r.phone}</span>
                  <span className="text-slate-600 flex-1 min-w-0 truncate">{r.note || '—'}</span>
                  <button
                    onClick={() => cancelReminder.mutate(r.id)}
                    disabled={cancelReminder.isPending}
                    className="text-slate-300 hover:text-red-500 bg-transparent border-0 cursor-pointer px-1 shrink-0"
                    title="Clear it"
                  >✕</button>
                </div>
              ))}
            </div>
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
