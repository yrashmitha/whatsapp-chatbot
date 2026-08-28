import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

/**
 * What Meta was told about this customer, on the collapsed orders header.
 *
 * A warning that has to be looked for is not a warning, so the counts sit where
 * they are seen without opening anything: how many of this customer's orders
 * were reported, and how many payments.
 *
 * An order awaiting payment has no purchase and that is correct, not a fault.
 * Only a paid order with no purchase, or an event that actually failed, counts
 * as broken — otherwise every customer with an open order would wear a warning
 * and the mark would mean nothing within a day.
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

  const broken = data.failed > 0;

  const pill = (bg, fg) => ({
    background: bg, color: fg,
  });

  if (broken) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
            style={pill('rgba(239,68,68,0.12)', '#dc2626')}
            title={`${data.failed} order(s) did not reach Meta: ${(data.failed_orders || []).join(', ')}. Open the order to retry.`}>
        ⚠ Meta {data.failed}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
            style={pill('rgba(16,185,129,0.12)', '#059669')}
            title={`${data.leads} order(s) reported to Meta`}>
        Lead {data.leads}
      </span>
      {data.purchases > 0 && (
        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
              style={pill('rgba(16,185,129,0.12)', '#059669')}
              title={`${data.purchases} payment(s) reported to Meta`}>
          Purchase {data.purchases}
        </span>
      )}
    </span>
  );
}
