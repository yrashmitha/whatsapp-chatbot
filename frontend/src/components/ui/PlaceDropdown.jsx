import { formatCoords } from '../../lib/usePlaceSearch';

const HELP = 'Type coordinates instead, like 7.2906, 80.6337.';

/**
 * Suggestion list under a birth-place input. Every option shows its coordinates,
 * because the chart is calculated from them and a place with the same name can
 * be somewhere else. Also says so when it is searching, finds nothing, or the
 * search is unavailable, instead of staying silent.
 *
 * Put it inside a `relative` wrapper, directly after the input.
 *
 * @param {object}   props
 * @param {object}   props.geo      the object returned by usePlaceSearch()
 * @param {Function} props.onPick   called with the chosen { name, lat, lng }
 * @param {string}   [props.hover]  tailwind hover background class for an option
 */
export default function PlaceDropdown({ geo, onPick, hover = 'hover:bg-slate-50' }) {
  if (geo.status === 'idle') return null;

  const box = 'absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden';
  const note = 'px-3 py-3 md:py-2 text-sm md:text-xs text-slate-500';

  if (geo.status === 'loading' && geo.suggestions.length === 0) {
    return <div className={`${box} ${note}`} role="status">Searching…</div>;
  }
  if (geo.status === 'error') {
    return <div className={`${box} ${note}`} role="status">Place search is unavailable. {HELP}</div>;
  }
  if (geo.suggestions.length === 0) {
    return <div className={`${box} ${note}`} role="status">No place found. Try a nearby city. {HELP}</div>;
  }

  return (
    <ul className={`${box} list-none p-0 m-0 max-h-72 overflow-y-auto`} role="listbox">
      {geo.suggestions.map((s, i) => (
        <li key={i} role="option" aria-selected="false">
          <button
            type="button"
            onClick={() => onPick(s)}
            className={`w-full text-left px-3 py-3 md:py-2 cursor-pointer bg-transparent border-0 border-b border-slate-100 ${hover}`}
          >
            <span className="block text-sm md:text-xs text-slate-800 leading-snug">{s.name}</span>
            <span className="block text-xs md:text-[11px] text-emerald-700 mt-0.5 tabular-nums">{formatCoords(s)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
