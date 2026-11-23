import { useState, useEffect, useRef } from 'react';
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

  // How the current chat was opened, for the open history.
  const openSource = useRef(deepLinked ? 'link' : 'tap');
  // One id per browser tab, so two tabs on one computer can be told apart.
  const tabId = useRef((() => {
    try {
      let t = sessionStorage.getItem('crm_tab');
      if (!t) { t = Math.random().toString(36).slice(2, 8); sessionStorage.setItem('crm_tab', t); }
      return t;
    } catch { return Math.random().toString(36).slice(2, 8); }
  })());

  // Who opened this chat before you, from the server, shown in the header.
  const [lastSeen, setLastSeen] = useState(null);

  // A link from Follow-ups opens one chat. Take the phone out of the address
  // once it is open, or every reload of the tab would open, and mark read,
  // that chat again with nobody looking at it.
  useEffect(() => {
    if (deepLinked) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCustomer?.phone) return;
    setLastSeen(null);
    const params = clientId ? { client_id: clientId } : {};
    const phone = selectedCustomer.phone;
    const mark = (source) => api.post(`/customers/${phone}/mark-read`, { source, tab: tabId.current }, { params })
      .then((r) => { setLastSeen(r.data?.previous || null); qc.invalidateQueries({ queryKey: ['customers'] }); })
      .catch(() => {});
    // Read only when someone can actually see it. A tab in the background, or a
    // phone that is locked with the CRM open, waits until it is shown.
    if (document.visibilityState === 'visible') { mark(openSource.current); return; }
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onShow);
      mark('tab_shown');
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
    // The customer object is new on every tap, so reopening the same chat (on a
    // phone: back, then the same row again) marks it read again too.
  }, [selectedCustomer]);

  const handleSelect = (customer) => {
    openSource.current = 'tap';
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
              // A fresh thread per chat: the scroll memory of the last chat
              // must not decide whether this one opens at the newest message.
              key={selectedCustomer.phone}
              customer={selectedCustomer}
              clientId={clientId}
              lastSeen={lastSeen}
              onMarkedUnread={() => {
                // Leave the chat, as WhatsApp does, or it would count as read again.
                setSelectedCustomer(null);
                setShowThread(false);
                qc.invalidateQueries({ queryKey: ['customers'] });
              }}
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
