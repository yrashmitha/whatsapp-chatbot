import { useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import { usePermissions } from '../lib/permissions';
import { timeAgoShort } from '../lib/utils';
import api from '../lib/api';
import { LEAD_STATUSES, CALL_OUTCOMES, outcomeLabel, todayStr, shortDate, formatPhone } from '../lib/leads';
import useIsWide from '../lib/useIsWide';
import { LeadPanel, LeadBody, StatusBadge } from '../components/leads/LeadControls';

/**
 * The lead tracker: who to ring, what happened last time, and a way to find
 * anyone fast.
 *
 * The page opens on the call queue (overdue, today, upcoming) because that is
 * what an operator comes here to work. Finding a person is search plus a status
 * menu. Everything occasional (last outcome, date ranges) sits behind Filters.
 * Each row uses the same lead panel as the chat header, so status, logging a
 * call and the history are one control wherever they appear.
 */

const PAGE_SIZE = 30;

const TABS = [
  { key: 'overdue',  label: 'Overdue',  count: s => s?.overdue,  red: true },
  { key: 'today',    label: 'Today',    count: s => s?.today },
  { key: 'upcoming', label: 'Upcoming', count: s => s?.upcoming },
  { key: '',         label: 'All leads', count: s => s?.all },
];

const EMPTY = {
  overdue:  'No overdue calls. You are caught up.',
  today:    'Nothing to ring today.',
  upcoming: 'No calls are scheduled ahead.',
};

/** A list row's lead fields in the shape the lead controls take. */
const toLead = (l) => ({
  lead_status: l.lead_status,
  next_call_at: l.next_call_at,
  call_count: parseInt(l.call_count) || 0,
  last_call: l.last_outcome
    ? { outcome: l.last_outcome, note: l.last_note, created_at: l.last_call_at }
    : null,
});

const telHref = (phone) => `tel:+${String(phone).replace(/\D/g, '')}`;

const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const PhoneIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

/** Outcome, date range and the shortcuts: the filters used now and then. */
function FiltersPopover({ outcome, setOutcome, dateField, setDateField, dateFrom, dateTo, setRange, count }) {
  const [open, setOpen] = useState(false);
  const today = todayStr();
  const presets = dateField === 'called'
    ? [['Today', today, today], ['Yesterday', addDays(-1), addDays(-1)], ['Last 7 days', addDays(-6), today]]
    : [['Today', today, today], ['Tomorrow', addDays(1), addDays(1)], ['Next 7 days', today, addDays(6)]];
  const field = 'text-sm border border-slate-200 rounded-lg px-2.5 h-10 md:h-9 bg-white text-slate-700';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog" aria-expanded={open}
        className={`h-10 md:h-9 px-3 rounded-lg border text-sm cursor-pointer flex items-center gap-1.5 ${
          count ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-600'}`}
      >
        Filters
        {count > 0 && <span className="text-xs font-semibold bg-violet-600 text-white rounded-full px-1.5">{count}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="More filters"
            className="fixed inset-x-3 top-32 md:absolute md:inset-x-auto md:right-0 md:left-auto md:top-full md:mt-1 md:w-80 z-40 bg-white border border-slate-200 rounded-xl shadow-lg p-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">
              Last call result
              <select value={outcome} onChange={e => setOutcome(e.target.value)} className={`${field} font-normal`}>
                <option value="">Any</option>
                {CALL_OUTCOMES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold text-slate-500">Date</div>
              <select value={dateField} onChange={e => setDateField(e.target.value)} className={field}>
                <option value="callback">Call-back date</option>
                <option value="called">Last called</option>
              </select>
              <div className="flex items-center gap-2">
                <input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setRange(e.target.value, dateTo)}
                  aria-label="From" className={`${field} flex-1 min-w-0`} />
                <span className="text-xs text-slate-500">to</span>
                <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setRange(dateFrom, e.target.value)}
                  aria-label="To" className={`${field} flex-1 min-w-0`} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map(([label, f, t]) => (
                  <button key={label} onClick={() => setRange(f, t)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border cursor-pointer ${
                      dateFrom === f && dateTo === t ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center">
              <button onClick={() => { setOutcome(''); setRange('', ''); }}
                className="text-xs text-slate-500 bg-transparent border-0 cursor-pointer px-0">Reset</button>
              <button onClick={() => setOpen(false)}
                className="ml-auto text-sm px-4 h-9 rounded-lg border-0 bg-violet-600 text-white cursor-pointer">Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function FollowUps() {
  const { user, selectedClientId } = useAuthStore();
  const navigate = useNavigate();
  const perms = usePermissions();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;
  const cp = clientId ? { client_id: clientId } : {};
  const canEdit = perms.can('followups.schedule');
  const wide = useIsWide();
  const [selected, setSelected] = useState(null);

  const [tab, setTab]           = useState('');   // '' | overdue | today | upcoming
  const [status, setStatus]     = useState('');   // '' | new | interested | ...
  const [outcome, setOutcome]   = useState('');
  const [dateField, setDateField] = useState('callback');   // callback | called
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);

  // Wait for typing to pause rather than querying on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [tab, status, outcome, search, clientId, dateField, dateFrom, dateTo]);

  const setRange = (from, to) => { setDateFrom(from); setDateTo(to); };

  const { data: summary } = useQuery({
    queryKey: ['leads-summary', clientId],
    queryFn: () => api.get('/leads/summary', { params: cp }).then(r => r.data),
    enabled: !!clientId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['leads', clientId, tab, status, outcome, search, dateField, dateFrom, dateTo, page],
    queryFn: () => api.get('/leads', {
      params: { ...cp, callback: tab, status, outcome, search, page, limit: PAGE_SIZE,
        ...(dateFrom || dateTo ? { date_field: dateField, date_from: dateFrom, date_to: dateTo } : {}) },
    }).then(r => r.data),
    enabled: !!clientId,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const leads = data?.leads || [];
  const pages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));
  const counts = summary?.counts || {};
  // On a wide screen one lead is always open on the right. Logging a call can
  // move it out of the queue; the selection then falls to the next one, which
  // is what working a queue means.
  const current = wide ? (leads.find(l => l.phone_number === selected) || leads[0] || null) : null;
  const onListKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = Math.max(0, leads.findIndex(l => l.phone_number === current?.phone_number));
    const next = leads[Math.min(leads.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) setSelected(next.phone_number);
  };
  const filterCount = (outcome ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);
  const narrowed = !!(status || outcome || search || dateFrom || dateTo);
  const clearAll = () => { setTab(''); setStatus(''); setOutcome(''); setSearchInput(''); setRange('', ''); };

  const control = 'text-sm border border-slate-200 rounded-lg px-3 h-10 md:h-9 bg-white text-slate-700 outline-none focus:border-violet-400';

  return (
    <Layout>
      <div className={wide ? 'h-full grid grid-cols-[minmax(0,1fr)_400px]' : 'h-full'}>
      <div className={`overflow-y-auto h-full ${wide ? 'p-6' : 'p-4 md:p-6'}`}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-lg font-bold text-slate-800">Leads</h1>
            <p className="text-sm text-slate-500">
              Who to ring, and what happened last time.
              {!clientId && <span className="text-amber-600 font-medium"> Select a client from the sidebar first.</span>}
            </p>
          </div>
          {isFetching && !isLoading && <Spinner size="sm" className="mt-1.5" />}
        </div>

        {/* The call queue. It is the main way into the page. */}
        <div role="tablist" aria-label="Call queue" className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl mb-3">
          {TABS.map(t => {
            const n = t.count(summary);
            const on = tab === t.key;
            return (
              <button key={t.key || 'all'} role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                className={`h-10 md:h-9 rounded-lg text-sm border-0 cursor-pointer transition-colors truncate px-1 ${
                  on ? 'bg-white text-slate-800 font-semibold shadow-sm'
                    : t.red && n > 0 ? 'bg-transparent text-red-600 font-medium'
                    : 'bg-transparent text-slate-600 hover:text-slate-800'}`}
              >
                {t.label}{n != null && <span className={`ml-1.5 tabular-nums ${on ? 'text-slate-500' : ''}`}>{n}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="search" value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="Search name, phone or call note" aria-label="Search leads"
            className={`${control} basis-full md:basis-auto md:flex-1 md:min-w-64 text-base md:text-sm`}
          />
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Lead status" className={`${control} flex-1 md:flex-none`}>
            <option value="">All statuses</option>
            {LEAD_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label} ({counts[s.key] ?? 0})</option>)}
          </select>
          <FiltersPopover
            outcome={outcome} setOutcome={setOutcome} dateField={dateField} setDateField={setDateField}
            dateFrom={dateFrom} dateTo={dateTo} setRange={setRange} count={filterCount}
          />
        </div>

        {(outcome || dateFrom || dateTo) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {outcome && (
              <button onClick={() => setOutcome('')} className="text-xs px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 cursor-pointer">
                Last call: {outcomeLabel(outcome)} ✕
              </button>
            )}
            {(dateFrom || dateTo) && (
              <button onClick={() => setRange('', '')} className="text-xs px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 cursor-pointer">
                {dateField === 'called' ? 'Called' : 'Call-back'} {dateFrom ? shortDate(dateFrom) : 'any'} to {dateTo ? shortDate(dateTo) : 'any'} ✕
              </button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : !leads.length ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
            <p className="text-sm text-slate-600">
              {narrowed ? 'No leads match these filters.' : (EMPTY[tab] || 'No leads yet.')}
            </p>
            {(narrowed || tab) && (
              <button onClick={clearAll} className="mt-3 text-sm px-4 h-9 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer">
                Show all leads
              </button>
            )}
          </div>
        ) : (
          <ul tabIndex={wide ? 0 : undefined} onKeyDown={wide ? onListKey : undefined} aria-label="Leads"
            className="m-0 p-0 list-none bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
            {leads.map(l => {
              const lead = toLead(l);
              if (wide) {
                const on = current?.phone_number === l.phone_number;
                const overdue = l.next_call_at && l.next_call_at < todayStr();
                return (
                  <li key={l.phone_number} onClick={() => setSelected(l.phone_number)} aria-selected={on}
                    className={`grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_auto] gap-x-4 items-center px-4 py-2.5 cursor-pointer first:rounded-t-xl last:rounded-b-xl ${on ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{l.name || formatPhone(l.phone_number)}</div>
                      <div className="text-xs text-slate-500 tabular-nums truncate">
                        {l.name && formatPhone(l.phone_number)}
                        {l.last_message_at && <span>{l.name ? ' · ' : ''}messaged {timeAgoShort(l.last_message_at)} ago</span>}
                      </div>
                    </div>
                    <div className="min-w-0 flex items-center gap-2 text-xs">
                      <StatusBadge status={l.lead_status} />
                      <span className="truncate text-slate-600">
                        {l.last_outcome ? `${outcomeLabel(l.last_outcome)} ${shortDate(l.last_call_at)}` : 'Not called yet'}
                      </span>
                      {l.next_call_at && (
                        <span className={`shrink-0 font-medium ${overdue ? 'text-red-600' : 'text-emerald-700'}`}>
                          {overdue ? 'Overdue' : 'Call'} {shortDate(l.next_call_at)}
                        </span>
                      )}
                    </div>
                    <a href={telHref(l.phone_number)} onClick={e => e.stopPropagation()} aria-label={`Call ${l.name || l.phone_number}`}
                      className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium no-underline">
                      <PhoneIcon />Call
                    </a>
                  </li>
                );
              }
              return (
                <li key={l.phone_number}
                  className="grid gap-x-4 gap-y-2.5 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] md:items-center first:rounded-t-xl last:rounded-b-xl">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate">{l.name || formatPhone(l.phone_number)}</div>
                    <div className="text-xs text-slate-500 tabular-nums truncate">
                      {l.name && formatPhone(l.phone_number)}
                      {l.last_message_at && <span>{l.name ? ' · ' : ''}messaged {timeAgoShort(l.last_message_at)} ago</span>}
                    </div>
                  </div>

                  <div className="min-w-0 flex flex-col gap-1">
                    <div className="flex">
                      <LeadPanel phone={l.phone_number} clientId={clientId} lead={lead} canEdit={canEdit} />
                    </div>
                    {l.last_note && <div className="text-xs text-slate-500 truncate">{l.last_note}</div>}
                  </div>

                  <div className="flex gap-2 md:justify-end">
                    <a href={telHref(l.phone_number)}
                      className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 h-10 md:h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium no-underline">
                      <PhoneIcon />Call
                    </a>
                    <button onClick={() => navigate(`/chat?phone=${encodeURIComponent(l.phone_number)}`)}
                      className="flex-1 md:flex-none h-10 md:h-9 px-4 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm cursor-pointer">
                      Open chat
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4 text-sm text-slate-600">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-4 h-10 md:h-9 rounded-lg border border-slate-200 bg-white cursor-pointer disabled:opacity-40">Previous</button>
            <span className="tabular-nums">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}
              className="px-4 h-10 md:h-9 rounded-lg border border-slate-200 bg-white cursor-pointer disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      {wide && (
        <aside className="border-l border-slate-200 bg-white overflow-y-auto h-full p-5" aria-label="Selected lead">
          {current ? (
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-base font-semibold text-slate-800 break-words">{current.name || formatPhone(current.phone_number)}</div>
                <div className="text-sm text-slate-500 tabular-nums">
                  {current.name && formatPhone(current.phone_number)}
                  {current.last_message_at && <span>{current.name ? ' · ' : ''}messaged {timeAgoShort(current.last_message_at)} ago</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <a href={telHref(current.phone_number)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium no-underline">
                  <PhoneIcon />Call
                </a>
                <button onClick={() => navigate(`/chat?phone=${encodeURIComponent(current.phone_number)}`)}
                  className="flex-1 h-10 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm cursor-pointer">
                  Open chat
                </button>
              </div>
              <LeadBody key={current.phone_number} phone={current.phone_number} clientId={clientId} lead={toLead(current)} canEdit={canEdit} />
            </div>
          ) : (
            <p className="text-sm text-slate-500">Pick a lead to see its history and log a call.</p>
          )}
        </aside>
      )}
      </div>
    </Layout>
  );
}
