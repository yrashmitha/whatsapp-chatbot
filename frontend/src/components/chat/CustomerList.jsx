import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { timeAgo } from '../../lib/utils';
import Spinner from '../ui/Spinner';

const WINDOW_MS = 24 * 3600_000;

function windowBadge(last_message_at) {
  if (!last_message_at) return null;
  const rem = WINDOW_MS - (Date.now() - new Date(last_message_at));
  if (rem <= 0) return { label: 'Expired', bg: 'rgba(239,68,68,0.15)', color: '#f87171' };
  const h = Math.floor(rem / 3600_000);
  const m = Math.floor((rem % 3600_000) / 60_000);
  if (rem < 3600_000)  return { label: `${m}m`,        bg: 'rgba(239,68,68,0.15)',    color: '#f87171' };
  if (rem < 4*3600_000) return { label: `${h}h ${m}m`, bg: 'rgba(245,158,11,0.15)',  color: '#fbbf24' };
  return { label: `${h}h`, bg: 'rgba(100,116,139,0.12)', color: 'var(--text-3)' };
}

const STATUS_LABEL = {
  pending:          'Pending',
  started:          'Started',
  delivered:        'Delivered',
  done:             'Done',
  cancelled:        'Cancelled',
  payment_received: 'Payment Rcvd',
  paid:             'Paid',
  complete:         'Complete',
};

// rgba-based so they work in both light and dark modes
const STATUS_BADGE = {
  pending:          { background: 'rgba(245,158,11,0.15)',  color: '#f59e0b' },
  started:          { background: 'rgba(59,130,246,0.15)',  color: '#60a5fa' },
  delivered:        { background: 'rgba(139,92,246,0.15)', color: '#a78bfa' },
  done:             { background: 'rgba(16,185,129,0.15)', color: '#34d399' },
  cancelled:        { background: 'rgba(239,68,68,0.15)',  color: '#f87171' },
  payment_received: { background: 'rgba(59,130,246,0.15)',  color: '#60a5fa' },
  paid:             { background: 'rgba(139,92,246,0.15)', color: '#a78bfa' },
  complete:         { background: 'rgba(16,185,129,0.15)', color: '#34d399' },
};

function Avatar({ name, phone }) {
  const char = (name?.[0] || phone?.[0] || '?').toUpperCase();
  return (
    <div
      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
      style={{ background: 'rgba(99,102,241,0.18)', color: 'var(--accent)' }}
    >
      {char}
    </div>
  );
}

