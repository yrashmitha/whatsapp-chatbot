import { useQuery } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import api from '../lib/api';

const StatCard = ({ icon, label, value, sub, accent }) => (
  <div
    className="rounded-2xl p-5 flex flex-col gap-2"
    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
  >
    <div className="flex items-center justify-between">
      <span className="text-lg">{icon}</span>
      {sub && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-base)', color: 'var(--text-3)' }}>{sub}</span>}
    </div>
    <div className="text-2xl font-bold" style={{ color: accent || 'var(--text-1)' }}>{value}</div>
    <div className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{label}</div>
  </div>
);

export default function Summary() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  const { data, isLoading } = useQuery({
    queryKey: ['summary', clientId],
    queryFn: () => api.get('/summary', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    refetchInterval: 60_000,
  });

  const n = (v) => (v == null ? '-' : Number(v).toLocaleString());
  const usd = (v) => (v == null ? '-' : `$${parseFloat(v).toFixed(4)}`);

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div
          className="px-6 py-4 shrink-0 flex items-center gap-2"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
        >
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>Summary</h1>
          <span className="text-xs ml-1" style={{ color: 'var(--text-3)' }}>Live stats for your account</span>
        </div>

        <div className="flex-1 overflow-auto px-6 py-6">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 max-w-5xl">
              <StatCard icon="💬" label="New Chats Today"     value={n(data?.new_chats_today)}   sub="24h"   accent="var(--accent)" />
              <StatCard icon="📦" label="Orders Today"        value={n(data?.orders_today)}       sub="24h"   accent="var(--accent)" />
              <StatCard icon="📅" label="Orders This Month"   value={n(data?.orders_this_month)}  sub="month" />
              <StatCard icon="🗂️"  label="Total Orders"       value={n(data?.orders_total)} />
              <StatCard icon="⏳" label="Open Orders"         value={n(data?.open_orders)}        accent="#fbbf24" />
              <StatCard icon="👥" label="Total Customers"     value={n(data?.total_customers)} />
              <StatCard icon="🤖" label="Nova Replies Today"      value={n(data?.ai_messages_today)}       sub="24h"   accent="#34d399" />
              <StatCard icon="🤖" label="Nova Replies This Month" value={n(data?.ai_messages_this_month)} sub="month" accent="#34d399" />
              <StatCard icon="🤖" label="Nova Replies Total"      value={n(data?.ai_messages_total)}                 accent="#34d399" />
              <StatCard icon="💰" label="Nova Cost Today"         value={usd(data?.cost_today)}       sub="24h"   accent="#a78bfa" />
              <StatCard icon="💰" label="Nova Cost This Month"    value={usd(data?.cost_this_month)}  sub="month" accent="#a78bfa" />
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
