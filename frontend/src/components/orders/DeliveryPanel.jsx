import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

/**
 * Self-service delivery controls for an order's report.
 *
 * The customer holds a permanent link (puranajothirwedaya.com/r/<token>) handed
 * to them at order time. The report only becomes downloadable once someone here
 * presses "Report is ready". A per-order last-4-of-phone gate guards a forwarded
 * link.
 *
 * @param {object}  props.order    - the order row (needs order_id)
 * @param {string}  props.clientId - active tenant
 * @param {boolean} props.open     - parent drawer open state (refetch on open)
 * @param {string}  props.kind     - horoscope | marriage | match | quantum | tarot
 */
export default function DeliveryPanel({ order, clientId, open, kind }) {
  const toast = useToast();
  const [info, setInfo]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(false);

  const qs = clientId ? `?client_id=${clientId}` : '';
  const orderId = order?.order_id;

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const res = await api.get(`/plugins/delivery/${orderId}${qs}`);
      setInfo(res.data);
    } catch (e) {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [orderId, qs]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const call = async (fn) => {
    setBusy(true);
    try {
      const res = await fn();
      setInfo(res.data);
      return res.data;
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const ensure   = () => call(() => api.post(`/plugins/delivery/${orderId}/ensure${qs}`));
  const release  = () => call(() => api.post(`/plugins/delivery/${orderId}/release${qs}`, { kind }))
    .then(d => d && toast.success('Customer can now download the report'));
  const unrelease = () => call(() => api.post(`/plugins/delivery/${orderId}/unrelease${qs}`));
  const setGate  = (on) => call(() => api.patch(`/plugins/delivery/${orderId}${qs}`, { phoneGate: on }));

  const copyLink = async () => {
    if (!info?.url) return;
    try {
      await navigator.clipboard.writeText(info.url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy — select it manually');
    }
  };

  const box = {
    flexShrink: 0, padding: '10px 16px', borderTop: '1px solid #e2e8f0',
    background: '#fbfaff', fontSize: 12, color: '#475569',
    display: 'flex', flexDirection: 'column', gap: 8,
  };

  if (!orderId) return null;

  const released   = !!info?.released;
  const hasContent = !!info?.has_content;

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ color: '#6d28d9' }}>Customer link</strong>
        {loading && <span style={{ color: '#94a3b8' }}>loading…</span>}
        {info && (
          <span
            style={{
              padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              background: released && hasContent ? '#dcfce7' : '#fef9c3',
              color:      released && hasContent ? '#166534' : '#854d0e',
            }}
          >
            {released && hasContent ? 'READY — customer can download' : released ? 'RELEASED — report not generated yet' : 'NOT RELEASED — shows “check back later”'}
          </span>
        )}
      </div>

      {info?.url && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            readOnly
            value={info.url}
            onFocus={e => e.target.select()}
            style={{ flex: 1, minWidth: 220, padding: '5px 8px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', color: '#334155' }}
          />
          <button onClick={copyLink} style={btn('#ffffff', '#334155', '#cbd5e1')}>Copy</button>
        </div>
      )}

      {info && !info.url && (
        <button onClick={ensure} disabled={busy} style={btn('#ffffff', '#6d28d9', '#c4b5fd')}>
          {busy ? '…' : 'Generate link'}
        </button>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!released ? (
          <button
            onClick={release}
            disabled={busy || !hasContent}
            title={hasContent ? '' : `No generated ${kind} report on this order yet`}
            style={btn(hasContent ? '#16a34a' : '#e2e8f0', hasContent ? '#fff' : '#94a3b8', 'transparent')}
          >
            {busy ? '…' : '📤 Report is ready'}
          </button>
        ) : (
          <>
            <span style={{ color: '#166534', fontWeight: 600 }}>
              ✓ Released{info?.released_at ? ` · ${new Date(info.released_at).toLocaleDateString()}` : ''}
            </span>
            <button onClick={unrelease} disabled={busy} style={btn('#ffffff', '#b91c1c', '#fecaca')}>
              {busy ? '…' : 'Undo'}
            </button>
          </>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none', marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={info?.phone_gate !== false}
            disabled={busy || !info}
            onChange={e => setGate(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Ask for last 4 digits{info?.phone_last4 ? ` (${info.phone_last4})` : ''}
        </label>
      </div>

      {info && (info.opened_at || info.downloads > 0) && (
        <div style={{ color: '#94a3b8' }}>
          {info.opened_at && `First opened ${new Date(info.opened_at).toLocaleString()}`}
          {info.downloads > 0 && ` · ${info.downloads} download${info.downloads === 1 ? '' : 's'}`}
        </div>
      )}
    </div>
  );
}

function btn(bg, fg, border) {
  return {
    padding: '5px 12px', fontSize: 12, fontWeight: 600,
    background: bg, color: fg, border: `1px solid ${border}`,
    borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
  };
}
