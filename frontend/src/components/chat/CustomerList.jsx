import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { timeAgo, STATUS_COLORS } from '../../lib/utils';
import Spinner from '../ui/Spinner';

const STATUS_LABEL = {
  pending:          'Pending',
  payment_received: 'Payment Rcvd',
  paid:             'Paid',
  complete:         'Complete',
  cancelled:        'Cancelled',
};

export default function CustomerList({ clientId, selectedPhone, onSelect }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const params = { page, limit: 30, ...(search && { search }), ...(clientId && { client_id: clientId }) };

  const { data, isLoading } = useQuery({
    queryKey: ['customers', params],
    queryFn: () => api.get('/customers', { params }).then(r => r.data),
    keepPreviousData: true,
  });

  const customers = data?.customers || [];

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-slate-100">
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search customers…"
          className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : customers.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">No customers found</div>
        ) : (
          customers.map(c => (
            <button
              key={c.phone}
              onClick={() => onSelect(c)}
              className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer bg-transparent
                ${selectedPhone === c.phone ? 'bg-violet-50 border-l-2 border-l-violet-500' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{c.name || c.phone}</div>
                  {c.name && <div className="text-xs text-slate-400 truncate">{c.phone}</div>}
                  {c.last_message && (
                    <div className="text-xs text-slate-500 truncate mt-0.5">{c.last_message}</div>
                  )}
                  {(c.has_image || c.has_document || c.latest_order_status) && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {c.has_image && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-medium">📷 Images</span>
                      )}
                      {c.has_document && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium">📄 Docs</span>
                      )}
                      {c.latest_order_status && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${STATUS_COLORS[c.latest_order_status] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_LABEL[c.latest_order_status] || c.latest_order_status}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right flex flex-col items-end gap-0.5">
                  {c.last_message_at && (
                    <div className="text-xs text-slate-400">{timeAgo(c.last_message_at)}</div>
                  )}
                  {c.order_count > 0 && (
                    <span className="text-xs font-semibold text-white bg-violet-500 rounded-full px-2 py-0.5">
                      {c.order_count} {c.order_count === 1 ? 'order' : 'orders'}
                    </span>
                  )}
                </div>
              </div>
              {c.client_id && (
                <div className="text-xs text-violet-400 mt-0.5">{c.client_id}</div>
              )}
            </button>
          ))
        )}
        {data?.total > 30 && (
          <div className="flex justify-center gap-2 py-3">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="text-xs text-violet-600 disabled:opacity-40 cursor-pointer bg-transparent border-0">← Prev</button>
            <span className="text-xs text-slate-400">Page {page}</span>
            <button disabled={customers.length < 30} onClick={() => setPage(p => p + 1)} className="text-xs text-violet-600 disabled:opacity-40 cursor-pointer bg-transparent border-0">Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
