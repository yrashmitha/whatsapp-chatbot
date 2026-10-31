import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';
import DeleteReportButton from './DeleteReportButton';
import DeliveryPanel from './DeliveryPanel';
import { SECTION_KINDS, hdKey, parseJsonField } from './sectionReports';

const textareaCls = 'w-full px-3 py-2.5 text-base md:text-sm border border-slate-300 rounded-lg outline-none bg-white text-slate-800 resize-y leading-relaxed';
const btnBase = 'min-h-[44px] md:min-h-0 px-4 py-2 text-sm rounded-lg cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap';

/** Words in the text as the editor shows it, counted the way the generator counts them. */
const countWords = (t) => String(t || '').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * What the automatic review found for the section on screen: its length against
 * the target, and any problem still open. The word count follows the text as it
 * is edited, so a fix by hand is seen at once. Renders nothing for a report made
 * without a spec.
 */
function SectionReviewNote({ review, label, content, accent }) {
  const info = review && review.sections && review.sections[label];
  if (!info) return null;
  const words = countWords(content);
  const over = info.max && words > info.max * 1.15;
  const under = info.target && words < info.target * 0.5;
  const open = Array.isArray(info.issues) ? info.issues : [];
  return (
    <div className="mb-3 text-xs">
      <p className="m-0 text-slate-500">
        <span className={over || under ? 'text-amber-700 font-semibold' : ''}>{words} words</span>
        {info.target ? `, target ${info.target}` : ''}{info.max ? `, limit ${info.max}` : ''}
        {review.rounds ? `. Review: ${review.found} found, ${review.fixed} fixed in ${review.rounds} round${review.rounds === 1 ? '' : 's'}.` : '. Review found nothing to fix.'}
      </p>
      {open.length > 0 && (
        <ul className="mt-1.5 mb-0 pl-4 text-amber-800">
          {open.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
      {review.review_error && <p className="m-0 mt-1 text-slate-400">The AI review did not run ({review.review_error}); only the automatic checks were applied.</p>}
    </div>
  );
}

/**
 * Editor for a generated section report (abroad, pregnancy): edit each section,
 * the customer's questions and answers, the WhatsApp message, preview and
 * download the document. Same tabs as the marriage editor, built phone first:
 * scrolling tab strips, 44px targets, and a footer that wraps into a grid.
 *
 * @param {object}  props
 * @param {string}  props.kind     key in SECTION_KINDS, or null while closed
 * @param {object}  props.order    the live order row (so polling refreshes it)
 * @param {string}  props.clientId
 * @param {boolean} props.open
 * @param {Function} props.onClose
 */
export default function SectionReportEditorDrawer({ kind, order, clientId, open, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const previewRef = useRef(null);
  const meta = SECTION_KINDS[kind] || SECTION_KINDS.abroad;

  const hd = parseJsonField(order?.horoscope_data);
  const cf = parseJsonField(order?.custom_fields);
  const hasChart = !!hd.chart_data;

  const k = (name) => hdKey(kind || 'abroad', name);
  const base   = `/plugins/section-report/${kind}`;
  const params = clientId ? `?client_id=${clientId}` : '';

  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [showChartData, setShowChartData]       = useState(false);
  const [outerTab, setOuterTab]   = useState('edit');
  const [activeIdx, setActiveIdx] = useState(0);
  const [sections, setSections]   = useState([]);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers]     = useState([]);
  const [newQuestion, setNewQuestion]   = useState('');
  const [expandedQIdx, setExpandedQIdx] = useState(null);
  const [waMessage, setWaMessage] = useState('');
  const [savedWa, setSavedWa]     = useState('');
  const [busy, setBusy] = useState({});
  const [regeneratingSection, setRegeneratingSection] = useState(null);
  const [regenerating, setRegenerating] = useState(false);

  const setFlag = (name, v) => setBusy(b => ({ ...b, [name]: v }));
  const waDirty = waMessage !== savedWa;
  const generating = !!hd[k('generating')];

  // Saved sections follow the order the client has configured now, which may
  // have changed since the report was generated.
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
    const fresh = Array.isArray(hd[k('sections_data')]) ? hd[k('sections_data')] : [];
    api.get(`/plugins/horoscope_reading/config${params}`)
      .then(r => {
        const configOrder = Array.isArray(r.data?.[k('sections')]) ? r.data[k('sections')] : [];
        setSections(applyConfigOrder(fresh, configOrder));
      })
      .catch(() => setSections(fresh.map(s => ({ ...s }))));
    setActiveIdx(0);
  };

  useEffect(() => {
    if (!open || !kind) return;
    setOuterTab('edit');
    setRegenerating(generating);
    setWaMessage(hd[k('wa_message')] || '');
    setSavedWa(hd[k('wa_message')] || '');
    setQuestions(Array.isArray(hd[k('special_questions')]) ? hd[k('special_questions')].map(q => ({ ...q })) : []);
    setAnswers(Array.isArray(hd[k('special_answers')]) ? hd[k('special_answers')].map(a => ({ ...a })) : []);
    loadSections();
  }, [open, kind, order?.order_id]);

  // When polling clears the generating flag, load what was just written.
  useEffect(() => {
    if (!open || generating || !regenerating) return;
    setRegenerating(false);
    setWaMessage(hd[k('wa_message')] || '');
    setSavedWa(hd[k('wa_message')] || '');
    setAnswers(Array.isArray(hd[k('special_answers')]) ? hd[k('special_answers')].map(a => ({ ...a })) : []);
    loadSections();
  }, [generating, open]);

  const refreshOrders = () => qc.invalidateQueries({ queryKey: ['orders'] });
  const active = sections[activeIdx];

  const handleRegenerateAll = async () => {
    setRegenerating(true);
    try {
      await api.post(`${base}/generate/${order.order_id}${params}`);
      toast.success(`Regenerating the ${meta.name.toLowerCase()} report. It takes about 2 minutes. Reopen this when it is done.`);
      refreshOrders();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to regenerate');
      setRegenerating(false);
    }
  };

  const handleRegenerateSection = async (label) => {
    setRegeneratingSection(label);
    try {
      const res = await api.post(`${base}/regenerate-section/${order.order_id}${params}`, { label });
      const content = res.data.content || '';
      setSections(prev => prev.map(s => (s.label === label ? { ...s, content } : s)));
      toast.success(`"${label}" regenerated`);
      refreshOrders();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to regenerate section');
    } finally {
      setRegeneratingSection(null);
    }
  };

  const save = async (flag, extra, okMsg, failMsg = 'Failed to save') => {
    setFlag(flag, true);
    try {
      await api.patch(`${base}/sections/${order.order_id}${params}`, { sections_data: sections, ...extra });
      toast.success(okMsg);
      refreshOrders();
    } catch (e) {
      toast.error(e?.response?.data?.error || failMsg);
    } finally {
      setFlag(flag, false);
    }
  };

  const handleSave = () => save('saving', {}, `${meta.name} sections saved`);
  const handleSaveQuestions = () => save('savingQuestions', {
    special_questions: questions.filter(q => (q.question || '').trim()),
    special_answers: answers,
  }, 'Saved. Use Regenerate All to answer newly added questions.');

  const handleAiFill = async () => {
    setFlag('aiFilling', true);
    try {
      const res = await api.post(`${base}/ai-prepare/${order.order_id}${params}`);
      const found = Array.isArray(res.data?.special_questions) ? res.data.special_questions : [];
      if (found.length === 0) {
        toast.info(`No ${meta.name.toLowerCase()} questions found in the chat.`);
        return;
      }
      setQuestions(prev => {
        const seen = new Set(prev.map(q => (q.question || '').trim().toLowerCase()));
        const additions = found
          .filter(q => (q.question || '').trim() && !seen.has(q.question.trim().toLowerCase()))
          .map(q => ({ question: q.question.trim(), prompt: (q.prompt || '').trim() }));
        return [...prev, ...additions];
      });
      toast.success(`AI added ${found.length} question${found.length === 1 ? '' : 's'}. Review, then Save.`);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'AI Fill failed');
    } finally {
      setFlag('aiFilling', false);
    }
  };

  const handleGenerateWa = async () => {
    setFlag('generatingWa', true);
    try {
      const res = await api.post(`${base}/generate-wa/${order.order_id}${params}`);
      const msg = res.data.wa_message || '';
      setWaMessage(msg);
      setSavedWa(msg);
      refreshOrders();
      toast.success('WhatsApp message generated');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to generate message');
    } finally {
      setFlag('generatingWa', false);
    }
  };

  const handleSaveWa = async () => {
    setFlag('savingWa', true);
    try {
      await api.patch(`${base}/wa/${order.order_id}${params}`, { wa_message: waMessage });
      setSavedWa(waMessage);
      refreshOrders();
      toast.success('Message saved');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally {
      setFlag('savingWa', false);
    }
  };

  const download = async (type) => {
    const isPdf = type === 'pdf';
    const flag = isPdf ? 'downloadingPdf' : 'downloading';
    setFlag(flag, true);
    try {
      const token = localStorage.getItem('crm_token');
      const res = await fetch(`/api${base}/download-${isPdf ? 'pdf' : 'docx'}/${order.order_id}${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Server error ${res.status}`);
      }
      const blob = await res.blob();
      const match = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = match ? match[1] : `${kind}-${order.order_id}.${isPdf ? 'pdf' : 'docx'}`;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      toast.error(e?.message || 'Download failed');
    } finally {
      setFlag(flag, false);
    }
  };

  const handlePreviewLoad = async () => {
    if (!previewRef.current) return;
    setFlag('loadingPreview', true);
    try {
      const token = localStorage.getItem('crm_token');
      const res = await fetch(`/api${base}/download-docx/${order.order_id}${params}`, {
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
      setFlag('loadingPreview', false);
    }
  };

  useEffect(() => {
    if (outerTab === 'preview' && open && sections.length > 0) handlePreviewLoad();
  }, [outerTab]);

  const addQuestion = () => {
    const q = newQuestion.trim();
    if (!q) return;
    setQuestions(qs => [...qs, { question: q, prompt: '' }]);
    setNewQuestion('');
  };

  const tabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setOuterTab(id)}
      className="px-4 min-h-[44px] md:min-h-0 md:py-2 text-sm bg-transparent border-0 cursor-pointer whitespace-nowrap shrink-0"
      style={{
        fontWeight: outerTab === id ? 600 : 400,
        color: outerTab === id ? meta.accent : '#64748b',
        borderBottom: `2px solid ${outerTab === id ? meta.accent : 'transparent'}`,
        marginBottom: '-2px',
      }}
    >
      {label}
    </button>
  );

  const primaryBtn = { background: meta.accent, color: '#fff', border: 0 };
  const noSections = sections.length === 0;

  return (
    <Drawer open={open} onClose={onClose} title={`${meta.emoji} ${meta.editorTitle}: #${order?.order_id || ''}`} width="800px">
      <div className="flex flex-col h-full min-h-0">

        {/* Customer details */}
        {Object.keys(cf).length > 0 && (
          <div className="border-b border-slate-100 shrink-0">
            <button
              type="button"
              onClick={() => setShowOrderDetails(v => !v)}
              className="w-full flex items-center justify-between px-4 min-h-[44px] md:min-h-0 md:py-2.5 bg-violet-50 text-xs font-semibold text-violet-700 hover:bg-violet-100 border-0 cursor-pointer"
            >
              <span>📋 Customer Order Details</span>
              <span className="text-violet-400 text-base leading-none">{showOrderDetails ? '▲' : '▼'}</span>
            </button>
            {showOrderDetails && (
              <div className="px-4 py-3 flex flex-col gap-2 bg-slate-50 max-h-48 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {Object.entries(cf).map(([key, v]) => {
                    if (!v || typeof v === 'object') return null;
                    return (
                      <div key={key} className="flex flex-col text-xs">
                        <span className="text-slate-400 capitalize mb-0.5">{key.replace(/_/g, ' ')}</span>
                        <span className="text-slate-700 break-words">{String(v)}</span>
                      </div>
                    );
                  })}
                </div>
                {order?.ai_summary && (
                  <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 text-xs text-violet-950 leading-relaxed whitespace-pre-wrap mt-1">
                    <span className="text-violet-600 font-semibold block mb-1">✨ Summary</span>
                    {order.ai_summary}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chart data */}
        {hasChart && (
          <div className="border-b border-slate-100 shrink-0">
            <button
              type="button"
              onClick={() => setShowChartData(v => !v)}
              className="w-full flex items-center justify-between px-4 min-h-[44px] md:min-h-0 md:py-2.5 bg-emerald-50 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 border-0 cursor-pointer"
            >
              <span>📊 Saved Chart Data (freeastroapi)</span>
              <span className="text-emerald-400 text-base leading-none">{showChartData ? '▲' : '▼'}</span>
            </button>
            {showChartData && (
              <pre className="px-4 py-3 bg-slate-950 text-emerald-300 text-xs overflow-auto max-h-72 leading-relaxed font-mono whitespace-pre-wrap">
                {JSON.stringify(hd.chart_data, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Outer tabs: scroll sideways on a narrow screen */}
        <div className="flex overflow-x-auto shrink-0 pl-1" style={{ borderBottom: '2px solid #e2e8f0' }} role="tablist">
          {tabBtn('edit', '✏ Sections')}
          {tabBtn('questions', `❓ Questions${questions.length ? ` (${questions.length})` : ''}`)}
          {tabBtn('wa', '💬 WhatsApp')}
          {tabBtn('preview', '👁 Preview')}
        </div>

        {/* ── Sections ── */}
        {outerTab === 'edit' && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0 px-3 py-2 border-b border-slate-200 overflow-x-auto flex gap-2 items-center">
              {sections.map((sec, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  title={sec.label}
                  className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3 py-1.5 text-sm md:text-xs rounded-md cursor-pointer border-0 shrink-0"
                  style={{
                    fontWeight: activeIdx === i ? 700 : 500,
                    background: activeIdx === i ? meta.accent : '#f1f5f9',
                    color: activeIdx === i ? '#fff' : '#475569',
                  }}
                >
                  {i + 1}
                </button>
              ))}
              {noSections && (
                <span className="text-xs text-slate-400">
                  {regenerating ? 'Generating…' : `No ${meta.name.toLowerCase()} sections generated yet.`}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {active ? (
                <>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="m-0 text-sm font-bold" style={{ color: meta.accent }}>{active.label}</p>
                    <button
                      type="button"
                      onClick={() => handleRegenerateSection(active.label)}
                      disabled={!!regeneratingSection}
                      className={`${btnBase} bg-slate-100 text-slate-600 border border-slate-300`}
                    >
                      {regeneratingSection === active.label ? '⏳ Generating…' : '↺ Regenerate'}
                    </button>
                  </div>
                  <SectionReviewNote review={hd[k('review')]} label={active.label} content={active.content} accent={meta.accent} />
                  {regeneratingSection === active.label ? (
                    <div className="flex flex-col items-center justify-center gap-3 h-72">
                      <span className="w-8 h-8 border-2 border-slate-200 rounded-full animate-spin block" style={{ borderTopColor: meta.accent }} />
                      <span className="text-sm font-semibold" style={{ color: meta.accent }}>Generating "{active.label}"…</span>
                      <span className="text-xs text-slate-400">This may take 20 to 40 seconds</span>
                    </div>
                  ) : (
                    <textarea
                      key={`${kind}-${activeIdx}`}
                      className={textareaCls}
                      value={active.content || ''}
                      onChange={e => setSections(prev => prev.map((s, i) => (i === activeIdx ? { ...s, content: e.target.value } : s)))}
                      rows={16}
                      placeholder={`Enter content for ${active.label}…`}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400">
                  {regenerating
                    ? `Generating the ${meta.name.toLowerCase()} report. Reopen this in a couple of minutes.`
                    : `No sections yet. Add ${meta.name} sections on the Plugins page, then generate from the order.`}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Questions ── */}
        {outerTab === 'questions' && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            <div>
              <p className="m-0 mb-1 text-sm font-bold" style={{ color: meta.accent }}>
                Customer&apos;s own questions ({questions.length})
              </p>
              <p className="m-0 mb-3 text-xs text-slate-400">
                Each is answered on its own after the main sections. Add or edit here, then use <b>Regenerate All</b> to produce the answers.
              </p>

              <button
                type="button"
                onClick={handleAiFill}
                disabled={busy.aiFilling}
                className={`${btnBase} mb-3 font-semibold border`}
                style={{ background: meta.accentSoft, color: meta.accentText, borderColor: meta.accentBorder }}
              >
                {busy.aiFilling ? '⏳ Reading chat…' : '✨ AI Fill from chat'}
              </button>

              <div className="flex flex-col gap-2">
                {questions.map((q, i) => (
                  <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="flex flex-wrap items-start gap-2 px-3 py-2 bg-slate-50">
                      <span className="text-xs text-slate-400 mt-3 md:mt-2">{i + 1}.</span>
                      <input
                        className="flex-1 min-w-[140px] px-2 py-2 md:py-1.5 text-base md:text-sm bg-white border border-slate-300 rounded-md outline-none min-h-[44px] md:min-h-0"
                        value={q.question || ''}
                        placeholder="Question (shown in the report)"
                        onChange={e => setQuestions(qs => qs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                      />
                      <button
                        type="button"
                        onClick={() => setExpandedQIdx(expandedQIdx === i ? null : i)}
                        title="Edit the detailed instruction the AI sees"
                        className="min-h-[44px] md:min-h-0 px-3 py-1 text-xs bg-white border rounded-md cursor-pointer"
                        style={{ color: meta.accent, borderColor: meta.accentBorder }}
                      >
                        {expandedQIdx === i ? '▲' : '✎ prompt'}
                      </button>
                      <button
                        type="button"
                        aria-label="Remove question"
                        onClick={() => setQuestions(qs => qs.filter((_, j) => j !== i))}
                        className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 px-2 py-1 text-base md:text-xs text-red-500 bg-white border border-red-200 rounded-md cursor-pointer"
                      >×</button>
                    </div>
                    {expandedQIdx === i && (
                      <textarea
                        rows={4}
                        value={q.prompt || ''}
                        placeholder="Detailed instruction for the AI (the customer never sees this). Leave blank to use the question as it is."
                        onChange={e => setQuestions(qs => qs.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))}
                        className="w-full px-3 py-2 text-sm md:text-xs border-0 border-t border-slate-200 outline-none resize-y"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-3">
                <input
                  className="flex-1 min-w-0 px-3 py-2 text-base md:text-sm border border-slate-300 rounded-lg outline-none min-h-[44px] md:min-h-0"
                  value={newQuestion}
                  onChange={e => setNewQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addQuestion(); } }}
                  placeholder="Add a question the customer asked…"
                />
                <button
                  type="button"
                  disabled={!newQuestion.trim()}
                  onClick={addQuestion}
                  className={`${btnBase} font-semibold border-0 shrink-0`}
                  style={{ background: meta.accentSoft, color: meta.accentText }}
                >+ Add</button>
              </div>

              <button
                type="button"
                onClick={handleSaveQuestions}
                disabled={busy.savingQuestions || noSections}
                className={`${btnBase} mt-3 font-semibold`}
                style={primaryBtn}
              >
                {busy.savingQuestions ? 'Saving…' : '💾 Save Questions'}
              </button>
            </div>

            {answers.length > 0 && (
              <div>
                <p className="m-0 mb-2 text-sm font-bold" style={{ color: meta.accent }}>Answers</p>
                <div className="flex flex-col gap-5">
                  {answers.map((qa, i) => (
                    <div key={i}>
                      <p className="m-0 mb-1.5 text-sm font-bold" style={{ color: meta.accent }}>{i + 1}. {qa.question}</p>
                      {qa.error && !(qa.answer || '').trim() && (
                        <p className="m-0 mb-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
                          ⚠ Not answered: {qa.error}
                        </p>
                      )}
                      <textarea
                        className={textareaCls}
                        value={qa.answer || ''}
                        onChange={e => setAnswers(prev => prev.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
                        rows={10}
                      />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleSaveQuestions}
                  disabled={busy.savingQuestions}
                  className={`${btnBase} mt-3 font-semibold`}
                  style={primaryBtn}
                >
                  {busy.savingQuestions ? 'Saving…' : '💾 Save Answers'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── WhatsApp ── */}
        {outerTab === 'wa' && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 items-center shrink-0">
              <button
                type="button"
                onClick={handleGenerateWa}
                disabled={busy.generatingWa || noSections}
                className={`${btnBase} font-semibold border-0`}
                style={{ background: '#25D366', color: '#fff' }}
              >
                {busy.generatingWa ? 'Generating…' : (waMessage ? '↺ Regenerate' : '✦ Generate')}
              </button>
              {waMessage && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(waMessage).then(() => toast.success('Copied to clipboard'))}
                  className={`${btnBase} bg-slate-100 text-slate-600 border border-slate-300`}
                >📋 Copy</button>
              )}
              {waDirty && (
                <button
                  type="button"
                  onClick={handleSaveWa}
                  disabled={busy.savingWa}
                  className={`${btnBase} font-semibold border-0`}
                  style={{ background: '#f59e0b', color: '#fff' }}
                >{busy.savingWa ? 'Saving…' : '💾 Save'}</button>
              )}
            </div>
            {busy.generatingWa ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <span className="w-8 h-8 border-2 border-green-200 border-t-green-600 rounded-full animate-spin block" />
                <span className="text-sm text-green-600 font-semibold">Generating message…</span>
              </div>
            ) : (
              <textarea
                value={waMessage}
                onChange={e => setWaMessage(e.target.value)}
                rows={14}
                placeholder={`No message yet. Click Generate above (needs a ${meta.name} WhatsApp prompt on the Plugins page).`}
                className={textareaCls}
                style={{ borderColor: waDirty ? '#f59e0b' : undefined }}
              />
            )}
          </div>
        )}

        {/* ── Preview ── */}
        {outerTab === 'preview' && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 items-center shrink-0">
              <button
                type="button"
                onClick={handlePreviewLoad}
                disabled={busy.loadingPreview}
                className={`${btnBase} border-0`}
                style={primaryBtn}
              >
                {busy.loadingPreview ? 'Loading…' : '🔄 Refresh Preview'}
              </button>
              <span className="text-xs text-slate-400">Save changes first, then refresh.</span>
            </div>
            {busy.loadingPreview && (
              <div className="text-center py-10 text-slate-400 text-sm">
                <span className="w-6 h-6 border-2 border-slate-200 rounded-full animate-spin inline-block" style={{ borderTopColor: meta.accent }} />
                <div className="mt-2">Rendering document…</div>
              </div>
            )}
            <div ref={previewRef} className="bg-white border border-slate-200 rounded-lg min-h-[400px] overflow-auto" />
          </div>
        )}

        <DeliveryPanel order={order} clientId={clientId} open={open} kind={kind} />

        {/* Footer: a grid on a phone, one row from md up */}
        <div
          className="shrink-0 px-3 md:px-4 py-3 border-t border-slate-200 bg-slate-50 grid grid-cols-2 md:flex md:flex-wrap md:justify-end md:items-center gap-2"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={busy.saving || noSections}
            className={`${btnBase} col-span-2 md:col-span-1 md:order-last font-semibold`}
            style={primaryBtn}
          >
            {busy.saving ? 'Saving…' : '💾 Save Changes'}
          </button>
          <button
            type="button"
            onClick={() => download('docx')}
            disabled={busy.downloading || noSections}
            className={`${btnBase} bg-white text-slate-700 border border-slate-300`}
          >
            {busy.downloading ? 'Downloading…' : '⬇ Word'}
          </button>
          <button
            type="button"
            onClick={() => download('pdf')}
            disabled={busy.downloadingPdf || noSections}
            className={`${btnBase} border-0`}
            style={{ background: '#dc2626', color: '#fff' }}
          >
            {busy.downloadingPdf ? 'Preparing…' : '⬇ PDF'}
          </button>
          <button
            type="button"
            onClick={handleRegenerateAll}
            disabled={regenerating}
            className={`${btnBase} md:mr-auto md:order-first border-0`}
            style={{ background: regenerating ? '#e2e8f0' : '#0f766e', color: regenerating ? '#94a3b8' : '#fff' }}
          >
            {regenerating ? '⏳ Generating…' : '↺ Regenerate All'}
          </button>
          <DeleteReportButton order={order} clientId={clientId} kind={kind} visible={!noSections} onDone={onClose} />
        </div>
      </div>
    </Drawer>
  );
}
