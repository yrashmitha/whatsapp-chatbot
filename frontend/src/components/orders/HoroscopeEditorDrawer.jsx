import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';
import DeliveryPanel from './DeliveryPanel';
import QuantumEditorDrawer from './QuantumEditorDrawer';
import DeleteReportButton from './DeleteReportButton';

function applyHoroscopeOrder(keys, configOrder) {
  if (!Array.isArray(configOrder) || configOrder.length === 0) return keys;
  const configLabels = configOrder.map(s => s.label || s);
  const keySet = new Set(keys);
  const sorted = configLabels.filter(l => keySet.has(l));
  const inConfig = new Set(configLabels);
  keys.filter(k => !inConfig.has(k)).forEach(k => sorted.push(k));
  return sorted;
}

export default function HoroscopeEditorDrawer({ order, clientId, open, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const previewRef = useRef(null);

  const hd = (() => {
    if (!order?.horoscope_data) return {};
    if (typeof order.horoscope_data === 'object') return order.horoscope_data;
    try { return JSON.parse(order.horoscope_data); } catch { return {}; }
  })();

  const savedSections = hd.sections || {};
  const savedSpecial  = hd.special_answers || [];

  const [configSectionOrder, setConfigSectionOrder] = useState([]);

  // Editor state
  const [outerTab, setOuterTab]     = useState('edit');
  const [activeTab, setActiveTab]   = useState(null);
  const [sections, setSections]     = useState({ ...savedSections });
  const [specialAnswers, setSpecialAnswers] = useState(savedSpecial.map(qa => ({ ...qa })));
  const [saving, setSaving]                   = useState(false);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [overrideAstro, setOverrideAstro]     = useState(false);
  const [regeneratingSection, setRegeneratingSection] = useState(null);
  const [downloading, setDownloading]         = useState(false);
  const [downloadingPdf, setDownloadingPdf]   = useState(false);
  const [downloadingQPdf, setDownloadingQPdf] = useState(false);
  const [loadingPreview, setLoadingPreview]   = useState(false);
  const [quantumEditorOpen, setQuantumEditorOpen] = useState(false);

  // Fetch config order when drawer opens
  useEffect(() => {
    if (!open) return;
    const params = clientId ? `?client_id=${clientId}` : '';
    api.get(`/plugins/horoscope_reading/config${params}`)
      .then(r => {
        const order = Array.isArray(r.data?.horoscope_sections) ? r.data.horoscope_sections : [];
        setConfigSectionOrder(order);
      })
      .catch(() => {});
  }, [open, order?.order_id]);

  useEffect(() => {
    setSections({ ...savedSections });
    setSpecialAnswers(savedSpecial.map(qa => ({ ...qa })));
    setActiveTab(null);
    setOuterTab('edit');
  }, [order?.order_id]);

  // Clear regeneratingAll once the backend finishes (generating flag removed)
  useEffect(() => {
    if (regeneratingAll && !hd.generating) setRegeneratingAll(false);
  }, [hd.generating]);

  const handleRegenerateAll = async () => {
    if (!hd.lat || !hd.lng) return;
    setRegeneratingAll(true);
    try {
      const params = clientId ? `?client_id=${clientId}` : '';
      await api.post(`/plugins/horoscope/generate${params}`, {
        order_id: order.order_id,
        lat: hd.lat,
        lng: hd.lng,
        birth_place_name: hd.birth_place_name || '',
        override_astro: overrideAstro,
      });
      toast.success('Regeneration started — sections will update automatically');
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to start regeneration');
      setRegeneratingAll(false);
    }
  };

  // Derive ordered section keys from config
  const rawKeys = Object.keys(savedSections);
  const sectionKeys = rawKeys.length > 0 ? applyHoroscopeOrder(rawKeys, configSectionOrder) : [];

  const sectionTabs = sectionKeys.map((key, i) => ({
    id: `s-${i}`,
    label: `S${i + 1}`,
    title: `Section ${i + 1}: ${key}`,
    key,
    type: 'section',
  }));
  const questionTabs = savedSpecial.map((_, i) => ({
    id: `q-${i}`,
    label: `Q${i + 1}`,
    title: `Question ${i + 1}`,
    key: i,
    type: 'question',
  }));
  const allTabs = [...sectionTabs, ...questionTabs];

  // Set first tab when tabs become available
  useEffect(() => {
    if (allTabs.length > 0 && !activeTab) {
      setActiveTab(allTabs[0].id);
    }
  }, [allTabs.length, activeTab]);

  const handleRegenerateSection = async (key) => {
    setRegeneratingSection(key);
    try {
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await api.post(`/plugins/horoscope/regenerate-section/${order.order_id}${params}`, { label: key });
      setSections(prev => ({ ...prev, [key]: res.data.content || '' }));
      toast.success(`"${key}" regenerated`);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to regenerate section');
    } finally {
      setRegeneratingSection(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/plugins/horoscope/sections/${order.order_id}`, {
        sections,
        special_answers: specialAnswers,
      });
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
      const token = localStorage.getItem('crm_token');
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/plugins/horoscope/download/${order.order_id}${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const last4    = (order.phone_number || '').replace(/\D/g, '').slice(-4) || '0000';
      const filename = match ? match[1] : `horoscope-${last4}-birthday.docx`;
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Failed to download');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const token = localStorage.getItem('crm_token');
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/plugins/horoscope/download-pdf/${order.order_id}${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `horoscope-${order.order_id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadQuantumPdf = async () => {
    if (downloadingQPdf) return;
    setDownloadingQPdf(true);
    try {
      const token  = localStorage.getItem('crm_token');
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/plugins/horoscope/download-quantum-pdf/${order.order_id}${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `quantum-${order.order_id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download Quantum PDF');
    } finally {
      setDownloadingQPdf(false);
    }
  };

  const handlePreviewLoad = async () => {
    if (!previewRef.current) return;
    setLoadingPreview(true);
    try {
      const token = localStorage.getItem('crm_token');
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/plugins/horoscope/download/${order.order_id}${params}`, {
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
    if (outerTab === 'preview' && order?.horoscope_data) handlePreviewLoad();
  }, [outerTab]);

  const outerTabCls = (active) => ({
    padding: '8px 16px', fontSize: 13, fontWeight: active ? 600 : 400,
    borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
    color: active ? '#6366f1' : '#64748b',
    cursor: 'pointer', background: 'none', border: 'none',
    borderBottomStyle: 'solid', borderBottomWidth: 2,
    borderBottomColor: active ? '#6366f1' : 'transparent',
    userSelect: 'none',
  });

  const innerTabCls = (active) => ({
    padding: '6px 10px', fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? '#6366f1' : '#f1f5f9',
    color: active ? '#ffffff' : '#475569',
    borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
    border: 'none', userSelect: 'none', flexShrink: 0,
  });

  const activeTabData = allTabs.find(t => t.id === activeTab);

  return (
    <Drawer open={open} onClose={onClose} title={`Horoscope Editor: #${order?.order_id}`} width="800px">
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
              {allTabs.map(t => (
                <p key={t.id} style={innerTabCls(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
                  {t.label}
                </p>
              ))}
              {allTabs.length === 0 && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>No sections generated yet.</span>
              )}
            </div>

            {/* Section content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {activeTabData ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#6366f1' }}>
                      {activeTabData.title}
                    </p>
                    {activeTabData.type === 'section' && (
                      <button
                        onClick={() => handleRegenerateSection(activeTabData.key)}
                        disabled={!!regeneratingSection}
                        style={{ padding: '4px 12px', fontSize: 12, background: regeneratingSection === activeTabData.key ? '#e2e8f0' : '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 6, cursor: regeneratingSection ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                      >
                        {regeneratingSection === activeTabData.key ? '⏳ Generating…' : '↺ Regenerate'}
                      </button>
                    )}
                  </div>
                  {activeTabData.type === 'section' ? (
                    regeneratingSection === activeTabData.key ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 320, gap: 14 }}>
                        <span className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin block" />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#6366f1' }}>Generating "{activeTabData.key}"…</span>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>This may take 20–40 seconds</span>
                      </div>
                    ) : (
                      <textarea
                        key={activeTabData.id}
                        style={{ width: '100%', padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#1e293b', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                        value={sections[activeTabData.key] || ''}
                        onChange={e => setSections(prev => ({ ...prev, [activeTabData.key]: e.target.value }))}
                        rows={22}
                        placeholder={`Enter content for ${activeTabData.title}…`}
                      />
                    )
                  ) : (
                    <>
                      <p style={{ margin: '0 0 4px 0', fontSize: 11, color: '#64748b', fontWeight: 600 }}>Question text (editable):</p>
                      <textarea
                        key={`q-text-${activeTabData.id}`}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#f8fafc', color: '#1e293b', resize: 'none', lineHeight: 1.5, boxSizing: 'border-box', marginBottom: 12, overflow: 'hidden' }}
                        rows={2}
                        value={specialAnswers[activeTabData.key]?.question || ''}
                        onChange={e => {
                          const updated = [...specialAnswers];
                          updated[activeTabData.key] = { ...updated[activeTabData.key], question: e.target.value };
                          setSpecialAnswers(updated);
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                        placeholder="Question text…"
                      />
                      {/* Generation left this one blank. Surfaced so the report is
                          not downloaded with a question silently unanswered. */}
                      {specialAnswers[activeTabData.key]?.error
                        && !(specialAnswers[activeTabData.key]?.answer || '').trim() && (
                        <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 8px' }}>
                          ⚠ Not answered — {specialAnswers[activeTabData.key].error}
                        </p>
                      )}
                      <p style={{ margin: '0 0 4px 0', fontSize: 11, color: '#64748b', fontWeight: 600 }}>Answer:</p>
                      <textarea
                        key={activeTabData.id}
                        style={{ width: '100%', padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#1e293b', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                        value={specialAnswers[activeTabData.key]?.answer || ''}
                        onChange={e => {
                          const updated = [...specialAnswers];
                          updated[activeTabData.key] = { ...updated[activeTabData.key], answer: e.target.value };
                          setSpecialAnswers(updated);
                        }}
                        rows={18}
                        placeholder="Enter answer…"
                      />
                    </>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#94a3b8' }}>Select a section tab above to edit.</p>
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

        <DeliveryPanel order={order} clientId={clientId} open={open} kind="horoscope" />

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', background: '#f8fafc', flexWrap: 'wrap' }}>
          {hd.lat && hd.lng && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
              <button
                onClick={handleRegenerateAll}
                disabled={regeneratingAll || !!hd.generating}
                style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: regeneratingAll || hd.generating ? '#e2e8f0' : '#0f766e', color: regeneratingAll || hd.generating ? '#94a3b8' : '#fff', border: 0, borderRadius: 8, cursor: regeneratingAll || hd.generating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
              >
                {regeneratingAll || hd.generating ? '⏳ Generating…' : '↺ Regenerate Horoscope'}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={overrideAstro}
                  onChange={e => setOverrideAstro(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                Re-fetch chart
              </label>
            </div>
          )}
          <DeleteReportButton order={order} clientId={clientId} kind="horoscope" visible={rawKeys.length > 0} onDone={onClose} />
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
          {hd.quantum_data && hd.aura_analysis && (
            <>
              {Array.isArray(hd.quantum_sections_data) && hd.quantum_sections_data.length > 0 && (
                <button
                  onClick={() => setQuantumEditorOpen(true)}
                  style={{ padding: '8px 18px', fontSize: 13, background: '#ffffff', color: '#7c3aed', border: '1px solid #7c3aed', borderRadius: 8, cursor: 'pointer' }}
                >
                  ✏ Quantum Sections
                </button>
              )}
              <button
                onClick={handleDownloadQuantumPdf}
                disabled={downloadingQPdf}
                style={{ padding: '8px 18px', fontSize: 13, background: '#7c3aed', color: '#ffffff', border: 0, borderRadius: 8, cursor: downloadingQPdf ? 'not-allowed' : 'pointer', opacity: downloadingQPdf ? 0.6 : 1 }}
              >
                {downloadingQPdf ? 'Preparing…' : '✦ Quantum PDF'}
              </button>
            </>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: '#6366f1', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
        </div>
      </div>
      <QuantumEditorDrawer
        order={order}
        clientId={clientId}
        open={quantumEditorOpen}
        onClose={() => setQuantumEditorOpen(false)}
      />
    </Drawer>
  );
}
