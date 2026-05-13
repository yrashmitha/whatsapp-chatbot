import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

export default function WaMessageModal({ order, clientId, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();

  const hd = (() => {
    if (!order?.horoscope_data) return {};
    if (typeof order.horoscope_data === 'object') return order.horoscope_data;
    try { return JSON.parse(order.horoscope_data); } catch { return {}; }
  })();

  const [message, setMessage]       = useState(hd.wa_message || '');
  const [generating, setGenerating] = useState(false);

  const handleRegenerate = async () => {
    setGenerating(true);
    try {
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await api.post(`/plugins/horoscope/generate-wa-message/${order.order_id}${params}`);
      setMessage(res.data.wa_message || '');
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('WhatsApp message generated');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to generate message');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!message) return;
    navigator.clipboard.writeText(message).then(() => toast.success('Copied to clipboard'));
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#1e293b' }}>💬 WhatsApp Message</p>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', marginTop: 2 }}>#{order?.order_id}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {generating ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 0' }}>
              <span className="w-8 h-8 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin block" />
              <span style={{ fontSize: 13, color: '#7c3aed', fontWeight: 600 }}>Generating message…</span>
            </div>
          ) : message ? (
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={14}
              style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', resize: 'vertical', lineHeight: 1.6, fontFamily: 'sans-serif', color: '#1e293b', boxSizing: 'border-box' }}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 13 }}>
              No message generated yet. Click <strong>Generate</strong> below.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#f8fafc', flexShrink: 0, borderRadius: '0 0 16px 16px' }}>
          {message && (
            <button
              onClick={handleCopy}
              style={{ padding: '8px 18px', fontSize: 13, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' }}
            >
              📋 Copy
            </button>
          )}
          <button
            onClick={handleRegenerate}
            disabled={generating}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: '#25D366', color: '#fff', border: 0, borderRadius: 8, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1 }}
          >
            {generating ? 'Generating…' : (message ? '↺ Regenerate' : '✦ Generate')}
          </button>
        </div>
      </div>
    </div>
  );
}
