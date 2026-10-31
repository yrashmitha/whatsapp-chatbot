import { useState, useRef, useCallback, useEffect } from 'react';
import api, { GEO_USER_AGENT } from '../../lib/api';
import { useToast } from '../ui/Toast';
import {
  SECTION_KINDS, hdKey, sectionReportState, parseJsonField,
  HOURS, MINUTES, LAGNA_SI, ZODIAC_SYMBOL, toISODate,
} from './sectionReports';

// 16px on a phone so iOS does not zoom the page when a field is focused.
const fieldCls = 'w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-slate-200 rounded-xl outline-none bg-white min-h-[44px] md:min-h-0';
const labelCls = 'text-xs font-medium text-slate-500 block mb-1';

/**
 * Generate form for a section report (abroad, pregnancy). The right-hand pane of
 * the order modal when it is opened on that report's tab. Same flow as the
 * marriage form: AI Fill from the chat, Check Lagna, the customer's own
 * questions, Generate. Built phone first: one column, 44px touch targets, and a
 * footer that stays in reach.
 *
 * @param {object} props
 * @param {string} props.kind       key in SECTION_KINDS
 * @param {object} props.order
 * @param {string} props.clientId
 * @param {object} props.existingHd the order's parsed horoscope_data
 * @param {Function} props.onClose
 * @param {Function} props.onGenerated
 */
