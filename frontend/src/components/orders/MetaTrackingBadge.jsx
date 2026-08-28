import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { marksFor, styleFor, glyphFor } from './metaMarks';

/**
 * What Meta was told about this customer, on the collapsed orders header.
 *
 * A warning that has to be looked for is not a warning, so this sits where it
 * is seen without opening anything. It shows the same two marks as an order
 * row, in the same colours, because a mark only works if it is recognised
 * rather than read.
 *
 * With one order it reads exactly like that order. With several it summarises:
 * an order awaiting payment has no purchase and that is correct, not a fault,
 * so only a paid order missing its purchase — or an event that actually failed
 * — turns it red.
 */
export default function MetaTrackingBadge({ phone, clientId }) {
  const { data } = useQuery({
    queryKey: ['meta-summary', phone, clientId],
    queryFn: () => api
      .get('/plugins/meta/summary', { params: { phone, ...(clientId && { client_id: clientId }) } })
      .then(r => r.data),
    enabled: !!phone,
    staleTime: 30_000,
    retry: false,
  });

  if (!data?.tracked) return null;

  if (data.failed > 0) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
            style={styleFor('Lead', 'bad')}
            title={`${data.failed} order(s) did not reach Meta: ${(data.failed_orders || []).join(', ')}. Open the order to retry.`}>
        ⚠ Meta {data.failed}
      </span>
    );
  }

  // Nothing has failed, so the two marks are either sent or not yet due.
  const many = (data.orders || 0) > 1 || data.leads > 1;
  const marks = marksFor({
    lead: data.leads > 0 ? 'ok' : null,
    purchase: data.purchases > 0 ? 'ok' : null,
    paid: false,
  });

  const Pill = ({ label, kind, count, title }) => (
    <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
          style={styleFor(label, kind)} title={title}>
      {label} {glyphFor(kind)}{many && count > 0 ? ` ${count}` : ''}
    </span>
  );

  return (
    <span className="inline-flex items-center gap-1">
      <Pill label="Lead" kind={marks.lead} count={data.leads}
            title={`${data.leads} order(s) reported to Meta`} />
      <Pill label="Purchase" kind={marks.purchase} count={data.purchases}
            title={data.purchases > 0
              ? `${data.purchases} payment(s) reported to Meta`
              : 'No payment reported yet — none of these orders has been paid'} />
    </span>
  );
}
