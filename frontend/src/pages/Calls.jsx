import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Pagination from '../components/ui/Pagination';
import Spinner from '../components/ui/Spinner';
import CallTranscriptDrawer from '../components/calls/CallTranscriptDrawer';
import api from '../lib/api';
import { formatDateTime } from '../lib/utils';

const STATUS_COLORS = {
  completed:  'bg-emerald-100 text-emerald-700',
  'no-answer':'bg-slate-100  text-slate-600',
  busy:       'bg-amber-100  text-amber-700',
  failed:     'bg-red-100    text-red-700',
  'in-progress': 'bg-blue-100 text-blue-700',
};

const STATUS_OPTIONS = [
  { value: '',           label: 'All statuses' },
  { value: 'completed',  label: 'Completed' },
  { value: 'no-answer',  label: 'No answer' },
  { value: 'busy',       label: 'Busy' },
  { value: 'failed',     label: 'Failed' },
];

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function Calls() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [selectedCall, setSelectedCall] = useState(null);

  const params = {
    page, limit: 20,
    ...(search && { search }),
    ...(statusFilter && { status: statusFilter }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    ...(clientId && { client_id: clientId }),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['calls', params],
    queryFn: () => api.get('/calls', { params }).then(r => r.data),
    keepPreviousData: true,
  });

  // Check addon status
  const { data: addonsData } = useQuery({
    queryKey: ['addons-status', clientId],
    queryFn: () => api.get('/crm/addons-status', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
  });
  const addonEnabled = addonsData?.addons?.includes('ai_call_answering');

  const calls = data?.calls || [];

  function handleSearchChange(e) {
    setSearch(e.target.value);
    setPage(1);
  }

  return (
    <Layout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 shrink-0 border-b border-slate-200 bg-white">
          <h1 className="text-xl font-semibold text-slate-800 mb-4">AI Calls</h1>
          <div className="flex flex-wrap gap-3">
            <input
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-violet-400"
              placeholder="Search caller number…"
              value={search}
              onChange={handleSearchChange}
            />
            <select
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              value={statusFilter}
              onChange={e => { setStatus(e.target.value); setPage(1); }}
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type="date"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            />
            <input
              type="date"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {!clientId ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              Select a client to view calls.
            </div>
          ) : clientId && addonEnabled === false ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400">
              <span className="text-4xl">📵</span>
              <p className="text-sm font-medium">AI Call Answering addon is not enabled for this client.</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-full"><Spinner /></div>
          ) : calls.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              No calls found.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Caller</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Called #</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Status</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Duration</th>
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {calls.map(call => (
                  <tr
                    key={call.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setSelectedCall(call)}
                  >
                    <td className="px-6 py-3 font-medium text-slate-700">{call.caller_phone || '—'}</td>
                    <td className="px-6 py-3 text-slate-500">{call.called_phone || '—'}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[call.status] || 'bg-slate-100 text-slate-600'}`}>
                        {call.status || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-500">{formatDuration(call.duration_seconds)}</td>
                    <td className="px-6 py-3 text-slate-500">{formatDateTime(call.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {data && (
          <div className="px-6 py-3 border-t border-slate-200 bg-white flex items-center justify-between shrink-0">
            <span className="text-sm text-slate-500">{data.total} total</span>
            {data.total > 20 && (
              <Pagination page={page} total={data.total} limit={20} onChange={setPage} />
            )}
          </div>
        )}
      </div>

      {/* Transcript Drawer */}
      {selectedCall && (
        <CallTranscriptDrawer
          call={selectedCall}
          onClose={() => setSelectedCall(null)}
        />
      )}
    </Layout>
  );
}
