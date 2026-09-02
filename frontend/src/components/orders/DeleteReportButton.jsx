import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

const LABELS = {
  horoscope: 'horoscope', match: 'match-making', marriage: 'marriage',
  quantum: 'Quantum Code', tarot: 'tarot',
};

/**
 * Footer button that wipes one order's *generated* report (of a given kind)
 * while keeping its inputs — chart data, birth details, couple charts, the
 * customer's questions — so it can be regenerated without re-entry.
 *
 * The recorded cost (gen_cost_usd) is kept: that money was really spent.
 *
 * @param {object}  props
 * @param {object}  props.order    - the order row (needs order_id, gen_cost_usd)
 * @param {string}  props.clientId
 * @param {string}  props.kind     - horoscope | match | marriage | quantum | tarot
 * @param {boolean} props.visible  - render only when a report actually exists
 * @param {Function} [props.onDone] - called after a successful delete (e.g. close the drawer)
 */
export default function DeleteReportButton({ order, clientId, kind, visible, onDone }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!visible || !order?.order_id) return null;

  const label = LABELS[kind] || kind;

  const handle = async () => {
    if (!window.confirm(
      `Delete the generated ${label} report for #${order.order_id}?\n\n`
      + 'The generated text is removed. Chart data and birth details are kept, '
      + 'so you can regenerate without re-entering anything.\n\n'
      + `Recorded cost ($${Number(order.gen_cost_usd || 0).toFixed(4)}) is kept.`
    )) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ kind, ...(clientId ? { client_id: clientId } : {}) });
      await api.delete(`/plugins/horoscope/report/${order.order_id}?${qs}`);
      toast.success(`${label[0].toUpperCase()}${label.slice(1)} report deleted`);
      qc.invalidateQueries({ queryKey: ['orders'] });
      onDone?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to delete report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handle}
      disabled={busy}
      style={{ padding: '8px 14px', fontSize: 13, background: '#ffffff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 8, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}
    >
      {busy ? 'Deleting…' : '🗑 Delete Report'}
    </button>
  );
}
