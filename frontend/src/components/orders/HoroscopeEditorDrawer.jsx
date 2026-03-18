import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

const SECTION_LABELS = [
  'Personality',
  'Education',
  'Career & Finance',
  'Love & Marriage',
  'Property, Land & Vehicles',
  'Health & Accidents',
  'Children',
  'Life Summary',
  'Current Dasha Period',
  'Remedies',
  'VIP Section',
];

// Expected Sinhala section key order (strip ZWJ for comparison)
const SECTION_ORDER_STRIPPED = [
  'පෞරුෂය',
  'අධ්‍යාපනය',
  'වෘත්තීය ජීවිතය සහ ආර්ථික ශක්තිය',
  'ප්‍රේමය සහ විවාහ ජීවිතය',
  'දේපළ, භූමිය, නිවාස සහ වාහන භාග්‍යය',
  'ශාරීරික සෞඛ්‍යය, මාරක අපල, හදිසි අනතුරු',
  'දරු පල',
  'මෙතෙක් දැක්වූ කරුණු අනුව ජීවන ගමනේ සමස්ත සාරාංශය',
  'වර්තමාන දශාව අනුව පලාපල',
  'ජීවිතයේ අභියෝග ජයගැනීම සඳහා වූ පොදු ශාස්ත්‍රීය සහ බෞද්ධ පිළියම්',
].map(s => s.replace(/\u200D/g, ''));

function sortSectionKeys(keys) {
  return [...keys].sort((a, b) => {
    const sa = a.replace(/\u200D/g, '');
    const sb = b.replace(/\u200D/g, '');
    const ia = SECTION_ORDER_STRIPPED.findIndex(s => s === sa || sa.startsWith(s.slice(0, 6)));
    const ib = SECTION_ORDER_STRIPPED.findIndex(s => s === sb || sb.startsWith(s.slice(0, 6)));
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
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
  const sectionKeys   = Object.keys(savedSections).length > 0 ? sortSectionKeys(Object.keys(savedSections)) : [];

  // Build tab list: S1..SN then Q1..QN
  const sectionTabs = sectionKeys.map((key, i) => ({
    id: `s-${i}`,
    label: `S${i + 1}`,
    title: SECTION_LABELS[i] ? `Section ${i + 1} — ${SECTION_LABELS[i]}` : `Section ${i + 1}`,
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

  // Editor state
  const [outerTab, setOuterTab]     = useState('edit');
  const [activeTab, setActiveTab]   = useState(allTabs[0]?.id || null);
  const [sections, setSections]     = useState({ ...savedSections });
  const [specialAnswers, setSpecialAnswers] = useState(savedSpecial.map(qa => ({ ...qa })));
  const [saving, setSaving]         = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    setSections({ ...savedSections });
    setSpecialAnswers(savedSpecial.map(qa => ({ ...qa })));
    const newTabs = [...sectionKeys.map((_, i) => `s-${i}`), ...savedSpecial.map((_, i) => `q-${i}`)];
    setActiveTab(newTabs[0] || null);
    setOuterTab('edit');
  }, [order?.order_id]);

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
      // Use filename from Content-Disposition if available, else build from order data
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
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
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
    <Drawer open={open} onClose={onClose} title={`Horoscope Editor — #${order?.order_id}`} width="800px">
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
                  <p style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 700, color: '#6366f1' }}>
                    {activeTabData.title}
                  </p>
                  {activeTabData.type === 'section' ? (
                    <textarea
                      key={activeTabData.id}
                      style={{ width: '100%', padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#1e293b', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                      value={sections[activeTabData.key] || ''}
                      onChange={e => setSections(prev => ({ ...prev, [activeTabData.key]: e.target.value }))}
                      rows={22}
                      placeholder={`Enter content for ${activeTabData.title}…`}
                    />
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
