import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import CustomerList from '../components/chat/CustomerList';
import ChatThread from '../components/chat/ChatThread';
import api from '../lib/api';

export default function Chat() {
  const { user } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
    enabled: superAdmin,
  });

  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  return (
    <Layout>
      <div className="flex h-full">
        {/* Left panel */}
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0">
          {/* Client selector for superadmin */}
          {superAdmin && (
            <div className="px-3 pt-3 pb-2 border-b border-slate-100">
              <select
                value={selectedClientId}
                onChange={e => { setSelectedClientId(e.target.value); setSelectedCustomer(null); }}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
              >
                <option value="">All Clients</option>
                {(clientsData?.clients || []).map(c => (
                  <option key={c.client_id} value={c.client_id}>{c.client_id}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            <CustomerList
              clientId={clientId}
              selectedPhone={selectedCustomer?.phone}
              onSelect={setSelectedCustomer}
            />
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-hidden">
          {selectedCustomer ? (
            <ChatThread
              customer={selectedCustomer}
              clientId={clientId}
              onCustomerDeleted={() => setSelectedCustomer(null)}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              Select a customer to start chatting
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
