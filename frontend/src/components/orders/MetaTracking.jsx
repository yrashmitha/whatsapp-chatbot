import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

/**
 * Whether Meta was told about this sale, and what it was told.
 *
 * Until now the only way to answer that was to read the server log. It matters
 * more than it sounds: an order Meta never heard about is a sale the campaign
 * cannot learn from, and the failure is silent - the CRM looks identical either
 * way. So it belongs next to the order.
 *
 * The value shown is what Meta received, not what the order says now. If
 * somebody corrects a price afterwards the two will differ, and that difference
 * is the useful thing to see rather than something to hide.
 */
export default function MetaTracking({ orderId, clientId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['meta-events', orderId, clientId],
    queryFn: () => api
      .get(`/plugins/meta/events/${orderId}`, { params: clientId ? { client_id: clientId } : {} })
      .then(r => r.data.events),
    staleTime: 30_000,
    retry: false,
  });

  if (isLoading) return null;

  // Not configured, or nothing sent. Either way there is nothing to report and
  // a permanent empty box is worse than no box.
  if (!data?.length) return null;

  // One row per event name. Two things make the grouping fiddly.
  //
  // Each sale is reported to two datasets, so every event appears twice at the
  // same instant. That is one send, not two - and only the copy that went as a
  // WhatsApp conversion carries the ad click, so a naive "first row wins" says
  // "no ad click" about a sale whose click was matched perfectly.
  //
  // A genuine resend is a different instant, and Meta counts it once anyway
  // because of event_id, so it is worth showing but not worth alarming about.
  const byEvent = new Map();
  for (const e of data) {
    const cur = byEvent.get(e.event_name);
    if (!cur) {
      byEvent.set(e.event_name, { ...e, times: new Set([e.created_at]) });
      continue;
    }
    cur.times.add(e.created_at);
    // Prefer the copy Meta can attribute, and the latest attempt of it.
    const better = (e.messaging && !cur.messaging)
      || (e.messaging === cur.messaging && new Date(e.created_at) > new Date(cur.created_at));
    if (better) byEvent.set(e.event_name, { ...e, times: cur.times });
  }

  const rows = [...byEvent.values()]
    .map(e => ({ ...e, repeats: e.times.size }))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const anyError = rows.some(r => r.status === 'error');

  return (
    <div className="mb-3 p-3 rounded" style={{
      background: anyError ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
      border: `1px solid ${anyError ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.22)'}`,
    }}>
      <div className="text-xs font-semibold mb-1.5" style={{ color: anyError ? '#dc2626' : '#059669' }}>
        Meta ads tracking
      </div>

      <div className="flex flex-col gap-1">
        {rows.map((e) => (
          <div key={e.event_name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
               style={{ color: 'var(--text-2)' }}>
            <span className="font-medium" style={{ color: 'var(--text-1)' }}>
              {e.event_name === 'Lead' ? 'Order placed' : e.event_name === 'Purchase' ? 'Payment' : e.event_name}
            </span>

            <span>{e.status === 'error' ? 'failed' : e.test ? 'sent as a test' : 'reported'}</span>

            {e.value > 0 && <span>· LKR {Number(e.value).toLocaleString()}</span>}

            {/* The click that produced the sale. Without it Meta cannot tie the
                sale to an ad, which is the whole point of reporting it. */}
            <span title={e.messaging
              ? 'Sent as a WhatsApp conversion with the ad click that started this chat'
              : 'No ad click on file — this customer did not arrive through an ad'}>
              {e.messaging ? '· ad click matched' : '· no ad click'}
            </span>

            <span style={{ color: 'var(--text-3)' }}>
              · {new Date(e.created_at).toLocaleString()}
            </span>

            {e.repeats > 1 && (
              <span style={{ color: 'var(--text-3)' }} title="Sent more than once; Meta counts it once">
                · sent {e.repeats}×, counted once
              </span>
            )}
          </div>
        ))}
      </div>

      {anyError && (
        <div className="text-xs mt-1.5" style={{ color: '#dc2626' }}>
          {rows.find(r => r.status === 'error')?.detail}
        </div>
      )}

      {!byEvent.has('Purchase') && (
        <div className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
          No payment reported yet — that is sent when the order is marked payment received.
        </div>
      )}
    </div>
  );
}
