import { SECTION_KINDS } from '../orders/sectionReports';
import { Group, PanelIntro } from './settingsLayout';

const areaCls = 'w-full px-3 py-2 text-base md:text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono';
const labelCls = 'text-xs font-medium text-slate-500 block mb-1';

/** One labelled textarea. */
function Area({ label, hint, value, onChange, rows = 4, placeholder }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {hint && <p className="text-xs text-slate-400 mb-1.5">{hint}</p>}
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        className={areaCls}
        placeholder={placeholder || '(not set)'}
      />
    </div>
  );
}

/**
 * Read the pasted spec for display. Mirrors the backend's rules (a title on every
 * section, no duplicate titles) so a bad paste is explained before Save.
 * @returns {null | {error:string} | {sections:{title:string,target:number}[], words:number}}
 */
export function readSpec(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  let o;
  try { o = JSON.parse(t); } catch (e) { return { error: `not valid JSON (${e.message})` }; }
  if (!o || typeof o !== 'object' || !Array.isArray(o.sections) || o.sections.length === 0) return { error: 'it has no sections' };
  const seen = new Set();
  for (let i = 0; i < o.sections.length; i += 1) {
    const title = String((o.sections[i] || {}).title || '').trim();
    if (!title) return { error: `section ${i + 1} has no title` };
    if (seen.has(title)) return { error: `two sections share the title "${title}"` };
    seen.add(title);
  }
  const sections = [...o.sections]
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map(s => ({ title: String(s.title).trim(), target: Number(s.targetWords) || 0 }));
  return { sections, words: sections.reduce((n, s) => n + s.target, 0) };
}

/**
 * What stops a section report from generating: no system prompt, or no sections.
 * The same rule the backend enforces, so the badge and the error agree.
 * @returns {string|null} the reason, or null when it is ready
 */
export function sectionReportGap(value = {}) {
  const missing = [];
  if (!String(value.system_prompt || '').trim()) missing.push('system prompt');
  const fromSpec = readSpec(value.spec);
  if (!(fromSpec && fromSpec.sections) && !(Array.isArray(value.sections) && value.sections.some(s => s && s.label))) missing.push('sections');
  return missing.length ? `Cannot generate yet: add ${missing.join(' and ')}` : null;
}

/**
 * Plugin settings for one section report kind (abroad, pregnancy). Three
 * collapsible groups, each headed by what it holds and whether it needs
 * attention: Prompts, Sections, then Titles, instructions and the closing note.
 *
 * @param {object}   props
 * @param {string}   props.kind     key in SECTION_KINDS
 * @param {object}   props.value    this kind's settings, keyed by field name
 * @param {Function} props.onChange (field, value) => void
 */
