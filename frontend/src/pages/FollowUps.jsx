import { useState, useEffect, Fragment } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import { usePermissions } from '../lib/permissions';
import api from '../lib/api';
import { LEAD_STATUSES, CALL_OUTCOMES, outcomeLabel, todayStr, shortDate } from '../lib/leads';
import { LeadStatusSelect, LogCallButton, CallHistory } from '../components/leads/LeadControls';

/**
 * The lead tracker: how good each lead is, who was called, and who to ring back.
 *
 * Every chat is a lead. Status and the call log are kept per chat, so a person
 * who never ordered can be tracked too. Filters and search run on the server.
 */

const PAGE_SIZE = 30;

/** A filter chip with a count. */
function Chip({ active, onClick, children, count, tone }) {
  const hot = tone === 'red' && count > 0;
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer whitespace-nowrap transition-colors ${
        active ? 'bg-violet-600 text-white border-violet-600'
          : hot ? 'bg-red-50 text-red-700 border-red-200'
          : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
    >
      {children}
      {count != null && <span className={`ml-1.5 font-semibold ${active ? 'text-violet-100' : ''}`}>{count}</span>}
    </button>
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

  const [status, setStatus]     = useState('');   // '' | new | interested | ...
  const [callback, setCallback] = useState('');   // '' | today | overdue | upcoming | none
  const [outcome, setOutcome]   = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [expanded, setExpanded] = useState(null);

  // Wait for typing to pause rather than querying on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [status, callback, outcome, search, clientId]);

  const { data: summary } = useQuery({
    queryKey: ['leads-summary', clientId],
    queryFn: () => api.get('/leads/summary', { params: cp }).then(r => r.data),
    enabled: !!clientId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const { data, isFetching } = useQuery({
    queryKey: ['leads', clientId, status, callback, outcome, search, page],
    queryFn: () => api.get('/leads', {
      params: { ...cp, status, callback, outcome, search, page, limit: PAGE_SIZE },
    }).then(r => r.data),
    enabled: !!clientId,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const leads = data?.leads || [];
  const pages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));
  const counts = summary?.counts || {};
  const today = todayStr();
  const filtered = !!(status || callback || outcome || search);

  // Status chips and the callback chips are separate filters that combine.
  const pickStatus = (k) => setStatus(s => (s === k ? '' : k));
  const pickCallback = (k) => setCallback(c => (c === k ? '' : k));

  return (
    <Layout>
      <div className="p-4 md:p-6 overflow-y-auto h-full">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h1 className="text-lg font-bold text-slate-800">Leads</h1>
            <p className="text-sm text-slate-500">
              Mark how good a lead is, log every call, and see who to ring back.
              {!clientId && <span className="text-amber-600 font-medium"> Select a client from the sidebar first.</span>}
            </p>
          </div>
          {isFetching && <Spinner />}
        </div>

        {/* Call-back chips first: this is what an operator opens the page for. */}
        <div className="flex gap-2 overflow-x-auto pb-1 mb-2">
          <Chip tone="red" active={callback === 'overdue'} onClick={() => pickCallback('overdue')} count={summary?.overdue}>Overdue calls</Chip>
          <Chip active={callback === 'today'} onClick={() => pickCallback('today')} count={summary?.today}>Call today</Chip>
          <Chip active={callback === 'upcoming'} onClick={() => pickCallback('upcoming')} count={summary?.upcoming}>Upcoming</Chip>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
          <Chip active={!status} onClick={() => setStatus('')} count={summary?.all}>All</Chip>
          {LEAD_STATUSES.map(s => (
            <Chip key={s.key} active={status === s.key} onClick={() => pickStatus(s.key)} count={counts[s.key] ?? 0}>{s.label}</Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search name, phone or call note"
            className="flex-1 min-w-48 text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 bg-white"
          />
          <select
            value={outcome}
            onChange={e => setOutcome(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white text-slate-600"
          >
            <option value="">Last call: any</option>
            {CALL_OUTCOMES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          {filtered && (
            <button
              onClick={() => { setStatus(''); setCallback(''); setOutcome(''); setSearchInput(''); }}
              className="text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-500 cursor-pointer"
            >Clear filters</button>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {!leads.length && !isFetching && (
            <div className="p-8 text-center text-sm text-slate-400">
              {filtered ? 'No leads match these filters.' : 'No leads yet.'}
            </div>
          )}
          {leads.map(l => {
            const overdue = l.next_call_at && l.next_call_at < today;
            const open = expanded === l.phone_number;
            return (
              <Fragment key={l.phone_number}>
                <div
                  onClick={() => setExpanded(open ? null : l.phone_number)}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50"
                >
                  <div className="min-w-40 flex-1">
                    <div className="text-sm font-semibold text-slate-800 truncate">{l.name || l.phone_number}</div>
                    {l.name && <div className="text-xs text-slate-400">{l.phone_number}</div>}
                  </div>
                  <LeadStatusSelect phone={l.phone_number} clientId={clientId} value={l.lead_status} disabled={!canEdit} />
                  <div className="min-w-44 flex-1 text-xs text-slate-500">
                    {l.last_outcome ? (
                      <>
                        <span className="font-semibold text-slate-600">{outcomeLabel(l.last_outcome)}</span>
                        <span className="text-slate-400"> · {shortDate(l.last_call_at)}</span>
                        {l.last_note && <div className="truncate max-w-xs">{l.last_note}</div>}
                      </>
                    ) : <span className="text-slate-300">Not called yet</span>}
                  </div>
                  <div className={`text-xs font-medium w-24 ${overdue ? 'text-red-600' : l.next_call_at ? 'text-emerald-700' : 'text-slate-300'}`}>
                    {l.next_call_at ? `${overdue ? 'Overdue ' : 'Call '}${shortDate(l.next_call_at)}` : 'No call set'}
                  </div>
                  <div className="flex gap-2 items-center ml-auto" onClick={e => e.stopPropagation()}>
                    <a
                      href={`tel:+${String(l.phone_number).replace(/\D/g, '')}`}
                      className="text-xs px-2.5 py-1 rounded-full font-medium bg-sky-100 text-sky-700 hover:bg-sky-200 no-underline"
                    >Call</a>
                    {canEdit && <LogCallButton phone={l.phone_number} clientId={clientId} />}
                    <button
                      onClick={() => navigate(`/chat?phone=${encodeURIComponent(l.phone_number)}`)}
                      className="text-xs px-2.5 py-1 rounded-full font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 border-0 cursor-pointer"
                    >Open chat</button>
                  </div>
                </div>
                {open && (
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                    <div className="text-xs font-semibold text-slate-500 mb-1.5">
                      Call history{l.owned_by_name ? ` · chat with ${l.owned_by_name}` : ''}
                    </div>
                    <CallHistory phone={l.phone_number} clientId={clientId} />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4 text-sm text-slate-600">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer disabled:opacity-40">Prev</button>
            <span>Page {page} of {pages} ({data?.total})</span>
            <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </Layout>
  );
}
