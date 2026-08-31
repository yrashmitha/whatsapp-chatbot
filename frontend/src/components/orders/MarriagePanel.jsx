import { useState, useRef, useCallback, useEffect } from 'react';
import api, { GEO_USER_AGENT } from '../../lib/api';
import { useToast } from '../ui/Toast';

const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const LAGNA_SI = {
  Aries: 'මේෂ', Taurus: 'වෘෂභ', Gemini: 'මිථුන', Cancer: 'කටක',
  Leo: 'සිංහ', Virgo: 'කන්නියා', Libra: 'තුලා', Scorpio: 'වෘශ්චික',
  Sagittarius: 'ධනු', Capricorn: 'මකර', Aquarius: 'කුම්භ', Pisces: 'මීන',
};
const ZODIAC_SYMBOL = {
  Aries: '♈', Taurus: '♉', Gemini: '♊', Cancer: '♋',
  Leo: '♌', Virgo: '♍', Libra: '♎', Scorpio: '♏',
  Sagittarius: '♐', Capricorn: '♑', Aquarius: '♒', Pisces: '♓',
};
const SINHALA_MONTHS = {
  'ජනවාරි':1,'පෙබරවාරි':2,'මාර්තු':3,'අප්‍රේල්':4,
  'මැයි':5,'ජූනි':6,'ජූලි':7,'අගෝස්තු':8,
  'සැප්තැම්බර්':9,'ඔක්තෝබර්':10,'නොවැම්බර්':11,'දෙසැම්බර්':12,
};

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100';
const labelCls = 'text-xs font-medium text-slate-500 block mb-1';

function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split(/\s+/);
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = SINHALA_MONTHS[parts[1]] || parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d))
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
}

/**
 * Marriage (විවාහ) form — the right-hand pane of the order modal when it is opened
 * on the Marriage tab. Single person, self-contained: its own birth form, geo
 * autocomplete and Check Lagna, mirroring MatchMakingPanel. The chart it fetches
 * is the order's own horoscope_data.chart_data — the exact input the marriage
 * generation pipeline reads.
 */
