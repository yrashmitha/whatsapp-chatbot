import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import Drawer from '../ui/Drawer';
import Spinner from '../ui/Spinner';
import { useToast } from '../ui/Toast';

export default function CreateOrderDrawer({ open, onClose, customer, clientId }) {
  const toast = useToast();
  const qc = useQueryClient();

  const [phone, setPhone] = useState('');
  const [fields, setFields] = useState({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // A catalogue product id, 'custom', or '' for no price yet.
  const [productId, setProductId] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  // Reset form when drawer opens
  const handleOpen = () => {
    setPhone(customer?.phone || '');
    setFields({});
    setNotes('');
    setProductId('');
    setCustomPrice('');
    setAlreadyPaid(false);
  };

  // Fetch client's order field definitions
  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ['settings', clientId],
    queryFn: () => api.get('/settings', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: open && !!clientId,
  });
  const orderFields = settings?.order_fields || [];

  const { data: products = [] } = useQuery({
    queryKey: ['products', clientId],
    queryFn: () => api.get('/products', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: open && !!clientId,
    retry: false,
  });
  // Only what is currently for sale. A retired tier stays in the catalogue so
  // past orders still make sense, but must not be sellable again.
  const productList = (Array.isArray(products) ? products : (products?.products || []))
    .filter(p => p.active !== false);
  const chosen = productList.find(p => String(p.id) === productId);
  const price = productId === 'custom' ? Number(customPrice) || 0 : Number(chosen?.price) || 0;

  const setField = (key, val) => setFields(prev => ({ ...prev, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const phoneVal = (customer?.phone || phone).trim();
    if (!phoneVal) { toast.error('Phone number required'); return; }
    setSaving(true);
    try {
      const custom_fields = {
        customer_name: fields.customer_name ?? (customer?.name || ''),
        ...Object.fromEntries(orderFields.map(f => [f.key, fields[f.key] ?? ''])),
        // Same shape the bot writes, so income and commission read one field.
        ...(price > 0 && {
          items: [{
            product_id: chosen?.id ?? price,
            name: chosen?.name || `Rs ${price}`,
            price,
          }],
        }),
      };
      const res = await api.post('/orders', {
        phone_number: phoneVal,
        custom_fields,
        ...(clientId && { client_id: clientId }),
        ...(notes && { notes }),
      });
      // Fires the Meta Lead event server-side. If the customer already paid,
      // mark it now so the Purchase event fires too.
      if (alreadyPaid) {
        try {
          await api.patch(`/orders/${res.data.order_id}/status`, { status: 'payment_received' },
            { params: clientId ? { client_id: clientId } : {} });
        } catch (e) {
          toast.error(e?.response?.data?.error || 'Order created, but could not mark it paid');
        }
      }
      toast.success(`Order ${res.data.order_id} created`);
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['chat-orders', phoneVal] });
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to create order');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '7px 10px',
    fontSize: '13px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    outline: 'none',
    background: 'var(--bg-base)',
    color: 'var(--text-1)',
  };

  const labelStyle = { fontSize: '11px', fontWeight: 500, color: 'var(--text-2)', marginBottom: 4, display: 'block' };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Create Order"
      width="440px"
    >
      {/* Trigger reset on open via key trick — handled by parent re-mounting isn't needed; use onTransitionEnd instead */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 p-4 overflow-y-auto flex-1"
        style={{ minHeight: 0 }}
      >
        {/* Phone */}
        <div>
          <label style={labelStyle}>Phone Number *</label>
          <input
            style={{ ...inputStyle, ...(customer?.phone ? { opacity: 0.7 } : {}) }}
            value={customer?.phone || phone}
            onChange={e => !customer?.phone && setPhone(e.target.value)}
            readOnly={!!customer?.phone}
            placeholder="e.g. 94771234567"
            required
          />
        </div>

        {/* Customer name */}
        <div>
          <label style={labelStyle}>Customer Name</label>
          <input
            style={inputStyle}
            value={fields.customer_name ?? (customer?.name || '')}
            onChange={e => setField('customer_name', e.target.value)}
            placeholder="Full name (optional)"
          />
        </div>

        {/* Price. Without one the order is worth nothing to the income figure
            and nothing to whoever closed it. */}
        <div>
          <label style={labelStyle}>Service / Price</label>
          <select
            style={inputStyle}
            value={productId}
            onChange={e => setProductId(e.target.value)}
          >
            <option value="">Choose a service…</option>
            {productList.map(p => (
              <option key={p.id} value={String(p.id)}>
                {p.name} — Rs {Number(p.price).toLocaleString()}
              </option>
            ))}
            <option value="custom">Other amount…</option>
          </select>
          {productId === 'custom' && (
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              type="number"
              min="0"
              value={customPrice}
              onChange={e => setCustomPrice(e.target.value)}
              placeholder="Amount in LKR"
            />
          )}
          {price > 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>
              This order will count as Rs {price.toLocaleString()}.
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>
              Without a price this order counts as zero in the income figure, and
              earns no commission for whoever closed it.
            </div>
          )}
        </div>

        {/* Dynamic order fields */}
        {loadingSettings ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : (
          orderFields.map(f => (
            <div key={f.key}>
              <label style={labelStyle}>
                {f.label}
                {f.required && <span style={{ color: '#f87171', marginLeft: 2 }}>*</span>}
              </label>
              <input
                style={inputStyle}
                value={fields[f.key] ?? ''}
                onChange={e => setField(f.key, e.target.value)}
                placeholder={f.description || ''}
                required={f.required}
              />
            </div>
          ))
        )}

        {/* Notes */}
        <div>
          <label style={labelStyle}>Notes (internal)</label>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Delivery date, special instructions..."
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={alreadyPaid}
            onChange={e => setAlreadyPaid(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Customer has already paid (marks it paid + fires the Meta Purchase event)
        </label>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 text-sm font-medium text-white rounded-lg border-0 cursor-pointer disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2, #38bdf8))' }}
        >
          {saving ? 'Creating…' : 'Create Order'}
        </button>
      </form>
    </Drawer>
  );
}
