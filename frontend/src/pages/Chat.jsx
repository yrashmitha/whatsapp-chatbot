import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import CustomerList from '../components/chat/CustomerList';
import ChatThread from '../components/chat/ChatThread';
import api from '../lib/api';

export default function Chat() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const qc = useQueryClient();

  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  useEffect(() => {
    if (!selectedCustomer?.phone) return;
    const params = clientId ? { client_id: clientId } : {};
    api.post(`/customers/${selectedCustomer.phone}/mark-read`, {}, { params })
      .then(() => qc.invalidateQueries({ queryKey: ['customers'] }))
      .catch(() => {});
  }, [selectedCustomer?.phone]);

  return (
    <Layout>
      <div className="flex h-full">
        {/* Left panel */}
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
          <CustomerList
            clientId={clientId}
            selectedPhone={selectedCustomer?.phone}
            onSelect={setSelectedCustomer}
          />
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