export default function MarriagePanel({ order, clientId, existingHd = {}, onClose, onGenerated }) {
  const toast = useToast();

  const cf = (() => {
    if (!order?.custom_fields) return {};
    if (typeof order.custom_fields === 'object') return order.custom_fields;
    try { return JSON.parse(order.custom_fields); } catch { return {}; }
  })();

  const [name, setName]         = useState(cf.customer_name || order?.customer_name || '');
  const [birthDate, setBirthDate] = useState(toISODate(cf.birth_date));
  const initTime = /^\d{1,2}:\d{2}/.test(cf.birth_time || '') ? cf.birth_time.split(':') : ['07', '00'];
  const [birthHour, setBirthHour]     = useState((initTime[0] || '07').padStart(2, '0'));
  const [birthMinute, setBirthMinute] = useState((initTime[1] || '00').padStart(2, '0'));
  const [geoQuery, setGeoQuery] = useState('');
  const [place, setPlace]       = useState(null);
  const [detectedLagna, setDetectedLagna] = useState(existingHd.chart_data?.ascendant?.sign || null);

  const [questions, setQuestions]     = useState(
    (existingHd.marriage_special_questions || [])
      .map(q => ({ question: q.question || '', prompt: q.prompt || q.question || '' }))
      .filter(q => q.question)
  );
  const [newQuestion, setNewQuestion]   = useState('');
  const [expandedQIdx, setExpandedQIdx] = useState(null);

  const [aiPreparing, setAiPreparing] = useState(false);
  const [checking, setChecking]       = useState(false);
  const [saving, setSaving]           = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [showOrderDetails, setShowOrderDetails] = useState(true);

  const hasReport = Array.isArray(existingHd.marriage_sections_data) && existingHd.marriage_sections_data.length > 0;
  const hasChart  = !!detectedLagna || !!existingHd.chart_data;

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

  // ── AI Fill — one pass over the chat ───────────────────────────────────────
  const handleAiFill = async () => {
    setAiPreparing(true);
    try {
      const r = await api.post(`/plugins/horoscope/ai-prepare-marriage/${order?.order_id}`, {
        ...(clientId && { client_id: clientId }),
      });
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
        toast.error('Could not read birth details from the chat — fill them manually');
      } else if (!gotBirth || !gotPlace) {
        toast.error('Only part of the birth details were found — check the form before Check Lagna');
      } else {
        toast.success('Filled from chat — check the details, then Check Lagna');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'AI Fill failed');
    } finally {
      setAiPreparing(false);
    }
  };

  // ── Check Lagna — fetch and store the order's chart ────────────────────────
  const handleCheckLagna = async () => {
    if (!place || !birthDate) return;
    setChecking(true);
    try {
      const r = await api.post('/plugins/horoscope/fetch-chart', {
        order_id: order?.order_id,
        lat: place.lat,
        lng: place.lng,
        birth_place_name: place.name || '',
        birth_overrides: {
          birth_date: birthDate,
          birth_time: `${birthHour}:${birthMinute}`,
        },
        ...(clientId && { client_id: clientId }),
      });
      setDetectedLagna(r.data.sign);
      toast.success('Chart data saved');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to fetch chart');
    } finally {
      setChecking(false);
    }
  };

  const saveQuestions = () => api.patch(`/plugins/horoscope/marriage-questions/${order?.order_id}`, {
    marriage_special_questions: questions.filter(q => (q.question || '').trim()),
    ...(clientId && { client_id: clientId }),
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
      await api.post(`/plugins/horoscope/generate-marriage/${order?.order_id}`, {
        ...(clientId && { client_id: clientId }),
      });
      toast.success('Marriage report started — takes ~2 min. It continues in the background.');
      onGenerated?.();
      onClose?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to start marriage report');
      setGenerating(false);
    }
  };

  return (
    <>
      {/* Customer details — same panel as the horoscope generate tab */}
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

      <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">

        {hasReport && (
          <div className="rounded-xl border border-pink-200 bg-pink-50 px-3 py-2 text-xs text-pink-800">
            A marriage report already exists for this order. Generating again replaces the sections —
            use the 💍 ✏ editor afterwards to tweak the text.
          </div>
        )}

        {/* AI Fill */}
        <button
          type="button"
          disabled={aiPreparing}
          onClick={handleAiFill}
          className="w-full py-2.5 text-sm font-semibold rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
          style={{
            background: aiPreparing ? '#fdf2f8' : 'linear-gradient(135deg,#db2777,#e11d48)',
            color:      aiPreparing ? '#be185d' : '#fff',
          }}
        >
          {aiPreparing
            ? <><span className="w-4 h-4 border-2 border-pink-300 border-t-pink-600 rounded-full animate-spin block" />Reading the chat…</>
            : '✨ AI Fill — Read Chat & Prepare'}
        </button>
        <p className="text-xs text-slate-400 -mt-2">
          Reads the birth details and the customer&apos;s own marriage questions out of the WhatsApp thread. Always check them before Check Lagna.
        </p>

        {/* Birth form */}
        <div className="flex flex-col gap-3 p-3 rounded-xl border border-pink-200 bg-pink-50">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <label className={labelCls}>Birth Date</label>
            <input
              type="date"
              className={inputCls}
              value={birthDate}
              onChange={e => { setBirthDate(e.target.value); setDetectedLagna(null); }}
            />
          </div>
          <div>
            <label className={labelCls}>Birth Time (24h)</label>
            <div className="flex gap-2">
              <select
                value={birthHour}
                onChange={e => { setBirthHour(e.target.value); setDetectedLagna(null); }}
                className="flex-1 px-2 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100 bg-white"
              >
                {HOURS.map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
              <select
                value={birthMinute}
                onChange={e => { setBirthMinute(e.target.value); setDetectedLagna(null); }}
                className="flex-1 px-2 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100 bg-white"
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
              className={inputCls}
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      onClick={() => selectPlace(s)}
                      className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-pink-50 cursor-pointer bg-transparent border-0"
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={checking || !place || !birthDate}
            onClick={handleCheckLagna}
            className="px-4 py-2 text-sm font-medium rounded-xl border-0 cursor-pointer disabled:opacity-50 transition-colors"
            style={{ background: '#fdf2f8', color: '#be185d' }}
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
            The birth chart is required. Fill the details and press “Check Lagna” — the report can&apos;t be generated until a lagna shows.
          </p>
        )}

        {/* Special questions */}
        <div>
          <label className={labelCls}>Special Questions ({questions.length})</label>
          <p className="text-xs text-slate-400 mb-2">
            The customer&apos;s own questions. Each gets its own answer after the main sections.
          </p>

          <div className="flex flex-col gap-2">
            {questions.map((q, i) => (
              <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-start gap-2 px-3 py-2 bg-slate-50">
                  <span className="text-xs text-slate-400 mt-1">{i + 1}.</span>
                  <input
                    className="flex-1 px-2 py-1 text-sm bg-white border border-slate-200 rounded-lg outline-none focus:border-pink-400"
                    value={q.question}
                    onChange={e => setQuestions(qs => qs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    onClick={() => setExpandedQIdx(expandedQIdx === i ? null : i)}
                    title="Edit the detailed internal instruction"
                    className="px-2 py-1 text-xs text-pink-600 bg-white border border-pink-200 rounded-lg cursor-pointer hover:bg-pink-50"
                  >
                    {expandedQIdx === i ? '▲' : '✎ prompt'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuestions(qs => qs.filter((_, j) => j !== i))}
                    className="px-2 py-1 text-xs text-red-500 bg-white border border-red-200 rounded-lg cursor-pointer hover:bg-red-50"
                  >
                    ×
                  </button>
                </div>
                {expandedQIdx === i && (
                  <textarea
                    rows={4}
                    value={q.prompt}
                    onChange={e => setQuestions(qs => qs.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))}
                    placeholder="Detailed Sinhala instruction (the customer never sees this)…"
                    className="w-full px-3 py-2 text-xs border-0 border-t border-slate-200 outline-none resize-y font-mono"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-2">
            <input
              className={inputCls}
              value={newQuestion}
              onChange={e => setNewQuestion(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newQuestion.trim()) {
                  e.preventDefault();
                  setQuestions(qs => [...qs, { question: newQuestion.trim(), prompt: newQuestion.trim() }]);
                  setNewQuestion('');
                }
              }}
              placeholder="Add a question the customer asked…"
            />
            <button
              type="button"
              disabled={!newQuestion.trim()}
              onClick={() => {
                setQuestions(qs => [...qs, { question: newQuestion.trim(), prompt: newQuestion.trim() }]);
                setNewQuestion('');
              }}
              className="px-4 py-2 text-sm font-medium text-pink-700 bg-pink-50 rounded-xl border-0 cursor-pointer disabled:opacity-50 hover:bg-pink-100"
            >
              + Add
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Timezone: Asia/Colombo · Generation runs in the background (~2 min)
        </p>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-100 flex gap-3 flex-wrap">
        <button
          onClick={onClose}
          className="py-2.5 px-5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer"
        >
          Cancel
        </button>
        <div className="flex gap-3 flex-1 flex-wrap justify-end">
          <button
            onClick={handleSaveOnly}
            disabled={saving || generating}
            className="py-2.5 px-5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Questions'}
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || !hasChart}
            title={hasChart ? '' : 'Press Check Lagna first'}
            className="flex-1 min-w-[200px] py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: generating ? '#be185d' : 'linear-gradient(135deg,#db2777,#e11d48)' }}
          >
            {generating
              ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />Starting…</>
              : (hasReport ? '💍 Generate Marriage Report Again' : '💍 Generate Marriage Report')}
          </button>
        </div>
      </div>
    </>
  );
}
