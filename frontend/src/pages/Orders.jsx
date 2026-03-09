import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Pagination from '../components/ui/Pagination';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';
import { formatDateTime, STATUS_COLORS, STATUS_OPTIONS } from '../lib/utils';

function parseCustomFields(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function Orders() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedOrder, setExpandedOrder] = useState(null);
  const toast = useToast();
  const qc = useQueryClient();

  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  const params = {
    page, limit: 20,
    ...(search && { search }),
    ...(statusFilter && { status: statusFilter }),
    ...(clientId && { client_id: clientId }),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['orders', params],
    queryFn: () => api.get('/orders', { params }).then(r => r.data),
    keepPreviousData: true,
  });

  const orders = data?.orders || [];

  const updateStatus = useMutation({
    mutationFn: ({ orderId, status }) => api.patch(`/orders/${orderId}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); toast.success('Status updated'); },
    onError: () => toast.error('Failed to update status'),
  });

  const handleExport = async () => {
    const exportParams = new URLSearchParams({ ...(clientId && { client_id: clientId }), ...(statusFilter && { status: statusFilter }), ...(search && { search }) });
    const token = localStorage.getItem('crm_token');
    const res = await fetch(`/api/orders/export?${exportParams}`, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'orders.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Column count for colSpan
  const colCount = superAdmin ? 6 : 5;

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 flex-wrap shrink-0">
          <h1 className="text-lg font-semibold text-slate-800 mr-2">Orders</h1>
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search…" className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 w-40" />
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="ml-auto">
            <button onClick={handleExport} className="text-sm bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg px-4 py-1.5 cursor-pointer transition-colors">
              Export CSV
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
                  <th className="py-2 text-left pr-4">Order ID</th>
                  <th className="py-2 text-left pr-4">Customer</th>
                  <th className="py-2 text-left pr-4">Status</th>
                  <th className="py-2 text-left pr-4">Date</th>
                  <th className="py-2 text-left pr-4">Details</th>
                  {superAdmin && <th className="py-2 text-left pr-4">Client</th>}
                </tr>
              </thead>
              <tbody>
                {orders.map(o => {
                  const cf = parseCustomFields(o.custom_fields);
                  const hasDetails = cf && Object.keys(cf).length > 0;
                  const isExpanded = expandedOrder === o.id;

                  return (
                    <React.Fragment key={o.id}>
                      <tr className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2.5 pr-4 text-slate-500 font-mono text-xs">#{o.order_id || o.id}</td>
                        <td className="py-2.5 pr-4">
                          <div className="font-medium text-slate-800">{o.customer_name || o.phone || o.phone_number}</div>
                          <div className="text-xs text-slate-400">{o.phone || o.phone_number}</div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <select
                            value={o.status}
                            onChange={e => updateStatus.mutate({ orderId: o.order_id, status: e.target.value })}
                            className={`text-xs font-medium rounded-md px-2 py-1 border cursor-pointer outline-none ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
                          >
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="py-2.5 pr-4 text-slate-500 text-xs">{formatDateTime(o.created_at)}</td>
                        <td className="py-2.5 pr-4">
                          {hasDetails ? (
                            <button
                              onClick={() => setExpandedOrder(isExpanded ? null : o.id)}
                              className="text-xs text-violet-600 hover:text-violet-800 underline cursor-pointer bg-transparent border-0"
                            >
                              {isExpanded ? 'Hide' : 'View'}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        {superAdmin && <td className="py-2.5 pr-4 text-violet-500 text-xs">{o.client_id}</td>}
                      </tr>
                      {isExpanded && hasDetails && (
                        <tr className="bg-violet-50 border-b border-violet-100">
                          <td colSpan={colCount} className="px-6 py-3">
                            <div className="text-xs font-semibold text-slate-600 mb-2">Order Details</div>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                              {Object.entries(cf).map(([k, v]) => (
                                <div key={k} className="flex gap-2 text-xs">
                                  <span className="text-slate-400 capitalize shrink-0">{k.replace(/_/g, ' ')}:</span>
                                  <span className="text-slate-700">{String(v ?? '—')}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {orders.length === 0 && (
                  <tr><td colSpan={colCount} className="py-12 text-center text-slate-400">No orders found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {data?.total > 20 && (
          <div className="px-6 py-3 border-t border-slate-200 bg-white flex items-center justify-between shrink-0">
            <span className="text-sm text-slate-500">{data.total} total</span>
            <Pagination page={page} total={data.total} limit={20} onChange={setPage} />
          </div>
        )}
      </div>
    </Layout>
  );
}
