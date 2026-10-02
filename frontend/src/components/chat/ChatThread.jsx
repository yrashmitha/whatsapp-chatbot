import { Fragment, useEffect, useRef, useCallback, useState } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import MetaTracking from '../orders/MetaTracking';
import MetaTrackingBadge from '../orders/MetaTrackingBadge';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import AstroChartModal from './AstroChartModal';
import HoroscopeQaPanel from './HoroscopeQaPanel';
import TarotModal from './TarotModal';
import CreateOrderDrawer from './CreateOrderDrawer';
import { LeadPanel, LeadBody } from '../leads/LeadControls';
import Spinner from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { usePermissions } from '../../lib/permissions';
import { STATUS_OPTIONS, STATUS_COLORS } from '../../lib/utils';
import useSwipeBack from '../../lib/useSwipeBack';

/** The calendar day of a timestamp on the viewer's clock, for grouping. */
function dayKey(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : null;
}

/** "Today", "Yesterday", or "28 Sep" (with the year once it is not this one). */
function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(y.toISOString())) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
}

export default function ChatThread({ customer, clientId, onBack, onCustomerDeleted }) {
  const { phone, name } = customer;
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [astroModalOpen, setAstroModalOpen]   = useState(false);
  const [horoscopeQaOpen, setHoroscopeQaOpen] = useState(false);
  const [tarotModalOpen, setTarotModalOpen]   = useState(false);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [messagePrefill, setMessagePrefill] = useState('');
  const toast = useToast();
  const perms = usePermissions();
  const qc = useQueryClient();
  const topRef = useRef();
  const bottomRef = useRef();
  const threadRef = useRef();
  const prevScrollHeight = useRef(0);

  // Swipe right to go back, as on a phone. Only bound when there is somewhere
  // to go back to.
  const swipe = useSwipeBack(onBack, !!onBack);

  // Escape closes the actions menu, as a keyboard user expects of any popover.
  useEffect(() => {
    if (!actionsOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setActionsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actionsOpen]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['messages', phone, clientId],
    queryFn: ({ pageParam }) => {
      const params = { limit: 50, ...(pageParam && { before: pageParam }), ...(clientId && { client_id: clientId }) };
      return api.get(`/messages/${phone}`, { params }).then(r => r.data);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.messages[0]?.created_at : undefined,
    initialPageParam: null,
    // There is no push channel, so an open conversation has to ask. Eight
    // seconds is close enough to feel live when someone is replying for a
    // living; the interval stops while the tab is hidden so an idle CRM in a
    // background tab costs nothing.
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
  });

  // Flatten pages: reverse page order so oldest page first, newest page last → oldest msg at top, newest at bottom
  const allMessages = data?.pages.slice().reverse().flatMap(p => p.messages) ?? [];

  // Scroll to bottom on initial load and new messages, but not when loading older pages
  const prevPageCount = useRef(0);
  const prevMsgCount = useRef(0);
  useEffect(() => {
    const curPageCount = data?.pages.length ?? 0;
    const addedOlderPage = curPageCount > prevPageCount.current && prevPageCount.current > 0;
    prevPageCount.current = curPageCount;

    const first = prevMsgCount.current === 0;
    prevMsgCount.current = allMessages.length;
    if (addedOlderPage) return;

    // Follow the conversation only when already at the bottom. Someone reading
    // back through history should not be dragged away by an arriving message.
    const el = threadRef.current;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (first || nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: first ? 'auto' : 'smooth' });
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
  const ownedBy = aiModeData?.owned_by ?? null;
  const mineAlready = ownedBy != null && ownedBy === perms.user?.uid;

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

  // ── Lead quality and call log ───────────────────────────────────────────────
  const cp = clientId ? { client_id: clientId } : {};
  const canLead = perms.can('followups.schedule');
  const { data: lead } = useQuery({
    queryKey: ['lead', phone, clientId],
    queryFn: () => api.get(`/customers/${encodeURIComponent(phone)}/lead`, { params: cp }).then(r => r.data),
    enabled: perms.can('followups.view'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ orderId, status }) => api.patch(`/orders/${orderId}/status`, { status }),
    onSuccess: () => { refetchOrders(); qc.invalidateQueries({ queryKey: ['customers'] }); toast.success('Status updated'); },
    onError: () => toast.error('Failed to update status'),
  });

  const reextractMutation = useMutation({
    mutationFn: () => api.post('/crm/media/reextract', { phone }, { params: cp }),
    onSuccess: (r) => {
      const d = r.data || {};
      qc.invalidateQueries({ queryKey: ['messages', phone] });
      toast.success(
        d.candidates === 0 ? 'Nothing to re-extract'
        : `${d.extracted}/${d.candidates} media re-read` + (d.file_missing ? ` (${d.file_missing} file gone)` : ''),
      );
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Re-extract failed'),
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

  // Claiming silences the bot and records who is working the chat. Releasing
  // hands it back. Credit for a sale is decided from that record, not from who
  // happened to type last.
  const claimMutation = useMutation({
    mutationFn: () => api.post(`/customers/${phone}/claim`, {},
      { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => refetchAiMode(),
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not take over this chat'),
  });
  const releaseMutation = useMutation({
    mutationFn: () => api.post(`/customers/${phone}/release`, {},
      { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => refetchAiMode(),
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not hand this chat back'),
  });

  const toggleAiMutation = useMutation({
    mutationFn: (enabled) => api.patch(`/customers/${phone}/ai-mode`, { enabled },
      { params: clientId ? { client_id: clientId } : {} }
    ),
    onSuccess: () => refetchAiMode(),
  });

  // Occasional AI tools. In the actions menu on a narrow screen, listed in the
  // side rail on a laptop so they cost one click, not two.
  const toolActions = [
    addonsData?.addons?.includes('astro_vedic_chart') && perms.can('ai.astro_chart') && customerOrders.some(o => o.status === 'pending')
      && ['Astrology message', () => setAstroModalOpen(true)],
    addonsData?.addons?.includes('tarot_reading') && perms.can('ai.generate_report')
      && ['Tarot reading', () => setTarotModalOpen(true)],
    addonsData?.addons?.includes('horoscope_followup_qa') && perms.can('ai.generate_report')
      && ['Report Q&A', () => setHoroscopeQaOpen(true)],
  ].filter(Boolean);
  const railHasLead = perms.can('followups.view');
  const showRail = railHasLead || toolActions.length > 0;

  return (
    <div
      className={`chat-thread relative flex flex-col h-full bg-white ${swipe.dragging ? 'shadow-2xl' : ''}`}
      style={swipe.style}
      {...swipe.handlers}
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
      {/* Header. One component for every width: name, the lead, who is
          answering, and the order button, with everything occasional behind one
          menu. On a phone the controls wrap to a second line under the name; on
          a desk they sit on the same line. */}
      <header className="border-b border-slate-200 bg-white shrink-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-2 md:px-4 md:py-2.5">
        {onBack && (
          <button
            onClick={onBack}
            className="order-1 md:hidden shrink-0 w-10 h-10 -ml-1 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 border-0 bg-transparent cursor-pointer"
            aria-label="Back to chats"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        <div className="order-2 flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-slate-800 truncate leading-snug">{name || phone}</div>
          {name && <div className="text-xs text-slate-500 truncate tabular-nums">{phone}</div>}
        </div>

        {/* Primary controls: second line on a phone, inline on a desk. */}
        <div className="order-4 md:order-3 basis-full md:basis-auto flex items-center gap-1.5 md:gap-2 min-w-0">
          {canLead && <div className={`min-w-0 ${railHasLead ? 'xl:hidden' : ''}`}><LeadPanel phone={phone} clientId={clientId} lead={lead} /></div>}
          {perms.isOperator ? (
            <button
              onClick={() => (mineAlready ? releaseMutation.mutate() : claimMutation.mutate())}
              disabled={claimMutation.isPending || releaseMutation.isPending}
              title={mineAlready
                ? 'Hand this chat back to the bot'
                : (ownedBy ? 'Another operator has this chat. Taking over moves it to you.' : 'Reply yourself. The bot stops answering this customer.')}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors border-0 cursor-pointer disabled:opacity-60 ${
                mineAlready
                  ? 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                  : ownedBy
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
              }`}
            >
              {mineAlready ? 'Mine · hand back' : 'Take over'}
            </button>
          ) : (
            <button
              onClick={() => toggleAiMutation.mutate(!aiEnabled)}
              disabled={toggleAiMutation.isPending}
              aria-pressed={aiEnabled}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors border-0 cursor-pointer disabled:opacity-60 ${
                aiEnabled ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
              }`}
            >
              AI {aiEnabled ? 'on' : 'off'}
            </button>
          )}
          <button
            onClick={() => setCreateOrderOpen(true)}
            className="shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border-0 cursor-pointer"
          >
            + Order
          </button>
        </div>

        {/* Everything occasional, in one menu at every width. */}
        <div className="order-3 md:order-4 relative shrink-0">
          <button
            onClick={() => setActionsOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={actionsOpen}
            aria-label="More actions"
            className="w-10 h-10 md:w-9 md:h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 border-0 bg-transparent cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
            </svg>
          </button>
          {actionsOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setActionsOpen(false)} />
              <div role="menu" className="absolute right-0 top-full mt-1 z-40 w-60 bg-white border border-slate-200 rounded-xl shadow-lg py-1 overflow-hidden">
                {(() => {
                  const item = 'w-full text-left px-4 min-h-11 md:min-h-9 flex items-center text-sm text-slate-700 hover:bg-slate-50 border-0 bg-transparent cursor-pointer disabled:opacity-50';
                  const run = (fn) => () => { setActionsOpen(false); fn(); };
                  const tools = toolActions;
                  return (
                    <>
                      {tools.map(([label, fn]) => (
                        <button key={label} role="menuitem" onClick={run(fn)} className={`${item} ${showRail ? 'xl:hidden' : ''}`}>{label}</button>
                      ))}
                      <button role="menuitem" disabled={reextractMutation.isPending}
                        onClick={run(() => reextractMutation.mutate())} className={item}
                        title="Re-read voice notes and PDFs on this chat">
                        {reextractMutation.isPending ? 'Reading media…' : 'Re-extract media'}
                      </button>
                      <div className="my-1 border-t border-slate-100" />
                      <button role="menuitem" onClick={run(handleDeleteHistory)} className={`${item} text-red-500`}>Clear history</button>
                      <button role="menuitem" onClick={run(handleDeleteCustomer)} className={`${item} text-red-500`}>Delete customer</button>
                      {totalCost > 0 && (
                        <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100 tabular-nums">
                          AI spend on this chat ${totalCost.toFixed(6)}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
      {/* One slim row for orders and the last call, so the chat keeps the screen. */}
      {customerOrders.length > 0 && (
        <div className="shrink-0 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 min-w-0">
            {customerOrders.length > 0 ? (
              <button
                onClick={() => setOrdersOpen(o => !o)}
                className="shrink-0 flex items-center gap-2 pl-4 pr-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors bg-transparent border-0 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  {customerOrders.length} order{customerOrders.length !== 1 ? 's' : ''}
                  {/* Visible without opening anything. A warning that has to be
                      looked for is not a warning. */}
                  <MetaTrackingBadge phone={phone} clientId={clientId} />
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 transition-transform ${ordersOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            ) : <span />}
          </div>
          {ordersOpen && (
            <div className="px-3 pb-2 flex flex-col gap-1.5">
              {customerOrders.map(o => (
                <div key={o.order_id} className="flex items-center gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-mono font-semibold text-slate-700 shrink-0">#{o.order_id}</span>
                  <span className="text-slate-400 shrink-0">{new Date(o.created_at).toLocaleDateString()}</span>
                  {/* The detail, and the Retry button when a send failed. The
                      summary on the header above says whether to bother
                      opening this at all. */}
                  <MetaTracking orderId={o.order_id} clientId={clientId} compact />
                  {o.delivery_url && (
                    <button
                      onClick={() => navigator.clipboard.writeText(o.delivery_url).then(
                        () => toast.success('Report link copied'),
                        () => toast.error('Copy failed — long-press the link'),
                      )}
                      title={`${o.delivery_released_at ? 'READY to download' : 'Not released yet — press "Report is ready" in the editor'}\n${o.delivery_url}`}
                      className={`shrink-0 text-xs px-1.5 py-0.5 rounded border cursor-pointer ${o.delivery_released_at ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}
                    >
                      🔗 {o.delivery_released_at ? 'link' : 'link·hold'}
                    </button>
                  )}
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
      <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto px-2 md:px-4 py-2 md:py-3 bg-slate-50">
        {/* Top sentinel for infinite scroll */}
        <div ref={topRef} className="h-1" />
        {(isLoading || isFetchingNextPage) && (
          <div className="flex justify-center py-4"><Spinner size="sm" /></div>
        )}
        {!hasNextPage && allMessages.length > 0 && (
          <div className="text-center text-xs text-slate-400 py-2">Beginning of conversation</div>
        )}
        {allMessages.map((msg, i) => {
          // A pill whenever the day changes. Operators read back through a
          // thread to answer "when did they say that", and times alone cannot.
          const day = dayKey(msg.created_at);
          const newDay = day && day !== dayKey(allMessages[i - 1]?.created_at);
          return (
            <Fragment key={msg.id ?? i}>
              {newDay && (
                <div className="flex justify-center my-3">
                  <span className="text-[11px] font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-0.5">
                    {dayLabel(msg.created_at)}
                  </span>
                </div>
              )}
              <MessageBubble msg={msg} onDelete={() => handleDeleteMessage(msg.id)} />
            </Fragment>
          );
        })}
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
        followUpEnabled={addonsData?.addons?.includes('follow_up_generator') ?? false}
        reportLink={(customerOrders.find(o => o.delivery_url) || {}).delivery_url || null}
        reportReleased={!!(customerOrders.find(o => o.delivery_url) || {}).delivery_released_at}
        prefill={messagePrefill}
        onPrefillConsumed={() => setMessagePrefill('')}
        onSent={() => qc.invalidateQueries({ queryKey: ['messages', phone] })}
      />
        </div>

        {/* Laptop and up: the lead, its history and the tools stay open beside
            the chat, so logging a call is one click and the history is never
            behind one. */}
        {showRail && (
          <aside className="hidden xl:flex flex-col gap-5 w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4" aria-label="Lead">
            {railHasLead && <LeadBody phone={phone} clientId={clientId} lead={lead} canEdit={canLead} />}
            {toolActions.length > 0 && (
              <section>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Tools</div>
                <div className="flex flex-col gap-1.5">
                  {toolActions.map(([label, fn]) => (
                    <button key={label} onClick={fn}
                      className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 text-left cursor-pointer">{label}</button>
                  ))}
                </div>
              </section>
            )}
          </aside>
        )}
      </div>

      {/* Create Order Drawer */}
      <CreateOrderDrawer
        open={createOrderOpen}
        onClose={() => setCreateOrderOpen(false)}
        customer={{ phone, name }}
        clientId={clientId}
      />

      {/* Follow-up Q&A on an already-delivered report */}
      <HoroscopeQaPanel
        open={horoscopeQaOpen}
        onClose={() => setHoroscopeQaOpen(false)}
        phone={phone}
        clientId={clientId}
        onDraft={(text) => setMessagePrefill(text)}
        orders={customerOrders}
        tarotEnabled={!!addonsData?.addons?.includes('tarot_reading') && perms.can('ai.generate_report')}
        onOrdersChanged={refetchOrders}
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
