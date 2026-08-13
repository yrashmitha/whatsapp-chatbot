import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../../lib/api';
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

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100';
const labelCls = 'text-xs font-medium text-slate-500 block mb-1';

/** Blank person form state. */
const emptyPerson = () => ({
  name: '', birthDate: '', birthHour: '07', birthMinute: '00',
  geoQuery: '', place: null, lagna: null,
});

/** Rehydrate a saved match_boy / match_girl block into form state. */
function personFromSaved(saved) {
  if (!saved) return emptyPerson();
  const [h, m] = (saved.birth_time || '07:00').split(':');
  return {
    name:        saved.name || '',
    birthDate:   saved.birth_date || '',
    birthHour:   (h || '07').padStart(2, '0'),
    birthMinute: (m || '00').padStart(2, '0'),
    geoQuery:    saved.birth_place_name || '',
    place:       (saved.lat != null && saved.lng != null)
      ? { lat: saved.lat, lng: saved.lng, name: saved.birth_place_name || '' }
      : null,
    lagna:       saved.lagna || null,
  };
}

/**
 * Match Making (ගැළපීම) form — the right-hand pane of the order modal.
 *
 * Two people, side by side, each with their own "Check Sign" button. Both charts must be
 * fetched before the report can be generated, which is why the generate button stays
 * disabled until two lagnas are showing.
 */
