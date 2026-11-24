import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import { usePermissions } from '../lib/permissions';
import api from '../lib/api';

/**
 * Automatic messages. The owner builds rules from a fixed list of conditions;
 * the server runs them every 15 minutes. No AI: the text is sent as written,
 * with {name} filled in.
 */

const LEADS = [
  ['new', 'New (no status yet)'], ['interested', 'Interested'], ['thinking', 'Thinking'],
  ['promised_payment', 'Promised to pay'], ['bought', 'Bought'],
];

// The conditions, as the server knows them (services/automations.js FIELDS).
const FIELDS = {
  last_from: { label: 'Who sent the last message', ops: { is: 'is' }, kind: 'choice',
    choices: [['us', 'Us (we replied, they went quiet)'], ['customer', 'The customer']] },
  orders: { label: 'Their orders', ops: { is: 'are' }, kind: 'choice',
    choices: [['none', 'No orders at all'], ['pending', 'Has an unpaid (pending) order'], ['no_pending', 'No unpaid order'],
      ['paid', 'Has paid at least once'], ['never_paid', 'Has never paid'], ['any', 'Has any order']] },
  paid_within_days: { label: 'Paid within the last', ops: { lte: '' }, kind: 'number', unit: 'days' },
  latest_order_value: { label: 'Latest order value', ops: { eq: 'is', gte: 'is at least', lte: 'is at most' }, kind: 'number', unit: 'Rs' },
  lead_status: { label: 'Lead status', ops: { is: 'is one of', is_not: 'is not' }, kind: 'multi', choices: LEADS },
  from_ad: { label: 'Came from a Meta ad', ops: { is: '' }, kind: 'choice', choices: [['yes', 'Yes'], ['no', 'No']] },
  ai: { label: 'Bot in the chat', ops: { is: 'is' }, kind: 'choice', choices: [['on', 'On'], ['off', 'Off']] },
  first_contact_days: { label: 'First message to us', ops: { lte: 'within the last', gte: 'more than' }, kind: 'number', unit: 'days ago' },
};

const blankCondition = (field = 'orders') => {
  const f = FIELDS[field];
  const op = Object.keys(f.ops)[0];
  const value = f.kind === 'choice' ? f.choices[0][0] : f.kind === 'multi' ? [f.choices[1][0]] : 1;
  return { field, op, value };
};

const BLANK = {
  name: '', enabled: false, min_hours: 12, max_hours: 22, gap_hours: 24, quiet_start: 22, quiet_end: 8,
  conditions: [{ field: 'last_from', op: 'is', value: 'us' }], message: '',
};

/** "12 to 22 hours after their last message · No orders · ..." */
function summary(rule) {
  const parts = [`${rule.min_hours} to ${rule.max_hours} hours after their last message`];
  for (const c of rule.conditions || []) {
    const f = FIELDS[c.field]; if (!f) continue;
    let v = c.value;
    if (f.kind === 'choice') v = (f.choices.find(x => x[0] === v) || [, v])[1];
    if (f.kind === 'multi') v = (Array.isArray(v) ? v : [v]).map(x => (f.choices.find(y => y[0] === x) || [, x])[1]).join(', ');
    if (f.kind === 'number') v = f.unit === 'Rs' ? `Rs ${v}` : `${v} ${f.unit}`;
    parts.push(`${f.label} ${f.ops[c.op] ? f.ops[c.op] + ' ' : ''}${v}`);
  }
  return parts.join(' · ');
}

const input = 'text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-violet-400 bg-white';

