import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Pagination from '../components/ui/Pagination';
import Badge from '../components/ui/Badge';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';
import { formatDateTime, STATUS_COLORS, STATUS_OPTIONS } from '../lib/utils';

export default function Orders() {
  const { user } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const toast = useToast();
  const qc = useQueryClient();

  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
    enabled: superAdmin,
  });

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
    mutationFn: ({ id, status }) => api.patch(`/orders/${id}/status`, { status }),
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

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Top bar */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 flex-wrap shrink-0">
          <h1 className="text-lg font-semibold text-slate-800 mr-2">Orders</h1>

          {superAdmin && (
            <select value={selectedClientId} onChange={e => { setSelectedClientId(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400">
              <option value="">All Clients</option>
              {(clientsData?.clients || []).map(c => <option key={c.client_id} value={c.client_id}>{c.client_id}</option>)}
            </select>
          )}

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

        {/* Table */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
                  <th className="py-2 text-left pr-4">Order ID</th>
                  <th className="py-2 text-left pr-4">Customer</th>
                  <th className="py-2 text-left pr-4">Package</th>
                  <th className="py-2 text-left pr-4">Status</th>
                  <th className="py-2 text-left pr-4">Date</th>
                  {superAdmin && <th className="py-2 text-left pr-4">Client</th>}
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2.5 pr-4 text-slate-500 font-mono text-xs">#{o.id}</td>
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-slate-800">{o.customer_name || o.phone}</div>
                      <div className="text-xs text-slate-400">{o.phone}</div>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-700">{o.package_name || '—'}</td>
                    <td className="py-2.5 pr-4">
                      <select
                        value={o.status}
                        onChange={e => updateStatus.mutate({ id: o.id, status: e.target.value })}
                        className={`text-xs font-medium rounded-md px-2 py-1 border cursor-pointer outline-none ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500 text-xs">{formatDateTime(o.created_at)}</td>
                    {superAdmin && <td className="py-2.5 pr-4 text-violet-500 text-xs">{o.client_id}</td>}
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr><td colSpan={superAdmin ? 6 : 5} className="py-12 text-center text-slate-400">No orders found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
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
