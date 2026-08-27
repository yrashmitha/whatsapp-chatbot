import { useState, useRef, useCallback, useEffect } from 'react';
import api, { GEO_USER_AGENT } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { customerNameFrom } from '../../lib/utils';
import ChatThread from '../chat/ChatThread';
import MatchMakingPanel from './MatchMakingPanel';

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

function toISODate(raw) {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = SINHALA_MONTHS[parts[1]] || parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d))
      return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  return '';
}

// Aura score → color band
function auraScoreColor(score) {
  if (score >= 0.8) return '#16a34a';
  if (score >= 0.5) return '#d97706';
  return '#dc2626';
}

export default function HoroscopeModal({ order, clientId, onClose, onGenerated, showMatch = false, initialTab = 'horoscope' }) {
  const toast  = useToast();
  // Which report the right-hand pane is editing. The chat stays mounted on the left in
  // both tabs — reading the thread is exactly what you need while filling either form.
  const [tab, setTab] = useState(showMatch ? initialTab : 'horoscope');
  const geoRef = useRef();
  const auraFileRef = useRef();
  const [showOrderDetails, setShowOrderDetails] = useState(true);

  const cf = (() => {
    if (!order?.custom_fields) return {};
    if (typeof order.custom_fields === 'object') return order.custom_fields;
    try { return JSON.parse(order.custom_fields); } catch { return {}; }
  })();

  const existingHd = (() => {
    if (!order?.horoscope_data) return {};
    if (typeof order.horoscope_data === 'object') return order.horoscope_data;
    try { return JSON.parse(order.horoscope_data); } catch { return {}; }
  })();

  const hasChart    = !!existingHd.chart_data;
  const hasSections = !!(existingHd.sections && Object.keys(existingHd.sections).length > 0);
  const [showChartData, setShowChartData] = useState(false);

  // ── Birth fields ───────────────────────────────────────────────────────────
  const [customerName, setCustomerName] = useState(customerNameFrom(cf));
  const [checkingSign, setCheckingSign] = useState(false);
  const [detectedLagna, setDetectedLagna] = useState(existingHd.chart_data?.ascendant?.sign || null);
  const [aiPreparing, setAiPreparing]   = useState(false);
  const [birthDate, setBirthDate]       = useState(toISODate(cf.birth_date || ''));
  const [birthHour, setBirthHour]       = useState('07');
  const [birthMinute, setBirthMinute]   = useState('00');
  const [overrideAstro, setOverrideAstro] = useState(false);

  useEffect(() => {
    const raw = cf.birth_time || '';
    if (/^\d{1,2}:\d{2}$/.test(raw)) {
      const [h, m] = raw.split(':');
      setBirthHour(h.padStart(2, '0'));
      setBirthMinute(m.padStart(2, '0'));
    } else {
      const isPM = raw.includes('රාත්‍රී') || raw.includes('රාත්රී') || raw.includes('දහවල්') ||
                   (raw.includes('ප.ව') && !raw.includes('පෙ.ව')) || raw.includes('සවස');
      const timePart = raw.replace(/[^\d.]/g, '').trim();
      const [h, m] = timePart.split('.').map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        let hour = h;
        if (isPM && hour < 12) hour += 12;
        if (!isPM && hour === 12) hour = 0;
        setBirthHour(String(hour).padStart(2, '0'));
        setBirthMinute(String(m).padStart(2, '0'));
      }
    }
  }, []);

  // ── Location picker ────────────────────────────────────────────────────────
  const [geoQuery, setGeoQuery]           = useState(cf.birth_place || '');
  const [geoSuggestions, setGeoSuggestions] = useState([]);
  const [selectedPlace, setSelectedPlace]   = useState(
    hasChart && existingHd.lat
      ? { lat: existingHd.lat, lng: existingHd.lng, name: existingHd.birth_place_name || cf.birth_place || '' }
      : null
  );
  const debounceRef = useRef(null);

  const searchGeo = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setGeoSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
          { headers: { 'User-Agent': GEO_USER_AGENT } }
        );
        const data = await r.json();
        setGeoSuggestions(data.map(d => ({ name: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) })));
      } catch { setGeoSuggestions([]); }
    }, 400);
  }, []);

  const handleGeoInput = (e) => { setGeoQuery(e.target.value); setSelectedPlace(null); searchGeo(e.target.value); };
  const selectPlace    = (place) => { setSelectedPlace(place); setGeoQuery(place.name); setGeoSuggestions([]); };

  // ── Package ────────────────────────────────────────────────────────────────
  const [packageType, setPackageType] = useState('2990');

  // ── Special questions ──────────────────────────────────────────────────────
  const [specialQuestions, setSpecialQuestions] = useState(
    (existingHd.special_answers || []).map(qa => ({
      question: qa.question,
      prompt:   qa.prompt || qa.question,   // detailed internal input
      sections: Array.isArray(qa.sections) ? qa.sections : [],
    })).filter(qa => qa.question)
  );
  const [newQuestion, setNewQuestion]           = useState('');
  const [newQuestionSections, setNewQuestionSections] = useState([]);
  const [editingQIdx, setEditingQIdx]           = useState(null);
  const [editingQText, setEditingQText]         = useState('');
  const [expandedQIdx, setExpandedQIdx]         = useState(null);  // which internal prompt is being editedor is open
  const [configSections, setConfigSections]     = useState([]);
  const [selectedSections, setSelectedSections] = useState([]);
  const [quantumFeatureEnabled, setQuantumFeatureEnabled] = useState(true);
  const newQuestionRef  = useRef(null);
  const editingInputRef = useRef(null);

  useEffect(() => {
    const params = clientId ? `?client_id=${clientId}` : '';
    fetch(`/api/plugins/horoscope_reading/config${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
    })
      .then(r => r.json())
      .then(data => {
        const secs = Array.isArray(data?.horoscope_sections) && data.horoscope_sections.length > 0
          ? data.horoscope_sections.map(s => s.label || s).filter(Boolean)
          : ['Personality','Education','Career & Finance','Love & Marriage','Property, Land & Vehicles','Health & Accidents','Children','Life Summary','Current Dasha Period','Remedies','VIP Section'];
        setConfigSections(secs);
        setSelectedSections(secs); // all selected by default
        setQuantumFeatureEnabled(data?.quantum_enabled !== false);
      })
      .catch(() => {
        const defaults = ['Personality','Education','Career & Finance','Love & Marriage','Property, Land & Vehicles','Health & Accidents','Children','Life Summary','Current Dasha Period','Remedies','VIP Section'];
        setConfigSections(defaults);
        setSelectedSections(defaults);
      });
  }, [clientId]);

  const toggleSection = (sec) => setSelectedSections(prev =>
    prev.includes(sec) ? prev.filter(s => s !== sec) : [...prev, sec]
  );

  const toggleNewSection = (sec) => setNewQuestionSections(prev =>
    prev.includes(sec) ? prev.filter(s => s !== sec) : [...prev, sec]
  );

  const addQuestion = () => {
    const q = (newQuestionRef.current?.value ?? newQuestion).trim();
    if (!q) return;
    // Manual add: seed the internal prompt with the display text — the agent can refine it below.
    setSpecialQuestions(prev => [...prev, { question: q, prompt: q, sections: newQuestionSections }]);
    setNewQuestion('');
    setNewQuestionSections([]);
    if (newQuestionRef.current) { newQuestionRef.current.value = ''; newQuestionRef.current.style.height = 'auto'; }
  };
  const removeQuestion = (i) => { setSpecialQuestions(prev => prev.filter((_, idx) => idx !== i)); if (editingQIdx === i) setEditingQIdx(null); if (expandedQIdx === i) setExpandedQIdx(null); };
  const startEdit = (i) => { setEditingQIdx(i); setEditingQText(specialQuestions[i].question); };
  const saveEdit  = (i) => {
    const t = (editingInputRef.current?.value ?? editingQText).trim();
    if (t) setSpecialQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, question: t } : q));
    setEditingQIdx(null);
  };
  const updateQuestionPrompt = (i, text) =>
    setSpecialQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, prompt: text } : q));
  const toggleQuestionSection = (qi, sec) => {
    setSpecialQuestions(prev => prev.map((q, idx) => idx === qi
      ? { ...q, sections: q.sections.includes(sec) ? q.sections.filter(s => s !== sec) : [...q.sections, sec] }
      : q
    ));
  };

  // ── Aura & Quantum state ───────────────────────────────────────────────────
  // includeQuantum is derived — selecting the 3490 full package enables it, but only when quantum feature is on
  const includeQuantum = quantumFeatureEnabled && packageType === '3490';
  const [activeName, setActiveName]         = useState(existingHd.quantum_data?.active_name || '');
  const [auraAnalysis, setAuraAnalysis]     = useState(existingHd.aura_analysis || null);
  const [auraUploading, setAuraUploading]   = useState(false);
  const [overrideAura, setOverrideAura]     = useState(false);


  // Chips: unique non-empty words from customerName
  const nameChips = [...new Set(customerName.trim().split(/\s+/).filter(Boolean))];

  const handleAuraFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    setAuraUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('order_id', order.order_id);
      if (overrideAura) formData.append('override', '1');
      if (clientId) formData.append('client_id', clientId);
      const r = await api.post('/plugins/horoscope/analyze-aura', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAuraAnalysis(r.data.aura_analysis);
      setOverrideAura(false);
      toast.success(r.data.cached ? 'Using saved aura analysis' : 'Aura analysis complete');
    } catch (e) {
      toast.error('Aura analysis failed: ' + (e?.response?.data?.error || e.message));
    } finally {
      setAuraUploading(false);
    }
  };

  // ── Generating ─────────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);

  // ── Agentic generation (Generator⇄Critic) live progress ─────────────────────
  const [agentRunning, setAgentRunning]   = useState(false);
  const [agentProgress, setAgentProgress] = useState(null);
  const agentPollRef = useRef(null);

  const stopAgentPoll = () => { if (agentPollRef.current) { clearInterval(agentPollRef.current); agentPollRef.current = null; } };
  useEffect(() => () => stopAgentPoll(), []); // clear interval on unmount

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape' && !agentRunning) onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, agentRunning]);

  const [generatingQuantum, setGeneratingQuantum] = useState(false);

  const buildPayload = (overrides = {}) => ({
    order_id:          order.order_id,
    lat:               selectedPlace?.lat,
    lng:               selectedPlace?.lng,
    birth_place_name:  selectedPlace?.name || '',
    override_astro:    overrideAstro,
    special_questions: specialQuestions,  // [{question, prompt, sections}]
    selected_sections: selectedSections,
    package_type:      packageType,
    birth_overrides:   { customer_name: customerName, birth_date: birthDate, birth_time: `${birthHour}:${birthMinute}` },
    active_name:       activeName.trim(),
    ...(clientId && { client_id: clientId }),
    ...overrides,
  });

  const handleGenerate = async () => {
    if (!selectedPlace)    return toast.error('Please select a birth place');
    if (!birthDate.trim()) return toast.error('Birth date is required');
    if (includeQuantum && !hasSections) {
      if (!activeName.trim())            return toast.error('Active name required for Quantum Code');
      if (!/[A-Za-z]/.test(activeName)) return toast.error('Active name must contain English letters (e.g. "Malith") for numerology');
      if (!auraAnalysis)                 return toast.error('Please upload a photo for Aura analysis first');
    }
    setGenerating(true);
    try {
      await api.post('/plugins/horoscope/generate', buildPayload({
        include_quantum: hasSections ? false : includeQuantum,
      }));
      toast.success('Generation started. Takes about 2 min. You can navigate away.');
      onGenerated?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to start generation');
      setGenerating(false);
    }
  };

  const handleGenerateAgent = async () => {
    if (!selectedPlace)    return toast.error('Please select a birth place');
    if (!birthDate.trim()) return toast.error('Birth date is required');
    try {
      // Agent builds the section report only (quantum stays a separate step).
      await api.post('/plugins/horoscope/generate', buildPayload({ include_quantum: false, use_agent: true }));
      setAgentRunning(true);
      setAgentProgress({ phase: 'starting' });
      onGenerated?.(); // let the list start its own polling too
      // Poll live progress; keep the modal open so the loop is visible.
      stopAgentPoll();
      agentPollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get(`/plugins/horoscope/progress/${order.order_id}`);
          if (data.error) {
            stopAgentPoll();
            setAgentRunning(false);
            setAgentProgress(null);
            toast.error('Agent generation failed: ' + data.error);
            return;
          }
          if (data.agent_progress) setAgentProgress(data.agent_progress);
          // Finished when the generating flag is cleared and sections exist.
          if (!data.generating && data.has_sections) {
            stopAgentPoll();
            setAgentProgress({ phase: 'done', ...(data.agent_audit || {}) });
            onGenerated?.();
          }
        } catch { /* transient — keep polling */ }
      }, 3000);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to start agent generation');
    }
  };

  const handleRegenerateQuantum = async () => {
    if (!activeName.trim())            return toast.error('Active name required for Quantum Code');
    if (!/[A-Za-z]/.test(activeName)) return toast.error('Active name must contain English letters');
    if (!auraAnalysis)                 return toast.error('Please upload a photo for Aura analysis first');
    setGeneratingQuantum(true);
    try {
      await api.post('/plugins/horoscope/generate', buildPayload({ include_quantum: true, override_astro: false }));
      toast.success('Quantum regeneration started. Download the updated PDF when done.');
      onGenerated?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to start quantum regeneration');
      setGeneratingQuantum(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
  const labelCls = 'text-xs font-medium text-slate-500 block mb-1';

  return (
    <div className="fixed inset-0 z-50 flex bg-black/50">
      <div
        className="bg-white shadow-2xl w-full overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              {tab === 'match' ? '💑 Generate Match Making Report' : '🔮 Generate Horoscope Reading'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">#{order?.order_id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-xl leading-none">×</button>
        </div>

        {/* Two-column body */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left: Chat */}
          <div className="w-1/2 shrink-0 border-r border-slate-100 flex flex-col overflow-hidden">
            <ChatThread
              customer={{ phone: order?.phone || order?.phone_number, name: order?.customer_name || order?.phone || order?.phone_number }}
              clientId={clientId}
            />
          </div>

          {/* Right: Form */}
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">

        {/* Report tabs */}
        {showMatch && (
          <div className="flex gap-1 px-5 pt-3 border-b border-slate-100 shrink-0">
            {[
              { key: 'horoscope', label: '🔮 Horoscope' },
              { key: 'match',     label: '💑 Match Making' },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="px-4 py-2 text-sm font-medium bg-transparent border-0 cursor-pointer"
                style={{
                  color: tab === t.key ? (t.key === 'match' ? '#0d9488' : '#6366f1') : '#94a3b8',
                  borderBottom: `2px solid ${tab === t.key ? (t.key === 'match' ? '#0d9488' : '#6366f1') : 'transparent'}`,
                  marginBottom: '-1px',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {tab === 'match' ? (
          <MatchMakingPanel
            order={order}
            clientId={clientId}
            existingHd={existingHd}
            onClose={onClose}
            onGenerated={onGenerated}
          />
        ) : (
        <>

        {/* Customer details */}
        {Object.keys(cf).length > 0 && (
          <div className="border-b border-slate-100">
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

        {/* Chart data panel */}
        {hasChart && (
          <div className="border-b border-slate-100">
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
                {JSON.stringify(existingHd.chart_data, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-3">

          {/* Agent live progress */}
          {agentRunning && (() => {
            const p = agentProgress || {};
            const done = p.phase === 'done';
            const line =
              p.phase === 'starting' ? 'Starting agent…'
              : p.phase === 'writing'   ? `✍️ Writing section ${p.index}/${p.total} — ${p.detail}`
              : p.phase === 'reviewing' ? `🔍 Critic reviewing (pass ${p.iteration})…`
              : p.phase === 'reviewed'  ? `🔍 Critic pass ${p.iteration}: ${p.issues} issue(s) found`
              : p.phase === 'revising'  ? `♻️ Revising ${p.detail} flagged section(s)…`
              : done                    ? `✅ Done — ${p.iterations ?? '?'} iteration(s), ${p.totalIssues ?? 0} issue(s) fixed${p.status && p.status !== 'passed' ? ` (${p.status})` : ''}`
              : 'Working…';
            return (
              <div className={`rounded-xl border p-3 flex items-center gap-3 ${done ? 'bg-emerald-50 border-emerald-200' : 'bg-violet-50 border-violet-200'}`}>
                {!done && <span className="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin block shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{line}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{done ? 'Report ready — close to review or download.' : 'Generator ⇄ Critic reflection loop running. You can close and check back; it continues in the background.'}</p>
                </div>
                {done && (
                  <button type="button" onClick={() => { setAgentRunning(false); onClose(); }}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg border-0 cursor-pointer hover:bg-emerald-700">Close</button>
                )}
              </div>
            );
          })()}

          {/* Auto Fill */}
          <button
            type="button"
            disabled={aiPreparing}
            onClick={async () => {
              setAiPreparing(true);
              try {
                const r = await api.post(`/plugins/horoscope/ai-prepare/${order?.order_id}`, {
                  ...(clientId && { client_id: clientId }),
                });
                const { birth_date_iso, birth_time_24h, birth_place_en, lat, lng, special_questions } = r.data;

                if (birth_date_iso) setBirthDate(birth_date_iso);
                if (birth_time_24h) {
                  const [h, m] = birth_time_24h.split(':');
                  setBirthHour(h.padStart(2, '0'));
                  setBirthMinute(m.padStart(2, '0'));
                }
                if (lat && lng) {
                  const place = { lat, lng, name: birth_place_en || '' };
                  setSelectedPlace(place);
                  setGeoQuery(birth_place_en || '');
                  setGeoSuggestions([]);
                }
                if (Array.isArray(special_questions) && special_questions.length) {
                  setSpecialQuestions(special_questions);
                }
                toast.success('Auto Fill completed — review and generate');
              } catch (e) {
                toast.error(e?.response?.data?.error || 'Auto Fill failed');
              } finally {
                setAiPreparing(false);
              }
            }}
            className="w-full py-2.5 text-sm font-semibold rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
            style={{ background: aiPreparing ? '#f3f0ff' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: aiPreparing ? '#7c3aed' : '#fff' }}
          >
            {aiPreparing
              ? <><span className="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin block" />Preparing…</>
              : '✨ Auto Fill — Read Chat & Prepare'}
          </button>

          {/* Customer name */}
          <div>
            <label className={labelCls}>Customer Name</label>
            <input className={inputCls} value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Full name" />
          </div>

          {/* Birth date */}
          <div>
            <label className={labelCls}>Birth Date</label>
            {cf.birth_date && <p className="text-xs text-amber-600 mb-1">From order: <span className="font-mono">{cf.birth_date}</span></p>}
            <input type="date" className={inputCls} value={birthDate} onChange={e => setBirthDate(e.target.value)} />
          </div>

          {/* Birth time */}
          <div>
            <label className={labelCls}>Birth Time (24h)</label>
            {cf.birth_time && <p className="text-xs text-amber-600 mb-1">Original: <span className="font-mono">{cf.birth_time}</span></p>}
            <div className="flex gap-2">
              <select value={birthHour} onChange={e => setBirthHour(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 bg-white">
                {HOURS.map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
              <select value={birthMinute} onChange={e => setBirthMinute(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 bg-white">
                {MINUTES.map(m => <option key={m} value={m}>{m}m</option>)}
              </select>
            </div>
          </div>

          {/* Birth place */}
          <div className="relative">
            <label className={labelCls}>Birth Place</label>
            {cf.birth_place && <p className="text-xs text-amber-600 mb-1">From order: <span className="font-mono">{cf.birth_place}</span></p>}
            <input
              ref={geoRef}
              type="text"
              value={geoQuery}
              onChange={handleGeoInput}
              placeholder="Type a city name…"
              autoComplete="off"
              className={inputCls}
            />
            {geoSuggestions.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                {geoSuggestions.map((s, i) => (
                  <li key={i}>
                    <button onClick={() => selectPlace(s)}
                      className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-violet-50 cursor-pointer bg-transparent border-0">
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedPlace && (
              <p className="text-xs text-emerald-600 mt-1">✓ {selectedPlace.lat.toFixed(4)}, {selectedPlace.lng.toFixed(4)}</p>
            )}
          </div>

          {/* Check Sign */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={checkingSign || !selectedPlace || !birthDate}
              onClick={async () => {
                setCheckingSign(true);
                try {
                  const r = await api.post('/plugins/horoscope/fetch-chart', {
                    order_id: order?.order_id,
                    lat: selectedPlace.lat,
                    lng: selectedPlace.lng,
                    birth_place_name: selectedPlace.name || '',
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
                  setCheckingSign(false);
                }
              }}
              className="px-4 py-2 text-sm font-medium rounded-xl border-0 cursor-pointer disabled:opacity-50 transition-colors"
              style={{ background: '#f3f0ff', color: '#7c3aed' }}
            >
              {checkingSign ? 'Checking…' : '🔍 Check Sign'}
            </button>
            {detectedLagna && (
              <div className="flex items-center gap-2">
                <span className="text-2xl leading-none" title={detectedLagna}>
                  {ZODIAC_SYMBOL[detectedLagna] || ''}
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold text-slate-800">{LAGNA_SI[detectedLagna] || detectedLagna}</span>
                  <span className="text-xs text-slate-400">{detectedLagna}</span>
                </div>
              </div>
            )}
          </div>

          {/* Package selection */}
          <div>
            <label className={labelCls}>Package</label>
            <div className="flex flex-wrap gap-3">
              {[
                // Labels name the depth of the report, not a price. These used
                // to read "Rs. 2990" and "Rs. 3490", which stopped being true at
                // the reprice and is not this control's business anyway - what
                // the customer pays is settled on the order, from the block they
                // were quoted from. The values stay as they are; the backend
                // keys report depth off them.
                { value: '2990', label: 'Basic', badge: null },
                { value: '3490', label: 'Full', badge: quantumFeatureEnabled ? '+ Aura & Quantum' : null },
              ].map(({ value, label, badge }) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="package_type"
                    value={value}
                    checked={packageType === value}
                    onChange={() => setPackageType(value)}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span className="text-sm text-slate-700 font-medium">
                    {label}
                    {badge && <span className="ml-1 text-xs text-violet-600 font-semibold">{badge}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Aura & Quantum expanded section — shown when 1500_aura is selected */}
          {includeQuantum && (
            <div className="flex flex-col gap-3">

                {/* Active name with chips */}
                <div>
                  <label className={labelCls}>
                    Active Name <span className="text-slate-400 font-normal">(English letters only — used for Pythagorean numerology)</span>
                  </label>
                  {nameChips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {nameChips.map(chip => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setActiveName(chip)}
                          className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer transition-colors ${
                            activeName === chip
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                          }`}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    className={inputCls}
                    value={activeName}
                    onChange={e => setActiveName(e.target.value)}
                    placeholder="e.g. Malith, Nilushya, Kavinda…"
                  />
                  {activeName.trim() && !/[A-Za-z]/.test(activeName) && (
                    <p className="text-xs text-red-500 mt-1">Name must contain English letters (e.g. &quot;Malith&quot; not &quot;මලිත්&quot;) for the numerology calculation.</p>
                  )}
                </div>

                {/* Saved aura card */}
                {auraAnalysis && !overrideAura && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-emerald-800">✦ Aura Analysis</span>
                      <button
                        type="button"
                        onClick={() => setOverrideAura(true)}
                        className="text-xs text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer underline"
                      >
                        Upload new photo
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-3 h-3 rounded-full"
                            style={{ background: auraScoreColor(auraAnalysis.af_score) }}
                          />
                          <span className="text-sm font-bold text-slate-800">
                            Af Score: {auraAnalysis.af_score.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-1 w-full bg-slate-200 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${auraAnalysis.af_score * 100}%`,
                              background: auraScoreColor(auraAnalysis.af_score),
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {auraAnalysis.energy_level   && <span className="text-slate-500">Energy: <b className="text-slate-700">{auraAnalysis.energy_level}</b></span>}
                      {auraAnalysis.dominant_color  && <span className="text-slate-500">Color: <b className="text-slate-700">{auraAnalysis.dominant_color}</b></span>}
                      {auraAnalysis.primary_chakra  && <span className="text-slate-500">Chakra: <b className="text-slate-700">{auraAnalysis.primary_chakra}</b></span>}
                      {auraAnalysis.aura_stability  && <span className="text-slate-500">Stability: <b className="text-slate-700">{auraAnalysis.aura_stability}</b></span>}
                    </div>
                    {auraAnalysis.recommendation_hint && (
                      <p className="mt-2 text-xs text-indigo-700 italic">{auraAnalysis.recommendation_hint}</p>
                    )}
                  </div>
                )}

                {/* Upload area (shown when no aura yet, or override requested) */}
                {(!auraAnalysis || overrideAura) && (
                  <div>
                    <label className={labelCls}>
                      Customer Selfie {overrideAura && <span className="text-amber-600">(replacing saved analysis)</span>}
                    </label>
                    <div
                      className="border-2 border-dashed border-indigo-200 rounded-xl p-4 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors relative"
                      onClick={() => auraFileRef.current?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); handleAuraFile(e.dataTransfer.files[0]); }}
                    >
                      <input
                        ref={auraFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => handleAuraFile(e.target.files[0])}
                      />
                      {auraUploading ? (
                        <div className="flex flex-col items-center gap-2 py-2">
                          <span className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin block" />
                          <span className="text-xs text-indigo-600 font-medium">Analysing aura…</span>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-slate-500">Click or drag a selfie here</p>
                          <p className="text-xs text-slate-400 mt-1">JPEG / PNG · max 10 MB</p>
                        </>
                      )}
                    </div>
                    {overrideAura && (
                      <button
                        type="button"
                        onClick={() => setOverrideAura(false)}
                        className="mt-1 text-xs text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer underline"
                      >
                        Cancel — keep saved analysis
                      </button>
                    )}
                  </div>
                )}


            </div>
          )}

          {/* Sections to generate */}
          {configSections.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelCls} style={{ marginBottom: 0 }}>
                  Sections to Generate
                  <span className="ml-1 text-slate-400 font-normal">({selectedSections.length}/{configSections.length} selected)</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSections([...configSections])}
                    className="text-xs text-violet-600 hover:text-violet-800 bg-transparent border-0 cursor-pointer underline"
                  >All</button>
                  <button
                    type="button"
                    onClick={() => setSelectedSections([])}
                    className="text-xs text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer underline"
                  >None</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {configSections.map((sec, i) => {
                  const active = selectedSections.includes(sec);
                  return (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => toggleSection(sec)}
                      className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border cursor-pointer transition-colors font-medium ${
                        active
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span className="opacity-60 text-[10px]">{i + 1}</span>
                      {sec}
                    </button>
                  );
                })}
              </div>
              {selectedSections.length === 0 && (
                <p className="text-xs text-amber-600 mt-1.5">No sections selected — generation will be skipped.</p>
              )}
            </div>
          )}

          {/* Special questions */}
          <div>
            <label className={labelCls}>Special Questions <span className="text-slate-400 font-normal">(optional — select sections to use as context)</span></label>
            <div className="flex gap-2 mb-2">
              <textarea
                ref={newQuestionRef}
                className={inputCls}
                style={{ resize: 'none', overflow: 'hidden', minHeight: '38px', lineHeight: '1.5' }}
                rows={1}
                value={newQuestion}
                onChange={e => {
                  setNewQuestion(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addQuestion(); } }}
                placeholder="Describe the customer's problem or question…"
              />
              <button
                type="button"
                onClick={addQuestion}
                className="px-3 py-2 text-xs font-medium bg-violet-100 text-violet-700 rounded-xl border-0 cursor-pointer hover:bg-violet-200 shrink-0"
              >Add</button>
            </div>
            {/* Section tags for the new question being typed */}
            {configSections.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-slate-400 mb-1.5">Apply to sections (optional):</p>
                <div className="flex flex-wrap gap-1.5">
                  {configSections.map(sec => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => toggleNewSection(sec)}
                      className={`px-2 py-0.5 text-xs rounded-full border cursor-pointer transition-colors ${
                        newQuestionSections.includes(sec)
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-violet-300 hover:text-violet-600'
                      }`}
                    >{sec}</button>
                  ))}
                </div>
              </div>
            )}
            {specialQuestions.length > 0 && (
              <ul className="flex flex-col gap-2">
                {specialQuestions.map((qObj, i) => (
                  <li key={i} className="bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-700">
                    <div className="flex items-start gap-2 mb-1.5">
                      {editingQIdx === i ? (
                        <input
                          ref={editingInputRef}
                          autoFocus
                          className="flex-1 text-xs border border-violet-300 rounded px-1 py-0.5 outline-none bg-white"
                          value={editingQText}
                          onChange={e => setEditingQText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(i); if (e.key === 'Escape') setEditingQIdx(null); }}
                          onBlur={() => saveEdit(i)}
                        />
                      ) : (
                        /* Display question — hover reveals the detailed internal prompt in a popover */
                        <span className="relative flex-1 group">
                          <span className="cursor-pointer hover:text-violet-700" onClick={() => startEdit(i)} title="Click to edit the customer-facing question">{i + 1}. {qObj.question}</span>
                          <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-full group-hover:block">
                            <span className="block rounded-lg bg-slate-800 text-slate-50 text-sm leading-relaxed px-3 py-2.5 shadow-xl whitespace-pre-wrap break-words">
                              <span className="block text-[11px] uppercase tracking-wide text-violet-300 mb-1">Internal instruction</span>
                              {qObj.prompt || qObj.question}
                            </span>
                          </span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedQIdx(expandedQIdx === i ? null : i)}
                        className={`shrink-0 bg-transparent border-0 cursor-pointer leading-none px-1 ${expandedQIdx === i ? 'text-violet-600' : 'text-slate-400 hover:text-violet-600'}`}
                        title="Edit the detailed internal instruction"
                      >{expandedQIdx === i ? '⌃' : '⌄'} edit</button>
                      <button type="button" onClick={() => removeQuestion(i)} className="text-slate-400 hover:text-red-500 bg-transparent border-0 cursor-pointer leading-none shrink-0">×</button>
                    </div>
                    {/* Expanded internal-instruction editor (never shown to the customer) */}
                    {expandedQIdx === i && (
                      <div className="mb-2">
                        <p className="text-[11px] text-slate-400 mb-1">Detailed instruction used when writing this answer (the customer never sees it):</p>
                        <textarea
                          autoFocus
                          value={qObj.prompt || ''}
                          onChange={e => updateQuestionPrompt(i, e.target.value)}
                          rows={5}
                          className="w-full text-sm leading-relaxed border border-violet-300 rounded-lg px-2 py-1.5 outline-none bg-white resize-y focus:ring-2 focus:ring-violet-100"
                          placeholder="Describe in detail what should be analysed and answered…"
                        />
                      </div>
                    )}
                    {/* Per-question section tags */}
                    {configSections.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {configSections.map(sec => (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => toggleQuestionSection(i, sec)}
                            className={`px-1.5 py-0.5 text-xs rounded-full border cursor-pointer transition-colors ${
                              qObj.sections.includes(sec)
                                ? 'bg-indigo-500 text-white border-indigo-500'
                                : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300 hover:text-indigo-500'
                            }`}
                          >{sec}</button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Override astro checkbox */}
          {hasChart && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={overrideAstro}
                onChange={e => setOverrideAstro(e.target.checked)}
                className="w-4 h-4 accent-violet-600"
              />
              <span className="text-xs text-slate-600">Override saved astro data (re-call freeastroapi)</span>
            </label>
          )}

          <p className="text-xs text-slate-400">Timezone: Asia/Colombo · Generation runs in the background (~2 min)</p>
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
              onClick={handleGenerate}
              disabled={generating || generatingQuantum || agentRunning || !selectedPlace || !birthDate.trim() || auraUploading || selectedSections.length === 0}
              className="flex-1 min-w-[160px] py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: generating ? '#4f46e5' : 'linear-gradient(135deg,#4f46e5,#6366f1)' }}
            >
              {generating ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />Starting…</>
              ) : (
                hasSections ? '🔮 Generate Reading Again' : '🔮 Generate Reading'
              )}
            </button>
            <button
              onClick={handleGenerateAgent}
              disabled={generating || generatingQuantum || agentRunning || !selectedPlace || !birthDate.trim() || auraUploading || selectedSections.length === 0}
              title="Generator ⇄ Critic reflection loop — higher quality, ~3–5 min"
              className="flex-1 min-w-[160px] py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: agentRunning ? '#6d28d9' : 'linear-gradient(135deg,#7c3aed,#9333ea)' }}
            >
              {agentRunning ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />Agent running…</>
              ) : (
                '🤖 Generate with Agent'
              )}
            </button>
            {(hasSections || includeQuantum) && (
              <button
                onClick={handleRegenerateQuantum}
                disabled={generating || generatingQuantum || agentRunning || !auraAnalysis || !activeName.trim() || auraUploading}
                className="flex-1 min-w-[160px] py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: generatingQuantum ? '#7c3aed' : 'linear-gradient(135deg,#7c3aed,#a855f7)' }}
              >
                {generatingQuantum ? (
                  <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />Starting…</>
                ) : (
                  '✦ Regenerate Quantum'
                )}
              </button>
            )}
          </div>
        </div>{/* end footer */}

        </>
        )}

          </div>{/* end right column */}
        </div>{/* end two-column body */}
      </div>
    </div>
  );
}