export default function MatchMakingPanel({ order, clientId, existingHd, onClose, onGenerated }) {
  const toast = useToast();

  const [boy,  setBoy]  = useState(() => personFromSaved(existingHd.match_boy));
  const [girl, setGirl] = useState(() => personFromSaved(existingHd.match_girl));
  const [aiPreparing, setAiPreparing] = useState(false);
  const [checking, setChecking]       = useState({ boy: false, girl: false });
  const [generating, setGenerating]   = useState(false);
  const [saving, setSaving]           = useState(false);

  const hasReport = Array.isArray(existingHd.match_sections_data) && existingHd.match_sections_data.length > 0;

  // ── Special questions ──────────────────────────────────────────────────────
  const [questions, setQuestions] = useState(
    (existingHd.match_special_questions || existingHd.match_special_answers || [])
      .map(q => ({ question: q.question || '', prompt: q.prompt || q.question || '' }))
      .filter(q => q.question)
  );
  const [newQuestion, setNewQuestion] = useState('');
  const [expandedQIdx, setExpandedQIdx] = useState(null);

  // ── Geo autocomplete (one debounce timer per side) ─────────────────────────
  const [suggestions, setSuggestions] = useState({ boy: [], girl: [] });
  const debounceRef = useRef({ boy: null, girl: null });

  const searchGeo = useCallback((side, q) => {
    clearTimeout(debounceRef.current[side]);
    if (!q.trim()) { setSuggestions(s => ({ ...s, [side]: [] })); return; }
    debounceRef.current[side] = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
          { headers: { 'User-Agent': 'pj-crm/1.0' } }
        );
        const data = await r.json();
        setSuggestions(s => ({
          ...s,
          [side]: data.map(d => ({ name: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) })),
        }));
      } catch { setSuggestions(s => ({ ...s, [side]: [] })); }
    }, 400);
  }, []);

  useEffect(() => () => {
    clearTimeout(debounceRef.current.boy);
    clearTimeout(debounceRef.current.girl);
  }, []);

  const setters = { boy: setBoy, girl: setGirl };
  const people  = { boy, girl };

  const patch = (side, changes) => setters[side](p => ({ ...p, ...changes }));

  // Any change to the birth inputs invalidates the fetched chart — clearing `lagna`
  // disables Generate until Check Sign is pressed again, so the report can never be built
  // from a chart that no longer matches the form.
  const handleGeoInput = (side, value) => {
    patch(side, { geoQuery: value, place: null, lagna: null });
    searchGeo(side, value);
  };
  const selectPlace = (side, place) => {
    patch(side, { place, geoQuery: place.name, lagna: null });
    setSuggestions(s => ({ ...s, [side]: [] }));
  };

  // ── AI Fill — one pass over the chat, both people ──────────────────────────
  const handleAiFill = async () => {
    setAiPreparing(true);
    try {
      const r = await api.post(`/plugins/horoscope/ai-prepare-match/${order?.order_id}`, {
        ...(clientId && { client_id: clientId }),
      });
      const { boy: b, girl: g, special_questions } = r.data;

      const applyPerson = (side, data) => {
        if (!data) return false;
        const next = { name: data.name || '', birthDate: data.birth_date_iso || '' };
        if (data.birth_time_24h) {
          const [h, m] = data.birth_time_24h.split(':');
          next.birthHour   = (h || '07').padStart(2, '0');
          next.birthMinute = (m || '00').padStart(2, '0');
        }
        if (data.lat != null && data.lng != null) {
          next.place    = { lat: data.lat, lng: data.lng, name: data.birth_place_en || '' };
          next.geoQuery = data.birth_place_en || '';
        }
        patch(side, next);
        return true;
      };

      const gotBoy  = applyPerson('boy', b);
      const gotGirl = applyPerson('girl', g);

      if (Array.isArray(special_questions) && special_questions.length) {
        setQuestions(special_questions.map(q => ({ question: q.question, prompt: q.prompt || q.question })));
      }

      // Be explicit about a side that came back empty — the backend deliberately returns
      // null rather than guessing, and a silently blank column is easy to miss.
      const missing = [!gotBoy && 'පිරිමි (boy)', !gotGirl && 'ගැහැනු (girl)'].filter(Boolean);
      if (missing.length === 2) {
        toast.error('AI could not identify either person from the chat — fill both sides manually');
      } else if (missing.length === 1) {
        toast.error(`AI could not identify the ${missing[0]} details — fill that side manually`);
      } else {
        toast.success('AI filled both charts — check the boy/girl split before generating');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'AI prepare failed');
    } finally {
      setAiPreparing(false);
    }
  };

  // ── Check Sign — fetches and stores that person's chart ────────────────────
  const handleCheckSign = async (side) => {
    const p = people[side];
    setChecking(c => ({ ...c, [side]: true }));
    try {
      const r = await api.post('/plugins/horoscope/fetch-chart', {
        order_id: order?.order_id,
        target:   side,
        name:     p.name,
        lat:      p.place.lat,
        lng:      p.place.lng,
        birth_place_name: p.place.name || '',
        birth_overrides: {
          birth_date: p.birthDate,
          birth_time: `${p.birthHour}:${p.birthMinute}`,
        },
        ...(clientId && { client_id: clientId }),
      });
      patch(side, { lagna: r.data.sign });
      toast.success(`${side === 'boy' ? 'පිරිමි' : 'ගැහැනු'} chart saved`);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to fetch chart');
    } finally {
      setChecking(c => ({ ...c, [side]: false }));
    }
  };

  const toPayload = (p) => ({
    name:             p.name,
    birth_date:       p.birthDate,
    birth_time:       `${p.birthHour}:${p.birthMinute}`,
    birth_place_name: p.place?.name || '',
    ...(p.place && { lat: p.place.lat, lng: p.place.lng }),
  });

  const savePeople = async () => {
    await api.patch(`/plugins/horoscope/match-people/${order?.order_id}`, {
      match_boy:  toPayload(boy),
      match_girl: toPayload(girl),
      match_special_questions: questions,
      ...(clientId && { client_id: clientId }),
    });
  };

  const handleSaveOnly = async () => {
    setSaving(true);
    try {
      await savePeople();
      toast.success('Saved');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await savePeople();
      await api.post(`/plugins/horoscope/generate-match/${order?.order_id}`, {
        ...(clientId && { client_id: clientId }),
      });
      toast.success('Match making report started — takes ~3 min. It continues in the background.');
      onGenerated?.();
      onClose?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to start match making report');
      setGenerating(false);
    }
  };

  const bothCharted = !!boy.lagna && !!girl.lagna;

  // ── Per-person column ──────────────────────────────────────────────────────
  const PersonColumn = (side) => {
    const p = people[side];
    const isBoy = side === 'boy';
    const accent = isBoy
      ? { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' }
      : { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' };

    return (
      <div className={`flex flex-col gap-3 p-3 rounded-xl border ${accent.border} ${accent.bg}`}>
        <div className={`text-sm font-semibold ${accent.text} flex items-center gap-2`}>
          <span>{isBoy ? '👦' : '👧'}</span>
          <span>{isBoy ? 'පිරිමි (Boy)' : 'ගැහැනු (Girl)'}</span>
        </div>

        <div>
          <label className={labelCls}>Name</label>
          <input
            className={inputCls}
            value={p.name}
            onChange={e => patch(side, { name: e.target.value })}
            placeholder="Full name"
          />
        </div>

        <div>
          <label className={labelCls}>Birth Date</label>
          <input
            type="date"
            className={inputCls}
            value={p.birthDate}
            onChange={e => patch(side, { birthDate: e.target.value, lagna: null })}
          />
        </div>

        <div>
          <label className={labelCls}>Birth Time (24h)</label>
          <div className="flex gap-2">
            <select
              value={p.birthHour}
              onChange={e => patch(side, { birthHour: e.target.value, lagna: null })}
              className="flex-1 px-2 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 bg-white"
            >
              {HOURS.map(h => <option key={h} value={h}>{h}h</option>)}
            </select>
            <select
              value={p.birthMinute}
              onChange={e => patch(side, { birthMinute: e.target.value, lagna: null })}
              className="flex-1 px-2 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 bg-white"
            >
              {MINUTES.map(m => <option key={m} value={m}>{m}m</option>)}
            </select>
          </div>
        </div>

        <div className="relative">
          <label className={labelCls}>Birth Place</label>
          <input
            type="text"
            value={p.geoQuery}
            onChange={e => handleGeoInput(side, e.target.value)}
            placeholder="Type a city name…"
            autoComplete="off"
            className={inputCls}
          />
          {suggestions[side].length > 0 && (
            <ul className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
              {suggestions[side].map((s, i) => (
                <li key={i}>
                  <button
                    onClick={() => selectPlace(side, s)}
                    className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-teal-50 cursor-pointer bg-transparent border-0"
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {p.place && (
            <p className="text-xs text-emerald-600 mt-1">✓ {p.place.lat.toFixed(4)}, {p.place.lng.toFixed(4)}</p>
          )}
        </div>
      </div>
    );
  };

  // ── Check Sign button for one side ─────────────────────────────────────────
  const CheckSignButton = (side) => {
    const p = people[side];
    const isBoy = side === 'boy';
    return (
      <div className="flex-1 flex flex-col gap-2">
        <button
          type="button"
          disabled={checking[side] || !p.place || !p.birthDate}
          onClick={() => handleCheckSign(side)}
          className="w-full px-4 py-2 text-sm font-medium rounded-xl border-0 cursor-pointer disabled:opacity-50 transition-colors"
          style={{
            background: isBoy ? '#eff6ff' : '#fdf2f8',
            color:      isBoy ? '#1d4ed8' : '#be185d',
          }}
        >
          {checking[side] ? 'Checking…' : `🔍 Check Sign — ${isBoy ? 'පිරිමි' : 'ගැහැනු'}`}
        </button>
        {p.lagna && (
          <div className="flex items-center gap-2 justify-center">
            <span className="text-2xl leading-none" title={p.lagna}>{ZODIAC_SYMBOL[p.lagna] || ''}</span>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-slate-800">{LAGNA_SI[p.lagna] || p.lagna}</span>
              <span className="text-xs text-slate-400">{p.lagna}</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">

        {hasReport && (
          <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
            A match making report already exists for this order. Generating again replaces it.
          </div>
        )}

        {/* AI Fill */}
        <button
          type="button"
          disabled={aiPreparing}
          onClick={handleAiFill}
          className="w-full py-2.5 text-sm font-semibold rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
          style={{
            background: aiPreparing ? '#ecfeff' : 'linear-gradient(135deg,#0d9488,#0891b2)',
            color:      aiPreparing ? '#0f766e' : '#fff',
          }}
        >
          {aiPreparing
            ? <><span className="w-4 h-4 border-2 border-teal-300 border-t-teal-600 rounded-full animate-spin block" />Gemini is reading the chat…</>
            : '✨ AI Fill — Read Chat & Prepare Couple'}
        </button>
        <p className="text-xs text-slate-400 -mt-2">
          Reads both people out of one conversation. If it can&apos;t tell who is who it leaves that side blank rather than guessing — always check the split.
        </p>

        {/* Two people side by side */}
        <div className="grid grid-cols-2 gap-4">
          {PersonColumn('boy')}
          {PersonColumn('girl')}
        </div>

        {/* Two Check Sign buttons, aligned under their columns */}
        <div className="flex gap-4">
          {CheckSignButton('boy')}
          {CheckSignButton('girl')}
        </div>

        {!bothCharted && (
          <p className="text-xs text-amber-600">
            Both charts are required. Press “Check Sign” on each side — the report can&apos;t be generated until two lagnas show.
          </p>
        )}

        {/* Special questions */}
        <div>
          <label className={labelCls}>Special Questions ({questions.length})</label>
          <p className="text-xs text-slate-400 mb-2">
            The couple&apos;s own questions. Each gets its own answer after the main sections.
          </p>

          <div className="flex flex-col gap-2">
            {questions.map((q, i) => (
              <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-start gap-2 px-3 py-2 bg-slate-50">
                  <span className="text-xs text-slate-400 mt-1">{i + 1}.</span>
                  <input
                    className="flex-1 px-2 py-1 text-sm bg-white border border-slate-200 rounded-lg outline-none focus:border-teal-400"
                    value={q.question}
                    onChange={e => setQuestions(qs => qs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    onClick={() => setExpandedQIdx(expandedQIdx === i ? null : i)}
                    title="Edit the detailed Gemini instruction"
                    className="px-2 py-1 text-xs text-teal-600 bg-white border border-teal-200 rounded-lg cursor-pointer hover:bg-teal-50"
                  >
                    {expandedQIdx === i ? '▲' : '✎ AI'}
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
                    placeholder="Detailed Sinhala instruction for Gemini (the customer never sees this)…"
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
              placeholder="Add a question the couple asked…"
            />
            <button
              type="button"
              disabled={!newQuestion.trim()}
              onClick={() => {
                setQuestions(qs => [...qs, { question: newQuestion.trim(), prompt: newQuestion.trim() }]);
                setNewQuestion('');
              }}
              className="px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-xl border-0 cursor-pointer disabled:opacity-50 hover:bg-teal-100"
            >
              + Add
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Timezone: Asia/Colombo · Generation runs in the background (~3 min)
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
            {saving ? 'Saving…' : 'Save Details'}
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || !bothCharted}
            title={bothCharted ? '' : 'Press Check Sign for both people first'}
            className="flex-1 min-w-[200px] py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: generating ? '#0f766e' : 'linear-gradient(135deg,#0d9488,#0891b2)' }}
          >
            {generating
              ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />Starting…</>
              : (hasReport ? '💑 Generate Match Report Again' : '💑 Generate Match Report')}
          </button>
        </div>
      </div>
    </>
  );
}
