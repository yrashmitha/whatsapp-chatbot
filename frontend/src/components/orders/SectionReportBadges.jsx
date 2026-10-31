import { SECTION_KIND_LIST, sectionReportState } from './sectionReports';

/**
 * Row-level status for abroad, pregnancy and any later section report: a spinner
 * while it generates, an edit button once it is ready, a warning if it failed.
 * Generation itself starts from the 🔮 modal's tabs, so nothing renders until
 * there is something to show.
 *
 * @param {object}   props.hd       the order's parsed horoscope_data
 * @param {Function} props.guard    wraps a click so a locked feature shows its lock modal
 * @param {Function} props.onOpen   called with the kind to open its editor
 */
export default function SectionReportBadges({ hd, guard, onOpen }) {
  return SECTION_KIND_LIST.map(k => {
    const s = sectionReportState(hd, k.key);
    if (s.generating) {
      return (
        <span key={k.key} className="flex items-center gap-1 text-xs font-medium" style={{ color: k.accent }}>
          <span className="w-3 h-3 border-2 border-slate-200 rounded-full animate-spin inline-block" style={{ borderTopColor: k.accent }} />
          {k.emoji} Generating…
        </span>
      );
    }
    if (s.done) {
      return (
        <button
          key={k.key}
          type="button"
          onClick={guard('horoscope_reading', () => onOpen(k.key))}
          title={`View/edit ${k.name.toLowerCase()} report`}
          className="text-xs px-1.5 py-0.5 rounded cursor-pointer border-0 hover:opacity-80"
          style={{ background: k.accentSoft, color: k.accentText }}
        >{k.emoji} ✏</button>
      );
    }
    if (s.error) {
      return (
        <span key={k.key} title={s.error} className="text-xs px-1.5 py-0.5 rounded border-0 bg-red-100 text-red-600 cursor-default">
          {k.emoji} ⚠
        </span>
      );
    }
    return null;
  });
}
