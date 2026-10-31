import { useState } from 'react';

/**
 * Building blocks for long settings forms: a wrapping tab row to pick one report,
 * and collapsible groups so a report's fields are scanned by heading instead of
 * scrolled. Nothing scrolls sideways: the tabs wrap, because on a phone anything
 * behind a sideways swipe is effectively hidden.
 */

function Chevron({ open }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="w-4 h-4 shrink-0 text-slate-400 transition-transform duration-200"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M5 7.5l5 5 5-5" />
    </svg>
  );
}

/**
 * Wrapping tab row.
 * @param {{id:string,label:string,warn?:string}[]} props.tabs  `warn` marks a tab that is not configured, with the reason as its title
 * @param {string} props.value
 * @param {Function} props.onChange
 */
export function ReportTabs({ tabs, value, onChange, label = 'Report' }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
      {tabs.map(t => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={t.warn || undefined}
            onClick={() => onChange(t.id)}
            className={`relative min-h-[44px] md:min-h-[38px] px-3.5 text-sm font-medium rounded-xl border cursor-pointer transition-colors ${
              active
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-700'
            }`}
          >
            {t.label}
            {t.warn && (
              <span
                className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${active ? 'border-violet-600' : 'border-white'} bg-amber-400`}
                aria-label={t.warn}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Collapsible group of fields. The header says what is inside and whether it
 * needs attention, so a long form can be read as a list of headings.
 *
 * @param {string}  props.title
 * @param {{text:string,tone?:'warn'}} [props.badge]  short status shown on the right
 * @param {boolean} [props.defaultOpen]
 */
export function Group({ title, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 min-h-[52px] md:min-h-[46px] bg-transparent border-0 cursor-pointer text-left hover:bg-slate-50"
      >
        <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800">{title}</span>
        {badge && (
          <span
            className={`shrink-0 text-xs font-medium rounded-full px-2.5 py-0.5 ${
              badge.tone === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
            }`}
          >{badge.text}</span>
        )}
        <Chevron open={open} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3 border-t border-slate-100 flex flex-col gap-4">
          {children}
        </div>
      )}
    </section>
  );
}

/** One-line description under the tabs, so the panel says what it is for. */
export function PanelIntro({ children }) {
  return <p className="text-xs text-slate-500 leading-relaxed m-0">{children}</p>;
}
