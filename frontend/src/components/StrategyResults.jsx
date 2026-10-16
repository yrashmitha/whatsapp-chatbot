import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

const ROWS = [
  ['chats', 'Chats started'],
  ['engaged', 'Real conversations (3+ customer messages)'],
  ['with_order', 'Chats with an order'],
  ['paid', 'Chats with a paid order'],
];

/** How the two prompt strategies are doing. Counts only, so small groups are not over-read. */
export default function StrategyResults({ clientId }) {
  const params = clientId ? { client_id: clientId } : {};
  const { data, isLoading } = useQuery({
    queryKey: ['strategy-results', clientId],
    queryFn: () => api.get('/strategy-results', { params }).then(r => r.data),
    enabled: !!clientId,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return <p className="text-xs text-slate-400">Loading results…</p>;

  const total = (data.A?.chats || 0) + (data.B?.chats || 0);
  const small = Math.min(data.A?.chats || 0, data.B?.chats || 0) < 30;

  return (
    <div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-xs text-slate-500 text-left">
            <th className="py-1 pr-3 font-medium"></th>
            <th className="py-1 px-3 font-semibold text-sky-700">Strategy A</th>
            <th className="py-1 px-3 font-semibold text-fuchsia-700">Strategy B</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([key, label]) => (
            <tr key={key} className="border-t border-slate-100">
              <td className="py-1.5 pr-3 text-slate-600">{label}</td>
              <td className="py-1.5 px-3 tabular-nums">{data.A?.[key] ?? 0}</td>
              <td className="py-1.5 px-3 tabular-nums">{data.B?.[key] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 mt-2">
        {total === 0
          ? 'No chats on the split yet. New customers are counted from the moment it is switched on.'
          : small
            ? 'Fewer than 30 chats on one side, so a gap between the two is probably luck. Wait for more.'
            : 'Each new customer is given A or B in turn, so both sides see the same ads and hours.'}
      </p>
    </div>
  );
}
