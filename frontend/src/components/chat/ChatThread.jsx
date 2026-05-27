import { useEffect, useRef, useCallback, useState } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import AstroChartModal from './AstroChartModal';
import TarotModal from './TarotModal';
import CreateOrderDrawer from './CreateOrderDrawer';
import Spinner from '../ui/Spinner';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { STATUS_OPTIONS, STATUS_COLORS } from '../../lib/utils';

export default function ChatThread({ customer, clientId, onBack, onCustomerDeleted }) {
  const { phone, name } = customer;
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [astroModalOpen, setAstroModalOpen]   = useState(false);
  const [tarotModalOpen, setTarotModalOpen]   = useState(false);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [messagePrefill, setMessagePrefill] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const topRef = useRef();
  const bottomRef = useRef();
  const threadRef = useRef();
  const prevScrollHeight = useRef(0);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['messages', phone, clientId],
    queryFn: ({ pageParam }) => {
      const params = { limit: 50, ...(pageParam && { before: pageParam }), ...(clientId && { client_id: clientId }) };
      return api.get(`/messages/${phone}`, { params }).then(r => r.data);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.messages[0]?.created_at : undefined,
    initialPageParam: null,
  });

  // Flatten pages: reverse page order so oldest page first, newest page last → oldest msg at top, newest at bottom
  const allMessages = data?.pages.slice().reverse().flatMap(p => p.messages) ?? [];

  // Scroll to bottom on initial load and new messages, but not when loading older pages
  const prevPageCount = useRef(0);
  useEffect(() => {
    const curPageCount = data?.pages.length ?? 0;
    const addedOlderPage = curPageCount > prevPageCount.current && prevPageCount.current > 0;
    prevPageCount.current = curPageCount;
    if (!addedOlderPage) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allMessages.length, data?.pages.length]);

  // Preserve scroll position when older messages prepended
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const diff = el.scrollHeight - prevScrollHeight.current;
    if (diff > 0 && prevScrollHeight.current > 0) {
      el.scrollTop += diff;
    }
    prevScrollHeight.current = el.scrollHeight;
  });

  // IntersectionObserver: load more when top sentinel visible
  const observerCb = useCallback((entries) => {
    if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
      const el = threadRef.current;
      prevScrollHeight.current = el?.scrollHeight ?? 0;
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(observerCb, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [observerCb]);

  const handleDeleteMessage = async (msgId) => {
    if (!confirm('Hide this message from CRM? (Customer will still see it on WhatsApp)')) return;
    try {
      await api.delete(`/messages/${msgId}`, { params: clientId ? { client_id: clientId } : {} });
      qc.invalidateQueries({ queryKey: ['messages', phone] });
    } catch {
      toast.error('Failed to delete message');
    }
  };

  const handleDeleteHistory = async () => {
    if (!confirm('Clear all messages for this customer?')) return;
    try {
      await api.delete(`/customers/${phone}/messages`, { params: clientId ? { client_id: clientId } : {} });
      qc.invalidateQueries({ queryKey: ['messages', phone] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Chat history cleared');
    } catch {
      toast.error('Failed to clear history');
    }
  };

  const handleDeleteCustomer = async () => {
    if (!confirm(`Delete customer ${name || phone} and all their data?`)) return;
    try {
      await api.delete(`/customers/${phone}`, { params: clientId ? { client_id: clientId } : {} });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
      onCustomerDeleted?.();
    } catch {
      toast.error('Failed to delete customer');
    }
  };

  const totalCost = allMessages.reduce((sum, m) => sum + (parseFloat(m.cost_usd) || 0), 0);

  const { data: aiModeData, refetch: refetchAiMode } = useQuery({
    queryKey: ['ai-mode', phone, clientId],
    queryFn: () => api.get(`/customers/${phone}/ai-mode`, {
      params: clientId ? { client_id: clientId } : {}
    }).then(r => r.data),
  });
  const aiEnabled = aiModeData?.ai_enabled ?? true;

  const { data: addonsData } = useQuery({
    queryKey: ['addons-status', clientId],
    queryFn: () => api.get('/crm/addons-status', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
  });
  const crmMediaEnabled = addonsData?.addons?.includes('crm_media_send') ?? false;

  const { data: ordersData, refetch: refetchOrders } = useQuery({
    queryKey: ['chat-orders', phone, clientId],
    queryFn: () => api.get('/orders', { params: { search: phone, limit: 20, ...(clientId && { client_id: clientId }) } }).then(r => r.data),
  });
  const customerOrders = ordersData?.orders || [];

  const updateStatusMutation = useMutation({
    mutationFn: ({ orderId, status }) => api.patch(`/orders/${orderId}/status`, { status }),
    onSuccess: () => { refetchOrders(); qc.invalidateQueries({ queryKey: ['customers'] }); toast.success('Status updated'); },
    onError: () => toast.error('Failed to update status'),
  });

  const uploadFile = async (file) => {
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('phone', phone);
      if (clientId) form.append('client_id', clientId);
      await api.post('/crm/send-media', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        params: clientId ? { client_id: clientId } : {},
      });
      qc.invalidateQueries({ queryKey: ['messages', phone] });
      toast.success('File sent');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to send file');
    }
  };

  const handleDragOver = (e) => {
    if (!crmMediaEnabled) return;
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  };
  const handleDrop = async (e) => {
    if (!crmMediaEnabled) return;
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadFile(file);
  };

  const toggleAiMutation = useMutation({
    mutationFn: (enabled) => api.patch(`/customers/${phone}/ai-mode`, { enabled },
      { params: clientId ? { client_id: clientId } : {} }
    ),
    onSuccess: () => refetchAiMode(),
  });

  return (
    <div
      className="relative flex flex-col h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-violet-500/10 border-2 border-dashed border-violet-400 rounded pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-violet-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span className="text-sm font-semibold">Drop file to send</span>
            <span className="text-xs opacity-70">Image, PDF or audio</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="border-b border-slate-200 bg-white shrink-0">
        {/* Top row: back + name + AI toggle */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          {/* Back button — mobile only */}
          <button
            onClick={onBack}
            className="md:hidden shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 border-0 bg-transparent cursor-pointer"
            aria-label="Back to contacts"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          {/* Customer info */}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">{name || phone}</div>
            {name && <div className="text-xs text-slate-400">{phone}</div>}
            {totalCost > 0 && <div className="text-xs text-slate-400">${totalCost.toFixed(6)}</div>}
          </div>
          {/* Action buttons: inline on desktop, only AI toggle visible on mobile */}
          <div className="hidden md:flex gap-2 items-center shrink-0">
            {addonsData?.addons?.includes('astro_vedic_chart') && customerOrders.some(o => o.status === 'pending') && (
              <button
                onClick={() => setAstroModalOpen(true)}
                className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors bg-amber-100 text-amber-700 hover:bg-amber-200"
                title="Generate astrology message for this customer"
              >
                ✨ Astro
              </button>
            )}
            {addonsData?.addons?.includes('tarot_reading') && (
              <button
                onClick={() => setTarotModalOpen(true)}
                className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors bg-purple-100 text-purple-700 hover:bg-purple-200"
                title="Generate tarot card reading for this customer"
              >
                🔮 Tarot
              </button>
            )}
            <button
              onClick={() => setCreateOrderOpen(true)}
              className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
            >
              + Order
            </button>
            <button
              onClick={() => toggleAiMutation.mutate(!aiEnabled)}
              disabled={toggleAiMutation.isPending}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                aiEnabled ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
              }`}
            >
              AI {aiEnabled ? 'ON' : 'OFF'}
            </button>
            <Button variant="ghost" size="sm" onClick={handleDeleteHistory}>Clear history</Button>
            <Button variant="danger" size="sm" onClick={handleDeleteCustomer}>Delete</Button>
          </div>
          {/* Mobile: just AI toggle in top row */}
          <div className="flex md:hidden items-center gap-1.5 shrink-0">
            <button
              onClick={() => toggleAiMutation.mutate(!aiEnabled)}
              disabled={toggleAiMutation.isPending}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                aiEnabled ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
              }`}
            >
              AI {aiEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
        {/* Mobile action row — scrollable */}
        <div className="md:hidden flex gap-1.5 items-center overflow-x-auto px-3 pb-2 scrollbar-none">
          {addonsData?.addons?.includes('astro_vedic_chart') && customerOrders.some(o => o.status === 'pending') && (
            <button
              onClick={() => setAstroModalOpen(true)}
              className="shrink-0 text-xs px-2.5 py-1 rounded-full font-medium transition-colors bg-amber-100 text-amber-700 hover:bg-amber-200"
            >
              ✨ Astro
            </button>
          )}
          {addonsData?.addons?.includes('tarot_reading') && (
            <button
              onClick={() => setTarotModalOpen(true)}
              className="shrink-0 text-xs px-2.5 py-1 rounded-full font-medium transition-colors bg-purple-100 text-purple-700 hover:bg-purple-200"
            >
              🔮 Tarot
            </button>
          )}
          <button
            onClick={() => setCreateOrderOpen(true)}
            className="shrink-0 text-xs px-2.5 py-1 rounded-full font-medium transition-colors bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
          >
            + Order
          </button>
          <Button variant="ghost" size="sm" onClick={handleDeleteHistory}>Clear</Button>
          <Button variant="danger" size="sm" onClick={handleDeleteCustomer}>Delete</Button>
        </div>
      </div>

      {/* Orders panel */}
      {customerOrders.length > 0 && (
        <div className="shrink-0 border-b border-slate-200 bg-white">
          <button
            onClick={() => setOrdersOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors bg-transparent border-0 cursor-pointer"
          >
            <span>{customerOrders.length} order{customerOrders.length !== 1 ? 's' : ''}</span>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 transition-transform ${ordersOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {ordersOpen && (
            <div className="px-3 pb-2 flex flex-col gap-1.5">
              {customerOrders.map(o => (
                <div key={o.order_id} className="flex items-center gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-mono font-semibold text-slate-700 shrink-0">#{o.order_id}</span>
                  <span className="text-slate-400 shrink-0">{new Date(o.created_at).toLocaleDateString()}</span>
                  <div className="ml-auto">
                    <select
                      value={o.status}
                      onChange={e => updateStatusMutation.mutate({ orderId: o.order_id, status: e.target.value })}
                      className={`text-xs font-medium rounded-md px-2 py-0.5 border cursor-pointer outline-none ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
                    >
                      {!STATUS_OPTIONS.includes(o.status) && <option value={o.status}>{o.status}</option>}
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3 bg-slate-50">
        {/* Top sentinel for infinite scroll */}
        <div ref={topRef} className="h-1" />
        {(isLoading || isFetchingNextPage) && (
          <div className="flex justify-center py-4"><Spinner size="sm" /></div>
        )}
        {!hasNextPage && allMessages.length > 0 && (
          <div className="text-center text-xs text-slate-300 py-2">Beginning of conversation</div>
        )}
        {allMessages.map((msg, i) => (
          <MessageBubble key={msg.id ?? i} msg={msg} onDelete={() => handleDeleteMessage(msg.id)} />
        ))}
        {allMessages.length === 0 && !isLoading && (
          <div className="text-center py-12 text-sm text-slate-400">No messages yet</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput
        phone={phone}
        clientId={clientId}
        crmMediaEnabled={crmMediaEnabled}
        prefill={messagePrefill}
        onPrefillConsumed={() => setMessagePrefill('')}
        onSent={() => qc.invalidateQueries({ queryKey: ['messages', phone] })}
      />

      {/* Create Order Drawer */}
      <CreateOrderDrawer
        open={createOrderOpen}
        onClose={() => setCreateOrderOpen(false)}
        customer={{ phone, name }}
        clientId={clientId}
      />

      {/* Astro Chart Modal */}
      {astroModalOpen && (
        <AstroChartModal
          phone={phone}
          clientId={clientId}
          onClose={() => setAstroModalOpen(false)}
          onResult={(text) => {
            setMessagePrefill(text);
            setAstroModalOpen(false);
          }}
        />
      )}

      {/* Tarot Modal */}
      {tarotModalOpen && (
        <TarotModal
          phone={phone}
          clientId={clientId}
          onClose={() => setTarotModalOpen(false)}
          onResult={(result) => {
            setMessagePrefill(typeof result === 'string' ? result : result.reading);
            setTarotModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
