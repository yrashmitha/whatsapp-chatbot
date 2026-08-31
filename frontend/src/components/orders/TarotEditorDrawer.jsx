import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';
import DeliveryPanel from './DeliveryPanel';

const POSITION_COLORS = { Past: '#8b5cf6', Present: '#3b82f6', Future: '#10b981' };

export default function TarotEditorDrawer({ order, clientId, open, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const previewRef = useRef(null);

  const parseTd = () => {
    if (!order?.tarot_data) return {};
    if (typeof order.tarot_data === 'object') return order.tarot_data;
    try { return JSON.parse(order.tarot_data); } catch { return {}; }
  };

  const td = parseTd();

  const [outerTab, setOuterTab]           = useState('edit');
  const [activeInnerTab, setActiveInnerTab] = useState('reading');
  const [reading, setReading]             = useState(td.reading || '');
  const [cards, setCards]                 = useState(td.cards ? td.cards.map(c => ({ ...c })) : []);
  const [saving, setSaving]               = useState(false);
  const [downloading, setDownloading]     = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Reset state whenever a different order is opened
  useEffect(() => {
    const fresh = parseTd();
    setReading(fresh.reading || '');
    setCards(fresh.cards ? fresh.cards.map(c => ({ ...c })) : []);
    setActiveInnerTab('reading');
    setOuterTab('edit');
  }, [order?.order_id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/crm/tarot-reading/sections/${order.order_id}`, { reading, cards });
      toast.success('Changes saved');
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const token  = localStorage.getItem('crm_token');
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/crm/tarot-reading/download/${order.order_id}${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const cd   = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const last4  = (order.phone_number || '').replace(/\D/g, '').slice(-4) || '0000';
      const filename = match ? match[1] : `tarot-reading-${last4}.docx`;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const token  = localStorage.getItem('crm_token');
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/crm/tarot-reading/download-pdf/${order.order_id}${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const cd   = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `tarot-reading-${order.order_id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePreviewLoad = async () => {
    if (!previewRef.current) return;
    setLoadingPreview(true);
    try {
      const token  = localStorage.getItem('crm_token');
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/crm/tarot-reading/download/${order.order_id}${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch document');
      const blob = await res.blob();
      const { renderAsync } = await import('docx-preview');
      previewRef.current.innerHTML = '';
      await renderAsync(blob, previewRef.current, null, {
        className: 'docx-preview', inWrapper: true, ignoreWidth: false,
        ignoreHeight: false, ignoreFonts: false, breakPages: true, useBase64URL: true,
      });
    } catch {
      toast.error('Failed to load preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (outerTab === 'preview' && order?.tarot_data) handlePreviewLoad();
  }, [outerTab]);

  const outerTabCls = (active) => ({
    padding: '8px 16px', fontSize: 13, fontWeight: active ? 600 : 400,
    borderBottom: 'none', cursor: 'pointer', background: 'none', border: 'none',
    borderBottomStyle: 'solid', borderBottomWidth: 2,
    borderBottomColor: active ? '#6366f1' : 'transparent',
    color: active ? '#6366f1' : '#64748b', userSelect: 'none',
  });

  const innerTabCls = (active) => ({
    padding: '6px 10px', fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? '#6366f1' : '#f1f5f9',
    color: active ? '#ffffff' : '#475569',
    borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
    border: 'none', userSelect: 'none', flexShrink: 0,
  });

  const updateCard = (i, field, value) =>
    setCards(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));

  const innerTabs = [
    { id: 'reading', label: 'Reading' },
    ...cards.map((c, i) => ({ id: `card-${i}`, label: c.position })),
  ];

  return (
    <Drawer open={open} onClose={onClose} title={`Tarot Reading Editor: #${order?.order_id}`} width="800px">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

        {/* Outer tabs: Edit | Preview */}
        <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', flexShrink: 0, paddingLeft: 8 }}>
          <p style={outerTabCls(outerTab === 'edit')}    onClick={() => setOuterTab('edit')}>✏ Edit Sections</p>
          <p style={outerTabCls(outerTab === 'preview')} onClick={() => setOuterTab('preview')}>👁 Preview Word File</p>
        </div>

        {/* ── Edit tab ── */}
        {outerTab === 'edit' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

            {/* Inner section tab bar */}
            <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid #e2e8f0', overflowX: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {innerTabs.map(t => (
                <button key={t.id} style={innerTabCls(activeInnerTab === t.id)} onClick={() => setActiveInnerTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Section content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

              {/* Reading tab */}
              {activeInnerTab === 'reading' && (
                <>
                  {td.question && (
                    <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#64748b', fontStyle: 'italic', lineHeight: 1.4 }}>
                      Question: {td.question}
                    </p>
                  )}
                  <p style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 700, color: '#6366f1' }}>Full Reading</p>
                  <textarea
                    style={{ width: '100%', padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#1e293b', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                    value={reading}
                    onChange={e => setReading(e.target.value)}
                    rows={22}
                    placeholder="Reading text…"
                  />
                </>
              )}

              {/* Card tabs (Past / Present / Future) */}
              {cards.map((c, i) => activeInnerTab === `card-${i}` && (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: POSITION_COLORS[c.position] || '#6366f1' }}>
                    {c.position} — {c.name} ({c.reversed ? 'Reversed' : 'Upright'})
                  </p>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Card Name</label>
                    <input
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }}
                      value={c.name}
                      onChange={e => updateCard(i, 'name', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Orientation</label>
                    <select
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', boxSizing: 'border-box', background: '#fff' }}
                      value={c.reversed ? 'reversed' : 'upright'}
                      onChange={e => updateCard(i, 'reversed', e.target.value === 'reversed')}
                    >
                      <option value="upright">⬆ Upright</option>
                      <option value="reversed">🔄 Reversed</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Card Meaning</label>
                    <textarea
                      style={{ width: '100%', padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#1e293b', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                      value={c.meaning}
                      onChange={e => updateCard(i, 'meaning', e.target.value)}
                      rows={6}
                      placeholder="Card meaning…"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Preview tab ── */}
        {outerTab === 'preview' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={handlePreviewLoad}
                disabled={loadingPreview}
                style={{ padding: '6px 16px', fontSize: 13, background: '#6366f1', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', opacity: loadingPreview ? 0.6 : 1 }}
              >
                {loadingPreview ? 'Loading…' : '🔄 Refresh Preview'}
              </button>
              <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>
                Save changes first, then refresh preview.
              </span>
            </div>
            {loadingPreview && (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                <span className="w-6 h-6 border-2 border-violet-400/30 border-t-violet-500 rounded-full animate-spin inline-block" />
                <div style={{ marginTop: 8, fontSize: 13 }}>Rendering document…</div>
              </div>
            )}
            <div ref={previewRef} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, minHeight: 400, overflow: 'auto' }} />
          </div>
        )}

        <DeliveryPanel order={order} clientId={clientId} open={open} kind="tarot" />

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#f8fafc' }}>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{ padding: '8px 18px', fontSize: 13, background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8, cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.6 : 1 }}
          >
            {downloading ? 'Downloading…' : '⬇ Download Word'}
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            style={{ padding: '8px 18px', fontSize: 13, background: '#dc2626', color: '#ffffff', border: 0, borderRadius: 8, cursor: downloadingPdf ? 'not-allowed' : 'pointer', opacity: downloadingPdf ? 0.6 : 1 }}
          >
            {downloadingPdf ? 'Preparing…' : '⬇ Download PDF'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: '#6366f1', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
