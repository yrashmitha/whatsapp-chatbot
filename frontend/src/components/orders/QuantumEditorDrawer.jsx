import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

export default function QuantumEditorDrawer({ order, clientId, open, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const previewRef = useRef(null);

  const hd = (() => {
    if (!order?.horoscope_data) return {};
    if (typeof order.horoscope_data === 'object') return order.horoscope_data;
    try { return JSON.parse(order.horoscope_data); } catch { return {}; }
  })();

  const [configOrder, setConfigOrder]       = useState([]);
  const [outerTab, setOuterTab]             = useState('edit');
  const [activeTab, setActiveTab]           = useState(null);
  const [sections, setSections]             = useState([]);
  const [saving, setSaving]                   = useState(false);
  const [regenerating, setRegenerating]       = useState(false);
  const [regeneratingSection, setRegeneratingSection] = useState(null); // label of section being regenerated
  const [downloadingPdf, setDownloadingPdf]   = useState(false);
  const [loadingPreview, setLoadingPreview]   = useState(false);

  function applyConfigOrder(savedData, order) {
    if (!Array.isArray(savedData) || savedData.length === 0) return [];
    if (!Array.isArray(order) || order.length === 0) return savedData.map(s => ({ ...s }));
    const byLabel = Object.fromEntries(savedData.map(s => [s.label, s]));
    const sorted = order.map(o => byLabel[o.label]).filter(Boolean);
    const inConfig = new Set(order.map(o => o.label));
    savedData.filter(s => !inConfig.has(s.label)).forEach(s => sorted.push(s));
    return sorted.map(s => ({ ...s }));
  }

  useEffect(() => {
    if (!open) return;
    setOuterTab('edit');
    setRegenerating(!!hd.quantum_generating);
    const params = clientId ? `?client_id=${clientId}` : '';
    api.get(`/plugins/horoscope_reading/config${params}`)
      .then(r => {
        const order = Array.isArray(r.data?.quantum_sections) ? r.data.quantum_sections : [];
        setConfigOrder(order);
        const fresh = Array.isArray(hd.quantum_sections_data) ? hd.quantum_sections_data : [];
        const ordered = applyConfigOrder(fresh, order);
        setSections(ordered);
        setActiveTab(ordered.length > 0 ? 'qs-0' : null);
      })
      .catch(() => {
        const fresh = Array.isArray(hd.quantum_sections_data) ? hd.quantum_sections_data : [];
        setSections(fresh.map(s => ({ ...s })));
        setActiveTab(fresh.length > 0 ? 'qs-0' : null);
      });
  }, [open, order?.order_id]);

  // When polling clears quantum_generating, update the button state automatically
  useEffect(() => {
    if (!open) return;
    if (!hd.quantum_generating && regenerating) {
      setRegenerating(false);
      // Reload sections in case they were updated
      const params = clientId ? `?client_id=${clientId}` : '';
      api.get(`/plugins/horoscope_reading/config${params}`)
        .then(r => {
          const order = Array.isArray(r.data?.quantum_sections) ? r.data.quantum_sections : [];
          setConfigOrder(order);
          const fresh = Array.isArray(hd.quantum_sections_data) ? hd.quantum_sections_data : [];
          const ordered = applyConfigOrder(fresh, order);
          setSections(ordered);
          setActiveTab(ordered.length > 0 ? 'qs-0' : null);
        })
        .catch(() => {});
    }
  }, [hd.quantum_generating, open]);

  const tabs = sections.map((sec, i) => ({
    id:    `qs-${i}`,
    label: `Q${i + 1}`,
    title: sec.label || `Section ${i + 1}`,
    index: i,
  }));

  const activeTabData = tabs.find(t => t.id === activeTab);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const params = clientId ? `?client_id=${clientId}` : '';
      await api.post(`/plugins/horoscope/regenerate-quantum/${order.order_id}${params}`);
      toast.success('Regenerating quantum sections… takes ~1 min. Reopen this drawer when done.');
      qc.invalidateQueries({ queryKey: ['orders'] });
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to regenerate');
      setRegenerating(false);
    }
  };

  const handleRegenerateSection = async (label) => {
    setRegeneratingSection(label);
    try {
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await api.post(`/plugins/horoscope/regenerate-quantum-section/${order.order_id}${params}`, { label });
      const newContent = res.data.content || '';
      setSections(prev => prev.map(s => s.label === label ? { ...s, content: newContent } : s));
      toast.success(`"${label}" regenerated`);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to regenerate section');
    } finally {
      setRegeneratingSection(null);
    }
  };

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
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Server error ${res.status}`);
      }
      const blob = await res.blob();
      const cd   = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `quantum-${order.order_id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[QuantumPDF] download error:', e);
      toast.error(e?.message || 'Failed to download Quantum PDF');
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
      const res = await fetch(`/api/plugins/horoscope/download-quantum-docx/${order.order_id}${params}`, {
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
    } catch (e) {
      toast.error('Failed to load preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (outerTab === 'preview' && open && hd.quantum_data) handlePreviewLoad();
  }, [outerTab]);

  const outerTabCls = (active) => ({
    padding: '8px 16px', fontSize: 13, fontWeight: active ? 600 : 400,
    borderBottomStyle: 'solid', borderBottomWidth: 2,
    borderBottomColor: active ? '#7c3aed' : 'transparent',
    color: active ? '#7c3aed' : '#64748b',
    cursor: 'pointer', background: 'none', border: 'none', userSelect: 'none',
  });

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

        {/* Outer tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', flexShrink: 0, paddingLeft: 8 }}>
          <p style={outerTabCls(outerTab === 'edit')}    onClick={() => setOuterTab('edit')}>✏ Edit Sections</p>
          <p style={outerTabCls(outerTab === 'preview')} onClick={() => setOuterTab('preview')}>👁 Preview Word File</p>
        </div>

        {/* ── Edit tab ── */}
        {outerTab === 'edit' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

            {/* Section tab bar */}
            <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid #e2e8f0', overflowX: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {tabs.map(t => (
                <button key={t.id} style={tabCls(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
                  {t.label}
                </button>
              ))}
              {tabs.length === 0 && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>No quantum sections generated yet.</span>
              )}
            </div>

            {/* Section content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {activeTabData ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>
                      {activeTabData.title}
                    </p>
                    <button
                      onClick={() => handleRegenerateSection(activeTabData.title)}
                      disabled={!!regeneratingSection}
                      style={{ padding: '4px 12px', fontSize: 12, background: regeneratingSection === activeTabData.title ? '#e2e8f0' : '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 6, cursor: regeneratingSection ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {regeneratingSection === activeTabData.title ? '⏳ Generating…' : '↺ Regenerate'}
                    </button>
                  </div>
                  {regeneratingSection === activeTabData.title ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 320, gap: 14 }}>
                      <span className="w-8 h-8 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin block" />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed' }}>Generating "{activeTabData.title}"…</span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>This may take 20–40 seconds</span>
                    </div>
                  ) : (
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
                  )}
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#94a3b8' }}>
                  {tabs.length === 0
                    ? 'No sections available. Add quantum sections in the Plugins page and regenerate.'
                    : 'Select a section tab above to edit.'}
                </p>
              )}
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
                style={{ padding: '6px 16px', fontSize: 13, background: '#7c3aed', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', opacity: loadingPreview ? 0.6 : 1 }}
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

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#f8fafc' }}>
          <button
            onClick={handleRegenerate}
            disabled={regenerating || !hd.aura_analysis || !hd.quantum_data}
            style={{ padding: '8px 18px', fontSize: 13, background: '#0f172a', color: '#ffffff', border: 0, borderRadius: 8, cursor: (regenerating || !hd.aura_analysis || !hd.quantum_data) ? 'not-allowed' : 'pointer', opacity: (regenerating || !hd.aura_analysis || !hd.quantum_data) ? 0.5 : 1 }}
          >
            {regenerating ? '⏳ Starting…' : '🔄 Regenerate'}
          </button>
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
