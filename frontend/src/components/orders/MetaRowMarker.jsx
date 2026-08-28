import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

/**
 * Whether the order and the payment each reached Meta, shown on the row itself.
 *
 * Two marks rather than one, because they mean different things: an order was
 * placed, and money arrived. The one that goes quiet is the purchase, and that
 * is the event campaigns optimise on, so collapsing them into a single "Meta"
 * tick hides the failure that matters.
 *
 * A purchase is only missing when the order has actually been paid. Most orders
 * are waiting for payment — twelve of the last fourteen — and marking those red
 * would put a dozen false alarms on one screen and teach everybody to stop
 * reading the badge by tomorrow. Not due is drawn dim, and carries no Retry.
 *
 * Takes its state from a batch the page already fetched; fifty rows asking
 * individually is fifty requests to draw one page.
 *
 * @param {object} props
 * @param {string} props.orderId
 * @param {string} props.clientId
 * @param {{lead: string|null, purchase: string|null, paid: boolean}} [props.state]
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
      qc.invalidateQueries({ queryKey: ['meta-summary'] });
      qc.invalidateQueries({ queryKey: ['meta-events', orderId] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not reach the server'),
  });

  // Nothing was ever reported for this order — it predates the tracking, or the
  // addon is off. Not a failure, so no mark at all.
  if (!state || (!state.lead && !state.purchase)) return null;

  const OK   = { background: 'rgba(16,185,129,0.12)', color: '#059669' };
  const BAD  = { background: 'rgba(239,68,68,0.12)',  color: '#dc2626' };
  const IDLE = { background: 'rgba(100,116,139,0.10)', color: '#94a3b8' };

  const lead = state.lead === 'ok' ? 'ok' : state.lead === 'error' ? 'bad' : 'idle';
  const purchase = state.purchase === 'ok' ? 'ok'
    : state.purchase === 'error' ? 'bad'
      // Paid with no purchase on record is a genuine hole. Unpaid is simply
      // not due yet.
      : state.paid ? 'bad' : 'idle';

  const broken = lead === 'bad' || purchase === 'bad';

  const Pill = ({ label, kind, title }) => (
    <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
          style={kind === 'ok' ? OK : kind === 'bad' ? BAD : IDLE}
          title={title}>
      {label} {kind === 'ok' ? '✓' : kind === 'bad' ? '✗' : '·'}
    </span>
  );

  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <Pill label="Lead" kind={lead}
            title={lead === 'ok' ? 'Order reported to Meta'
              : lead === 'bad' ? 'The order did not reach Meta'
                : 'Not reported'} />
      <Pill label="Purchase" kind={purchase}
            title={purchase === 'ok' ? 'Payment reported to Meta'
              : purchase === 'bad' ? 'This order is paid but the payment did not reach Meta'
                : 'Not due yet — this order has not been paid'} />
      {broken && (
        <button
          onClick={(e) => { e.stopPropagation(); retry.mutate(); }}
          disabled={retry.isPending}
          className="text-xs px-1.5 py-0.5 rounded-md border-0 cursor-pointer disabled:opacity-60"
          style={BAD}
          title="Send it again. Every event carries an id, so Meta counts one sale once."
        >{retry.isPending ? '…' : 'Retry'}</button>
      )}
    </span>
  );
}
