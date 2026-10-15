import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import api from '../lib/api';
import { formatDateTime } from '../lib/utils';

export default function WebInquiries() {
  const [selectedId, setSelectedId] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['website-leads'],
    queryFn: () => api.get('/website-leads').then(r => r.data),
  });

  const leads = data?.leads || [];
  const selected = leads.find(l => l.id === selectedId) || null;

  async function openLead(lead) {
    setSelectedId(lead.id);
    if (!lead.is_read) {
      // Optimistic: flip it locally so the nav badge and list dot update
      // immediately instead of waiting on the next poll/refetch.
      qc.setQueryData(['website-leads'], old => old && {
        ...old,
        leads: old.leads.map(l => l.id === lead.id ? { ...l, is_read: true } : l),
      });
      try {
        await api.patch(`/website-leads/${lead.id}/read`);
      } finally {
        qc.invalidateQueries({ queryKey: ['website-leads-unread'] });
      }
    }
  }

  return (
    <Layout>
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* ── Inquiry list ── */}
        <div style={{
          width: '360px', flexShrink: 0, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-1)' }}>
              Web Inquiries
              {leads.length > 0 && (
                <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-3)' }}>
                  {leads.length} total
                </span>
              )}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
              Consultation requests from the Nova Solutions website.
            </p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
                Loading...
              </div>
            )}
            {!isLoading && leads.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
                No inquiries yet.
              </div>
            )}
            {leads.map(lead => (
              <div
                key={lead.id}
                onClick={() => openLead(lead)}
                style={{
                  padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                  background: selectedId === lead.id ? 'rgba(99,102,241,0.08)' : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {!lead.is_read && (
                    <span
                      title="Unread"
                      style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }}
                    />
                  )}
                  <span style={{
                    fontSize: '13px', color: 'var(--text-1)', flex: 1, minWidth: 0,
                    fontWeight: lead.is_read ? 500 : 700,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {lead.name}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-3)', flexShrink: 0 }}>
                    {formatDateTime(lead.created_at)}
                  </span>
                </div>
                {lead.business_name && (
                  <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '2px' }}>
                    {lead.business_name}
                  </div>
                )}
                {lead.service_interest && (
                  <span style={{
                    display: 'inline-block', marginTop: '4px', fontSize: '11px', padding: '1px 7px', borderRadius: '6px',
                    background: 'rgba(99,102,241,0.12)', color: 'var(--accent)',
                  }}>{lead.service_interest}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Detail panel ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', minWidth: 0 }}>
          {!selected ? (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-3)', fontSize: '14px',
            }}>
              Select an inquiry to view the details
            </div>
          ) : (
            <div style={{ maxWidth: '560px' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700, color: 'var(--text-1)' }}>
                {selected.name}
              </h3>
              <p style={{ margin: '0 0 20px', fontSize: '12px', color: 'var(--text-3)' }}>
                Submitted {formatDateTime(selected.created_at)}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                {[
                  { label: 'Business', value: selected.business_name },
                  { label: 'Service Interested In', value: selected.service_interest },
                  { label: 'Email', value: selected.email, href: `mailto:${selected.email}` },
                  { label: 'Phone', value: selected.phone, href: selected.phone ? `tel:${selected.phone}` : null },
                  { label: 'Country', value: selected.country },
                ].filter(f => f.value).map(f => (
                  <div key={f.label}>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {f.label}
                    </div>
                    {f.href ? (
                      <a href={f.href} style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 500, textDecoration: 'none' }}>{f.value}</a>
                    ) : (
                      <div style={{ fontSize: '13px', color: 'var(--text-1)', fontWeight: 500 }}>{f.value}</div>
                    )}
                  </div>
                ))}
              </div>

              {selected.message && (
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                    Message
                  </div>
                  <div style={{
                    fontSize: '13px', lineHeight: '1.7', color: 'var(--text-1)', whiteSpace: 'pre-wrap',
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px',
                  }}>
                    {selected.message}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
