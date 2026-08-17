import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

const ACCENT = '#0d9488';

/**
 * Editor for the couple match-making (ගැළපීම) report.
 * Same shape as MarriageEditorDrawer — section tabs, per-section regenerate, Word/PDF
 * download — plus the couple's custom Q&A, and without the WhatsApp message tab (this
 * report has no WA summary).
 */
export default function MatchEditorDrawer({ order, clientId, open, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const previewRef = useRef(null);

  const hd = (() => {
    if (!order?.horoscope_data) return {};
    if (typeof order.horoscope_data === 'object') return order.horoscope_data;
    try { return JSON.parse(order.horoscope_data); } catch { return {}; }
  })();

  const [outerTab, setOuterTab]   = useState('edit');
  const [activeTab, setActiveTab] = useState(null);
  const [sections, setSections]   = useState([]);
  const [answers, setAnswers]     = useState([]);
  const [saving, setSaving]                           = useState(false);
  const [regenerating, setRegenerating]               = useState(false);
  const [regeneratingSection, setRegeneratingSection] = useState(null);
  const [downloading, setDownloading]                 = useState(false);
  const [downloadingPdf, setDownloadingPdf]           = useState(false);
  const [downloadingPorondam, setDownloadingPorondam] = useState(false);
  const [loadingPreview, setLoadingPreview]           = useState(false);

  const params = clientId ? `?client_id=${clientId}` : '';

  // Order saved sections by the plugin config order (config may have been reordered since generation)
  function applyConfigOrder(savedData, configOrder) {
    if (!Array.isArray(savedData) || savedData.length === 0) return [];
    if (!Array.isArray(configOrder) || configOrder.length === 0) return savedData.map(s => ({ ...s }));
    const byLabel  = Object.fromEntries(savedData.map(s => [s.label, s]));
    const sorted   = configOrder.map(o => byLabel[o.label]).filter(Boolean);
    const inConfig = new Set(configOrder.map(o => o.label));
    savedData.filter(s => !inConfig.has(s.label)).forEach(s => sorted.push(s));
    return sorted.map(s => ({ ...s }));
  }

  const loadSections = () => {
    const fresh = Array.isArray(hd.match_sections_data) ? hd.match_sections_data : [];
    setAnswers(Array.isArray(hd.match_special_answers) ? hd.match_special_answers.map(a => ({ ...a })) : []);
    api.get(`/plugins/horoscope_reading/config${params}`)
      .then(r => {
        const configOrder = Array.isArray(r.data?.match_sections) ? r.data.match_sections : [];
        const ordered = applyConfigOrder(fresh, configOrder);
        setSections(ordered);
        setActiveTab(ordered.length > 0 ? 'ms-0' : null);
      })
      .catch(() => {
        setSections(fresh.map(s => ({ ...s })));
        setActiveTab(fresh.length > 0 ? 'ms-0' : null);
      });
  };

  useEffect(() => {
    if (!open) return;
    setOuterTab('edit');
    setRegenerating(!!hd.match_generating);
    loadSections();
  }, [open, order?.order_id]);

  // When polling clears match_generating, reload the freshly written sections
  useEffect(() => {
    if (!open || hd.match_generating || !regenerating) return;
    setRegenerating(false);
    loadSections();
  }, [hd.match_generating, open]);

  const tabs = sections.map((sec, i) => ({
    id:    `ms-${i}`,
    label: `${i + 1}`,
    title: sec.label || `Section ${i + 1}`,
    index: i,
  }));
  const activeTabData = tabs.find(t => t.id === activeTab);

  const boyName  = hd.match_boy?.name  || 'පිරිමි';
  const girlName = hd.match_girl?.name || 'ගැහැනු';

  const handleRegenerateAll = async () => {
    setRegenerating(true);
    try {
      await api.post(`/plugins/horoscope/generate-match/${order.order_id}${params}`);
      toast.success('Regenerating match making report… takes ~3 min. Reopen this drawer when done.');
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
      const res = await api.post(`/plugins/horoscope/regenerate-match-section/${order.order_id}${params}`, { label });
      const content = res.data.content || '';
      setSections(prev => prev.map(s => (s.label === label ? { ...s, content } : s)));
      toast.success(`"${label}" regenerated`);
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to regenerate section');
    } finally {
      setRegeneratingSection(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/plugins/horoscope/match-sections/${order.order_id}${params}`, {
        match_sections_data:   sections,
        match_special_answers: answers,
      });
      toast.success('Match making sections saved');
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Stream a generated document down as a file.
   *
   * @param {'pdf'|'docx'} kind
   * @param {'match'|'porondam'} report - `porondam` is the deterministic
   *   20-Porondam table, which needs no generated sections (see below).
   */
  const download = async (kind, report = 'match') => {
    const isPdf = kind === 'pdf';
    const setBusy = report === 'porondam'
      ? setDownloadingPorondam
      : (isPdf ? setDownloadingPdf : setDownloading);
    setBusy(true);
    try {
      const token = localStorage.getItem('crm_token');
      const url = `/api/plugins/horoscope/download-${report}-${isPdf ? 'pdf' : 'docx'}/${order.order_id}${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Server error ${res.status}`);
      }
      const blob = await res.blob();
      const cd    = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `${report}-${order.order_id}.${isPdf ? 'pdf' : 'docx'}`;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl; a.download = filename; a.click();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      toast.error(e?.message || 'Download failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewLoad = async () => {
    if (!previewRef.current) return;
    setLoadingPreview(true);
    try {
      const token = localStorage.getItem('crm_token');
      const res = await fetch(`/api/plugins/horoscope/download-match-docx/${order.order_id}${params}`, {
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
    if (outerTab === 'preview' && open && sections.length > 0) handlePreviewLoad();
  }, [outerTab]);

  const outerTabCls = (active) => ({
    padding: '8px 16px', fontSize: 13, fontWeight: active ? 600 : 400,
    borderBottomStyle: 'solid', borderBottomWidth: 2,
    borderBottomColor: active ? ACCENT : 'transparent',
    color: active ? ACCENT : '#64748b',
    cursor: 'pointer', background: 'none', border: 'none', userSelect: 'none', margin: 0,
  });

  const tabCls = (active) => ({
    padding: '6px 10px', fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? ACCENT : '#f1f5f9',
    color: active ? '#ffffff' : '#475569',
    borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
    border: 'none', userSelect: 'none', flexShrink: 0,
  });

  return (
    <Drawer open={open} onClose={onClose} title={`💑 Match Making: #${order?.order_id}`} width="800px">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

        {/* Couple header */}
        <div style={{ flexShrink: 0, padding: '8px 16px', background: '#f0fdfa', borderBottom: '1px solid #99f6e4', fontSize: 13, color: '#0f766e', fontWeight: 600 }}>
          👦 {boyName}  ⚭  👧 {girlName}
        </div>

        {/* Outer tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', flexShrink: 0, paddingLeft: 8 }}>
          <p style={outerTabCls(outerTab === 'edit')}    onClick={() => setOuterTab('edit')}>✏ Edit Sections</p>
          <p style={outerTabCls(outerTab === 'preview')} onClick={() => setOuterTab('preview')}>👁 Preview Word File</p>
        </div>

        {/* ── Edit tab ── */}
        {outerTab === 'edit' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid #e2e8f0', overflowX: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {tabs.map(t => (
                <button key={t.id} style={tabCls(activeTab === t.id)} onClick={() => setActiveTab(t.id)} title={t.title}>
                  {t.label}
                </button>
              ))}
              {answers.length > 0 && (
                <button
                  style={tabCls(activeTab === 'qa')}
                  onClick={() => setActiveTab('qa')}
                  title="The couple's own questions"
                >
                  ❓ {answers.length}
                </button>
              )}
              {tabs.length === 0 && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  {regenerating ? 'Generating…' : 'No match making sections generated yet.'}
                </span>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {activeTab === 'qa' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {answers.map((qa, i) => (
                    <div key={i}>
                      <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: ACCENT }}>
                        {i + 1}. {qa.question}
                      </p>
                      <textarea
                        style={{ width: '100%', padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#1e293b', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                        value={qa.answer || ''}
                        onChange={e => setAnswers(prev => prev.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
                        rows={12}
                      />
                    </div>
                  ))}
                </div>
              ) : activeTabData ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: ACCENT }}>{activeTabData.title}</p>
                    <button
                      onClick={() => handleRegenerateSection(activeTabData.title)}
                      disabled={!!regeneratingSection}
                      style={{ padding: '4px 12px', fontSize: 12, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 6, cursor: regeneratingSection ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {regeneratingSection === activeTabData.title ? '⏳ Generating…' : '↺ Regenerate'}
                    </button>
                  </div>
                  {regeneratingSection === activeTabData.title ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 320, gap: 14 }}>
                      <span className="w-8 h-8 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin block" />
                      <span style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>Generating "{activeTabData.title}"…</span>
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
                  {regenerating
                    ? 'Generating the match making report… reopen this drawer in a couple of minutes.'
                    : 'No sections yet. Configure Match Making Sections on the Plugins page, then generate.'}
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
                style={{ padding: '6px 16px', fontSize: 13, background: ACCENT, color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', opacity: loadingPreview ? 0.6 : 1 }}
              >
                {loadingPreview ? 'Loading…' : '🔄 Refresh Preview'}
              </button>
              <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>
                Save changes first, then refresh preview.
              </span>
            </div>
            {loadingPreview && (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                <span className="w-6 h-6 border-2 border-teal-400/30 border-t-teal-500 rounded-full animate-spin inline-block" />
                <div style={{ marginTop: 8, fontSize: 13 }}>Rendering document…</div>
              </div>
            )}
            <div ref={previewRef} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, minHeight: 400, overflow: 'auto' }} />
          </div>
        )}

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', background: '#f8fafc', flexWrap: 'wrap' }}>
          <button
            onClick={handleRegenerateAll}
            disabled={regenerating}
            style={{ marginRight: 'auto', padding: '8px 14px', fontSize: 13, fontWeight: 600, background: regenerating ? '#e2e8f0' : '#0f766e', color: regenerating ? '#94a3b8' : '#fff', border: 0, borderRadius: 8, cursor: regenerating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
          >
            {regenerating ? '⏳ Generating…' : '↺ Regenerate All'}
          </button>
          {/* 20-Porondam table. Deliberately NOT gated on sections.length —
              it is computed from both people's saved charts, so it is ready
              as soon as the couple's birth details exist, with no AI
              generation step needed. */}
          <button
            onClick={() => download('pdf', 'porondam')}
            disabled={downloadingPorondam}
            title="විසි පොරොන්දම් — needs only both birth charts, no generated sections"
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: '#7c3aed', color: '#ffffff', border: 0, borderRadius: 8, cursor: downloadingPorondam ? 'not-allowed' : 'pointer', opacity: downloadingPorondam ? 0.6 : 1 }}
          >
            {downloadingPorondam ? 'Preparing…' : '⬇ Porondam 20 PDF'}
          </button>
          <button
            onClick={() => download('docx')}
            disabled={downloading || sections.length === 0}
            style={{ padding: '8px 18px', fontSize: 13, background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8, cursor: (downloading || sections.length === 0) ? 'not-allowed' : 'pointer', opacity: (downloading || sections.length === 0) ? 0.6 : 1 }}
          >
            {downloading ? 'Downloading…' : '⬇ Download Word'}
          </button>
          <button
            onClick={() => download('pdf')}
            disabled={downloadingPdf || sections.length === 0}
            style={{ padding: '8px 18px', fontSize: 13, background: '#dc2626', color: '#ffffff', border: 0, borderRadius: 8, cursor: (downloadingPdf || sections.length === 0) ? 'not-allowed' : 'pointer', opacity: (downloadingPdf || sections.length === 0) ? 0.6 : 1 }}
          >
            {downloadingPdf ? 'Preparing…' : '⬇ Download PDF'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || sections.length === 0}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: ACCENT, color: '#fff', border: 0, borderRadius: 8, cursor: (saving || sections.length === 0) ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
