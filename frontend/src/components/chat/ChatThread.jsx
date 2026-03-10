import { useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import Spinner from '../ui/Spinner';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';

export default function ChatThread({ customer, clientId, onCustomerDeleted }) {
  const { phone, name } = customer;
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

  const toggleAiMutation = useMutation({
    mutationFn: (enabled) => api.patch(`/customers/${phone}/ai-mode`, { enabled },
      { params: clientId ? { client_id: clientId } : {} }
    ),
    onSuccess: () => refetchAiMode(),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <div>
          <div className="text-sm font-semibold text-slate-800">{name || phone}</div>
          {name && <div className="text-xs text-slate-400">{phone}</div>}
          {totalCost > 0 && <div className="text-xs text-slate-400">${totalCost.toFixed(6)}</div>}
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => toggleAiMutation.mutate(!aiEnabled)}
            disabled={toggleAiMutation.isPending}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              aiEnabled
                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
            }`}
            title={aiEnabled ? 'AI is ON — click to disable' : 'AI is OFF — click to enable'}
          >
            AI {aiEnabled ? 'ON' : 'OFF'}
          </button>
          <Button variant="ghost" size="sm" onClick={handleDeleteHistory}>Clear history</Button>
          <Button variant="danger" size="sm" onClick={handleDeleteCustomer}>Delete</Button>
        </div>
      </div>

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
          <MessageBubble key={msg.id ?? i} msg={msg} />
        ))}
        {allMessages.length === 0 && !isLoading && (
          <div className="text-center py-12 text-sm text-slate-400">No messages yet</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput phone={phone} clientId={clientId} onSent={() => qc.invalidateQueries({ queryKey: ['messages', phone] })} />
    </div>
  );
}
