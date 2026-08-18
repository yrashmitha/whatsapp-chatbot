import { useState, useEffect, useRef, useCallback } from 'react';
import api, { GEO_USER_AGENT } from '../../lib/api';
import { useToast } from '../ui/Toast';

const SINHALA_MONTHS = {
  'ජනවාරි': '01', 'පෙබරවාරි': '02', 'මාර්තු': '03', 'අප්‍රේල්': '04',
  'මැයි': '05', 'ජූනි': '06', 'ජූලි': '07', 'අගෝස්තු': '08',
  'සැප්තැම්බර්': '09', 'ඔක්තෝබර්': '10', 'නොවැම්බර්': '11', 'දෙසැම්බර්': '12',
};

function parseSinhalaDate(raw) {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 3) {
    const [year, monthName, day] = parts;
    const month = SINHALA_MONTHS[monthName];
    if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
  }
  return raw;
}

function parseSinhalaTime(raw) {
  if (!raw) return '';
  if (/^\d{1,2}:\d{2}$/.test(raw)) return raw;
  // රාත්‍රී = night (PM), දහවල් = midday (PM), ප.ව = afternoon (PM), පෙ.ව / උදේ = morning (AM)
  const isPM = raw.includes('රාත්‍රී') || raw.includes('රාත්රී') || raw.includes('දහවල්') ||
               (raw.includes('ප.ව') && !raw.includes('පෙ.ව'));
  const timePart = raw.replace(/[^\d.]/g, '').trim();
  const [h, m] = timePart.split('.').map(Number);
  if (isNaN(h) || isNaN(m)) return raw;
  let hour = h;
  if (isPM && hour < 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export default function AstroChartModal({ phone, clientId, onClose, onResult }) {
  const toast = useToast();
  const geoRef = useRef();

  const [birthDate, setBirthDate] = useState('');
  const [birthHour, setBirthHour] = useState('10');
  const [birthMinute, setBirthMinute] = useState('00');
  const [geoQuery, setGeoQuery] = useState('');
  const [geoSuggestions, setGeoSuggestions] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const debounceRef = useRef(null);

  // Raw values from DB for display
  const [rawDate, setRawDate] = useState('');
  const [rawTime, setRawTime] = useState('');
  const [rawPlace, setRawPlace] = useState('');
  const [rawLagna, setRawLagna] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const params = clientId ? { client_id: clientId } : {};
        const [ordersRes, savedRes] = await Promise.all([
          api.get('/orders', { params: { search: phone, limit: 1, ...params } }),
          api.get(`/plugins/astro_vedic_chart/customer-data/${phone}`, { params }),
        ]);
        const latestOrder = ordersRes.data?.orders?.[0];
        let orderPlace = '';
        if (latestOrder?.custom_fields) {
          const cf = latestOrder.custom_fields;
          const rawD = cf.birth_date || '';
          const rawT = cf.birth_time || '';
          orderPlace = cf.birth_place || cf.birth_city || cf.place_of_birth || '';
          setRawDate(rawD);
          setRawTime(rawT);
          setRawLagna(cf.lagna || cf.birth_lagna || '');
          if (orderPlace) setRawPlace(orderPlace);
          setBirthDate(parseSinhalaDate(rawD));
          const parsed = parseSinhalaTime(rawT);
          if (/^\d{2}:\d{2}$/.test(parsed)) {
            const [h, m] = parsed.split(':');
            setBirthHour(h);
            setBirthMinute(m);
          }
        }
        const saved = savedRes.data;
        if (saved?.birth_place_name) {
          // Saved geo (from previous generation) takes priority — has lat/lng
          setRawPlace(saved.birth_place_name);
          setGeoQuery(saved.birth_place_name);
          setSelectedPlace({ name: saved.birth_place_name, lat: saved.lat, lng: saved.lng });
        } else if (orderPlace) {
          // Fall back to order custom_fields place — pre-fill search but no lat/lng yet
          setGeoQuery(orderPlace);
        }
      } catch (_) {}
      setFetching(false);
      setTimeout(() => geoRef.current?.focus(), 50);
    }
    load();
  }, [phone, clientId]);

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
      } catch (_) { setGeoSuggestions([]); }
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

  const birthTime = `${birthHour}:${birthMinute}`;

  const handleSubmit = async () => {
    if (!selectedPlace) return toast.error('Please select a birth place');
    if (!birthDate) return toast.error('Birth date is required');
    setLoading(true);
    try {
      const params = clientId ? { client_id: clientId } : {};
      const r = await api.post('/plugins/astro-chart', {
        phone,
        birth_date: birthDate,
        birth_time: birthTime,
        lat: selectedPlace.lat,
        lng: selectedPlace.lng,
        birth_place_name: selectedPlace.name,
        ...(clientId && { client_id: clientId }),
      }, { params });
      onResult(r.data.text);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to generate astro message');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-800">✨ Vedic Astro Chart</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-xl leading-none">×</button>
        </div>

        {fetching ? (
          <div className="flex justify-center py-8">
            <span className="w-6 h-6 border-2 border-violet-400/30 border-t-violet-500 rounded-full animate-spin block" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">

            {/* Birth Date */}
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Birth Date (YYYY-MM-DD)</label>
              {rawDate && <p className="text-xs text-amber-600 mb-1">From order: <span className="font-mono">{rawDate}</span></p>}
              <input
                type="text"
                value={birthDate}
                onChange={e => setBirthDate(e.target.value)}
                placeholder="1990-05-15"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </div>

            {/* Birth Time */}
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Birth Time (24h)</label>
              {rawTime && <p className="text-xs text-amber-600 mb-1">From order: <span className="font-mono">{rawTime}</span></p>}
              <div className="flex gap-2">
                <div className="flex-1">
                  <select
                    value={birthHour}
                    onChange={e => setBirthHour(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 bg-white"
                  >
                    {HOURS.map(h => (
                      <option key={h} value={h}>{h}h</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <select
                    value={birthMinute}
                    onChange={e => setBirthMinute(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 bg-white"
                  >
                    {MINUTES.map(m => (
                      <option key={m} value={m}>{m}m</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Lagna (read-only from order) */}
            {rawLagna && (
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Lagna</label>
                <div className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700">{rawLagna}</div>
              </div>
            )}

            {/* Birth Place */}
            <div className="relative">
              <label className="text-xs font-medium text-slate-500 block mb-1">Birth Place</label>
              {rawPlace && <p className="text-xs text-amber-600 mb-1">From order: <span className="font-mono">{rawPlace}</span></p>}
              <input
                ref={geoRef}
                type="text"
                value={geoQuery}
                onChange={handleGeoInput}
                placeholder="Type a city name…"
                autoComplete="off"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              {geoSuggestions.length > 0 && (
                <ul className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                  {geoSuggestions.map((s, i) => (
                    <li key={i}>
                      <button
                        onClick={() => selectPlace(s)}
                        className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-violet-50 cursor-pointer bg-transparent border-0"
                      >
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

            <p className="text-xs text-slate-400">Timezone: Asia/Colombo (GMT+5:30)</p>

            <button
              onClick={handleSubmit}
              disabled={loading || !selectedPlace || !birthDate}
              className="mt-1 w-full py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2 cursor-pointer border-0 transition-colors"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" /> Generating…</>
              ) : '✨ Generate Message'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
