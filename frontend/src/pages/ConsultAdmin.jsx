import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import FlowViewer from '../components/FlowViewer';
import api from '../lib/api';
import { formatDateTime } from '../lib/utils';

function parseMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

export default function ConsultAdmin() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null); // session_token
  const [activeTab, setActiveTab] = useState('conversation'); // 'conversation' | 'flow'
  const [actionLoading, setActionLoading] = useState(null); // 'delete' | 'clear'
  const qc = useQueryClient();

  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ['consult-sessions', page],
    queryFn: () => api.get('/consult/sessions', { params: { page } }).then(r => r.data),
    keepPreviousData: true,
  });

  const { data: threadData, isLoading: threadLoading } = useQuery({
    queryKey: ['consult-thread', selected],
    queryFn: () => api.get(`/consult/sessions/${selected}`).then(r => r.data),
    enabled: !!selected,
  });

  const { data: flowData } = useQuery({
    queryKey: ['consult-session-flow', selected],
    queryFn: () => api.get(`/api/flow-config/session/${selected}`).then(r => r.data),
    enabled: !!selected && activeTab === 'flow',
    refetchInterval: activeTab === 'flow' ? 5000 : false,
  });

  async function handleDeleteSession() {
    if (!selected) return;
    if (!window.confirm('Delete this session and all its messages? This cannot be undone.')) return;
    setActionLoading('delete');
    try {
      await api.delete(`/consult/sessions/${selected}`);
      qc.invalidateQueries({ queryKey: ['consult-sessions'] });
      setSelected(null);
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to delete session');
    } finally { setActionLoading(null); }
  }

  async function handleClearMessages() {
    if (!selected) return;
    if (!window.confirm('Clear all messages in this session? The session profile will be kept.')) return;
    setActionLoading('clear');
    try {
      await api.delete(`/consult/sessions/${selected}/messages`);
      qc.invalidateQueries({ queryKey: ['consult-thread', selected] });
      qc.invalidateQueries({ queryKey: ['consult-sessions'] });
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to clear messages');
    } finally { setActionLoading(null); }
  }

  const sessions = sessionsData?.sessions || [];
  const total = sessionsData?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const selectedSession = threadData?.session;
  const messages = threadData?.messages || [];

  return (
    <Layout>
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* ── Sessions list ── */}
        <div style={{
          width: '340px', flexShrink: 0, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-1)' }}>
              Consult Sessions
              {total > 0 && (
                <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-3)' }}>
                  {total} total
                </span>
              )}
            </h2>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
                Loading...
              </div>
            )}
            {sessions.map(s => (
              <div
                key={s.session_token}
                onClick={() => { setSelected(s.session_token); setActiveTab('conversation'); }}
                style={{
                  padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                  background: selected === s.session_token ? 'rgba(99,102,241,0.08)' : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)' }}>
                    {s.name || 'Anonymous'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-3)', flexShrink: 0, marginLeft: '8px' }}>
                    {s.message_count} msgs
                  </span>
                </div>
                {s.business_name && (
                  <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '2px' }}>
                    {s.business_name}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                  {s.business_type && (
                    <span style={{
                      fontSize: '11px', padding: '1px 7px', borderRadius: '6px',
                      background: 'rgba(99,102,241,0.12)', color: 'var(--accent)',
                    }}>{s.business_type}</span>
                  )}
                  {s.phone && (
                    <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                      +94{s.phone}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px' }}>
                  {formatDateTime(s.created_at)}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              padding: '10px 16px', borderTop: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
            }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{
                  fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)',
                  background: 'var(--bg-card)', color: 'var(--text-2)', cursor: page === 1 ? 'not-allowed' : 'pointer',
                  opacity: page === 1 ? 0.5 : 1,
                }}
              >← Prev</button>
              <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{
                  fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)',
                  background: 'var(--bg-card)', color: 'var(--text-2)', cursor: page === totalPages ? 'not-allowed' : 'pointer',
                  opacity: page === totalPages ? 0.5 : 1,
                }}
              >Next →</button>
            </div>
          )}
        </div>

        {/* ── Conversation thread ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selected ? (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-3)', fontSize: '14px',
            }}>
              Select a session to view the conversation
            </div>
          ) : (
            <>
              {/* Session header */}
              {selectedSession && (
                <div style={{
                  padding: '12px 20px', borderBottom: '1px solid var(--border)',
                  background: 'var(--bg-surface)', flexShrink: 0,
                  display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
                }}>
                  <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', flex: 1 }}>
                    {[
                      { label: 'Name', value: selectedSession.name },
                      { label: 'Business', value: selectedSession.business_name },
                      { label: 'Type', value: selectedSession.business_type },
                      { label: 'Phone', value: selectedSession.phone ? `+94${selectedSession.phone}` : null },
                      { label: 'Started', value: formatDateTime(selectedSession.created_at) },
                    ].filter(f => f.value).map(f => (
                      <div key={f.label}>
                        <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {f.label}
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-1)', fontWeight: 500 }}>{f.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                      onClick={handleClearMessages}
                      disabled={!!actionLoading}
                      style={{
                        fontSize: '12px', padding: '5px 12px', borderRadius: '8px', cursor: 'pointer',
                        border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-2)',
                        opacity: actionLoading ? 0.5 : 1,
                      }}
                    >
                      {actionLoading === 'clear' ? 'Clearing…' : 'Clear Messages'}
                    </button>
                    <button
                      onClick={handleDeleteSession}
                      disabled={!!actionLoading}
                      style={{
                        fontSize: '12px', padding: '5px 12px', borderRadius: '8px', cursor: 'pointer',
                        border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                        opacity: actionLoading ? 0.5 : 1,
                      }}
                    >
                      {actionLoading === 'delete' ? 'Deleting…' : 'Delete Session'}
                    </button>
                  </div>
                </div>
              )}

              {/* Tab bar */}
              <div style={{
                display: 'flex', borderBottom: '1px solid var(--border)',
                background: 'var(--bg-surface)', flexShrink: 0,
              }}>
                {['conversation', 'flow'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '8px 18px', fontSize: '12px', fontWeight: 500,
                      border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                      background: 'transparent',
                      color: activeTab === tab ? 'var(--accent)' : 'var(--text-3)',
                      borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                      transition: 'color 0.15s',
                    }}
                  >{tab}</button>
                ))}
              </div>

              {/* Conversation tab */}
              {activeTab === 'conversation' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {threadLoading && (
                    <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: '13px', marginTop: '24px' }}>
                      Loading conversation...
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '70%', padding: '10px 14px', borderRadius: '16px',
                        fontSize: '13px', lineHeight: '1.6',
                        ...(msg.role === 'user'
                          ? {
                              background: 'rgba(99,102,241,0.15)', color: 'var(--text-1)',
                              border: '1px solid rgba(99,102,241,0.25)', borderBottomRightRadius: '4px',
                            }
                          : {
                              background: 'var(--bg-card)', color: 'var(--text-1)',
                              border: '1px solid var(--border)', borderBottomLeftRadius: '4px',
                            }
                        ),
                      }}
                        dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.text) }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Flow tab */}
              {activeTab === 'flow' && (
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  <FlowViewer
                    flowConfig={flowData?.flowConfig}
                    currentPhase={flowData?.currentPhase}
                    completedPhases={flowData?.completedPhases || []}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