export default function CustomerList({ clientId, selectedPhone, onSelect }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const params = { page, limit: 30, ...(search && { search }), ...(clientId && { client_id: clientId }) };

  const { data, isLoading } = useQuery({
    queryKey: ['customers', params],
    queryFn: () => api.get('/customers', { params }).then(r => r.data),
    keepPreviousData: true,
    // A minute is a long time to wait to notice someone replied.
    refetchInterval: 20_000,
  });

  const customers = data?.customers || [];

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search customers…"
          className="w-full px-3 py-1.5 text-sm rounded-lg outline-none"
          style={{
            background: 'var(--bg-base)',
            color: 'var(--text-1)',
            border: '1px solid var(--border)',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : customers.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--text-3)' }}>No customers found</div>
        ) : (
          customers.map(c => {
            const isSelected = selectedPhone === c.phone;
            const badge = windowBadge(c.last_message_at);
            const needsAttention = !!c.needs_attention;
            return (
              <button
                key={c.phone}
                onClick={() => onSelect(c)}
                className="w-full text-left px-3 py-2.5 transition-colors cursor-pointer bg-transparent border-0"
                style={{
                  borderBottom: '1px solid var(--border-sub)',
                  borderLeft: isSelected
                    ? '2px solid var(--accent)'
                    : needsAttention
                      ? '2px solid #ef4444'
                      : '2px solid transparent',
                  background: isSelected
                    ? 'rgba(99,102,241,0.10)'
                    : needsAttention
                      ? 'rgba(239,68,68,0.05)'
                      : 'transparent',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = needsAttention ? 'rgba(239,68,68,0.10)' : 'rgba(99,102,241,0.05)'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = needsAttention ? 'rgba(239,68,68,0.05)' : 'transparent'; }}
              >
                <div className="flex items-start gap-2.5">
                  <Avatar name={c.name} phone={c.phone} />
                  <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate" style={{ color: needsAttention ? '#ef4444' : 'var(--text-1)' }}>
                          {c.name || c.phone}
                        </span>
                        {needsAttention && (
                          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#ef4444', color: '#fff' }}>!</span>
                        )}
                      </div>
                      {c.name && (
                        <div className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{c.phone}</div>
                      )}
                      {c.last_message && (
                        <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-2)' }}>{c.last_message}</div>
                      )}
                      {(c.has_image || c.has_document || c.latest_order_status) && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {c.has_image && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}
                            >📷 Images</span>
                          )}
                          {/* Who is working this chat by hand. An owner is a
                              person's name; a paused chat with nobody on it is
                              the owner's own reply, or a switch someone flipped.
                              Either way the bot is not answering, which is the
                              thing worth seeing from the list. */}
                          {c.owned_by ? (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: 'rgba(139,92,246,0.18)', color: '#a78bfa' }}
                              title={`${c.owned_by_name || 'An operator'} has taken this chat over. The bot is not replying.`}
                            >👤 {c.owned_by_name || 'operator'}</span>
                          ) : c.ai_enabled === false ? (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: 'rgba(148,163,184,0.18)', color: 'var(--text-2)' }}
                              title="The bot is not replying to this chat. Nobody has taken it over."
                            >⏸ bot off</span>
                          ) : null}
                          {c.has_voice && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}
                            >🎤 Voice</span>
                          )}
                          {c.has_document && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}
                            >📄 Docs</span>
                          )}
                          {c.latest_order_status && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={STATUS_BADGE[c.latest_order_status] || { background: 'rgba(148,163,184,0.15)', color: 'var(--text-2)' }}
                            >
                              {STATUS_LABEL[c.latest_order_status] || c.latest_order_status}
                            </span>
                          )}
                        </div>
                      )}
                      {c.client_id && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--accent)' }}>{c.client_id}</div>
                      )}
                    </div>
                    <div className="shrink-0 text-right flex flex-col items-end gap-0.5">
                      {c.last_message_at && (
                        <div className="text-xs" style={{ color: 'var(--text-3)' }}>{timeAgo(c.last_message_at)}</div>
                      )}
                      {c.unread_count > 0 && (
                        <span className="min-w-5 h-5 flex items-center justify-center rounded-full bg-green-500 text-white text-xs font-bold px-1">
                          {c.unread_count > 99 ? '99+' : c.unread_count}
                        </span>
                      )}
                      {c.order_count > 0 && (
                        <span
                          className="text-xs font-semibold text-white rounded-full px-2 py-0.5"
                          style={{ background: 'var(--accent)' }}
                        >
                          {c.order_count} {c.order_count === 1 ? 'order' : 'orders'}
                        </span>
                      )}
                      {badge && (
                        <span
                          className="text-[10px] font-medium rounded px-1.5 py-0.5"
                          style={{ background: badge.bg, color: badge.color }}
                        >{badge.label}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
        {data?.total > 30 && (
          <div className="flex justify-center gap-2 py-3">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="text-xs disabled:opacity-40 cursor-pointer bg-transparent border-0"
              style={{ color: 'var(--accent)' }}
            >← Prev</button>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>Page {page}</span>
            <button
              disabled={customers.length < 30}
              onClick={() => setPage(p => p + 1)}
              className="text-xs disabled:opacity-40 cursor-pointer bg-transparent border-0"
              style={{ color: 'var(--accent)' }}
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