export default function SectionReportSettings({ kind, value, onChange }) {
  const meta = SECTION_KINDS[kind];
  const name = meta.name;
  const lower = name.toLowerCase();
  const sections = Array.isArray(value.sections) ? value.sections : [];
  const setSections = (next) => onChange('sections', next);
  const move = (i, to) => {
    if (to < 0 || to >= sections.length) return;
    const u = [...sections];
    [u[i], u[to]] = [u[to], u[i]];
    setSections(u);
  };
  const set = (i, patch) => setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const useSuggested = () => {
    if (sections.length > 0 && !window.confirm(`Replace the ${sections.length} ${lower} section(s) below with the suggested set? Nothing is saved until you press Save.`)) return;
    setSections(meta.suggestedSections.map(s => ({ ...s })));
  };

  const spec = readSpec(value.spec);
  const specActive = !!(spec && spec.sections);

  return (
    <div className="flex flex-col gap-3">
      <PanelIntro>
        Generated from the same chart data as the horoscope. Admins run it from the {name} tab of the order&apos;s
        generate window, after Check Lagna. It has its own prompt, sections, PDF and WhatsApp message.
      </PanelIntro>

      <Group
        title="Prompts"
        defaultOpen
        badge={String(value.system_prompt || '').trim() ? null : { text: 'System prompt not set', tone: 'warn' }}
      >
        <Area label={`${name} System Prompt`} rows={10}
          hint={`House style for every ${lower} section. The chart data is added automatically. A blank prompt stops generation.`}
          value={value.system_prompt} onChange={v => onChange('system_prompt', v)} />
        <Area label={`${name} WhatsApp Message Prompt`} rows={6}
          hint={`System prompt used to turn the finished ${lower} report into a WhatsApp message. Leave blank to disable the message.`}
          value={value.wa_prompt} onChange={v => onChange('wa_prompt', v)} />
        <Area label={`${name} AI Fill Prompt`} rows={6}
          hint={`Used by the AI Fill buttons on the ${lower} report. Must keep {{chat_log}} and return the JSON schema. Leave blank for the built-in default.`}
          value={value.ai_fill_prompt} onChange={v => onChange('ai_fill_prompt', v)}
          placeholder="(not set, the built-in default is used)" />
      </Group>

      <Group
        title="Sections"
        defaultOpen={sections.length === 0}
        badge={specActive
          ? { text: `${spec.sections.length} from spec` }
          : sections.length
            ? { text: `${sections.length} section${sections.length === 1 ? '' : 's'}` }
            : { text: 'None yet', tone: 'warn' }}
      >
        <div>
          <label className={labelCls}>Section spec (JSON, optional)</label>
          <p className="text-xs text-slate-400 mb-1.5">
            Paste a structured spec to control each section&apos;s length, scope and rules. With a spec the sections are written one by one,
            share only a short summary of what earlier sections said, then the whole report is reviewed and only flagged sections are rewritten.
            The list below is replaced by the spec. Clear this box to go back to the plain list.
          </p>
          <textarea
            value={value.spec || ''}
            onChange={e => onChange('spec', e.target.value)}
            rows={8}
            spellCheck={false}
            className={areaCls}
            placeholder='{ "globalRules": { ... }, "sections": [ { "order": 1, "title": "...", "targetWords": 120, "maxWords": 150, ... } ] }'
          />
          {spec && spec.error && (
            <p className="text-xs text-red-600 mt-1.5">Not saved until fixed: {spec.error}</p>
          )}
          {specActive && (
            <p className="text-xs text-emerald-700 mt-1.5">
              Spec active: {spec.sections.length} sections, about {spec.words} words in total.
            </p>
          )}
          {specActive && (
            <ol className="mt-2 mb-0 pl-5 text-xs text-slate-600 leading-relaxed">
              {spec.sections.map((s, i) => (
                <li key={i}>{s.title}{s.target ? ` (${s.target} words)` : ''}</li>
              ))}
            </ol>
          )}
        </div>
        {!specActive && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <p className="text-xs text-slate-400 m-0 flex-1 min-w-[200px]">
              Each entry is one heading in the {lower} report, in this order. The writing guide tells the AI what that section must cover.
            </p>
            <button
              type="button"
              onClick={useSuggested}
              className="min-h-[44px] md:min-h-0 px-3 py-1.5 text-xs border rounded-xl cursor-pointer bg-white hover:bg-slate-50"
              style={{ color: meta.accent, borderColor: meta.accentBorder }}
            >Use suggested sections</button>
          </div>
          {sections.map((sec, i) => (
            <div key={i} className="flex flex-col md:flex-row gap-2 mb-3 md:mb-2 md:items-start p-3 md:p-0 border border-slate-200 md:border-0 rounded-xl">
              <div className="flex md:flex-col gap-1 shrink-0 md:mt-1">
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label="Move section up"
                  className="w-11 h-11 md:w-6 md:h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                >▲</button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === sections.length - 1}
                  aria-label="Move section down"
                  className="w-11 h-11 md:w-6 md:h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                >▼</button>
                <button
                  type="button"
                  onClick={() => setSections(sections.filter((_, j) => j !== i))}
                  aria-label="Remove section"
                  className="md:hidden ml-auto w-11 h-11 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 cursor-pointer bg-white text-sm font-bold"
                >×</button>
              </div>
              <input
                type="text"
                value={sec.label || ''}
                onChange={e => set(i, { label: e.target.value })}
                placeholder="Section label (heading)…"
                className="md:w-48 md:shrink-0 px-3 py-2 text-base md:text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 min-h-[44px] md:min-h-0"
              />
              <textarea
                value={sec.guide || ''}
                onChange={e => set(i, { guide: e.target.value })}
                placeholder="Writing guide for this section…"
                rows={3}
                className={`${areaCls} md:flex-1`}
              />
              <button
                type="button"
                onClick={() => setSections(sections.filter((_, j) => j !== i))}
                aria-label="Remove section"
                className="hidden md:flex mt-1 w-7 h-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-300 cursor-pointer bg-white text-xs font-bold"
              >×</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSections([...sections, { label: '', guide: '' }])}
            className="mt-1 min-h-[44px] md:min-h-0 px-3 py-1.5 text-xs border border-dashed rounded-xl cursor-pointer bg-white hover:bg-slate-50"
            style={{ color: meta.accent, borderColor: meta.accentBorder }}
          >+ Add Section</button>
        </div>
        )}
      </Group>

      <Group title="Titles, instructions and closing note">
        <Area label={`${name} Report Title`} rows={2} hint={`Cover title of the ${lower} report.`}
          value={value.report_title} onChange={v => onChange('report_title', v)} />
        <Area label={`${name} Fixed Instructions`} rows={6} hint={`Appended to every ${lower} section prompt.`}
          value={value.fixed_instructions} onChange={v => onChange('fixed_instructions', v)} />
        <Area label={`${name} Questions Heading`} rows={2}
          hint={`Heading above the customer's own questions in the ${lower} report.`}
          value={value.questions_title} onChange={v => onChange('questions_title', v)} />
        <Area label={`${name} Question Instructions`} rows={6}
          hint="Appended when answering the customer's own questions."
          value={value.question_instructions} onChange={v => onChange('question_instructions', v)} />
        <Area label={`${name} Special Note (Final Page)`} rows={5}
          hint={`Static text added as the last page of every ${lower} document.`}
          value={value.special_note} onChange={v => onChange('special_note', v)} />
      </Group>
    </div>
  );
}
