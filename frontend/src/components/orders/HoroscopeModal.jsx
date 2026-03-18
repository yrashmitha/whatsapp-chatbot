import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

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

export default function HoroscopeModal({ order, clientId, onClose, onGenerated }) {
  const toast = useToast();
  const geoRef = useRef();
  const [showOrderDetails, setShowOrderDetails] = useState(true);

  const cf = (() => {
    if (!order?.custom_fields) return {};
    if (typeof order.custom_fields === 'object') return order.custom_fields;
    try { return JSON.parse(order.custom_fields); } catch { return {}; }
  })();

  const existingHd = (() => {
    if (!order?.horoscope_data) return {};
    if (typeof order.horoscope_data === 'object') return order.horoscope_data;
    try { return JSON.parse(order.horoscope_data); } catch { return {};  }
  })();

  const hasChart = !!existingHd.chart_data;

  // Editable birth fields
  const [customerName, setCustomerName] = useState(cf.customer_name || '');
  const [birthDate, setBirthDate]       = useState(toISODate(cf.birth_date || ''));
  const [birthHour, setBirthHour]       = useState('07');
  const [birthMinute, setBirthMinute]   = useState('00');
  const [overrideAstro, setOverrideAstro] = useState(false);

  // Parse existing birth_time into hour/minute on mount
  useEffect(() => {
    const raw = cf.birth_time || '';
    if (/^\d{1,2}:\d{2}$/.test(raw)) {
      const [h, m] = raw.split(':');
      setBirthHour(h.padStart(2, '0'));
      setBirthMinute(m.padStart(2, '0'));
    } else {
      // Try to parse Sinhala time for display
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

  // Location picker
  const [geoQuery, setGeoQuery]         = useState(cf.birth_place || '');
  const [geoSuggestions, setGeoSuggestions] = useState([]);
  const [selectedPlace, setSelectedPlace]   = useState(
    hasChart && existingHd.lat ? { lat: existingHd.lat, lng: existingHd.lng, name: existingHd.birth_place_name || cf.birth_place || '' } : null
  );
  const debounceRef = useRef(null);

  const searchGeo = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setGeoSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
          { headers: { 'User-Agent': 'pj-crm/1.0' } }
        );
        const data = await r.json();
        setGeoSuggestions(data.map(d => ({ name: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) })));
      } catch { setGeoSuggestions([]); }
    }, 400);
  }, []);

  const handleGeoInput = (e) => {
    setGeoQuery(e.target.value);
    setSelectedPlace(null);
    searchGeo(e.target.value);
  };

  const selectPlace = (place) => {
    setSelectedPlace(place);
    setGeoQuery(place.name);
    setGeoSuggestions([]);
  };

  // Package selection
  const [packageType, setPackageType] = useState('1000');

  // Special questions
  const [specialQuestions, setSpecialQuestions] = useState([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [editingQIdx, setEditingQIdx] = useState(null);
  const [editingQText, setEditingQText] = useState('');
  const newQuestionRef = useRef(null);
  const editingInputRef = useRef(null);

  const addQuestion = () => {
    const q = (newQuestionRef.current?.value ?? newQuestion).trim();
    if (!q) return;
    setSpecialQuestions(prev => [...prev, q]);
    setNewQuestion('');
    if (newQuestionRef.current) {
      newQuestionRef.current.value = '';
      newQuestionRef.current.style.height = 'auto';
    }
  };

  const removeQuestion = (i) => {
    setSpecialQuestions(prev => prev.filter((_, idx) => idx !== i));
    if (editingQIdx === i) setEditingQIdx(null);
  };

  const startEdit = (i) => { setEditingQIdx(i); setEditingQText(specialQuestions[i]); };

  const saveEdit = (i) => {
    const t = (editingInputRef.current?.value ?? editingQText).trim();
    if (t) setSpecialQuestions(prev => prev.map((q, idx) => idx === i ? t : q));
    setEditingQIdx(null);
  };

  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!selectedPlace) return toast.error('Please select a birth place');
    if (!birthDate.trim()) return toast.error('Birth date is required');
    setGenerating(true);
    try {
      await api.post('/plugins/horoscope/generate', {
        order_id: order.order_id,
        lat: selectedPlace.lat,
        lng: selectedPlace.lng,
        birth_place_name: selectedPlace.name,
        override_astro: overrideAstro,
        special_questions: specialQuestions,
        package_type: packageType,
        birth_overrides: {
          customer_name: customerName,
          birth_date: birthDate,
          birth_time: `${birthHour}:${birthMinute}`,
        },
        ...(clientId && { client_id: clientId }),
      });
      toast.success('Generation started — takes ~2 min. You can navigate away.');
      onGenerated?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to start generation');
      setGenerating(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
  const labelCls = 'text-xs font-medium text-slate-500 block mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">🔮 Generate Horoscope Reading</h2>
            <p className="text-xs text-slate-400 mt-0.5">#{order?.order_id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-3">

          {/* Order details panel */}
          {Object.keys(cf).length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowOrderDetails(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 bg-violet-50 text-xs font-medium text-violet-700 hover:bg-violet-100 border-0 cursor-pointer"
              >
                <span>📋 Customer Order Details</span>
                <span className="text-slate-400">{showOrderDetails ? '▲' : '▼'}</span>
              </button>
              {showOrderDetails && (
                <div className="px-3 py-2 flex flex-col gap-2 bg-white">
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                    {Object.entries(cf).map(([k, v]) => v ? (
                      <div key={k} className="flex gap-2 text-xs">
                        <span className="text-slate-400 shrink-0 capitalize">{k.replace(/_/g, ' ')}:</span>
                        <span className="text-slate-700 font-mono break-all">{String(v)}</span>
                      </div>
                    ) : null)}
                  </div>
                  {order?.ai_summary && (
                    <div className="bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                      <span className="text-violet-500 font-semibold block mb-1">✨ AI Summary</span>
                      {order.ai_summary}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Customer name */}
          <div>
            <label className={labelCls}>Customer Name</label>
            <input className={inputCls} value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Full name" />
          </div>

          {/* Birth date */}
          <div>
            <label className={labelCls}>Birth Date</label>
            {cf.birth_date && <p className="text-xs text-amber-600 mb-1">From order: <span className="font-mono">{cf.birth_date}</span></p>}
            <input
              type="date"
              className={inputCls}
              value={birthDate}
              onChange={e => setBirthDate(e.target.value)}
            />
          </div>

          {/* Birth time */}
          <div>
            <label className={labelCls}>Birth Time (24h)</label>
            {cf.birth_time && (
              <p className="text-xs text-amber-600 mb-1">Original: <span className="font-mono">{cf.birth_time}</span></p>
            )}
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
            {cf.birth_place && (
              <p className="text-xs text-amber-600 mb-1">From order: <span className="font-mono">{cf.birth_place}</span></p>
            )}
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
              <p className="text-xs text-emerald-600 mt-1">
                ✓ {selectedPlace.lat.toFixed(4)}, {selectedPlace.lng.toFixed(4)}
              </p>
            )}
          </div>

          {/* Package selection */}
          <div>
            <label className={labelCls}>Package</label>
            <div className="flex gap-4">
              {['1000', '1500'].map(pkg => (
                <label key={pkg} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="package_type"
                    value={pkg}
                    checked={packageType === pkg}
                    onChange={() => setPackageType(pkg)}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span className="text-sm text-slate-700 font-medium">
                    Rs. {pkg}
                    {pkg === '1500' && <span className="ml-1 text-xs text-violet-600 font-semibold">+ VIP Section</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Special questions */}
          <div>
            <label className={labelCls}>Special Questions <span className="text-slate-400 font-normal">(optional)</span></label>
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
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addQuestion(); }
                }}
                placeholder="Type a question and press Enter or Add…"
              />
              <button
                type="button"
                onClick={addQuestion}
                className="px-3 py-2 text-xs font-medium bg-violet-100 text-violet-700 rounded-xl border-0 cursor-pointer hover:bg-violet-200 shrink-0"
              >Add</button>
            </div>
            {specialQuestions.length > 0 && (
              <ul className="flex flex-col gap-1">
                {specialQuestions.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-1.5 text-xs text-slate-700">
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
                      <span className="flex-1 cursor-pointer hover:text-violet-700" onClick={() => startEdit(i)} title="Click or press Enter to edit">{i + 1}. {q}</span>
                    )}
                    <button type="button" onClick={() => removeQuestion(i)} className="text-slate-400 hover:text-red-500 bg-transparent border-0 cursor-pointer leading-none shrink-0">×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Override astro checkbox (only if chart already exists) */}
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
        <div className="px-5 py-4 border-t border-slate-100">
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedPlace || !birthDate.trim()}
            className="w-full py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: generating ? '#7c3aed' : 'linear-gradient(135deg,#7c3aed,#a855f7)' }}
          >
            {generating ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
                Starting…
              </>
            ) : '🔮 Generate Reading'}
          </button>
        </div>
      </div>
    </div>
  );
}
