import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import Button from './ui/Button';
import Spinner from './ui/Spinner';
import { useToast } from './ui/Toast';

/**
 * Editor for the tappable menus the assistant sends.
 *
 * Every field shows its own character count against WhatsApp's limit, because
 * one field over the limit makes Meta reject the entire message — and a
 * rejected message is silent from the customer's side. Better to see it here
 * than to wonder why a customer never replied.
 */

const inp = 'w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-violet-400 bg-white';

/** An input that shows how much room is left, and turns red when it runs out. */
function Field({ label, value, onChange, max, placeholder, textarea, rows = 2 }) {
  const n = (value || '').length;
  const over = max && n > max;
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        {max && (
          <span className={`text-[10px] tabular-nums ${over ? 'text-red-600 font-semibold' : n > max * 0.8 ? 'text-amber-600' : 'text-slate-400'}`}>
            {n}/{max}
          </span>
        )}
      </div>
      {textarea ? (
        <textarea
          value={value || ''} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
          className={`${inp} resize-y ${over ? 'border-red-400' : ''}`}
        />
      ) : (
        <input
          value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className={`${inp} ${over ? 'border-red-400' : ''}`}
        />
      )}
    </label>
  );
}

/** Up to three inline buttons. */
function ButtonsEditor({ menu, patch, limits }) {
  const buttons = menu.buttons || [];
  const set = (i, key, v) => patch({ buttons: buttons.map((b, j) => (j === i ? { ...b, [key]: v } : b)) });
  return (
    <div className="flex flex-col gap-2">
      {buttons.map((b, i) => (
        <div key={i} className="flex gap-2 items-start bg-slate-50 rounded-lg p-2">
          <div className="flex-1"><Field label={`Button ${i + 1} label`} value={b.title} max={limits.buttonTitle} onChange={v => set(i, 'title', v)} /></div>
          <div className="flex-1"><Field label="Sent back as" value={b.id} max={limits.buttonId} onChange={v => set(i, 'id', v)} placeholder="e.g. start" /></div>
          <button
            onClick={() => patch({ buttons: buttons.filter((_, j) => j !== i) })}
            className="text-slate-400 hover:text-red-500 bg-transparent border-0 cursor-pointer mt-5 px-1"
            title="Remove"
          >✕</button>
        </div>
      ))}
      {buttons.length < limits.buttons && (
        <Button variant="ghost" onClick={() => patch({ buttons: [...buttons, { id: '', title: '' }] })}>
          + Add button
        </Button>
      )}
      {buttons.length >= limits.buttons && (
        <p className="text-xs text-slate-400">WhatsApp allows {limits.buttons} buttons. For more choices, use a list.</p>
      )}
    </div>
  );
}

