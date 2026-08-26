import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import Layout from '../components/Layout';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { useAuthStore } from '../stores/auth';

/**
 * The people who work this client's inbox, and what each of them may do.
 *
 * Everything here is the owner's: creating a person, deciding what they can
 * reach, and setting what a sale pays them. An operator never sees this screen,
 * and the routes behind it refuse them regardless.
 */
export default function Operators() {
  const toast = useToast();
  const qc = useQueryClient();
  const { user, selectedClientId } = useAuthStore();
  const clientId = user?.role === 'superadmin' ? selectedClientId : user?.clientId;
  const params = clientId ? { client_id: clientId } : {};

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);   // the user row being re-permissioned

  const { data: catalogue } = useQuery({
    queryKey: ['permission-catalogue'],
    queryFn: () => api.get('/crm-users/permissions').then(r => r.data),
  });
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['crm-users', clientId],
    queryFn: () => api.get('/crm-users', { params }).then(r => r.data),
    enabled: !!clientId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['crm-users', clientId] });
  const fail = (e) => toast.error(e?.response?.data?.error || 'Something went wrong');

  const createUser = useMutation({
    mutationFn: (body) => api.post('/crm-users', body, { params }),
    onSuccess: () => { toast.success('Operator created'); setCreating(false); invalidate(); },
    onError: fail,
  });
  const updateUser = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/crm-users/${id}`, body, { params }),
    onSuccess: () => { toast.success('Saved'); setEditing(null); invalidate(); },
    onError: fail,
  });
  const resetPw = useMutation({
    mutationFn: ({ id, password }) => api.post(`/crm-users/${id}/password`, { password }, { params }),
    onSuccess: () => toast.success('Password changed'),
    onError: fail,
  });

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 shrink-0">
          <h1 className="text-lg font-semibold text-slate-800">Operators</h1>
          <div className="ml-auto">
            <Button size="sm" onClick={() => setCreating(true)}>+ Add operator</Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {isLoading ? <Spinner /> : (
            <section>
              {!users.length && (
                <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-xl p-6 text-center">
                  Nobody yet. Until an operator has their own login, everyone who signs in
                  shares this client's password, and no sale can be credited to a person.
                </div>
              )}
              <div className="grid gap-3">
                {users.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    catalogue={catalogue}
                    onToggleActive={() => updateUser.mutate({ id: u.id, active: !u.active })}
                    onEdit={() => setEditing(u)}
                    onResetPassword={(password) => resetPw.mutate({ id: u.id, password })}
                  />
                ))}
              </div>
            </section>
          )}

          <CommissionCard clientId={clientId} params={params} />
        </div>
      </div>

      {creating && (
        <CreateOperator
          catalogue={catalogue}
          busy={createUser.isPending}
          onCancel={() => setCreating(false)}
          onCreate={(body) => createUser.mutate(body)}
        />
      )}
      {editing && (
        <PermissionEditor
          user={editing}
          catalogue={catalogue}
          busy={updateUser.isPending}
          onCancel={() => setEditing(null)}
          onSave={(permissions) => updateUser.mutate({ id: editing.id, permissions })}
        />
      )}
    </Layout>
  );
}

/** One operator in the list. */
function UserRow({ user, catalogue, onToggleActive, onEdit, onResetPassword }) {
  const [pw, setPw] = useState('');
  const total = catalogue?.permissions?.length || 0;
  return (
    <div className={`border rounded-xl p-4 bg-white ${user.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="font-medium text-slate-800">{user.display_name || user.username}</div>
          <div className="text-xs text-slate-500">{user.username}</div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${user.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {user.active ? 'active' : 'disabled'}
        </span>
        <span className="text-xs text-slate-500">
          {(user.permissions || []).length} of {total} permissions
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onEdit}>Permissions</Button>
          <Button size="sm" variant="ghost" onClick={onToggleActive}>
            {user.active ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <input
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          placeholder="New password (min 8)"
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 w-56"
        />
        <Button size="sm" variant="ghost"
          onClick={() => { if (pw.length >= 8) { onResetPassword(pw); setPw(''); } }}>
          Set password
        </Button>
        {/* Disabling keeps the row, so sales already credited to this person
            survive. Deleting would quietly change a closed payroll period. */}
        <span className="text-xs text-slate-400">Disabling keeps their past sales credited to them.</span>
      </div>
    </div>
  );
}

