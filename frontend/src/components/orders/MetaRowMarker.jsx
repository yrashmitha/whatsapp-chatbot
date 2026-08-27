import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

/**
 * Whether this order's sale reached Meta, shown on the row itself.
 *
 * Takes its state from a batch the page already fetched rather than asking per
 * row - fifty rows asking individually is fifty requests to draw one page.
 *
 * Renders nothing when the order was never reported. An order placed before the
 * tracking existed, or under a client without the addon, is not a failure and
 * must not wear a warning; marking those is how a warning becomes wallpaper
 * that nobody reads.
 *
 * @param {object} props
 * @param {string} props.orderId
 * @param {string} props.clientId
 * @param {{tracked: boolean, failed: number}} [props.state]
 */
export default function MetaRowMarker({ orderId, clientId, state }) {
  const qc = useQueryClient();
  const toast = useToast();

  const retry = useMutation({
    mutationFn: () => api
      .post(`/plugins/meta/retry/${orderId}`, clientId ? { client_id: clientId } : {})
      .then(r => r.data),
    onSuccess: (r) => {
      if (r.ok) toast.success(`${orderId} reported to Meta`);
      else toast.error(r.note || r.failed?.[0]?.error || 'Meta would not accept it');
      qc.invalidateQueries({ queryKey: ['meta-statuses'] });
      qc.invalidateQueries({ queryKey: ['meta-events', orderId] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not reach the server'),
  });

  if (!state?.tracked) return null;

  if (!state.failed) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded-md font-medium shrink-0"
            style={{ background: 'rgba(16,185,129,0.12)', color: '#059669' }}
            title="Reported to Meta">✓ Meta</span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#dc2626' }}
            title={`${state.failed} event(s) did not reach Meta`}>⚠ Meta</span>
      <button
        onClick={(e) => { e.stopPropagation(); retry.mutate(); }}
        disabled={retry.isPending}
        className="text-xs px-1.5 py-0.5 rounded-md border-0 cursor-pointer disabled:opacity-60"
        style={{ background: 'rgba(239,68,68,0.12)', color: '#dc2626' }}
        title="Send it again. Every event carries an id, so Meta counts one sale once."
      >{retry.isPending ? '…' : 'Retry'}</button>
    </span>
  );
}