function ConditionRow({ c, onChange, onRemove }) {
  const f = FIELDS[c.field];
  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200">
      <select className={input} value={c.field} onChange={e => onChange(blankCondition(e.target.value))}>
        {Object.entries(FIELDS).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
      </select>
      {Object.keys(f.ops).length > 1 ? (
        <select className={input} value={c.op} onChange={e => onChange({ ...c, op: e.target.value })}>
          {Object.entries(f.ops).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      ) : f.ops[c.op] ? <span className="text-sm text-slate-500">{f.ops[c.op]}</span> : null}
      {f.kind === 'choice' && (
        <select className={input} value={c.value} onChange={e => onChange({ ...c, value: e.target.value })}>
          {f.choices.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
      {f.kind === 'number' && (
        <span className="flex items-center gap-1">
          {f.unit === 'Rs' && <span className="text-sm text-slate-500">Rs</span>}
          <input type="number" min="0" className={`${input} w-24`} value={c.value}
            onChange={e => onChange({ ...c, value: e.target.value === '' ? '' : Number(e.target.value) })} />
          {f.unit !== 'Rs' && <span className="text-sm text-slate-500">{f.unit}</span>}
        </span>
      )}
      {f.kind === 'multi' && (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {f.choices.map(([k, l]) => {
            const list = Array.isArray(c.value) ? c.value : [c.value];
            return (
              <label key={k} className="flex items-center gap-1 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={list.includes(k)}
                  onChange={() => onChange({ ...c, value: list.includes(k) ? list.filter(x => x !== k) : [...list, k] })} />
                {l}
              </label>
            );
          })}
        </span>
      )}
      <button type="button" onClick={onRemove} aria-label="Remove condition"
        className="ml-auto text-slate-400 hover:text-red-500 bg-transparent border-0 cursor-pointer text-lg leading-none px-1">×</button>
    </div>
  );
}

function RuleEditor({ initial, clientId, cap, onClose, onSaved }) {
  const [r, setR] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const params = clientId ? { client_id: clientId } : {};
  const set = (k, v) => { setR(x => ({ ...x, [k]: v })); setPreview(null); };

  const doPreview = async () => {
    setError(''); setBusy(true);
    try { setPreview((await api.post('/automations/preview', r, { params })).data); }
    catch (e) { setError(e?.response?.data?.error || 'Could not preview'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setError(''); setBusy(true);
    try {
      if (r.id) await api.patch(`/automations/${r.id}`, r, { params });
      else await api.post('/automations', r, { params });
      onSaved();
    } catch (e) { setError(e?.response?.data?.error || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-800 mb-3">{r.id ? 'Edit rule' : 'New rule'}</h2>

        <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
        <input className={`${input} w-full mb-3`} value={r.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Discount for quiet chats" />

        <div className="text-xs font-medium text-slate-500 mb-1">When</div>
        <div className="flex flex-wrap items-center gap-1.5 mb-1 text-sm text-slate-700">
          Between
          <input type="number" min="0" step="0.5" className={`${input} w-20`} value={r.min_hours} onChange={e => set('min_hours', Number(e.target.value))} />
          and
          <input type="number" min="0" max={cap} step="0.5" className={`${input} w-20`} value={r.max_hours} onChange={e => set('max_hours', Number(e.target.value))} />
          hours after the customer's last message
        </div>
        <div className="text-xs text-slate-400 mb-3">
          Each customer is timed from their own last message. At most {cap} hours: WhatsApp only delivers a normal message within 24 hours.
        </div>

        <div className="text-xs font-medium text-slate-500 mb-1">And all of these are true</div>
        <div className="space-y-1.5 mb-1.5">
          {r.conditions.map((c, i) => (
            <ConditionRow key={i} c={c}
              onChange={(nc) => set('conditions', r.conditions.map((x, j) => (j === i ? nc : x)))}
              onRemove={() => set('conditions', r.conditions.filter((_, j) => j !== i))} />
          ))}
        </div>
        <button type="button" onClick={() => set('conditions', [...r.conditions, blankCondition()])}
          className="text-sm text-violet-600 bg-transparent border-0 cursor-pointer px-0 mb-3">+ Add condition</button>

        <label className="block text-xs font-medium text-slate-500 mb-1">Message</label>
        <textarea className={`${input} w-full text-base`} rows={5} value={r.message} onChange={e => set('message', e.target.value)}
          placeholder="Hi {name}, ..." />
        <div className="text-xs text-slate-400 mb-3">{'{name}'} is replaced with the customer's name, or left out if we don't have one.</div>

        <details className="mb-3">
          <summary className="text-xs font-medium text-slate-500 cursor-pointer">Limits</summary>
          <div className="mt-2 space-y-2 text-sm text-slate-700">
            <div className="flex flex-wrap items-center gap-1.5">
              No automatic message to the same customer within
              <input type="number" min="0" className={`${input} w-20`} value={r.gap_hours} onChange={e => set('gap_hours', Number(e.target.value))} />
              hours of the last one (any rule)
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              Quiet hours: nothing sent from
              <input type="number" min="0" max="23" className={`${input} w-16`} value={r.quiet_start} onChange={e => set('quiet_start', Number(e.target.value))} />
              :00 to
              <input type="number" min="0" max="23" className={`${input} w-16`} value={r.quiet_end} onChange={e => set('quiet_end', Number(e.target.value))} />
              :00 (Sri Lanka time)
            </div>
            <div className="text-xs text-slate-400">Customers marked not interested or wrong number are never messaged. Each rule sends at most once after each customer message.</div>
          </div>
        </details>

        <label className="flex items-center gap-2 text-sm text-slate-700 mb-3 cursor-pointer">
          <input type="checkbox" checked={r.enabled} onChange={e => set('enabled', e.target.checked)} />
          Switched on (checked every 15 minutes)
        </label>

        {preview && (
          <div className="mb-3 p-3 rounded-lg bg-violet-50 border border-violet-100 text-sm">
            <div className="font-semibold text-slate-800 mb-1">
              Right now this would message {preview.count} customer{preview.count === 1 ? '' : 's'}
              {preview.quiet_now ? ' (it is quiet hours now, so they would get it when quiet hours end, if still in range)' : ''}.
            </div>
            {preview.sample.slice(0, 10).map(s => (
              <div key={s.phone} className="text-xs text-slate-600 py-0.5">
                {s.name || s.phone} · wrote {s.hours_ago}h ago · <span className="text-slate-400">"{s.text.slice(0, 60)}{s.text.length > 60 ? '…' : ''}"</span>
              </div>
            ))}
            {preview.count > 10 && <div className="text-xs text-slate-400">and {preview.count - 10} more</div>}
          </div>
        )}
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer">Cancel</button>
          <button type="button" onClick={doPreview} disabled={busy} className="px-4 py-2 text-sm rounded-lg border border-violet-300 bg-white text-violet-700 cursor-pointer disabled:opacity-50">Who gets it now?</button>
          <button type="button" onClick={save} disabled={busy} className="px-4 py-2 text-sm font-semibold rounded-lg border-0 bg-violet-600 text-white cursor-pointer disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Automations() {
  const { user, selectedClientId } = useAuthStore();
  const clientId = isSuperAdmin(user) ? (selectedClientId || null) : user?.clientId;
  const { can } = usePermissions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const params = clientId ? { client_id: clientId } : {};
  const { data, isLoading, error } = useQuery({
    queryKey: ['automations', clientId],
    queryFn: () => api.get('/automations', { params }).then(r => r.data),
    enabled: !!clientId && can('automations.manage'),
    refetchInterval: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['automations'] });
  const toggle = (rule) => api.patch(`/automations/${rule.id}`, { enabled: !rule.enabled }, { params }).then(refresh);
  const remove = (rule) => { if (confirm(`Delete the rule "${rule.name}"?`)) api.delete(`/automations/${rule.id}`, { params }).then(refresh); };
  const cap = data?.max_hours_cap ?? 23.5;

  return (
    <Layout>
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <div className="max-w-3xl mx-auto">
          <button type="button" onClick={() => navigate('/follow-ups')} className="text-sm text-slate-500 bg-transparent border-0 cursor-pointer px-0 mb-2">← Leads</button>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h1 className="text-lg font-bold text-slate-800">Automatic messages</h1>
              <p className="text-sm text-slate-500">Rules you build. Each one sends your text to every customer who matches, timed from their own last message. Checked every 15 minutes.</p>
            </div>
            {can('automations.manage') && clientId && (
              <button type="button" onClick={() => setEditing({ ...BLANK })}
                className="shrink-0 px-3 py-2 text-sm font-semibold rounded-lg border-0 bg-violet-600 text-white cursor-pointer">+ New rule</button>
            )}
          </div>

          {!clientId ? <p className="text-sm text-amber-600">Select a client first.</p>
            : !can('automations.manage') ? <p className="text-sm text-slate-500">You don't have permission to manage automatic messages.</p>
            : isLoading ? <div className="flex justify-center py-10"><Spinner /></div>
            : error ? <p className="text-sm text-red-600">{error.response?.data?.error || 'Could not load the rules.'}</p>
            : !data?.rules?.length ? (
              <div className="text-sm text-slate-500 p-6 text-center border border-dashed border-slate-300 rounded-xl">
                No rules yet. Press <b>+ New rule</b> to make one. Rules start switched off until you switch them on.
              </div>
            ) : (
              <div className="space-y-2">
                {data.rules.map(rule => (
                  <div key={rule.id} className="p-3 rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800">{rule.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{summary(rule)}</div>
                        <div className="text-xs text-slate-400 mt-1 truncate">"{rule.message}"</div>
                        <div className="text-xs mt-1.5 text-slate-600">
                          Last 7 days: <b>{rule.stats.sent}</b> sent · <b>{rule.stats.replied}</b> replied · <b>{rule.stats.paid}</b> paid within 48h
                          {rule.stats.failed > 0 && <span className="text-red-600"> · {rule.stats.failed} failed</span>}
                        </div>
                      </div>
                      <label className="shrink-0 flex items-center gap-1.5 text-xs font-medium cursor-pointer" style={{ color: rule.enabled ? '#059669' : '#94a3b8' }}>
                        <input type="checkbox" checked={rule.enabled} onChange={() => toggle(rule)} />
                        {rule.enabled ? 'On' : 'Off'}
                      </label>
                    </div>
                    <div className="flex gap-3 mt-2">
                      <button type="button" onClick={() => setEditing({ ...rule })} className="text-xs text-violet-600 bg-transparent border-0 cursor-pointer px-0">Edit</button>
                      <button type="button" onClick={() => remove(rule)} className="text-xs text-red-500 bg-transparent border-0 cursor-pointer px-0">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
      {editing && <RuleEditor initial={editing} clientId={clientId} cap={cap} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </Layout>
  );
}
