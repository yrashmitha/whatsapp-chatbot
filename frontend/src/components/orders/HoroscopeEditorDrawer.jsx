import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

const SECTIONS = [
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
];

export default function HoroscopeEditorDrawer({ order, clientId, open, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const previewRef = useRef(null);

  const hd = (() => {
    if (!order?.horoscope_data) return {};
    if (typeof order.horoscope_data === 'object') return order.horoscope_data;
    try { return JSON.parse(order.horoscope_data); } catch { return {}; }
  })();

  const savedSections    = hd.sections || {};
  const savedSpecial     = hd.special_answers || [];
  // Use saved keys directly to avoid Unicode/ZWJ mismatch issues
  const allSectionKeys = Object.keys(savedSections).length > 0
    ? Object.keys(savedSections)
    : SECTIONS;

  // Editor state
  const [tab, setTab]                 = useState('edit'); // 'edit' | 'preview'
  const [sections, setSections]       = useState({ ...savedSections });
  const [specialAnswers, setSpecialAnswers] = useState(savedSpecial.map(qa => ({ ...qa })));
  const [expandedSection, setExpandedSection] = useState(allSectionKeys[0] || null);
  const [saving, setSaving]           = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Reset when order changes
  useEffect(() => {
    setSections({ ...savedSections });
    setSpecialAnswers(savedSpecial.map(qa => ({ ...qa })));
    setExpandedSection(allSectionKeys[0] || null);
    setTab('edit');
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
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `horoscope-${order.order_id}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Failed to download');
    } finally {
      setDownloading(false);
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

      // Dynamically import docx-preview to avoid SSR issues
      const { renderAsync } = await import('docx-preview');
      previewRef.current.innerHTML = '';
      await renderAsync(blob, previewRef.current, null, {
        className: 'docx-preview',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        useBase64URL: true,
      });
    } catch (e) {
      toast.error('Failed to load preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  // Auto-load preview when switching to preview tab
  useEffect(() => {
    if (tab === 'preview' && order?.horoscope_data) {
      handlePreviewLoad();
    }
  }, [tab]);

  const tabBtnCls = (active) =>
    `px-4 py-2 text-sm font-medium border-b-2 cursor-pointer bg-transparent transition-colors ${
      active ? 'border-violet-600 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-700'
    }`;

  const textareaStyle = {
    width: '100%',
    padding: '8px 10px',
    fontSize: '13px',
    fontFamily: 'monospace',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    outline: 'none',
    background: '#ffffff',
    color: '#1e293b',
    resize: 'vertical',
    minHeight: '120px',
    lineHeight: 1.6,
  };

  return (
    <Drawer open={open} onClose={onClose} title={`Horoscope Editor — #${order?.order_id}`} width="800px">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, paddingLeft: 8 }}>
          <button className={tabBtnCls(tab === 'edit')}    onClick={() => setTab('edit')}>✏ Edit Sections</button>
          <button className={tabBtnCls(tab === 'preview')} onClick={() => setTab('preview')}>👁 Preview Word File</button>
        </div>

        {/* Edit tab */}
        {tab === 'edit' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allSectionKeys.map((sec) => (
              <div key={sec} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <button
                  onClick={() => setExpandedSection(expandedSection === sec ? null : sec)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 14px',
                    background: expandedSection === sec ? '#f1f5f9' : '#ffffff',
                    border: 0, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    color: '#1e293b', fontSize: 13, fontWeight: 500,
                  }}
                >
                  <span>{sec}</span>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>
                    {expandedSection === sec ? '▲' : '▼'}
                    {sections[sec] ? ` · ${sections[sec].length} chars` : ' · empty'}
                  </span>
                </button>
                {expandedSection === sec && (
                  <div style={{ padding: '10px 12px', background: '#f8fafc' }}>
                    <textarea
                      style={textareaStyle}
                      value={sections[sec] || ''}
                      onChange={e => setSections(prev => ({ ...prev, [sec]: e.target.value }))}
                      rows={12}
                      placeholder={`Enter content for "${sec}"…`}
                    />
                  </div>
                )}
              </div>
            ))}

            {/* Special answers */}
            {specialAnswers.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
                  විශේෂ ප්‍රශ්න
                </div>
                {specialAnswers.map((qa, i) => (
                  <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ padding: '10px 14px', background: '#f1f5f9', fontSize: 12, fontWeight: 500, color: '#1e293b' }}>
                      {i + 1}. {qa.question}
                    </div>
                    <div style={{ padding: '10px 12px', background: '#f8fafc' }}>
                      <textarea
                        style={textareaStyle}
                        value={qa.answer || ''}
                        onChange={e => {
                          const updated = [...specialAnswers];
                          updated[i] = { ...updated[i], answer: e.target.value };
                          setSpecialAnswers(updated);
                        }}
                        rows={8}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Preview tab */}
        {tab === 'preview' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={handlePreviewLoad}
                disabled={loadingPreview}
                style={{
                  padding: '6px 16px', fontSize: 13, background: 'var(--accent)', color: '#fff',
                  border: 0, borderRadius: 8, cursor: 'pointer', opacity: loadingPreview ? 0.6 : 1,
                }}
              >
                {loadingPreview ? 'Loading…' : '🔄 Refresh Preview'}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-3)', alignSelf: 'center' }}>
                Save your changes first before refreshing the preview.
              </span>
            </div>
            {loadingPreview && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                <span className="w-6 h-6 border-2 border-violet-400/30 border-t-violet-500 rounded-full animate-spin inline-block" />
                <div style={{ marginTop: 8, fontSize: 13 }}>Rendering document…</div>
              </div>
            )}
            <div
              ref={previewRef}
              style={{
                background: '#fff',
                border: '1px solid var(--border)',
                borderRadius: 8,
                minHeight: 400,
                overflow: 'auto',
              }}
            />
          </div>
        )}

        {/* Footer actions */}
        <div style={{
          flexShrink: 0, padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
          background: 'var(--bg-surface)',
        }}>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              padding: '8px 18px', fontSize: 13, background: 'var(--bg-card)',
              color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 8,
              cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.6 : 1,
            }}
          >
            {downloading ? 'Downloading…' : '⬇ Download Word'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 18px', fontSize: 13, fontWeight: 500,
              background: saving ? '#7c3aed' : 'var(--accent)', color: '#fff',
              border: 0, borderRadius: 8, cursor: 'pointer', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
