import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

/**
 * Compact self-service delivery controls, one line above the drawer footer.
 *
 * The customer holds a permanent link (puranajothirwedaya.com/r/<token>) handed
 * to them at order time. The report only becomes downloadable once someone here
 * presses "ready". A per-order last-4-of-phone gate guards a forwarded link.
 * Click the row to expand full URL + stats + gate toggle.
 *
 * @param {object}  props.order    - order row (needs order_id)
 * @param {string}  props.clientId - active tenant
 * @param {boolean} props.open     - parent drawer open state (refetch on open)
 * @param {string}  props.kind     - horoscope | marriage | match | quantum | tarot
 */
export default function DeliveryPanel({ order, clientId, open, kind }) {
  const toast = useToast();
  const [info, setInfo]   = useState(null);
  const [busy, setBusy]   = useState(false);
  const [expanded, setExpanded] = useState(false);

  const qs = clientId ? `?client_id=${clientId}` : '';
  const orderId = order?.order_id;

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await api.get(`/plugins/delivery/${orderId}${qs}`);
      setInfo(res.data);
    } catch {
      setInfo(null);
    }
  }, [orderId, qs]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const call = async (fn, okMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      setInfo(res.data);
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const ensure      = () => call(() => api.post(`/plugins/delivery/${orderId}/ensure${qs}`));
  const releaseKind = (k) => call(() => api.post(`/plugins/delivery/${orderId}/release${qs}`, { kind: k }), 'Added to the customer link');
  const unreleaseKind = (k) => call(() => api.post(`/plugins/delivery/${orderId}/unrelease${qs}`, { kind: k }), 'Removed from the link');

  const copyLink = async (e) => {
    e?.stopPropagation();
    if (!info?.url) return ensure();
    try {
      await navigator.clipboard.writeText(info.url);
      toast.success('Link copied');
    } catch {
      setExpanded(true);
      toast.error('Select the link and copy manually');
    }
  };

  if (!orderId) return null;

  const reports    = Array.isArray(info?.reports) ? info.reports : [];
  const thisReport = reports.find(r => r.kind === kind);
  const hasContent = thisReport ? true : false; // in reports[] means content exists
  const released   = !!thisReport?.released;    // is THIS drawer's report on the link
  const ready      = released;
  const releasedCount = reports.filter(r => r.released).length;

  const pill = !info
    ? { t: '…', bg: '#f1f5f9', fg: '#94a3b8' }
    : ready
    ? { t: 'ON LINK', bg: '#dcfce7', fg: '#166534' }
    : releasedCount > 0
    ? { t: `${releasedCount} ON LINK`, bg: '#fef9c3', fg: '#854d0e' }
    : { t: 'ON HOLD', bg: '#f1f5f9', fg: '#64748b' };

  return (
    <div
      onClick={() => setExpanded(v => !v)}
      style={{
        flexShrink: 0, borderTop: '1px solid #e2e8f0', background: '#fbfaff',
        padding: '7px 16px', fontSize: 12, color: '#475569', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: expanded ? 8 : 0,
      }}
    >
      {/* one-line summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 800, background: pill.bg, color: pill.fg }}>
          {pill.t}
        </span>
        <span style={{ color: '#6d28d9', fontWeight: 600 }}>Customer link</span>

        {info && (
          <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>
            …/r/{info.token ? String(info.token).slice(-6) : '——'}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={copyLink} disabled={busy} style={mini('#ffffff', '#334155', '#cbd5e1')}>
            {info?.url ? '⧉ Copy' : 'Generate link'}
          </button>

          {info && (released ? (
            <button onClick={(e) => { e.stopPropagation(); unreleaseKind(kind); }} disabled={busy} style={mini('#ffffff', '#b91c1c', '#fecaca')}>
              Remove {kind}
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); releaseKind(kind); }}
              disabled={busy || !hasContent}
              title={hasContent ? '' : `No generated ${kind} report yet`}
              style={mini(hasContent ? '#16a34a' : '#e2e8f0', hasContent ? '#fff' : '#94a3b8', 'transparent')}
            >
              📤 Add {kind} to link
            </button>
          ))}

          <span style={{ color: '#cbd5e1', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>

      {/* expanded detail */}
      {expanded && info && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onClick={(e) => e.stopPropagation()}>
          {info.url && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                readOnly
                value={info.url}
                onFocus={(e) => e.target.select()}
                style={{ flex: 1, minWidth: 0, padding: '4px 8px', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', color: '#334155' }}
              />
            </div>
          )}

          {/* One link, every generated report. Toggle each on/off. */}
          {reports.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700, letterSpacing: 0.4 }}>REPORTS ON THIS LINK</span>
              {reports.map(r => (
                <div key={r.kind} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: r.released ? '#16a34a' : '#cbd5e1', flexShrink: 0 }} />
                  <span style={{ flex: 1, color: r.released ? '#166534' : '#64748b' }}>
                    {r.label} <span style={{ color: '#cbd5e1' }}>({r.kind})</span>
                  </span>
                  <button
                    onClick={() => (r.released ? unreleaseKind(r.kind) : releaseKind(r.kind))}
                    disabled={busy}
                    style={mini('#ffffff', r.released ? '#b91c1c' : '#16a34a', r.released ? '#fecaca' : '#bbf7d0')}
                  >
                    {r.released ? 'Remove' : 'Add'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {released && info.released_at && (
              <span style={{ color: '#94a3b8' }}>released {new Date(info.released_at).toLocaleDateString()}</span>
            )}
            {(info.opened_at || info.downloads > 0) && (
              <span style={{ color: '#94a3b8' }}>
                {info.opened_at && `opened ${new Date(info.opened_at).toLocaleDateString()}`}
                {info.downloads > 0 && ` · ${info.downloads} download${info.downloads === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function mini(bg, fg, border) {
  return {
    padding: '4px 9px', fontSize: 11, fontWeight: 700,
    background: bg, color: fg, border: `1px solid ${border}`,
    borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
  };
}
