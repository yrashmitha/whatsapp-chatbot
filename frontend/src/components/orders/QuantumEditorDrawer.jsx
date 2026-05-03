import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

export default function QuantumEditorDrawer({ order, clientId, open, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();

  const hd = (() => {
    if (!order?.horoscope_data) return {};
    if (typeof order.horoscope_data === 'object') return order.horoscope_data;
    try { return JSON.parse(order.horoscope_data); } catch { return {}; }
  })();

  const savedSections = Array.isArray(hd.quantum_sections_data) ? hd.quantum_sections_data : [];

  const tabs = savedSections.map((sec, i) => ({
    id:    `qs-${i}`,
    label: `Q${i + 1}`,
    title: sec.label || `Section ${i + 1}`,
    index: i,
  }));

  const [activeTab, setActiveTab]       = useState(tabs[0]?.id || null);
  const [sections, setSections]         = useState(savedSections.map(s => ({ ...s })));
  const [saving, setSaving]             = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    const fresh = Array.isArray(hd.quantum_sections_data) ? hd.quantum_sections_data : [];
    setSections(fresh.map(s => ({ ...s })));
    const freshTabs = fresh.map((_, i) => `qs-${i}`);
    setActiveTab(freshTabs[0] || null);
  }, [order?.order_id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/plugins/horoscope/quantum-sections/${order.order_id}`, {
        quantum_sections_data: sections,
      });
      toast.success('Quantum sections saved');
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const token  = localStorage.getItem('crm_token');
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/plugins/horoscope/download-quantum-pdf/${order.order_id}${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const cd   = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `quantum-${order.order_id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download Quantum PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const activeTabData = tabs.find(t => t.id === activeTab);

  const tabCls = (active) => ({
    padding: '6px 10px', fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? '#7c3aed' : '#f1f5f9',
    color: active ? '#ffffff' : '#475569',
    borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
    border: 'none', userSelect: 'none', flexShrink: 0,
  });

  return (
    <Drawer open={open} onClose={onClose} title={`Quantum Editor: #${order?.order_id}`} width="800px">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

        {/* Tab bar */}
        <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid #e2e8f0', overflowX: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {tabs.map(t => (
            <button key={t.id} style={tabCls(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
          {tabs.length === 0 && (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>No quantum sections generated yet. Configure sections in Plugins settings and regenerate.</span>
          )}
        </div>

        {/* Section content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {activeTabData ? (
            <>
              <p style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>
                {activeTabData.title}
              </p>
              <textarea
                key={activeTabData.id}
                style={{ width: '100%', padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#1e293b', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                value={sections[activeTabData.index]?.content || ''}
                onChange={e => {
                  const updated = [...sections];
                  updated[activeTabData.index] = { ...updated[activeTabData.index], content: e.target.value };
                  setSections(updated);
                }}
                rows={22}
                placeholder={`Enter content for ${activeTabData.title}…`}
              />
            </>
          ) : (
            <p style={{ fontSize: 13, color: '#94a3b8' }}>
              {tabs.length === 0
                ? 'No sections available. Add quantum sections in the Plugins page and regenerate the quantum reading.'
                : 'Select a section tab above to edit.'}
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#f8fafc' }}>
          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf || !hd.quantum_data}
            style={{ padding: '8px 18px', fontSize: 13, background: '#7c3aed', color: '#ffffff', border: 0, borderRadius: 8, cursor: (downloadingPdf || !hd.quantum_data) ? 'not-allowed' : 'pointer', opacity: (downloadingPdf || !hd.quantum_data) ? 0.6 : 1 }}
          >
            {downloadingPdf ? 'Preparing…' : '✦ Download Quantum PDF'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || tabs.length === 0}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: '#6366f1', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