/** Grouped checkboxes over the permission catalogue. */
function PermissionPicker({ catalogue, value, onChange }) {
  const groups = (catalogue?.permissions || []).reduce((acc, p) => {
    (acc[p.group] ||= []).push(p);
    return acc;
  }, {});
  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);

  return (
    <div className="space-y-4 max-h-[46vh] overflow-y-auto pr-1">
      {Object.entries(groups).map(([group, perms]) => (
        <div key={group}>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{group}</div>
          <div className="space-y-1.5">
            {perms.map(p => (
              <label key={p.id}
                className={`flex items-start gap-2 text-sm ${p.ownerOnly ? 'opacity-50' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={p.ownerOnly}
                  checked={value.includes(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span>
                  <span className="text-slate-700">{p.label}</span>
                  {p.ownerOnly && <span className="text-xs text-slate-400"> · yours only</span>}
                  {p.note && <span className="block text-xs text-slate-400">{p.note}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A plain modal shell, since this page needs three of them. */
function Modal({ title, children, onCancel, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-800 mb-3">{title}</h2>
        {children}
        <div className="flex justify-end gap-2 mt-4">{footer}</div>
      </div>
    </div>
  );
}

function CreateOperator({ catalogue, busy, onCancel, onCreate }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [permissions, setPermissions] = useState(catalogue?.operator_default || []);
  const input = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 mb-2';

  return (
    <Modal
      title="Add an operator"
      onCancel={onCancel}
      footer={<>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={busy || !username || password.length < 8}
          onClick={() => onCreate({ username, display_name: displayName, password, permissions })}
        >
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </>}
    >
      <input className={input} value={displayName} onChange={e => setDisplayName(e.target.value)}
             placeholder="Name, as it appears on their sales" />
      <input className={input} value={username} onChange={e => setUsername(e.target.value)}
             placeholder="Username they sign in with" />
      <input className={input} type="password" value={password} onChange={e => setPassword(e.target.value)}
             placeholder="Password (at least 8 characters)" />
      <div className="text-xs text-slate-500 mb-2">
        Starts with enough to work the inbox, the follow-up queue and the order list.
        Nothing that spends API credit, exports the customer list, or deletes anything.
      </div>
      <PermissionPicker catalogue={catalogue} value={permissions} onChange={setPermissions} />
    </Modal>
  );
}

function PermissionEditor({ user, catalogue, busy, onCancel, onSave }) {
  const [permissions, setPermissions] = useState(user.permissions || []);
  return (
    <Modal
      title={`What ${user.display_name || user.username} can do`}
      onCancel={onCancel}
      footer={<>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={busy} onClick={() => onSave(permissions)}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}
    >
      <PermissionPicker catalogue={catalogue} value={permissions} onChange={setPermissions} />
    </Modal>
  );
}

/**
 * The commission scheme: what a sale pays, and where the rate steps up.
 *
 * Tiers are read forward-only. Crossing a threshold changes what the next sale
 * pays, never what the earlier ones paid, which is the reading pj confirmed.
 */
function CommissionCard({ clientId, params }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: scheme } = useQuery({
    queryKey: ['commission', clientId],
    queryFn: () => api.get('/crm-users/commission', { params }).then(r => r.data),
    enabled: !!clientId,
    retry: false,
  });

  const [draft, setDraft] = useState(null);
  const rows = draft ?? scheme?.tiers ?? [];
  const basis = (draft && draft.basis) || scheme?.basis || 'percent';
  const [basisDraft, setBasisDraft] = useState(null);
  const effectiveBasis = basisDraft ?? basis;

  const save = useMutation({
    mutationFn: (body) => api.put('/crm-users/commission', body, { params }),
    onSuccess: () => {
      toast.success('Commission scheme saved');
      setDraft(null); setBasisDraft(null);
      qc.invalidateQueries({ queryKey: ['commission', clientId] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not save'),
  });

  const setRow = (i, key, val) => {
    const next = rows.map((r, j) => (j === i ? { ...r, [key]: val } : r));
    setDraft(next);
  };
  const addRow = () => setDraft([...rows, { from: (rows.at(-1)?.from || 0) + 1, rate: 0 }]);
  const removeRow = (i) => setDraft(rows.filter((_, j) => j !== i));

  return (
    <section className="border border-slate-200 rounded-xl p-4 bg-white max-w-2xl">
      <h2 className="font-semibold text-slate-800 mb-1">Commission</h2>
      <p className="text-xs text-slate-500 mb-3">
        The rate applies from the sale number you set, forward only. Passing a threshold
        changes what the next sale pays and never repays the earlier ones. Sales are
        counted per calendar month in Sri Lanka.
      </p>

      <label className="text-xs text-slate-600 flex items-center gap-2 mb-3">
        Paid as
        <select
          value={effectiveBasis}
          onChange={e => setBasisDraft(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-violet-400"
        >
          <option value="percent">a percentage of the sale</option>
          <option value="flat">a flat amount per sale</option>
        </select>
      </label>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">From sale #</span>
            <input type="number" min="1" value={r.from}
              onChange={e => setRow(i, 'from', parseInt(e.target.value, 10) || 1)}
              className="w-20 border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-violet-400" />
            <span className="text-slate-500">pay</span>
            <input type="number" min="0" step="0.01" value={r.rate}
              onChange={e => setRow(i, 'rate', parseFloat(e.target.value) || 0)}
              className="w-24 border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-violet-400" />
            <span className="text-slate-500">{effectiveBasis === 'percent' ? '%' : 'LKR'}</span>
            <Button size="sm" variant="ghost" onClick={() => removeRow(i)}>Remove</Button>
          </div>
        ))}
        {!rows.length && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No scheme set yet, so no commission can be worked out. Sales are still
            being credited to whoever closed them, so nothing is lost by setting
            this up later.
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="ghost" onClick={addRow}>+ Add a tier</Button>
        <Button size="sm"
          disabled={save.isPending || (!draft && !basisDraft)}
          onClick={() => save.mutate({ basis: effectiveBasis, tiers: rows })}>
          {save.isPending ? 'Saving…' : 'Save scheme'}
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="text-xs text-slate-500 mt-3">
          Worked example: {rows.map((r, i) => {
            const next = rows[i + 1];
            const upto = next ? `${r.from}–${next.from - 1}` : `${r.from} onward`;
            return `sales ${upto} pay ${r.rate}${effectiveBasis === 'percent' ? '%' : ' LKR'}`;
          }).join('; ')}.
        </div>
      )}
    </section>
  );
}
