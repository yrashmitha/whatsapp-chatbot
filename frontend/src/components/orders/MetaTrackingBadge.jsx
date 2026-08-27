import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

/**
 * One mark for a whole customer, on the collapsed orders header.
 *
 * A warning that has to be looked for is not a warning. The per-order detail
 * belongs inside the list, but "is there a sale here Meta was never told
 * about?" has to be answerable without opening anything.
 *
 * Silent when nothing has been reported for this customer at all - an order
 * that predates the tracking, or a client without the addon, is not a failure
 * and should not wear a mark.
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

  const failed = data.failed > 0;

  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded-md font-medium"
      style={failed
        ? { background: 'rgba(239,68,68,0.12)', color: '#dc2626' }
        : { background: 'rgba(16,185,129,0.12)', color: '#059669' }}
      title={failed
        ? `${data.failed} event(s) did not reach Meta. Open the order to retry.`
        : 'Reported to Meta'}
    >
      {failed ? `⚠ Meta ${data.failed}` : '✓ Meta'}
    </span>
  );
}
