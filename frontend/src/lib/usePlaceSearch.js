import { useState, useRef, useCallback, useEffect } from 'react';
import { GEO_USER_AGENT } from './api';

const NUMBER = '-?\\d{1,3}(?:\\.\\d+)?';
const COORDS = new RegExp(`^\\s*(${NUMBER})\\s*[,;\\s]\\s*(${NUMBER})\\s*$`);

/** "7.2906, 80.6337" typed by hand, as a place; null when the text is not coordinates. */
export function parseCoordinates(text) {
  const m = COORDS.exec(String(text || ''));
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
  return { name: `Coordinates ${lat}, ${lng}`, lat, lng, typed: true };
}

/**
 * Place search for birth-place fields. Suggestions come from OpenStreetMap
 * (Nominatim); typed coordinates are accepted directly, so an order can still be
 * made when the search is down or cannot find a small village.
 *
 * status: 'idle' | 'loading' | 'done' | 'error'
 *
 * @returns {{ suggestions: {name:string,lat:number,lng:number,typed?:boolean}[], status: string,
 *             search: (q: string) => void, clear: () => void }}
 */
export function usePlaceSearch() {
  const [suggestions, setSuggestions] = useState([]);
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);
  const seq = useRef(0);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    seq.current += 1;
    setSuggestions([]);
    setStatus('idle');
  }, []);

  const search = useCallback((q) => {
    clearTimeout(timer.current);
    const text = String(q || '').trim();
    seq.current += 1;
    const id = seq.current;

    if (text.length < 2) { setSuggestions([]); setStatus('idle'); return; }

    const typed = parseCoordinates(text);
    if (typed) { setSuggestions([typed]); setStatus('done'); return; }

    setStatus('loading');
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=6`,
          { headers: { 'User-Agent': GEO_USER_AGENT } }
        );
        if (!r.ok) throw new Error(`search failed (${r.status})`);
        const data = await r.json();
        if (id !== seq.current) return;
        setSuggestions(data.map(d => ({ name: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) })));
        setStatus('done');
      } catch {
        if (id !== seq.current) return;
        setSuggestions([]);
        setStatus('error');
      }
    }, 400);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { suggestions, status, search, clear };
}

/** "7.2906, 80.6337" */
export function formatCoords(place) {
  return `${Number(place.lat).toFixed(4)}, ${Number(place.lng).toFixed(4)}`;
}
