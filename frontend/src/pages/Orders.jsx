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
import MetaTracking from '../components/orders/MetaTracking';
import MetaRowMarker from '../components/orders/MetaRowMarker';
import SendTemplateModal from '../components/orders/SendTemplateModal';
import WaMessageModal from '../components/orders/WaMessageModal';
import TarotGenerateModal from '../components/orders/TarotGenerateModal';
import TarotEditorDrawer from '../components/orders/TarotEditorDrawer';
import MarriageEditorDrawer from '../components/orders/MarriageEditorDrawer';
import MatchEditorDrawer from '../components/orders/MatchEditorDrawer';

function parseCustomFields(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function Orders() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  // Always rendered so the product's flagship feature is discoverable; the
  // buttons themselves are gated on the horoscope_reading addon below.
  const showHoroscope = true;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // '' every sale, 'bot' the ones nobody claimed, or a crm_users id.
  const [operator, setOperator] = useState('');
  const [expandedOrder, setExpandedOrder] = useState(null);
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
  const showTarot = true;

  const { can, isOwner } = usePermissions();
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
    page, limit: 20,
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

  const startMarriage = useMutation({
    mutationFn: (orderId) => api.post(
      `/plugins/horoscope/generate-marriage/${orderId}`, {},
      { params: clientId ? { client_id: clientId } : {} }
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Marriage reading started — takes ~2 min.');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to start marriage reading'),
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


  return (
    <Layout>
      {lockModal}
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 flex-wrap shrink-0">
          <h1 className="text-lg font-semibold text-slate-800 mr-2">Orders</h1>
          {isEnabled('income_summary') ? (
            <IncomeBadges
              income={incomeData}
              operator={operator}
              onPick={(v) => { setOperator(v); setPage(1); }}
            />
          ) : (
            <button
              onClick={() => showLocked('income_summary')}
              title="Income Summary — see what this does"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-50 text-slate-400 border border-slate-200 border-dashed cursor-pointer hover:bg-slate-100"
            >
              💰 This month: LKR ••••• <LockBadge />
            </button>
          )}
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search…" className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 w-40" />
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400">
            <option value="">All statuses</option>
            {STATUS_FILTER_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {canPickOperator && (
            <select value={operator} onChange={e => { setOperator(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
              title="Whose sales to show">
              <option value="">Everyone</option>
              <option value="bot">🤖 Bot only</option>
              {operators.map(o => (
                <option key={o.id} value={String(o.id)}>
                  👤 {o.display_name || o.username}{o.active ? '' : ' (disabled)'}
                </option>
              ))}
            </select>
          )}
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
            title="From date" />
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
            title="To date" />
          <div className="ml-auto flex gap-2">
            <button onClick={() => setShowCreate(true)}
              className="text-sm text-white rounded-lg px-4 py-1.5 cursor-pointer border-0"
              style={{ background: 'var(--accent)' }}>
              + New Order
            </button>
            <button onClick={handleExport} className="text-sm bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg px-4 py-1.5 cursor-pointer transition-colors">
              Export CSV
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {/* Appears only when something is ticked, so it never competes with
              the table for attention. The count is in the button because the
              number of people about to receive a paid message is the one thing
              worth being sure about. */}
          {selected.length > 0 && (
            <div className="flex items-center gap-3 mb-3 px-3 py-2 rounded-xl"
                 style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <span className="text-sm font-medium text-slate-700">{selected.length} selected</span>
              <button onClick={() => setTemplateOpen(true)}
                className="px-3 py-1 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg border-0 cursor-pointer">
                Send WhatsApp template
              </button>
              <button onClick={() => setSelected([])}
                className="text-xs text-slate-500 bg-transparent border-0 cursor-pointer ml-auto">Clear</button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
                  <th className="py-2 text-left pr-2 w-8">
                    <input type="checkbox"
                      checked={orders.length > 0 && selected.length === orders.length}
                      onChange={e => setSelected(e.target.checked ? orders.map(x => x.order_id).filter(Boolean) : [])}
                      className="cursor-pointer" />
                  </th>
                  <th className="py-2 text-left pr-4">Order ID</th>
                  <th className="py-2 text-left pr-4">Customer</th>
                  <th className="py-2 text-left pr-4">Status</th>
                  <th className="py-2 text-left pr-4">Date</th>
                  <th className="py-2 text-left pr-4">Details</th>
                  {superAdmin && <th className="py-2 text-left pr-4">Client</th>}
                </tr>
              </thead>
              <tbody>
                {orders.map(o => {
                  const cf = parseCustomFields(o.custom_fields);
                  const hasDetails = cf && Object.keys(cf).length > 0;
                  const isExpanded = expandedOrder === o.id;
                  const hasNotes = !!o.notes;
                  const hd = o.horoscope_data && typeof o.horoscope_data === 'string'
                    ? (() => { try { return JSON.parse(o.horoscope_data); } catch { return {}; } })()
                    : (o.horoscope_data || null);
                  const isGenerating = hd?.generating === true;
                  const paymentIdentified = cf?.payment_identified || null;
                  const horoscopeError = hd?.error || null;
                  const horoscopeDone = hd?.sections && Object.keys(hd.sections).length > 0;
                  const hasChart           = !!hd?.chart_data;
                  const marriageGenerating = hd?.marriage_generating === true;
                  const marriageError      = hd?.marriage_error || null;
                  const marriageDone       = Array.isArray(hd?.marriage_sections_data) && hd.marriage_sections_data.length > 0;
                  const matchGenerating    = hd?.match_generating === true;
                  const matchError         = hd?.match_error || null;
                  const matchDone          = Array.isArray(hd?.match_sections_data) && hd.match_sections_data.length > 0;
                  const td = o.tarot_data && typeof o.tarot_data === 'string'
                    ? (() => { try { return JSON.parse(o.tarot_data); } catch { return null; } })()
                    : (o.tarot_data || null);
                  const tarotGenerating = td?.generating === true;
                  const tarotError      = td?.error || null;
                  const tarotDone       = !!(td?.reading && td?.cards);

                  return (
                    <React.Fragment key={o.id}>
                      <tr className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2.5 pr-2">
                          <input type="checkbox"
                            checked={selected.includes(o.order_id)}
                            onChange={e => setSelected(prev => e.target.checked
                              ? [...prev, o.order_id]
                              : prev.filter(x => x !== o.order_id))}
                            onClick={e => e.stopPropagation()}
                            className="cursor-pointer" />
                        </td>
                        <td className="py-2.5 pr-4 text-slate-500 font-mono text-xs">
                          <div className="flex items-center gap-1.5">
                            <span>#{o.order_id || o.id}</span>
                            {/* On the row, not inside the expansion: a sale Meta
                                never heard about has to be visible while
                                scanning the list, not after opening it. Carries
                                its own Retry when the last attempt failed. */}
                            <MetaRowMarker orderId={o.order_id} clientId={clientId} state={metaStatuses[o.order_id]} />
                          </div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <button
                            onClick={() => setDrawerCustomer({ phone: o.phone || o.phone_number, name: o.customer_name || o.phone || o.phone_number })}
                            className="font-medium text-left bg-transparent border-0 cursor-pointer p-0 transition-colors"
                            style={{ color: 'var(--accent)' }}
                          >{o.customer_name || o.phone || o.phone_number}</button>
                          <div className="text-xs text-slate-400">{o.phone || o.phone_number}</div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex flex-col gap-1">
                            <select
                              value={o.status}
                              onChange={e => updateStatus.mutate({ orderId: o.order_id, status: e.target.value })}
                              className={`text-xs font-medium rounded-md px-2 py-1 border cursor-pointer outline-none ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
                            >
                              {!STATUS_OPTIONS.includes(o.status) && <option value={o.status}>{o.status}</option>}
                              {STATUS_OPTIONS.map(s => (
                                <option key={s} value={s}
                                  /* Confirming a payment is the owner's, since they check
                                     the bank. Already-credited orders are exempt, so
                                     marking a paid order delivered still works. */
                                  disabled={!canMarkPaid && PAID_STATUSES.includes(s) && !o.credited_at}>
                                  {s}{!canMarkPaid && PAID_STATUSES.includes(s) && !o.credited_at ? ' (owner only)' : ''}
                                </option>
                              ))}
                            </select>
                            {paymentIdentified && o.status !== 'payment_received' && (
                              <div
                                className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 border border-amber-300 rounded text-amber-700 text-xs font-medium w-fit"
                                title={`Payment detected. Amount: ${paymentIdentified.amount || '?'} | Date: ${paymentIdentified.date || '?'} | Bank: ${paymentIdentified.bank || '?'} | Ref: ${paymentIdentified.ref || '?'}`}
                              >
                                💳 Payment detected
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-slate-500 text-xs">{formatDateTime(o.created_at)}</td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setExpandedOrder(isExpanded ? null : o.id)}
                              className={`text-xs underline cursor-pointer bg-transparent border-0 ${hasDetails || hasNotes ? 'text-violet-600 hover:text-violet-800' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                              {isExpanded ? 'Hide' : (hasDetails || hasNotes ? 'View' : 'Notes')}
                            </button>
                            <button
                              onClick={() => {
                                setExpandedOrder(o.id);
                                setEditingOrder({ id: o.id, orderId: o.order_id, fields: { ...cf } });
                              }}
                              className="text-xs underline cursor-pointer bg-transparent border-0 text-violet-600 hover:text-violet-800"
                            >Edit</button>
                            <button
                              onClick={() => confirmDelete(o)}
                              disabled={deleteOrder.isPending}
                              className="text-xs underline cursor-pointer bg-transparent border-0 text-red-500 hover:text-red-600 disabled:opacity-50"
                            >Delete</button>
                            {showHoroscope && (
                              <>
                                {isGenerating ? (
                                  <span
                                    className="flex items-center gap-1 text-xs text-violet-600 font-medium"
                                    title={hd?.progress?.phase
                                      ? `${hd.progress.done}/${hd.progress.total} — ${hd.progress.phase}`
                                      : 'Starting…'}
                                  >
                                    <span className="w-3 h-3 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin inline-block" />
                                    Generating{hd?.progress?.percent != null ? ` ${hd.progress.percent}%` : '…'}
                                  </span>
                                ) : horoscopeError ? (
                                  <>
                                    <span title={horoscopeError} className="text-xs px-1.5 py-0.5 rounded border-0 bg-red-100 text-red-600 cursor-default">⚠ Error</span>
                                    <button
                                      onClick={guard('horoscope_reading', () => setHoroscopeOrder(o))}
                                      title="Retry generation"
                                      className="text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 bg-violet-100 text-violet-700 hover:bg-violet-200"
                                    >🔮</button>
                                  </>
                                ) : (
                                  <button
                                    onClick={guard('horoscope_reading', () => setHoroscopeOrder(o))}
                                    title={isEnabled('horoscope_reading')
                                      ? 'Generate horoscope reading'
                                      : 'Horoscope Reading — see what this does'}
                                    className={`text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 ${
                                      isEnabled('horoscope_reading')
                                        ? 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                    }`}
                                  >{isEnabled('horoscope_reading') ? '🔮' : '🔮 🔒'}</button>
                                )}
                                {horoscopeDone && (
                                  <button
                                    onClick={() => setEditorOrder(o)}
                                    title="View/edit horoscope"
                                    className="text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                                  >✏</button>
                                )}
                                {horoscopeDone && (
                                  <button
                                    onClick={() => setWaMessageOrder(o)}
                                    title={hd?.wa_message ? 'View/regenerate WhatsApp message' : 'Generate WhatsApp message'}
                                    className="text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 bg-green-100 text-green-700 hover:bg-green-200"
                                  >💬</button>
                                )}
                                {(
                                  marriageGenerating ? (
                                    <span className="flex items-center gap-1 text-xs text-pink-600 font-medium">
                                      <span className="w-3 h-3 border-2 border-pink-300 border-t-pink-600 rounded-full animate-spin inline-block" />
                                      💍 Generating…
                                    </span>
                                  ) : (
                                    <>
                                      {marriageError && !marriageDone && (
                                        <span title={marriageError} className="text-xs px-1.5 py-0.5 rounded border-0 bg-red-100 text-red-600 cursor-default">⚠</span>
                                      )}
                                      <button
                                        onClick={() => {
                                          if (marriageDone) return setMarriageOrder(o);
                                          if (!hasChart) {
                                            return toast.error('No birth chart yet — open 🔮, fill the birth details, and click "Check Lagna" to fetch the chart. Then click 💍. (You do not need to generate the horoscope.)');
                                          }
                                          startMarriage.mutate(o.order_id);
                                        }}
                                        title={
                                          marriageDone ? 'View/edit marriage reading'
                                          : hasChart   ? 'Generate marriage reading'
                                          : 'Needs the birth chart first — open 🔮 and click "Check Lagna"'
                                        }
                                        disabled={startMarriage.isPending}
                                        className={`text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 ${
                                          marriageDone ? 'bg-pink-200 text-pink-800 hover:bg-pink-300'
                                          : hasChart   ? 'bg-pink-100 text-pink-700 hover:bg-pink-200'
                                          : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                        }`}
                                      >{marriageDone ? '💍 ✏' : '💍'}</button>
                                    </>
                                  )
                                )}
                                {showMatch && (
                                  matchGenerating ? (
                                    <span
                                      className="flex items-center gap-1 text-xs text-teal-600 font-medium"
                                      title={hd?.match_progress?.phase
                                        ? `${hd.match_progress.done}/${hd.match_progress.total} — ${hd.match_progress.phase}`
                                        : 'Starting…'}
                                    >
                                      <span className="w-3 h-3 border-2 border-teal-300 border-t-teal-600 rounded-full animate-spin inline-block" />
                                      💑 Generating{hd?.match_progress?.percent != null ? ` ${hd.match_progress.percent}%` : '…'}
                                    </span>
                                  ) : (
                                    <>
                                      {matchError && !matchDone && (
                                        <span title={matchError} className="text-xs px-1.5 py-0.5 rounded border-0 bg-red-100 text-red-600 cursor-default">⚠</span>
                                      )}
                                      <button
                                        onClick={guard('match_making', () => (matchDone ? setMatchOrder(o) : setMatchModalOrder(o)))}
                                        title={!isEnabled('match_making')
                                          ? 'Match Making — see what this does'
                                          : (matchDone ? 'View/edit match making report' : 'Match making — enter both charts')}
                                        className={`text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 ${
                                          !isEnabled('match_making') ? 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                            : matchDone ? 'bg-teal-200 text-teal-800 hover:bg-teal-300'
                                                        : 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                                        }`}
                                      >{!isEnabled('match_making') ? '💑 🔒' : (matchDone ? '💑 ✏' : '💑')}</button>
                                    </>
                                  )
                                )}
                              </>
                            )}
                            {showTarot && (
                              <>
                                {tarotGenerating ? (
                                  <span className="flex items-center gap-1 text-xs text-purple-600 font-medium">
                                    <span className="w-3 h-3 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin inline-block" />
                                    Generating…
                                  </span>
                                ) : tarotError ? (
                                  <>
                                    <span title={tarotError} className="text-xs px-1.5 py-0.5 rounded border-0 bg-red-100 text-red-600 cursor-default">⚠ Error</span>
                                    <button
                                      onClick={guard('tarot_reading', () => setTarotOrder(o))}
                                      title="Retry tarot generation"
                                      className="text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 bg-purple-100 text-purple-700 hover:bg-purple-200"
                                    >🃏</button>
                                  </>
                                ) : (
                                  <button
                                    onClick={guard('tarot_reading', () => setTarotOrder(o))}
                                    title={!isEnabled('tarot_reading')
                                      ? 'Tarot Reading — see what this does'
                                      : (tarotDone ? 'Regenerate tarot reading' : 'Generate tarot reading')}
                                    className={`text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 ${
                                      isEnabled('tarot_reading')
                                        ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                    }`}
                                  >{isEnabled('tarot_reading') ? '🃏' : '🃏 🔒'}</button>
                                )}
                                {tarotDone && (
                                  <button
                                    onClick={() => setTarotEditorOrder(o)}
                                    title="View / edit tarot reading"
                                    className="text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 bg-teal-100 text-teal-700 hover:bg-teal-200"
                                  >✏</button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                        {superAdmin && <td className="py-2.5 pr-4 text-violet-500 text-xs">{o.client_id}</td>}
                      </tr>
                      {isExpanded && (
                        <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                          <td colSpan={colCount} className="px-6 py-3">
                            {/* Conversation summary section */}
                            {o.ai_summary && (
                              <div className="mb-3 p-3 rounded" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--accent)' }}>Conversation Summary</div>
                                <div className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>{o.ai_summary}</div>
                              </div>
                            )}

                            {/* Did Meta hear about this sale? Silent when there is
                                nothing to report. */}
                            <MetaTracking orderId={o.order_id} clientId={clientId} />

                            {/* Remarks — the operator's running log */}
                            <div className="mb-3">
                              <OrderRemarks orderId={o.order_id} remarks={o.remarks} clientId={clientId} />
                            </div>

                            {/* Notes section */}
                            <div className="mb-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Notes</span>
                                {editingNoteId !== o.id && (
                                  <button onClick={() => { setEditingNoteId(o.id); setNoteText(o.notes || `Today is ${formatDateTime(new Date())}.`); }}
                                    className="text-xs cursor-pointer bg-transparent border-0" style={{ color: 'var(--accent)' }}>
                                    {o.notes ? 'Edit' : 'Add'}
                                  </button>
                                )}
                              </div>
                              {editingNoteId === o.id ? (
                                <div>
                                  <textarea
                                    value={noteText}
                                    onChange={e => setNoteText(e.target.value)}
                                    rows={3}
                                    autoFocus
                                    className="w-full text-xs rounded px-2 py-1.5 outline-none resize-none"
                                    style={{ background: 'var(--bg-surface)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
                                    placeholder="Delivery date, special instructions, reminders..."
                                  />
                                  <div className="flex gap-2 mt-1">
                                    <button onClick={() => updateNotes.mutate({ orderId: o.order_id, notes: noteText })}
                                      className="text-xs bg-violet-600 hover:bg-violet-700 text-white rounded px-3 py-1 cursor-pointer border-0">
                                      Save
                                    </button>
                                    <button onClick={() => setEditingNoteId(null)}
                                      className="text-xs cursor-pointer bg-transparent border-0" style={{ color: 'var(--text-3)' }}>
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs whitespace-pre-wrap" style={{ color: o.notes ? 'var(--text-2)' : 'var(--text-3)', fontStyle: o.notes ? 'normal' : 'italic' }}>
                                  {o.notes || 'No notes yet'}
                                </div>
                              )}
                            </div>

                            {/* Custom fields section */}
                            {hasDetails && (
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Order Details</div>
                                  {editingOrder?.id !== o.id && (
                                    <button onClick={() => setEditingOrder({ id: o.id, orderId: o.order_id, fields: { ...cf } })}
                                      className="text-xs cursor-pointer bg-transparent border-0" style={{ color: 'var(--accent)' }}>
                                      Edit Details
                                    </button>
                                  )}
                                </div>
                                {editingOrder?.id === o.id ? (
                                  <div>
                                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 mb-3">
                                      {Object.entries(editingOrder.fields).map(([k, v]) => (
                                        <div key={k} className="flex flex-col gap-0.5">
                                          <label className="text-xs capitalize" style={{ color: 'var(--text-3)' }}>{k.replace(/_/g, ' ')}</label>
                                          <input
                                            value={String(v ?? '')}
                                            onChange={e => setEditingOrder(prev => ({ ...prev, fields: { ...prev.fields, [k]: e.target.value } }))}
                                            className="text-xs rounded px-2 py-1 outline-none"
                                            style={{ background: 'var(--bg-surface)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => updateFields.mutate({ orderId: editingOrder.orderId, custom_fields: editingOrder.fields })}
                                        className="text-xs bg-violet-600 hover:bg-violet-700 text-white rounded px-3 py-1 cursor-pointer border-0">
                                        Save
                                      </button>
                                      <button onClick={() => setEditingOrder(null)}
                                        className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer bg-transparent border-0">
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                                    {Object.entries(cf).filter(([k]) => k !== 'product_id').map(([k, v]) => (
                                      <div key={k} className="flex gap-2 text-xs">
                                        <span className="capitalize shrink-0" style={{ color: 'var(--text-3)' }}>{k.replace(/_/g, ' ')}:</span>
                                        {k === 'product' && v ? (
                                          <button onClick={() => handleProductClick(cf, o.client_id)}
                                            className="underline cursor-pointer bg-transparent border-0 text-xs text-left p-0" style={{ color: 'var(--accent)' }}>
                                            {String(v)}
                                          </button>
                                        ) : (
                                          <span style={{ color: 'var(--text-1)' }}>{String(v ?? '-')}</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {orders.length === 0 && (
                  <tr><td colSpan={colCount} className="py-12 text-center text-slate-400">No orders found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {data && (
          <div className="px-6 py-3 flex items-center justify-between shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
            <span className="text-sm" style={{ color: 'var(--text-3)' }}>{data.total} total</span>
            {data.total > 20 && <Pagination page={page} total={data.total} limit={20} onChange={setPage} />}
          </div>
        )}
      </div>
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