export default function SectionReportPanel({ kind, order, clientId, existingHd = {}, onClose, onGenerated }) {
  const toast = useToast();
  const meta = SECTION_KINDS[kind];
  const base = `/plugins/section-report/${kind}`;
  const orderId = order?.order_id;
  const cf = parseJsonField(order?.custom_fields);

  const [name, setName]           = useState(cf.customer_name || order?.customer_name || '');
  const [birthDate, setBirthDate] = useState(toISODate(cf.birth_date));
  const initTime = /^\d{1,2}:\d{2}/.test(cf.birth_time || '') ? cf.birth_time.split(':') : ['07', '00'];
  const [birthHour, setBirthHour]     = useState((initTime[0] || '07').padStart(2, '0'));
  const [birthMinute, setBirthMinute] = useState((initTime[1] || '00').padStart(2, '0'));
  const [geoQuery, setGeoQuery] = useState('');
  const [place, setPlace]       = useState(null);
  const [detectedLagna, setDetectedLagna] = useState(existingHd.chart_data?.ascendant?.sign || null);

  const [questions, setQuestions] = useState(
    (existingHd[hdKey(kind, 'special_questions')] || [])
      .map(q => ({ question: q.question || '', prompt: q.prompt || q.question || '' }))
      .filter(q => q.question)
  );
  const [newQuestion, setNewQuestion]   = useState('');
  const [expandedQIdx, setExpandedQIdx] = useState(null);

  const [aiPreparing, setAiPreparing] = useState(false);
  const [checking, setChecking]       = useState(false);
  const [saving, setSaving]           = useState(false);
  const [generating, setGenerating]   = useState(false);
  // Closed on a phone: the form is what you came for, and the chat is one tap away.
  const [showOrderDetails, setShowOrderDetails] = useState(
    typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches);

  const { done: hasReport } = sectionReportState(existingHd, kind);
  const hasChart = !!detectedLagna || !!existingHd.chart_data;

  // ── Geo autocomplete ───────────────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState([]);
  const debounceRef = useRef(null);
  const searchGeo = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
          { headers: { 'User-Agent': GEO_USER_AGENT } }
        );
        const data = await r.json();
        setSuggestions(data.map(d => ({ name: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) })));
      } catch { setSuggestions([]); }
    }, 400);
  }, []);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const handleGeoInput = (value) => {
    setGeoQuery(value);
    setPlace(null);
    setDetectedLagna(null);
    searchGeo(value);
  };
  const selectPlace = (p) => {
    setPlace(p);
    setGeoQuery(p.name);
    setDetectedLagna(null);
    setSuggestions([]);
  };

  const withClient = (body = {}) => ({ ...body, ...(clientId && { client_id: clientId }) });
  const qs = clientId ? `?client_id=${clientId}` : '';

  // ── AI Fill: one pass over the chat ────────────────────────────────────────
  const handleAiFill = async () => {
    setAiPreparing(true);
    try {
      const r = await api.post(`${base}/ai-prepare/${orderId}${qs}`, {});
      const d = r.data || {};
      if (d.birth_date_iso) setBirthDate(d.birth_date_iso);
      if (d.birth_time_24h) {
        const [h, m] = d.birth_time_24h.split(':');
        setBirthHour((h || '07').padStart(2, '0'));
        setBirthMinute((m || '00').padStart(2, '0'));
      }
      if (d.lat != null && d.lng != null) {
        setPlace({ lat: d.lat, lng: d.lng, name: d.birth_place_en || '' });
        setGeoQuery(d.birth_place_en || '');
      }
      if (d.birth_date_iso || (d.lat != null && d.lng != null)) setDetectedLagna(null);
      if (Array.isArray(d.special_questions) && d.special_questions.length) {
        setQuestions(d.special_questions.map(q => ({ question: q.question, prompt: q.prompt || q.question })));
      }

      const gotBirth = !!d.birth_date_iso;
      const gotPlace = d.lat != null && d.lng != null;
      if (!gotBirth && !gotPlace) {
        toast.error('Could not read birth details from the chat. Fill them in by hand.');
      } else if (!gotBirth || !gotPlace) {
        toast.error('Only part of the birth details were found. Check the form before Check Lagna.');
      } else {
        toast.success('Filled from the chat. Check the details, then Check Lagna.');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'AI Fill failed');
    } finally {
      setAiPreparing(false);
    }
  };

  // ── Check Lagna: fetch and store the order's chart ─────────────────────────
  const handleCheckLagna = async () => {
    if (!place || !birthDate) return;
    setChecking(true);
    try {
      const r = await api.post('/plugins/horoscope/fetch-chart', withClient({
        order_id: orderId,
        lat: place.lat,
        lng: place.lng,
        birth_place_name: place.name || '',
        birth_overrides: { birth_date: birthDate, birth_time: `${birthHour}:${birthMinute}` },
      }));
      setDetectedLagna(r.data.sign);
      toast.success('Chart data saved');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to fetch chart');
    } finally {
      setChecking(false);
    }
  };

  const saveQuestions = () => api.patch(`${base}/questions/${orderId}${qs}`, {
    special_questions: questions.filter(q => (q.question || '').trim()),
  });

  const handleSaveOnly = async () => {
    setSaving(true);
    try {
      await saveQuestions();
      toast.success('Questions saved');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await saveQuestions();
      await api.post(`${base}/generate/${orderId}${qs}`, {});
      toast.success(`${meta.name} report started. It takes about 2 minutes and continues in the background.`);
      onGenerated?.();
      onClose?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || `Failed to start the ${meta.name.toLowerCase()} report`);
      setGenerating(false);
    }
  };

  const addQuestion = () => {
    const q = newQuestion.trim();
    if (!q) return;
    setQuestions(qs2 => [...qs2, { question: q, prompt: q }]);
    setNewQuestion('');
  };

  return (
    <>
      {/* Customer details, same panel as the other report tabs */}
      {Object.keys(cf).length > 0 && (
        <div className="border-b border-slate-100 shrink-0">
          <button
            type="button"
            onClick={() => setShowOrderDetails(v => !v)}
            className="w-full flex items-center justify-between px-4 md:px-5 py-3 md:py-2.5 bg-violet-50 text-xs font-semibold text-violet-700 hover:bg-violet-100 border-0 cursor-pointer"
          >
            <span>📋 Customer Order Details</span>
            <span className="text-violet-400 text-base leading-none">{showOrderDetails ? '▲' : '▼'}</span>
          </button>
          {showOrderDetails && (
            <div className="px-4 md:px-5 py-3 flex flex-col gap-2 bg-slate-50 max-h-48 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {Object.entries(cf).map(([k, v]) => {
                  if (!v || typeof v === 'object') return null;
                  return (
                    <div key={k} className="flex flex-col text-xs">
                      <span className="text-slate-400 capitalize mb-0.5">{k.replace(/_/g, ' ')}</span>
                      <span className="text-slate-700 break-words">{String(v)}</span>
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

      <div className="overflow-y-auto flex-1 px-4 md:px-5 py-4 flex flex-col gap-4">

        {hasReport && (
          <div className="rounded-xl border px-3 py-2 text-xs"
            style={{ background: meta.accentSoft, borderColor: meta.accentBorder, color: meta.accentText }}>
            A {meta.name.toLowerCase()} report already exists for this order. Generating again replaces the sections.
            Use the {meta.emoji} editor afterwards to adjust the text.
          </div>
        )}

        {/* AI Fill */}
        <div>
          <button
            type="button"
            disabled={aiPreparing}
            onClick={handleAiFill}
            className="w-full min-h-[48px] md:min-h-0 py-3 md:py-2.5 text-sm font-semibold rounded-xl border-0 cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ background: aiPreparing ? meta.accentSoft : meta.accent, color: aiPreparing ? meta.accentText : '#fff' }}
          >
            {aiPreparing
              ? <><span className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin block" />Reading the chat…</>
              : '✨ AI Fill: read the chat and prepare'}
          </button>
          <p className="text-xs text-slate-400 mt-2">{meta.questionHint}</p>
        </div>

        {/* Birth form */}
        <div className="flex flex-col gap-3 p-3 rounded-xl border"
          style={{ background: meta.accentSoft, borderColor: meta.accentBorder }}>
          <div>
            <label className={labelCls}>Name</label>
            <input className={fieldCls} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <label className={labelCls}>Birth Date</label>
            <input
              type="date"
              className={fieldCls}
              value={birthDate}
              onChange={e => { setBirthDate(e.target.value); setDetectedLagna(null); }}
            />
          </div>
          <div>
            <label className={labelCls}>Birth Time (24h)</label>
            <div className="flex gap-2">
              <select
                aria-label="Birth hour"
                value={birthHour}
                onChange={e => { setBirthHour(e.target.value); setDetectedLagna(null); }}
                className={`${fieldCls} flex-1`}
              >
                {HOURS.map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
              <select
                aria-label="Birth minute"
                value={birthMinute}
                onChange={e => { setBirthMinute(e.target.value); setDetectedLagna(null); }}
                className={`${fieldCls} flex-1`}
              >
                {MINUTES.map(m => <option key={m} value={m}>{m}m</option>)}
              </select>
            </div>
          </div>
          <div className="relative">
            <label className={labelCls}>Birth Place</label>
            <input
              type="text"
              value={geoQuery}
              onChange={e => handleGeoInput(e.target.value)}
              placeholder="Type a city name…"
              autoComplete="off"
              className={fieldCls}
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden list-none p-0 m-0">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => selectPlace(s)}
                      className="w-full text-left px-3 py-3 md:py-2 text-sm md:text-xs text-slate-700 hover:bg-slate-50 cursor-pointer bg-transparent border-0 border-b border-slate-100"
                    >
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {place && (
              <p className="text-xs text-emerald-600 mt-1">✓ {place.lat.toFixed(4)}, {place.lng.toFixed(4)}</p>
            )}
          </div>
        </div>

        {/* Check Lagna */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={checking || !place || !birthDate}
            onClick={handleCheckLagna}
            className="min-h-[44px] md:min-h-0 px-4 py-2 text-sm font-medium rounded-xl border-0 cursor-pointer disabled:opacity-50"
            style={{ background: meta.accentSoft, color: meta.accentText }}
          >
            {checking ? 'Checking…' : '🔍 Check Lagna'}
          </button>
          {detectedLagna && (
            <div className="flex items-center gap-2">
              <span className="text-2xl leading-none" title={detectedLagna}>{ZODIAC_SYMBOL[detectedLagna] || ''}</span>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold text-slate-800">{LAGNA_SI[detectedLagna] || detectedLagna}</span>
                <span className="text-xs text-slate-400">{detectedLagna}</span>
              </div>
            </div>
          )}
        </div>

        {!hasChart && (
          <p className="text-xs text-amber-600">
            The birth chart is required. Fill the details and press Check Lagna. The report cannot be generated until a lagna shows.
          </p>
        )}

        {/* Special questions */}
        <div>
          <label className={labelCls}>Special Questions ({questions.length})</label>
          <p className="text-xs text-slate-400 mb-2">{meta.questionsIntro}</p>

          <div className="flex flex-col gap-2">
            {questions.map((q, i) => (
              <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex flex-wrap items-start gap-2 px-3 py-2 bg-slate-50">
                  <span className="text-xs text-slate-400 mt-3 md:mt-2">{i + 1}.</span>
                  <input
                    className="flex-1 min-w-[140px] px-2 py-2 md:py-1 text-base md:text-sm bg-white border border-slate-200 rounded-lg outline-none min-h-[44px] md:min-h-0"
                    value={q.question}
                    onChange={e => setQuestions(qs2 => qs2.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    onClick={() => setExpandedQIdx(expandedQIdx === i ? null : i)}
                    title="Edit the detailed instruction the AI sees"
                    className="min-h-[44px] md:min-h-0 px-3 py-1 text-xs bg-white border rounded-lg cursor-pointer hover:bg-slate-50"
                    style={{ color: meta.accent, borderColor: meta.accentBorder }}
                  >
                    {expandedQIdx === i ? '▲' : '✎ prompt'}
                  </button>
                  <button
                    type="button"
                    aria-label="Remove question"
                    onClick={() => setQuestions(qs2 => qs2.filter((_, j) => j !== i))}
                    className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 px-2 py-1 text-base md:text-xs text-red-500 bg-white border border-red-200 rounded-lg cursor-pointer hover:bg-red-50"
                  >
                    ×
                  </button>
                </div>
                {expandedQIdx === i && (
                  <textarea
                    rows={4}
                    value={q.prompt}
                    onChange={e => setQuestions(qs2 => qs2.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))}
                    placeholder="Detailed Sinhala instruction (the customer never sees this)…"
                    className="w-full px-3 py-2 text-sm md:text-xs border-0 border-t border-slate-200 outline-none resize-y"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-2">
            <input
              className={fieldCls}
              value={newQuestion}
              onChange={e => setNewQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addQuestion(); } }}
              placeholder="Add a question the customer asked…"
            />
            <button
              type="button"
              disabled={!newQuestion.trim()}
              onClick={addQuestion}
              className="min-h-[44px] md:min-h-0 px-4 py-2 text-sm font-medium rounded-xl border-0 cursor-pointer disabled:opacity-50 shrink-0"
              style={{ background: meta.accentSoft, color: meta.accentText }}
            >
              + Add
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Timezone: Asia/Colombo. Generation runs in the background (about 2 minutes).
        </p>
      </div>

      {/* Footer: generate first on a phone, where the thumb is */}
      <div
        className="px-4 md:px-5 py-3 md:py-4 border-t border-slate-100 flex flex-col-reverse md:flex-row gap-2 md:gap-3 bg-white shrink-0"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] md:min-h-0 py-2.5 px-5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer"
        >
          Cancel
        </button>
        <div className="flex flex-col-reverse md:flex-row gap-2 md:gap-3 flex-1 md:justify-end">
          <button
            type="button"
            onClick={handleSaveOnly}
            disabled={saving || generating}
            className="min-h-[44px] md:min-h-0 py-2.5 px-5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Questions'}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !hasChart}
            title={hasChart ? '' : 'Press Check Lagna first'}
            className="flex-1 md:min-w-[220px] min-h-[48px] md:min-h-0 py-3 md:py-2.5 text-sm font-semibold text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: meta.accent }}
          >
            {generating
              ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />Starting…</>
              : `${meta.emoji} ${hasReport ? `Generate ${meta.name} Report Again` : `Generate ${meta.name} Report`}`}
          </button>
        </div>
      </div>
    </>
  );
}
