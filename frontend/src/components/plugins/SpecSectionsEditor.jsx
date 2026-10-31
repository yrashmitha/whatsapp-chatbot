import { useState } from 'react';

const fieldCls = 'w-full px-3 py-2 text-base md:text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 bg-white';
const areaCls = `${fieldCls} resize-y font-mono`;
const labelCls = 'text-xs font-medium text-slate-500 block mb-1';

/** The text areas that hold one line per item. */
const LIST_FIELDS = [
  { key: 'allowedTopics', label: 'What this section covers', rows: 4, hint: 'One topic per line. The writer stays inside these.' },
  { key: 'excludedTopics', label: 'What it must not cover', rows: 4, hint: 'One per line. Topics that belong to other sections, so they are not repeated here. The review checks this.' },
  { key: 'astrologicalFocus', label: 'Astrological focus', rows: 3, hint: 'The houses, planets and dashas to look at.' },
  { key: 'requiredCustomerContext', label: 'Customer details to use', rows: 3, hint: 'Details from the order this section depends on, such as purpose, field or budget.' },
  { key: 'outputRequirements', label: 'Writing rules for this section', rows: 5, hint: 'One rule per line: what to state first, what to limit, what never to say.' },
];

const renumber = (sections) => sections.map((s, i) => ({ ...s, order: i + 1, sectionKey: s.sectionKey || `section_${i + 1}` }));

/**
 * Per-section instructions for a spec, the same way Marriage has a label and a
 * guide for each section: one collapsible card per section holding its title,
 * word limits, scope, focus and writing rules. Edits rewrite the spec; the raw
 * JSON stays available for the global rules.
 *
 * @param {object}   props
 * @param {object}   props.spec      the parsed spec object ({ globalRules, sections, ... })
 * @param {Function} props.onChange  called with the whole updated spec object
 * @param {string}   props.accent
 * @param {string}   props.accentBorder
 */
export default function SpecSectionsEditor({ spec, onChange, accent, accentBorder }) {
  const sections = Array.isArray(spec.sections) ? [...spec.sections].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)) : [];
  const [open, setOpen] = useState(() => new Set());

  const write = (next) => onChange({ ...spec, sections: renumber(next) });
  const patch = (i, changes) => write(sections.map((s, j) => (j === i ? { ...s, ...changes } : s)));
  const move = (i, to) => {
    if (to < 0 || to >= sections.length) return;
    const u = [...sections];
    [u[i], u[to]] = [u[to], u[i]];
    write(u);
    setOpen(new Set());
  };
  const remove = (i) => {
    if (!window.confirm(`Remove "${sections[i].title || 'this section'}"? Nothing is saved until you press Save.`)) return;
    write(sections.filter((_, j) => j !== i));
    setOpen(new Set());
  };
  const add = () => {
    write([...sections, { title: '', targetWords: 120, maxWords: 150, allowedTopics: [], excludedTopics: [], astrologicalFocus: [], requiredCustomerContext: [], outputRequirements: [] }]);
    setOpen(new Set([sections.length]));
  };
  const toggle = (i) => setOpen(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const num = (v) => (v === '' ? 0 : Math.max(0, parseInt(v, 10) || 0));

  return (
    <div className="flex flex-col gap-2">
      {sections.map((s, i) => {
        const isOpen = open.has(i);
        const noTitle = !String(s.title || '').trim();
        return (
          <div key={i} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(i)}
              className="w-full flex items-center gap-3 px-3 min-h-[52px] md:min-h-[44px] bg-transparent border-0 cursor-pointer text-left hover:bg-slate-50"
            >
              <span className="shrink-0 w-6 text-xs font-semibold text-slate-400 tabular-nums">{i + 1}</span>
              <span className={`flex-1 min-w-0 text-sm font-medium truncate ${noTitle ? 'text-amber-700' : 'text-slate-800'}`}>
                {noTitle ? 'Untitled section' : s.title}
              </span>
              {(s.targetWords || s.maxWords) ? (
                <span className="shrink-0 text-xs text-slate-500 tabular-nums">{s.targetWords || 0} / {s.maxWords || 0} words</span>
              ) : null}
              <span className="shrink-0 text-slate-400 text-xs" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 pt-2 border-t border-slate-100 flex flex-col gap-3">
                <div>
                  <label className={labelCls}>Heading in the report</label>
                  <input type="text" value={s.title || ''} onChange={e => patch(i, { title: e.target.value })} placeholder="Section heading…" className={fieldCls} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Minimum words</label>
                    <input type="number" inputMode="numeric" min="0" value={s.minWords ?? ''} onChange={e => patch(i, { minWords: num(e.target.value) })} className={fieldCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Target words</label>
                    <input type="number" inputMode="numeric" min="0" value={s.targetWords ?? ''} onChange={e => patch(i, { targetWords: num(e.target.value) })} className={fieldCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Word limit</label>
                    <input type="number" inputMode="numeric" min="0" value={s.maxWords ?? ''} onChange={e => patch(i, { maxWords: num(e.target.value) })} className={fieldCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Section description</label>
                  <p className="text-xs text-slate-400 mb-1.5 mt-0">
                    What the writer is told about this section, in your own words. Sent first, ahead of the scope lists below.
                  </p>
                  <textarea
                    value={s.guide || ''}
                    onChange={e => patch(i, { guide: e.target.value })}
                    rows={9}
                    className={areaCls}
                    placeholder="Describe what this section must do…"
                  />
                </div>
                {LIST_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className={labelCls}>{f.label}</label>
                    <p className="text-xs text-slate-400 mb-1.5 mt-0">{f.hint}</p>
                    <textarea
                      value={(Array.isArray(s[f.key]) ? s[f.key] : []).join('\n')}
                      onChange={e => patch(i, { [f.key]: e.target.value.split('\n') })}
                      rows={f.rows}
                      className={areaCls}
                    />
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0}
                    className="min-h-[44px] md:min-h-0 px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white text-slate-600 cursor-pointer disabled:opacity-40">▲ Move up</button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === sections.length - 1}
                    className="min-h-[44px] md:min-h-0 px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white text-slate-600 cursor-pointer disabled:opacity-40">▼ Move down</button>
                  <button type="button" onClick={() => remove(i)}
                    className="min-h-[44px] md:min-h-0 px-3 py-1.5 text-xs border border-red-200 rounded-xl bg-white text-red-600 cursor-pointer ml-auto">Remove section</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="self-start min-h-[44px] md:min-h-0 px-3 py-1.5 text-xs border border-dashed rounded-xl cursor-pointer bg-white hover:bg-slate-50"
        style={{ color: accent, borderColor: accentBorder }}
      >+ Add Section</button>
    </div>
  );
}