/** A sheet of rows, grouped into sections. */
function ListEditor({ menu, patch, limits }) {
  const sections = menu.sections || [];
  const rowCount = sections.reduce((n, s) => n + (s.rows?.length || 0), 0);

  const setSection = (si, next) => patch({ sections: sections.map((s, j) => (j === si ? { ...s, ...next } : s)) });
  const setRow = (si, ri, key, v) =>
    setSection(si, { rows: sections[si].rows.map((r, j) => (j === ri ? { ...r, [key]: v } : r)) });

  return (
    <div className="flex flex-col gap-3">
      <Field label="Button that opens the list" value={menu.button} max={limits.button} onChange={v => patch({ button: v })} placeholder="e.g. සේවා බලන්න" />

      {sections.map((sec, si) => (
        <div key={si} className="border border-slate-200 rounded-lg p-2.5 bg-slate-50">
          <div className="flex gap-2 items-end mb-2">
            <div className="flex-1"><Field label={`Section ${si + 1} title`} value={sec.title} max={limits.rowTitle} onChange={v => setSection(si, { title: v })} /></div>
            {sections.length > 1 && (
              <button onClick={() => patch({ sections: sections.filter((_, j) => j !== si) })}
                className="text-slate-400 hover:text-red-500 bg-transparent border-0 cursor-pointer pb-1.5 px-1">✕</button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {(sec.rows || []).map((r, ri) => (
              <div key={ri} className="bg-white border border-slate-200 rounded-lg p-2 flex gap-2 items-start">
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <div className="flex-1"><Field label="Title" value={r.title} max={limits.rowTitle} onChange={v => setRow(si, ri, 'title', v)} /></div>
                    <div className="w-32"><Field label="Sent back as" value={r.id} max={limits.rowId} onChange={v => setRow(si, ri, 'id', v)} /></div>
                  </div>
                  <Field label="Description" value={r.description} max={limits.rowDescription} onChange={v => setRow(si, ri, 'description', v)} />
                </div>
                <button onClick={() => setSection(si, { rows: sec.rows.filter((_, j) => j !== ri) })}
                  className="text-slate-400 hover:text-red-500 bg-transparent border-0 cursor-pointer mt-5 px-1">✕</button>
              </div>
            ))}
            {rowCount < limits.rows && (
              <Button variant="ghost" onClick={() => setSection(si, { rows: [...(sec.rows || []), { id: '', title: '', description: '' }] })}>
                + Add row
              </Button>
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        {sections.length < limits.sections && (
          <Button variant="ghost" onClick={() => patch({ sections: [...sections, { title: '', rows: [] }] })}>+ Add section</Button>
        )}
        <span className={`text-xs ${rowCount > limits.rows ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
          {rowCount}/{limits.rows} rows across all sections
        </span>
      </div>
    </div>
  );
}

export default function MenusPanel({ clientId }) {
  const toast = useToast();
  const qc = useQueryClient();
  const params = clientId ? { client_id: clientId } : {};

  // null means untouched, so the editor keeps showing the server's menus until
  // an actual edit is made and a background refetch cannot wipe work in progress.
  const [edited, setEdited] = useState(null);
  const [pickedId, setPickedId] = useState(null);
  const [errors, setErrors] = useState({});
  const [previewPhone, setPreviewPhone] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['menus', clientId],
    queryFn: () => api.get('/menus', { params }).then(r => r.data),
    enabled: !!clientId,
  });

  const save = useMutation({
    mutationFn: () => api.put('/menus', { menus }, { params }).then(r => r.data),
    onSuccess: (d) => {
      setErrors({});
      setEdited(null);
      toast.success(`Saved ${d.count} menu${d.count === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['menus', clientId] });
    },
    onError: (err) => {
      const body = err?.response?.data;
      setErrors(body?.errors || {});
      toast.error(body?.error || 'Could not save');
    },
  });

  const preview = useMutation({
    mutationFn: () => api.post(`/menus/${selected}/preview`, { phone: previewPhone }, { params }).then(r => r.data),
    onSuccess: () => toast.success('Sent — check the phone'),
    onError: (err) => toast.error(err?.response?.data?.error || 'Could not send'),
  });

  if (!clientId) return <p className="text-sm text-slate-400">Select a client from the sidebar first.</p>;
  if (isLoading || !data) return <div className="flex items-center gap-2 text-sm text-slate-400 py-6"><Spinner size="sm" /> Loading…</div>;

  const limits = data.limits;
  const menus = edited ?? (data.menus || {});
  const setMenus = (fn) => setEdited(m => (typeof fn === 'function' ? fn(m ?? (data.menus || {})) : fn));

  const ids = Object.keys(menus);
  // Falls back to the first menu rather than storing a default, so a deleted or
  // renamed menu can never leave the editor pointing at nothing.
  const selected = pickedId && menus[pickedId] ? pickedId : (ids[0] || null);
  const setSelected = setPickedId;
  const menu = selected ? menus[selected] : null;
  const patch = (next) => setMenus(m => ({ ...m, [selected]: { ...m[selected], ...next } }));

  function addMenu(kind) {
    const base = kind === 'buttons' ? { body: '', buttons: [{ id: '', title: '' }] }
                                    : { body: '', button: '', sections: [{ title: '', rows: [{ id: '', title: '', description: '' }] }] };
    let id = kind === 'buttons' ? 'new_buttons' : 'new_list';
    let n = 1;
    while (menus[id]) id = `${kind === 'buttons' ? 'new_buttons' : 'new_list'}_${++n}`;
    setMenus(m => ({ ...m, [id]: base }));
    setSelected(id);
  }

  function renameMenu(nextId) {
    if (!nextId || nextId === selected) return;
    setMenus(m => {
      const next = {};
      for (const [k, v] of Object.entries(m)) next[k === selected ? nextId : k] = v;
      return next;
    });
    setSelected(nextId);
  }

  function removeMenu() {
    const next = { ...menus };
    delete next[selected];
    setMenus(next);
    setSelected(Object.keys(next)[0] || null);
  }

  const isButtons = menu && Array.isArray(menu.buttons);
  const menuErrors = errors[selected] || [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">
        These are the tappable menus the assistant sends. It shows one by putting{' '}
        <code className="font-mono bg-slate-100 px-1 rounded">[[LIST:id]]</code> or{' '}
        <code className="font-mono bg-slate-100 px-1 rounded">[[BUTTONS:id]]</code> at the end of a message.
        Whatever the customer taps comes back as ordinary text, so the id and title are what your
        prompt has to recognise.
      </p>

      <div className="flex gap-4 items-start">
        {/* Menu list */}
        <div className="w-52 shrink-0 flex flex-col gap-1">
          {ids.map(id => {
            const bad = (errors[id] || []).length > 0;
            return (
              <button
                key={id}
                onClick={() => setSelected(id)}
                className={`text-left text-xs px-2.5 py-2 rounded-lg border-0 cursor-pointer font-mono truncate ${
                  selected === id ? 'bg-violet-600 text-white' : bad ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span className="opacity-60">{Array.isArray(menus[id].buttons) ? '◉ ' : '☰ '}</span>{id}
              </button>
            );
          })}
          <div className="flex gap-1 mt-1">
            <Button variant="ghost" onClick={() => addMenu('list')}>+ List</Button>
            <Button variant="ghost" onClick={() => addMenu('buttons')}>+ Buttons</Button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {!menu && <p className="text-sm text-slate-400">No menus yet. Add a list or buttons to start.</p>}

          {menu && (
            <>
              {menuErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5">
                  <p className="text-xs font-semibold text-red-700 mb-1">WhatsApp would reject this menu:</p>
                  <ul className="text-xs text-red-600 list-disc pl-4 flex flex-col gap-0.5">
                    {menuErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Field label="Menu id — what the prompt calls it" value={selected} onChange={renameMenu} />
                </div>
                <span className="text-xs text-slate-400 pb-2 font-mono whitespace-nowrap">
                  [[{isButtons ? 'BUTTONS' : 'LIST'}:{selected}]]
                </span>
                <button onClick={removeMenu} className="text-xs text-red-500 hover:text-red-600 bg-transparent border-0 cursor-pointer pb-2">Delete</button>
              </div>

              {!isButtons && <Field label="Header (optional)" value={menu.header} max={limits.header} onChange={v => patch({ header: v })} />}
              <Field label="Message above the menu" value={menu.body} max={limits.body} textarea rows={3} onChange={v => patch({ body: v })} />
              {!isButtons && <Field label="Footer (optional)" value={menu.footer} max={limits.footer} onChange={v => patch({ footer: v })} />}

              {isButtons
                ? <ButtonsEditor menu={menu} patch={patch} limits={limits} />
                : <ListEditor menu={menu} patch={patch} limits={limits} />}
            </>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save menus'}
        </Button>

        {selected && (
          <>
            <span className="text-slate-300">|</span>
            <input
              value={previewPhone}
              onChange={e => setPreviewPhone(e.target.value)}
              placeholder="94771234567"
              className={`${inp} w-40`}
            />
            <Button
              variant="ghost"
              onClick={() => preview.mutate()}
              disabled={preview.isPending || !previewPhone.trim()}
            >{preview.isPending ? 'Sending…' : `Send "${selected}" to this number`}</Button>
          </>
        )}
      </div>
      <p className="text-xs text-slate-400 -mt-2">
        Preview sends the <em>saved</em> menu, so save first. It only reaches numbers that have
        messaged the bot in the last 24 hours — that is a WhatsApp rule, not ours.
      </p>
    </div>
  );
}
