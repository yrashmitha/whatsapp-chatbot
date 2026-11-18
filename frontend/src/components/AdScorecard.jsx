import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import Spinner from './ui/Spinner';

/**
 * What each ad earned for what it cost, for the owner.
 *
 * Spend comes from Meta for the chosen days; sales come from the CRM: every
 * paid order of a customer whose first ad click fell in those days, counted for
 * that ad, upsells included. Ads that spent money and sold nothing are shown
 * too, tinted, because those are the ones to stop.
 */
export default function AdScorecard({ clientId }) {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQuery({
    queryKey: ['ad-scorecard', clientId, days],
    queryFn: () => api.get('/orders/ad-scorecard', { params: { days, ...(clientId ? { client_id: clientId } : {}) } }).then(r => r.data),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Owner only: anyone else simply does not get the section.
  if (error?.response?.status === 403) return null;

  const rs = (v) => `Rs ${Math.round(v || 0).toLocaleString()}`;
  const cur = data?.currency || '';
  const symbol = cur === 'USD' ? '$' : `${cur} `;
  const spendText = (v) => (v == null ? '–' : `${symbol}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  // Spend in rupees too: then it is a plain multiple, revenue for each rupee.
  const perText = (v) => (v == null ? '–' : cur === 'LKR' ? `${v.toFixed(1)}×` : rs(v));
  const perHeader = cur === 'LKR' ? 'Return on spend' : `Revenue per ${cur === 'USD' ? '$' : `${cur} `}1 spent`;
  const points = data?.price_points || [];
  const hasOther = (data?.totals?.other_sales || 0) > 0;

  const th = 'px-3 py-2 text-left text-xs font-medium whitespace-nowrap';
  const td = 'px-3 py-2 text-sm whitespace-nowrap';

  return (
    <section className="max-w-5xl mx-auto mt-8">
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>Revenue by ad</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            Customers whose first ad click was in the period, and every sale they made after it, upsells included. Spend from Meta for the same days.
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid var(--border)' }}>
          {[14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="px-3 py-1.5 text-xs font-medium border-0 cursor-pointer"
              style={{ background: d === days ? 'var(--accent)' : 'transparent', color: d === days ? '#fff' : 'var(--text-2)' }}
            >
              Last {d} days
            </button>
          ))}
        </div>
      </div>

      {data?.spend_error && (
        <div className="text-xs rounded-lg px-3 py-2 mb-3" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
          Spend could not be read from Meta, so it is left out: {data.spend_error}
        </div>
      )}

      <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : error ? (
          <p className="px-4 py-6 text-sm" style={{ color: '#f87171' }}>{error.response?.data?.error || 'Could not load the ad figures.'}</p>
        ) : !data?.ads?.length ? (
          <p className="px-4 py-6 text-sm" style={{ color: 'var(--text-3)' }}>No ad clicks or ad spend in the last {days} days.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                <th className={th}>Ad</th>
                <th className={`${th} text-right`}>Spend</th>
                {points.map(p => <th key={p} className={`${th} text-right`}>{rs(p)} sales</th>)}
                {hasOther && <th className={`${th} text-right`}>Other</th>}
                <th className={`${th} text-right`}>Total revenue</th>
                <th className={`${th} text-right`}>{perHeader}</th>
              </tr>
            </thead>
            <tbody>
              {data.ads.map(a => {
                const wasted = a.spend > 0 && a.revenue === 0;
                return (
                  <tr key={a.ad_id} style={{ borderBottom: '1px solid var(--border)', background: wasted ? 'rgba(248,113,113,0.07)' : 'transparent' }}>
                    <td className={`${td} max-w-[260px]`}>
                      <div className="truncate font-medium" style={{ color: 'var(--text-1)' }} title={a.ad_name || a.headline || a.ad_id}>
                        {a.ad_name || a.headline || `Ad ${a.ad_id}`}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                        {a.people} {a.people === 1 ? 'person' : 'people'}
                        {a.repeat_sales > 0 && ` · ${a.repeat_sales} repeat sale${a.repeat_sales === 1 ? '' : 's'}`}
                        {a.status && a.status !== 'ACTIVE' && ` · ${a.status.toLowerCase().replace(/_/g, ' ')}`}
                        {wasted && <span style={{ color: '#f87171' }}> · spent, no sales</span>}
                      </div>
                    </td>
                    <td className={`${td} text-right`} style={{ color: 'var(--text-2)' }}>{spendText(a.spend)}</td>
                    {points.map(p => (
                      <td key={p} className={`${td} text-right`} style={{ color: a.by_price[p] ? 'var(--text-1)' : 'var(--text-3)' }}>{a.by_price[p] || '–'}</td>
                    ))}
                    {hasOther && <td className={`${td} text-right`} style={{ color: 'var(--text-2)' }}>{a.other_sales || '–'}</td>}
                    <td className={`${td} text-right font-medium`} style={{ color: 'var(--text-1)' }}>{rs(a.revenue)}</td>
                    <td className={`${td} text-right font-semibold`} style={{ color: a.revenue_per_spend == null ? 'var(--text-3)' : a.revenue_per_spend === 0 ? '#f87171' : '#34d399' }}>{perText(a.revenue_per_spend)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ color: 'var(--text-1)' }}>
                <td className={`${td} font-semibold`}>Total</td>
                <td className={`${td} text-right font-semibold`}>{spendText(data.totals.spend)}</td>
                {points.map(p => <td key={p} className={`${td} text-right font-semibold`}>{data.totals.by_price[p] || '–'}</td>)}
                {hasOther && <td className={`${td} text-right font-semibold`}>{data.totals.other_sales || '–'}</td>}
                <td className={`${td} text-right font-semibold`}>{rs(data.totals.revenue)}</td>
                <td className={`${td} text-right font-semibold`} style={{ color: '#34d399' }}>{perText(data.totals.revenue_per_spend)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      {data && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
          {data.since} to {data.until}. Each customer counts for the ad that first brought them in; all their later sales count for that ad too.
        </p>
      )}
    </section>
  );
}
