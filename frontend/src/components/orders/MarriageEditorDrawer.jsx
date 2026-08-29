import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

export default function MarriageEditorDrawer({ order, clientId, open, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const previewRef = useRef(null);

  const hd = (() => {
    if (!order?.horoscope_data) return {};
    if (typeof order.horoscope_data === 'object') return order.horoscope_data;
    try { return JSON.parse(order.horoscope_data); } catch { return {}; }
  })();

  const cf = (() => {
    if (!order?.custom_fields) return {};
    if (typeof order.custom_fields === 'object') return order.custom_fields;
    try { return JSON.parse(order.custom_fields); } catch { return {}; }
  })();
  const hasChart = !!hd.chart_data;

  const [showOrderDetails, setShowOrderDetails] = useState(true);
  const [showChartData, setShowChartData]       = useState(false);
  const [outerTab, setOuterTab]   = useState('edit');
  const [activeTab, setActiveTab] = useState(null);
  const [sections, setSections]   = useState([]);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers]     = useState([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [expandedQIdx, setExpandedQIdx] = useState(null);
  const [savingQuestions, setSavingQuestions] = useState(false);
  const [aiFilling, setAiFilling] = useState(false);
  const [waMessage, setWaMessage] = useState('');
  const [savedWa, setSavedWa]     = useState('');
  const [saving, setSaving]                           = useState(false);
  const [regenerating, setRegenerating]               = useState(false);
  const [regeneratingSection, setRegeneratingSection] = useState(null);
  const [generatingWa, setGeneratingWa]               = useState(false);
  const [savingWa, setSavingWa]                       = useState(false);
  const [downloading, setDownloading]                 = useState(false);
  const [downloadingPdf, setDownloadingPdf]           = useState(false);
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
    const fresh = Array.isArray(hd.marriage_sections_data) ? hd.marriage_sections_data : [];
    api.get(`/plugins/horoscope_reading/config${params}`)
      .then(r => {
        const configOrder = Array.isArray(r.data?.marriage_sections) ? r.data.marriage_sections : [];
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
    setRegenerating(!!hd.marriage_generating);
    setWaMessage(hd.marriage_wa_message || '');
    setSavedWa(hd.marriage_wa_message || '');
    setQuestions(Array.isArray(hd.marriage_special_questions) ? hd.marriage_special_questions.map(q => ({ ...q })) : []);
    setAnswers(Array.isArray(hd.marriage_special_answers) ? hd.marriage_special_answers.map(a => ({ ...a })) : []);
    loadSections();
  }, [open, order?.order_id]);

  // When polling clears marriage_generating, reload the freshly written sections
  useEffect(() => {
    if (!open || hd.marriage_generating || !regenerating) return;
    setRegenerating(false);
    setWaMessage(hd.marriage_wa_message || '');
    setSavedWa(hd.marriage_wa_message || '');
    setAnswers(Array.isArray(hd.marriage_special_answers) ? hd.marriage_special_answers.map(a => ({ ...a })) : []);
    loadSections();
  }, [hd.marriage_generating, open]);

  const tabs = sections.map((sec, i) => ({
    id:    `ms-${i}`,
    label: `${i + 1}`,
    title: sec.label || `Section ${i + 1}`,
    index: i,
  }));
  const activeTabData = tabs.find(t => t.id === activeTab);
  const waDirty = waMessage !== savedWa;

  const handleRegenerateAll = async () => {
    setRegenerating(true);
    try {
      await api.post(`/plugins/horoscope/generate-marriage/${order.order_id}${params}`);
      toast.success('Regenerating marriage reading… takes ~2 min. Reopen this drawer when done.');
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
      const res = await api.post(`/plugins/horoscope/regenerate-marriage-section/${order.order_id}${params}`, { label });
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
      await api.patch(`/plugins/horoscope/marriage-sections/${order.order_id}${params}`, {
        marriage_sections_data: sections,
      });
      toast.success('Marriage sections saved');
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveQuestions = async () => {
    setSavingQuestions(true);
    try {
      await api.patch(`/plugins/horoscope/marriage-sections/${order.order_id}${params}`, {
        marriage_sections_data: sections,
        marriage_special_questions: questions.filter(q => (q.question || '').trim()),
        marriage_special_answers: answers,
      });
      toast.success('Saved. Use "Regenerate All" to answer newly added questions.');
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSavingQuestions(false);
    }
  };

  const handleAiFill = async () => {
    setAiFilling(true);
    try {
      const res = await api.post(`/plugins/horoscope/ai-prepare-marriage/${order.order_id}${params}`);
      const found = Array.isArray(res.data?.special_questions) ? res.data.special_questions : [];
      if (found.length === 0) {
        toast.info('No marriage-specific questions found in the chat.');
        return;
      }
      setQuestions(prev => {
        const seen = new Set(prev.map(q => (q.question || '').trim().toLowerCase()));
        const additions = found
          .filter(q => (q.question || '').trim() && !seen.has(q.question.trim().toLowerCase()))
          .map(q => ({ question: q.question.trim(), prompt: (q.prompt || '').trim() }));
        return [...prev, ...additions];
      });
      toast.success(`AI added ${found.length} question${found.length === 1 ? '' : 's'} — review, then Save.`);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'AI Fill failed');
    } finally {
      setAiFilling(false);
    }
  };

  const handleGenerateWa = async () => {
    setGeneratingWa(true);
    try {
      const res = await api.post(`/plugins/horoscope/generate-marriage-wa/${order.order_id}${params}`);
      const msg = res.data.wa_message || '';
      setWaMessage(msg);
      setSavedWa(msg);
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('WhatsApp message generated');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to generate message');
    } finally {
      setGeneratingWa(false);
    }
  };

  const handleSaveWa = async () => {
    setSavingWa(true);
    try {
      await api.patch(`/plugins/horoscope/marriage-wa/${order.order_id}${params}`, { wa_message: waMessage });
      setSavedWa(waMessage);
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Message saved');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSavingWa(false);
    }
  };

  const download = async (kind) => {
    const isPdf = kind === 'pdf';
    const setBusy = isPdf ? setDownloadingPdf : setDownloading;
    setBusy(true);
    try {
      const token = localStorage.getItem('crm_token');
      const url = isPdf
        ? `/api/plugins/horoscope/download-marriage-pdf/${order.order_id}${params}`
        : `/api/plugins/horoscope/download-marriage-docx/${order.order_id}${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Server error ${res.status}`);
      }
      const blob = await res.blob();
      const cd    = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `marriage-${order.order_id}.${isPdf ? 'pdf' : 'docx'}`;
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
      const res = await fetch(`/api/plugins/horoscope/download-marriage-docx/${order.order_id}${params}`, {
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
    borderBottomColor: active ? '#db2777' : 'transparent',
    color: active ? '#db2777' : '#64748b',
    cursor: 'pointer', background: 'none', border: 'none', userSelect: 'none', margin: 0,
  });

  const tabCls = (active) => ({
    padding: '6px 10px', fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? '#db2777' : '#f1f5f9',
    color: active ? '#ffffff' : '#475569',
    borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
    border: 'none', userSelect: 'none', flexShrink: 0,
  });

  return (
    <Drawer open={open} onClose={onClose} title={`💍 Marriage Reading: #${order?.order_id}`} width="800px">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

        {/* Customer details — same panel as the horoscope generate modal */}
        {Object.keys(cf).length > 0 && (
          <div className="border-b border-slate-100 shrink-0">
            <button
              type="button"
              onClick={() => setShowOrderDetails(v => !v)}
              className="w-full flex items-center justify-between px-5 py-2.5 bg-violet-50 text-xs font-semibold text-violet-700 hover:bg-violet-100 border-0 cursor-pointer"
            >
              <span>📋 Customer Order Details</span>
              <span className="text-violet-400 text-base leading-none">{showOrderDetails ? '▲' : '▼'}</span>
            </button>
            {showOrderDetails && (
              <div className="px-5 py-3 flex flex-col gap-2 bg-slate-50 max-h-48 overflow-y-auto">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {Object.entries(cf).map(([k, v]) => {
                    if (!v || typeof v === 'object') return null;
                    return (
                      <div key={k} className="flex flex-col text-xs">
                        <span className="text-slate-400 capitalize mb-0.5">{k.replace(/_/g, ' ')}</span>
                        <span className="text-slate-700 break-all">{String(v)}</span>
                      </div>
                    );
                  })}
                </div>
                {order?.ai_summary && (
                  <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap mt-1">
                    <span className="text-violet-600 font-semibold block mb-1">✨ Summary</span>
                    {order.ai_summary}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chart data panel — same as the horoscope generate modal */}
        {hasChart && (
          <div className="border-b border-slate-100 shrink-0">
            <button
              type="button"
              onClick={() => setShowChartData(v => !v)}
              className="w-full flex items-center justify-between px-5 py-2.5 bg-emerald-50 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 border-0 cursor-pointer"
            >
              <span>📊 Saved Chart Data (freeastroapi)</span>
              <span className="text-emerald-400 text-base leading-none">{showChartData ? '▲' : '▼'}</span>
            </button>
            {showChartData && (
              <pre className="px-5 py-3 bg-slate-950 text-emerald-300 text-xs overflow-auto max-h-72 leading-relaxed font-mono whitespace-pre-wrap">
                {JSON.stringify(hd.chart_data, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Outer tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', flexShrink: 0, paddingLeft: 8 }}>
          <p style={outerTabCls(outerTab === 'edit')}    onClick={() => setOuterTab('edit')}>✏ Edit Sections</p>
          <p style={outerTabCls(outerTab === 'questions')} onClick={() => setOuterTab('questions')}>❓ Special Questions{questions.length ? ` (${questions.length})` : ''}</p>
          <p style={outerTabCls(outerTab === 'wa')}      onClick={() => setOuterTab('wa')}>💬 WhatsApp Message</p>
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
              {tabs.length === 0 && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  {regenerating ? 'Generating…' : 'No marriage sections generated yet.'}
                </span>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {activeTabData ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#db2777' }}>{activeTabData.title}</p>
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
                      <span className="w-8 h-8 border-2 border-pink-200 border-t-pink-600 rounded-full animate-spin block" />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#db2777' }}>Generating "{activeTabData.title}"…</span>
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
                    ? 'Generating the marriage reading… reopen this drawer in a couple of minutes.'
                    : 'No sections yet. Configure Marriage Sections on the Plugins page, then generate.'}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Special Questions tab ── */}
        {outerTab === 'questions' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#db2777' }}>
                Customer&apos;s own questions ({questions.length})
              </p>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8' }}>
                Each is answered individually after the main sections. Add or edit here, then use
                &nbsp;<b>Regenerate All</b>&nbsp;to produce the answers.
              </p>

              <button
                onClick={handleAiFill}
                disabled={aiFilling}
                style={{ marginBottom: 10, padding: '6px 14px', fontSize: 13, fontWeight: 600, background: '#faf5ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 8, cursor: aiFilling ? 'not-allowed' : 'pointer', opacity: aiFilling ? 0.6 : 1 }}
              >
                {aiFilling ? '⏳ Reading chat…' : '✨ AI Fill from chat'}
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {questions.map((q, i) => (
                  <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', background: '#f8fafc' }}>
                      <span style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>{i + 1}.</span>
                      <input
                        style={{ flex: 1, padding: '6px 8px', fontSize: 13, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, outline: 'none' }}
                        value={q.question || ''}
                        placeholder="Question (shown in the report)"
                        onChange={e => setQuestions(qs => qs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                      />
                      <button
                        type="button"
                        onClick={() => setExpandedQIdx(expandedQIdx === i ? null : i)}
                        title="Edit the detailed AI-only instruction"
                        style={{ padding: '4px 8px', fontSize: 12, color: '#db2777', background: '#fff', border: '1px solid #f9a8d4', borderRadius: 6, cursor: 'pointer' }}
                      >
                        {expandedQIdx === i ? '▲' : '✎ prompt'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuestions(qs => qs.filter((_, j) => j !== i))}
                        style={{ padding: '4px 8px', fontSize: 12, color: '#ef4444', background: '#fff', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer' }}
                      >×</button>
                    </div>
                    {expandedQIdx === i && (
                      <textarea
                        rows={4}
                        value={q.prompt || ''}
                        placeholder="Detailed instruction for the AI (the customer never sees this). Leave blank to use the question as-is."
                        onChange={e => setQuestions(qs => qs.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))}
                        style={{ width: '100%', padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', border: 0, borderTop: '1px solid #e2e8f0', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input
                  style={{ flex: 1, padding: '8px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                  value={newQuestion}
                  onChange={e => setNewQuestion(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newQuestion.trim()) {
                      e.preventDefault();
                      setQuestions(qs => [...qs, { question: newQuestion.trim(), prompt: '' }]);
                      setNewQuestion('');
                    }
                  }}
                  placeholder="Add a question the customer asked…"
                />
                <button
                  type="button"
                  disabled={!newQuestion.trim()}
                  onClick={() => { setQuestions(qs => [...qs, { question: newQuestion.trim(), prompt: '' }]); setNewQuestion(''); }}
                  style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#be185d', background: '#fce7f3', border: 0, borderRadius: 8, cursor: newQuestion.trim() ? 'pointer' : 'not-allowed', opacity: newQuestion.trim() ? 1 : 0.5 }}
                >+ Add</button>
              </div>

              <button
                onClick={handleSaveQuestions}
                disabled={savingQuestions || sections.length === 0}
                style={{ marginTop: 12, padding: '8px 18px', fontSize: 13, fontWeight: 600, background: '#db2777', color: '#fff', border: 0, borderRadius: 8, cursor: (savingQuestions || sections.length === 0) ? 'not-allowed' : 'pointer', opacity: (savingQuestions || sections.length === 0) ? 0.6 : 1 }}
              >
                {savingQuestions ? 'Saving…' : '💾 Save Questions'}
              </button>
            </div>

            {answers.length > 0 && (
              <div>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#db2777' }}>Answers</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {answers.map((qa, i) => (
                    <div key={i}>
                      <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: '#db2777' }}>{i + 1}. {qa.question}</p>
                      {qa.error && !(qa.answer || '').trim() && (
                        <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 8px' }}>
                          ⚠ Not answered — {qa.error}
                        </p>
                      )}
                      <textarea
                        style={{ width: '100%', padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#fff', color: '#1e293b', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                        value={qa.answer || ''}
                        onChange={e => setAnswers(prev => prev.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
                        rows={12}
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleSaveQuestions}
                  disabled={savingQuestions}
                  style={{ marginTop: 12, padding: '8px 18px', fontSize: 13, fontWeight: 600, background: '#db2777', color: '#fff', border: 0, borderRadius: 8, cursor: savingQuestions ? 'not-allowed' : 'pointer', opacity: savingQuestions ? 0.6 : 1 }}
                >
                  {savingQuestions ? 'Saving…' : '💾 Save Answers'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── WhatsApp tab ── */}
        {outerTab === 'wa' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
              <button
                onClick={handleGenerateWa}
                disabled={generatingWa || sections.length === 0}
                style={{ padding: '6px 16px', fontSize: 13, fontWeight: 600, background: '#25D366', color: '#fff', border: 0, borderRadius: 8, cursor: (generatingWa || sections.length === 0) ? 'not-allowed' : 'pointer', opacity: (generatingWa || sections.length === 0) ? 0.6 : 1 }}
              >
                {generatingWa ? 'Generating…' : (waMessage ? '↺ Regenerate' : '✦ Generate')}
              </button>
              {waMessage && (
                <button
                  onClick={() => navigator.clipboard.writeText(waMessage).then(() => toast.success('Copied to clipboard'))}
                  style={{ padding: '6px 16px', fontSize: 13, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' }}
                >📋 Copy</button>
              )}
              {waDirty && (
                <button
                  onClick={handleSaveWa}
                  disabled={savingWa}
                  style={{ padding: '6px 16px', fontSize: 13, fontWeight: 600, background: '#f59e0b', color: '#fff', border: 0, borderRadius: 8, cursor: savingWa ? 'not-allowed' : 'pointer', opacity: savingWa ? 0.7 : 1 }}
                >{savingWa ? 'Saving…' : '💾 Save'}</button>
              )}
            </div>
            {generatingWa ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '40px 0' }}>
                <span className="w-8 h-8 border-2 border-green-200 border-t-green-600 rounded-full animate-spin block" />
                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>Generating message…</span>
              </div>
            ) : (
              <textarea
                value={waMessage}
                onChange={e => setWaMessage(e.target.value)}
                rows={16}
                placeholder="No message yet. Click Generate above (needs a Marriage WhatsApp Prompt in the Plugins page)."
                style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: `1px solid ${waDirty ? '#f59e0b' : '#cbd5e1'}`, borderRadius: 8, outline: 'none', resize: 'vertical', lineHeight: 1.6, color: '#1e293b', boxSizing: 'border-box' }}
              />
            )}
          </div>
        )}

        {/* ── Preview tab ── */}
        {outerTab === 'preview' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={handlePreviewLoad}
                disabled={loadingPreview}
                style={{ padding: '6px 16px', fontSize: 13, background: '#db2777', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', opacity: loadingPreview ? 0.6 : 1 }}
              >
                {loadingPreview ? 'Loading…' : '🔄 Refresh Preview'}
              </button>
              <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>
                Save changes first, then refresh preview.
              </span>
            </div>
            {loadingPreview && (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                <span className="w-6 h-6 border-2 border-pink-400/30 border-t-pink-500 rounded-full animate-spin inline-block" />
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
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: '#db2777', color: '#fff', border: 0, borderRadius: 8, cursor: (saving || sections.length === 0) ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
