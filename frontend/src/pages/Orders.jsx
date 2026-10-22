import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import { usePermissions } from '../lib/permissions';
import IncomeBadges from '../components/orders/IncomeBadges';

/** Statuses that mean the money arrived. Mirrors the server's list. */
const PAID_STATUSES = ['payment_received', 'paid', 'delivered', 'done', 'complete'];
import Layout from '../components/Layout';
import { useFeatureGate, LockBadge } from '../components/FeatureLock';
import Pagination from '../components/ui/Pagination';
import Spinner from '../components/ui/Spinner';
import Drawer from '../components/ui/Drawer';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';
import { formatDateTime, STATUS_COLORS, STATUS_OPTIONS, STATUS_FILTER_OPTIONS } from '../lib/utils';
import ChatThread from '../components/chat/ChatThread';
import CreateOrderDrawer from '../components/chat/CreateOrderDrawer';
import HoroscopeModal from '../components/orders/HoroscopeModal';
import HoroscopeEditorDrawer from '../components/orders/HoroscopeEditorDrawer';
import OrderRemarks from '../components/orders/OrderRemarks';
import OrderDetailDrawer from '../components/orders/OrderDetailDrawer';
import { orderFacts, statusLabel } from '../components/orders/orderView';
import MetaRowMarker from '../components/orders/MetaRowMarker';
import SendTemplateModal from '../components/orders/SendTemplateModal';
import WaMessageModal from '../components/orders/WaMessageModal';
import TarotGenerateModal from '../components/orders/TarotGenerateModal';
import TarotEditorDrawer from '../components/orders/TarotEditorDrawer';
import MarriageEditorDrawer from '../components/orders/MarriageEditorDrawer';
import MatchEditorDrawer from '../components/orders/MatchEditorDrawer';

/** Queues worth one tap. Legacy statuses stay reachable through the chip the filter adds. */
const STATUS_CHIPS = ['pending', 'started', 'payment_identified', 'payment_received', 'delivered', 'done', 'cancelled'];

