import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import CustomerList from '../components/chat/CustomerList';
import ChatThread from '../components/chat/ChatThread';
import api from '../lib/api';

export default function Chat() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const [searchParams, setSearchParams] = useSearchParams();

  // Arriving from the follow-up queue with a specific person to answer. The
  // name fills in from the list once it loads; the phone is all the thread needs.
  const deepLinked = searchParams.get('phone');
  const [selectedCustomer, setSelectedCustomer] = useState(
    deepLinked ? { phone: deepLinked, name: null } : null);
  const [showThread, setShowThread] = useState(!!deepLinked);
  const qc = useQueryClient();

  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  useEffect(() => {
    if (!selectedCustomer?.phone) return;
    const params = clientId ? { client_id: clientId } : {};
    api.post(`/customers/${selectedCustomer.phone}/mark-read`, {}, { params })
      .then(() => qc.invalidateQueries({ queryKey: ['customers'] }))
      .catch(() => {});
  }, [selectedCustomer?.phone]);

  const handleSelect = (customer) => {
    setSelectedCustomer(customer);
    setShowThread(true);
  };

  const handleBack = () => {
    setShowThread(false);
    // Drop the deep link, or going back and forth keeps reopening the same chat.
    if (searchParams.get('phone')) setSearchParams({}, { replace: true });
  };

  return (
    <Layout hideNavOnMobile={showThread}>
      <div className="relative flex h-full overflow-hidden">
        {/* Left panel — full screen on mobile when thread not open */}
        <div className={`bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden
          w-full md:w-80
          ${showThread ? 'absolute inset-0 md:static md:flex' : 'flex'}
        `}>
          <CustomerList
            clientId={clientId}
            selectedPhone={selectedCustomer?.phone}
            onSelect={handleSelect}
          />
        </div>

        {/* Right panel — full screen on mobile when thread open */}
        <div className={`flex-1 overflow-hidden flex flex-col
          ${showThread ? 'flex relative z-10' : 'hidden md:flex'}
        `}>
          {selectedCustomer ? (
            <ChatThread
              customer={selectedCustomer}
              clientId={clientId}
              onBack={handleBack}
              onCustomerDeleted={() => { setSelectedCustomer(null); setShowThread(false); }}
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