function parseCustomFields(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Hover text for the per-order generation-cost badge: one line per run. */
function genCostTooltip(runs) {
  let list = runs;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  if (!Array.isArray(list) || !list.length) return 'AI report generation cost (accumulates over regenerations)';
  const total = list.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const lines = list.map(r => {
    const when = r.at ? new Date(r.at).toLocaleString() : '?';
    return `${when}  ${r.kind || 'run'}  $${(Number(r.cost_usd) || 0).toFixed(6)}  (${r.in_tokens || 0}→${r.out_tokens || 0} tok)`;
  });
  return `${list.length} generation run(s) — total $${total.toFixed(6)}\n\n${lines.join('\n')}`;
}

export default function Orders() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const { can, isOwner } = usePermissions();
  // Report generation (horoscope/match/tarot) is owner-only: an operator's
  // login never sees these buttons at all, regardless of what permissions
  // they hold, so there is nothing to click that only 403s on the server.
  const showHoroscope = isOwner;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dir, setDir] = useState('desc'); // order date sort direction
  // '' every sale, 'bot' the ones nobody claimed, or a crm_users id.
  const [operator, setOperator] = useState('');
  const [openOrderId, setOpenOrderId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Ticked orders, for sending a template to several people at once.
  const [selected, setSelected] = useState([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null); // { id, orderId, fields }
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [productPopup, setProductPopup] = useState(null); // product object or 'loading'
  const [drawerCustomer, setDrawerCustomer] = useState(null); // { phone, name }
  const [showCreate, setShowCreate] = useState(false);
  const [horoscopeOrder, setHoroscopeOrder]   = useState(null);  // horoscope generate modal
  const [editorOrder, setEditorOrder]         = useState(null);  // horoscope editor drawer
  const [waMessageOrder, setWaMessageOrder]   = useState(null);  // WA message popup
  const [tarotOrder, setTarotOrder]           = useState(null);  // tarot generate modal
  const [tarotEditorOrder, setTarotEditorOrder] = useState(null); // tarot editor drawer
  const [marriageOrder, setMarriageOrder]       = useState(null); // marriage editor drawer
  const [matchOrder, setMatchOrder]             = useState(null); // match making editor drawer
  const [matchModalOrder, setMatchModalOrder]   = useState(null); // order modal opened on the match tab
  const toast = useToast();
  const qc = useQueryClient();

  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  // Everything in the catalogue is shown to everyone. `isEnabled` controls what
  // happens on click, not whether the control exists — a feature nobody can see
  // is a feature nobody asks for. The backend still enforces entitlement.
  const { isEnabled, guard, showLocked, lockModal } = useFeatureGate(clientId, superAdmin);
  const showTarot = isOwner;

  // Only the owner picks whose sales to look at. An operator has one
  // answer available to them and the server enforces it either way.
  const canPickOperator = isOwner && can('finance.income');
  const canMarkPaid = can('orders.mark_paid');
  const showIncome = true;
  const showMatch  = showHoroscope;
  const { data: operators = [] } = useQuery({
    queryKey: ['crm-users', clientId],
    queryFn: () => api.get('/crm-users', { params: { client_id: clientId } }).then(r => r.data),
    enabled: canPickOperator,
    // A missing list is not worth a red toast on a page that works without it.
    retry: false,
  });

  const { data: incomeData } = useQuery({
    queryKey: ['orders-income-summary', clientId, operator],
    queryFn: () => api.get('/orders/income-summary', {
      params: { ...(clientId && { client_id: clientId }), ...(operator && { operator }) },
    }).then(r => r.data),
    enabled: isEnabled('income_summary'),
  });

  const params = {
    page, limit: 20, dir,
    ...(search && { search }),
    ...(statusFilter && { status: statusFilter }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
    ...(operator && { operator }),
    ...(clientId && { client_id: clientId }),
  };

  const [hasGenerating, setHasGenerating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['orders', params],
    queryFn: () => api.get('/orders', { params }).then(r => r.data),
    keepPreviousData: true,
    refetchInterval: hasGenerating ? 8000 : false,
  });

  const orders = data?.orders || [];

  // Update hasGenerating whenever orders data changes (includes both horoscope and tarot)
  React.useEffect(() => {
    const anyGenerating = orders.some(o => {
      const hd = o.horoscope_data && typeof o.horoscope_data === 'string'
        ? (() => { try { return JSON.parse(o.horoscope_data); } catch { return {}; } })()
        : (o.horoscope_data || {});
      if (hd.generating === true || hd.quantum_generating === true || hd.marriage_generating === true || hd.match_generating === true) return true;
      const td = o.tarot_data && typeof o.tarot_data === 'string'
        ? (() => { try { return JSON.parse(o.tarot_data); } catch { return {}; } })()
        : (o.tarot_data || {});
      return td.generating === true;
    });
    setHasGenerating(anyGenerating);
  }, [orders]);

  const updateStatus = useMutation({
    mutationFn: ({ orderId, status }) => api.patch(`/orders/${orderId}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); toast.success('Status updated'); },
    onError: () => toast.error('Failed to update status'),
  });

  const updateFields = useMutation({
    mutationFn: ({ orderId, custom_fields }) => api.patch(`/orders/${orderId}/fields`, { custom_fields }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); setEditingOrder(null); toast.success('Order updated'); },
    onError: () => toast.error('Failed to update order'),
  });

  const deleteOrder = useMutation({
    mutationFn: (orderId) => api.delete(`/orders/${orderId}`, { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); toast.success('Order deleted'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to delete order'),
  });

  const confirmDelete = (o) => {
    const who = o.customer_name || o.phone || o.phone_number || '';
    if (window.confirm(`Delete order ${o.order_id}${who ? ` for ${who}` : ''}?\n\nThis cannot be undone. The conversation is kept.`)) {
      deleteOrder.mutate(o.order_id);
    }
  };

  const updateNotes = useMutation({
    mutationFn: ({ orderId, notes }) => api.patch(`/orders/${orderId}/notes`, { notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); setEditingNoteId(null); toast.success('Note saved'); },
    onError: () => toast.error('Failed to save note'),
  });

  const handleProductClick = async (cf, orderClientId) => {
    setProductPopup('loading');
    try {
      if (cf.product_id) {
        const ids = String(cf.product_id).split(',').map(s => s.trim()).filter(Boolean);
        const results = await Promise.all(ids.map(id => api.get(`/products/${id}`).then(r => r.data.product).catch(() => null)));
        const products = results.filter(Boolean);
        setProductPopup(products.length ? products : 'notfound');
      } else if (cf.product) {
        const searchClientId = orderClientId || clientId;
        const names = String(cf.product).split(',').map(s => s.split(/\s*[—–-]\s*Rs/i)[0].trim()).filter(Boolean);
        const results = await Promise.all(names.map(name =>
          api.get('/products', { params: { search: name, limit: 1, ...(searchClientId && { client_id: searchClientId }) } })
            .then(r => r.data.products?.[0]).catch(() => null)
        ));
        const products = results.filter(Boolean);
        setProductPopup(products.length ? products : 'notfound');
      } else {
        setProductPopup('notfound');
      }
    } catch { setProductPopup('notfound'); }
  };

  const handleExport = async () => {
    const exportParams = new URLSearchParams({ ...(clientId && { client_id: clientId }), ...(statusFilter && { status: statusFilter }), ...(search && { search }), ...(dateFrom && { date_from: dateFrom }), ...(dateTo && { date_to: dateTo }), ...(operator && { operator }) });
    const token = localStorage.getItem('crm_token');
    const res = await fetch(`/api/orders/export?${exportParams}`, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'orders.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Column count for colSpan
  const colCount = superAdmin ? 7 : 6;

  // One request for the page rather than one per row. The ids come from the
  // orders already loaded, so this follows whatever filter and page is showing.
  const visibleOrderIds = (data?.orders || []).map(o => o.order_id).filter(Boolean);
  const { data: metaStatusData } = useQuery({
    queryKey: ['meta-statuses', clientId, visibleOrderIds.join(',')],
    queryFn: () => api.get('/plugins/meta/statuses', {
      params: { order_ids: visibleOrderIds.join(','), ...(clientId && { client_id: clientId }) },
    }).then(r => r.data.statuses),
    enabled: visibleOrderIds.length > 0,
    staleTime: 30_000,
    retry: false,
  });
  const metaStatuses = metaStatusData || {};

  // Who has already had a marketing template. The send skips repeats on its
  // own, but only once it is running - by then you have already decided how
  // many people to message. This is what makes the count right beforehand.
  const { data: templateSendData } = useQuery({
    queryKey: ['template-sends', clientId, visibleOrderIds.join(',')],
    queryFn: () => api.get('/plugins/whatsapp/template-sends', {
      params: { order_ids: visibleOrderIds.join(','), ...(clientId && { client_id: clientId }) },
    }).then(r => r.data.sends),
    enabled: visibleOrderIds.length > 0,
    staleTime: 30_000,
    retry: false,
  });
  const templateSends = templateSendData || {};


  const openOrder = orders.find(x => x.id === openOrderId) || null;
  const filtersActive = !!(operator || dateFrom || dateTo);
  const chip = (active) => ({
    background: active ? 'var(--accent)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-2)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  });
  const fieldCls = 'text-sm rounded-lg px-3 py-2 outline-none';
  const fieldStyle = { background: 'var(--bg-card)', color: 'var(--text-1)', border: '1px solid var(--border)' };

  const pill = (bg, color) => ({ background: bg, color });

  return (
    <Layout>
      {lockModal}
      <div className="flex flex-col h-full">
        {/* Header: what matters this month, find an order, make an order. */}
        <div className="px-4 sm:px-6 pt-4 pb-3 shrink-0" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg font-semibold mr-1 m-0" style={{ color: 'var(--text-1)' }}>Orders</h1>
            {isEnabled('income_summary') ? (
              <IncomeBadges income={incomeData} operator={operator} onPick={(v) => { setOperator(v); setPage(1); }} />
            ) : (
              <button
                onClick={() => showLocked('income_summary')}
                title="Income Summary: see what this does"
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-50 text-slate-400 border border-slate-200 border-dashed cursor-pointer hover:bg-slate-100"
              >
                This month: LKR ••••• <LockBadge />
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button onClick={handleExport} className={`${fieldCls} cursor-pointer`} style={fieldStyle}>Export</button>
              <button onClick={() => setShowCreate(true)}
                className="text-sm font-medium text-white rounded-lg px-4 py-2 cursor-pointer border-0"
                style={{ background: 'var(--accent)' }}>
                + New order
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, phone or order number"
              aria-label="Search orders"
              className={`${fieldCls} flex-1 min-w-[200px] max-w-md`} style={fieldStyle} />
            <button type="button" onClick={() => setFiltersOpen(v => !v)}
              className={`${fieldCls} cursor-pointer`}
              style={filtersActive ? { ...fieldStyle, borderColor: 'var(--accent)', color: 'var(--accent)' } : fieldStyle}>
              Filters{filtersActive ? ' (on)' : ''}
            </button>
            <button type="button"
              onClick={() => { setDir(d => (d === 'desc' ? 'asc' : 'desc')); setPage(1); }}
              className={`${fieldCls} cursor-pointer`} style={fieldStyle}
              title="Sort by date and time">
              {dir === 'desc' ? 'Newest first' : 'Oldest first'}
            </button>
          </div>

          {filtersOpen && (
            <div className="flex items-end gap-3 mt-3 flex-wrap">
              {canPickOperator && (
                <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
                  Whose sales
                  <select value={operator} onChange={e => { setOperator(e.target.value); setPage(1); }}
                    className={fieldCls} style={fieldStyle}>
                    <option value="">Everyone</option>
                    <option value="bot">Bot only</option>
                    {operators.map(o => (
                      <option key={o.id} value={String(o.id)}>
                        {o.display_name || o.username}{o.active ? '' : ' (disabled)'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
                From
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                  className={fieldCls} style={fieldStyle} />
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
                To
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
                  className={fieldCls} style={fieldStyle} />
              </label>
              {filtersActive && (
                <button type="button" className="text-sm cursor-pointer bg-transparent border-0 pb-2"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => { setOperator(''); setDateFrom(''); setDateTo(''); setPage(1); }}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* One tap to a queue. Wraps rather than scrolls sideways. */}
          <div className="flex gap-1.5 mt-3 flex-wrap" role="group" aria-label="Filter by status">
            {[['', 'All'], ...STATUS_CHIPS.map(s => [s, statusLabel(s)])].map(([val, label]) => (
              <button key={val || 'all'} type="button" aria-pressed={statusFilter === val}
                onClick={() => { setStatusFilter(val); setPage(1); }}
                className="text-xs font-medium rounded-full px-3 py-1.5 cursor-pointer"
                style={chip(statusFilter === val)}>
                {label}
              </button>
            ))}
            {statusFilter && !STATUS_CHIPS.includes(statusFilter) && (
              <button type="button" aria-pressed className="text-xs font-medium rounded-full px-3 py-1.5 cursor-pointer"
                style={chip(true)} onClick={() => setStatusFilter('')}>{statusLabel(statusFilter)} ✕</button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
          {selected.length > 0 && (
            <div className="flex items-center gap-3 mb-3 px-3 py-2 rounded-xl sticky top-0 z-10"
                 style={{ background: 'var(--bg-card)', border: '1px solid var(--accent)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{selected.length} selected</span>
              <button onClick={() => setTemplateOpen(true)}
                className="px-3 py-1.5 text-sm font-medium text-white rounded-lg border-0 cursor-pointer"
                style={{ background: 'var(--accent)' }}>
                Send WhatsApp template
              </button>
              <button onClick={() => setSelected([])}
                className="text-sm bg-transparent border-0 cursor-pointer ml-auto" style={{ color: 'var(--text-3)' }}>Clear</button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : orders.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-base font-medium" style={{ color: 'var(--text-1)' }}>No orders match</div>
              <div className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                {(search || statusFilter || filtersActive) ? 'Try clearing the search or filters.' : 'New orders from chats appear here.'}
              </div>
              {(search || statusFilter || filtersActive) && (
                <button type="button" className="mt-3 text-sm cursor-pointer bg-transparent border-0" style={{ color: 'var(--accent)' }}
                  onClick={() => { setSearch(''); setStatusFilter(''); setOperator(''); setDateFrom(''); setDateTo(''); setPage(1); }}>
                  Clear everything
                </button>
              )}
            </div>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-2">
              <li className="hidden md:flex items-center gap-3 px-3 pb-1 text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                <input type="checkbox" aria-label="Select all on this page"
                  checked={orders.length > 0 && selected.length === orders.length}
                  onChange={e => setSelected(e.target.checked ? orders.map(x => x.order_id).filter(Boolean) : [])}
                  className="cursor-pointer" />
                <span className="w-[26%]">Customer</span>
                <span className="flex-1">Order</span>
                <span className="w-40">Status</span>
                <span className="w-32 text-right">Placed</span>
                {superAdmin && <span className="w-16">Client</span>}
                <span className="w-20" />
              </li>
              {orders.map(o => {
                const f = orderFacts(o);
                const needsPayment = !!f.paymentIdentified && o.status !== 'payment_received';
                const isOpen = openOrderId === o.id;
                const paidLocked = (s) => !canMarkPaid && PAID_STATUSES.includes(s) && !o.credited_at;
                return (
                  <li key={o.id}>
                    <div
                      role="button" tabIndex={0}
                      onClick={() => setOpenOrderId(o.id)}
                      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpenOrderId(o.id); }}
                      className="flex items-start md:items-center gap-3 rounded-xl px-3 py-3 cursor-pointer flex-wrap md:flex-nowrap"
                      style={{
                        background: isOpen ? 'rgba(99,102,241,0.08)' : 'var(--bg-card)',
                        border: `1px solid ${needsPayment ? '#f59e0b' : 'var(--border)'}`,
                      }}
                    >
                      <input type="checkbox" aria-label={`Select order ${o.order_id}`}
                        checked={selected.includes(o.order_id)}
                        onChange={e => setSelected(prev => e.target.checked
                          ? [...prev, o.order_id]
                          : prev.filter(x => x !== o.order_id))}
                        onClick={e => e.stopPropagation()}
                        className="cursor-pointer mt-1 md:mt-0" />

                      <div className="md:w-[26%] min-w-0 flex-1 md:flex-none">
                        <div className="font-medium truncate" style={{ color: 'var(--text-1)' }}>{f.name}</div>
                        <div className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                          {f.phone} · #{o.order_id || o.id}
                          <span className="md:hidden"> · {formatDateTime(o.created_at)}</span>
                        </div>
                      </div>

                      <div className="w-full md:w-auto md:flex-1 min-w-0 order-last md:order-none pl-7 md:pl-0">
                        <div className="text-sm truncate" style={{ color: f.summaryLine ? 'var(--text-2)' : 'var(--text-3)' }}>
                          {f.summaryLine || 'No product yet'}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1 empty:hidden">
                          {needsPayment && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={pill('#fef3c7', '#92400e')}
                              title={`Amount ${f.paymentIdentified.amount || '?'} | ${f.paymentIdentified.bank || '?'} | Ref ${f.paymentIdentified.ref || '?'}`}>
                              Slip received, confirm payment
                            </span>
                          )}
                          {f.generating && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1" style={pill('rgba(99,102,241,0.12)', 'var(--accent)')}>
                              <span className="w-2.5 h-2.5 border-2 rounded-full animate-spin inline-block"
                                style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
                              Report generating
                            </span>
                          )}
                          {f.failed && !f.generating && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={pill('#fee2e2', '#b91c1c')}>Report failed</span>
                          )}
                          {(f.horoscopeDone || f.tarotDone || f.marriageDone || f.matchDone) && !f.generating && !f.failed && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={pill('rgba(16,185,129,0.12)', '#047857')}>Report ready</span>
                          )}
                          {o.notes && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md" style={pill('var(--bg-surface)', 'var(--text-3)')}>Has notes</span>
                          )}
                          {templateSends[o.order_id] && (
                            <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={pill('rgba(217,119,6,0.12)', '#b45309')}
                              title={`Already sent "${templateSends[o.order_id].template}" on ${new Date(templateSends[o.order_id].at).toLocaleString()}. Sending again is refused.`}>
                              Template sent
                            </span>
                          )}
                          <span onClick={e => e.stopPropagation()}>
                            <MetaRowMarker orderId={o.order_id} clientId={clientId} state={metaStatuses[o.order_id]} />
                          </span>
                        </div>
                      </div>

                      <div className="md:w-40 shrink-0" onClick={e => e.stopPropagation()}>
                        <select
                          aria-label={`Status of order ${o.order_id}`}
                          value={o.status}
                          onChange={e => updateStatus.mutate({ orderId: o.order_id, status: e.target.value })}
                          className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border cursor-pointer outline-none w-full ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
                        >
                          {!STATUS_OPTIONS.includes(o.status) && <option value={o.status}>{statusLabel(o.status)}</option>}
                          {STATUS_OPTIONS.map(s => (
                            <option key={s} value={s} disabled={paidLocked(s)}>
                              {statusLabel(s)}{paidLocked(s) ? ' (owner only)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="md:w-32 md:text-right text-xs shrink-0 hidden md:block" style={{ color: 'var(--text-3)' }}>
                        {formatDateTime(o.created_at)}
                      </div>
                      {superAdmin && <div className="w-16 text-xs hidden md:block" style={{ color: 'var(--accent)' }}>{o.client_id}</div>}

                      <div className="md:w-20 shrink-0 flex justify-end" onClick={e => e.stopPropagation()}>
                        <button type="button"
                          onClick={() => setDrawerCustomer({ phone: f.phone, name: f.name })}
                          className="text-xs font-medium rounded-lg px-3 py-1.5 cursor-pointer"
                          style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border)' }}>
                          Chat
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {data && (
          <div className="px-4 sm:px-6 py-3 flex items-center justify-between shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
            <span className="text-sm" style={{ color: 'var(--text-3)' }}>{data.total} total</span>
            {data.total > 20 && <Pagination page={page} total={data.total} limit={20} onChange={setPage} />}
          </div>
        )}
      </div>

      <OrderDetailDrawer
        order={openOrder}
        clientId={clientId}
        canMarkPaid={canMarkPaid}
        showHoroscope={showHoroscope}
        showMatch={showMatch}
        showTarot={showTarot}
        isEnabled={isEnabled}
        guard={guard}
        open={{
          horoscope:     () => setHoroscopeOrder(openOrder),
          horoscopeEdit: () => setEditorOrder(openOrder),
          wa:            () => setWaMessageOrder(openOrder),
          marriage:      () => setMarriageOrder(openOrder),
          match:         () => setMatchOrder(openOrder),
          matchNew:      () => setMatchModalOrder(openOrder),
          tarot:         () => setTarotOrder(openOrder),
          tarotEdit:     () => setTarotEditorOrder(openOrder),
        }}
        onChat={() => {
          const f = orderFacts(openOrder);
          setDrawerCustomer({ phone: f.phone, name: f.name });
        }}
        onProduct={() => handleProductClick(orderFacts(openOrder).cf || {}, openOrder.client_id)}
        onDelete={() => { confirmDelete(openOrder); setOpenOrderId(null); }}
        onClose={() => setOpenOrderId(null)}
      />
      {/* Product detail popup */}
      {productPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setProductPopup(null)}>
          <div className="rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            {productPopup === 'loading' ? (
              <div className="flex justify-center items-center py-16"><Spinner /></div>
            ) : productPopup === 'notfound' ? (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>Product not found</div>
            ) : (
              <div className="max-h-[80vh] overflow-y-auto">
                {productPopup.map((p, i) => (
                  <div key={p.id} style={i > 0 ? { borderTop: '1px solid var(--border)' } : {}}>
                    {p.image_url && (
                      <img src={p.image_url} alt={p.name} className="w-full h-48 object-cover" />
                    )}
                    <div className="p-5">
                      <div className="font-semibold text-base mb-0.5" style={{ color: 'var(--text-1)' }}>{p.name}</div>
                      {p.category && <div className="text-xs mb-2" style={{ color: 'var(--accent)' }}>{p.category}{p.subcategory ? ` · ${p.subcategory}` : ''}</div>}
                      {p.description && <div className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>{p.description}</div>}
                      <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>
                        {p.currency || 'Rs'} {p.price_max ? `${p.price} – ${p.price_max}` : p.price}
                      </div>
                      {p.attributes && Object.keys(p.attributes).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(p.attributes).map(([k, v]) => (
                            <span key={k} className="text-xs rounded-full px-2 py-0.5" style={{ background: 'var(--bg-surface)', color: 'var(--text-2)' }}>{k}: {v}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="px-5 py-3 flex justify-end" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setProductPopup(null)} className="text-sm cursor-pointer bg-transparent border-0" style={{ color: 'var(--text-3)' }}>Close</button>
            </div>
          </div>
        </div>
      )}
      {templateOpen && (
        <SendTemplateModal
          orderIds={selected}
          alreadySent={selected.filter(id => templateSends[id])}
          clientId={clientId}
          onClose={() => setTemplateOpen(false)}
          onSent={() => setSelected([])}
        />
      )}

      <CreateOrderDrawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        clientId={clientId}
      />
      {horoscopeOrder && (
        <HoroscopeModal
          order={horoscopeOrder}
          clientId={clientId}
          showMatch={showMatch}
          showMarriage={showHoroscope}
          onClose={() => setHoroscopeOrder(null)}
          onGenerated={() => qc.invalidateQueries({ queryKey: ['orders'] })}
        />
      )}
      {matchModalOrder && (
        <HoroscopeModal
          order={matchModalOrder}
          clientId={clientId}
          showMatch
          initialTab="match"
          onClose={() => setMatchModalOrder(null)}
          onGenerated={() => qc.invalidateQueries({ queryKey: ['orders'] })}
        />
      )}
      {tarotOrder && (
        <TarotGenerateModal
          order={tarotOrder}
          clientId={clientId}
          onClose={() => setTarotOrder(null)}
          onGenerated={() => {
            qc.invalidateQueries({ queryKey: ['orders'] });
            setTarotOrder(null);
          }}
        />
      )}
      <TarotEditorDrawer
        order={tarotEditorOrder}
        clientId={clientId}
        open={!!tarotEditorOrder}
        onClose={() => setTarotEditorOrder(null)}
      />
      <HoroscopeEditorDrawer
        order={editorOrder}
        clientId={clientId}
        open={!!editorOrder}
        onClose={() => setEditorOrder(null)}
      />
      <MarriageEditorDrawer
        order={orders.find(o => o.order_id === marriageOrder?.order_id) || marriageOrder}
        clientId={clientId}
        open={!!marriageOrder}
        onClose={() => setMarriageOrder(null)}
      />
      <MatchEditorDrawer
        order={orders.find(o => o.order_id === matchOrder?.order_id) || matchOrder}
        clientId={clientId}
        open={!!matchOrder}
        onClose={() => setMatchOrder(null)}
      />
      {waMessageOrder && (
        <WaMessageModal
          order={waMessageOrder}
          clientId={clientId}
          onClose={() => setWaMessageOrder(null)}
        />
      )}
      <Drawer
        open={!!drawerCustomer}
        onClose={() => setDrawerCustomer(null)}
        title={drawerCustomer?.name || drawerCustomer?.phone || 'Chat'}
      >
        {drawerCustomer && (
          <ChatThread customer={drawerCustomer} clientId={clientId} />
        )}
      </Drawer>
    </Layout>
  );
}
