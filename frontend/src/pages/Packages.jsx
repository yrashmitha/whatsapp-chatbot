import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { adminApi } from '../lib/api';

// ─── Add / Edit Package Modal ──────────────────────────────────────────────────
function PackageModal({ open, onClose, onSaved, item }) {
  const editing = !!item;
  const [id, setId] = useState(item?.id || '');
  const [name, setName] = useState(item?.name || '');
  const [messageLimit, setMessageLimit] = useState(item?.message_limit ?? '');
  const [perMessageCost, setPerMessageCost] = useState(item?.per_message_cost ?? 0);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  if (!open) return null;

  const handleSave = async () => {
    if (!name.trim() || !messageLimit) return;
    if (!editing && !id.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await adminApi.patch(`/packages/${item.id}`, {
          name: name.trim(),
          message_limit: Number(messageLimit),
          per_message_cost: Number(perMessageCost),
        });
        toast.success('Package updated');
      } else {
        await adminApi.post('/packages', {
          id: id.trim(),
          name: name.trim(),
          message_limit: Number(messageLimit),
          per_message_cost: Number(perMessageCost),
        });
        toast.success('Package created');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">{editing ? 'Edit Package' : 'New Package'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none bg-transparent border-0 cursor-pointer">×</button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-4 overflow-y-auto flex-1">
          {!editing && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Package ID</label>
              <input
                value={id} onChange={e => setId(e.target.value)}
                placeholder="e.g. starter"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
              <p className="text-xs text-slate-400 mt-0.5">Unique identifier, cannot be changed later</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Package Name</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Starter Plan"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Message Limit / Month</label>
            <input
              type="number" min="1" value={messageLimit}
              onChange={e => setMessageLimit(e.target.value)}
              placeholder="e.g. 1000"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Per-Message Cost (USD)</label>
            <input
              type="number" min="0" step="0.000001" value={perMessageCost}
              onChange={e => setPerMessageCost(e.target.value)}
              placeholder="e.g. 0.002"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
            <p className="text-xs text-slate-400 mt-0.5">Default overage cost per message for clients on this package</p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim() || !messageLimit || (!editing && !id.trim())}
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create package'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Packages page ─────────────────────────────────────────────────────────────
export default function Packages() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState(null); // null | 'new' | { ...item }

  // Superadmin only
  if (!isSuperAdmin(user)) {
    navigate('/chat', { replace: true });
    return null;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['packages'],
    queryFn: () => adminApi.get('/packages').then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => adminApi.delete(`/packages/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packages'] }); toast.success('Package deleted'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to delete'),
  });

  const packages = data || [];

  const handleDelete = (pkg) => {
    if (!confirm(`Delete package "${pkg.name}"? Clients on this package will lose their assignment.`)) return;
    deleteMutation.mutate(pkg.id);
  };

  return (
    <Layout>
      {modal && (
        <PackageModal
          open
          onClose={() => setModal(null)}
          item={modal === 'new' ? null : modal}
          onSaved={() => qc.invalidateQueries({ queryKey: ['packages'] })}
        />
      )}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Packages</h1>
              <p className="text-sm text-slate-400 mt-0.5">Define message plans and pricing tiers for clients.</p>
            </div>
            <Button onClick={() => setModal('new')}>+ New Package</Button>
          </div>

          {isLoading && (
            <div className="flex justify-center py-12"><Spinner /></div>
          )}

          {!isLoading && packages.length === 0 && (
            <div className="text-center py-12 text-sm text-slate-400">
              No packages yet. Create one to start assigning plans to clients.
            </div>
          )}

          <div className="flex flex-col gap-3">
            {packages.map(pkg => (
              <div key={pkg.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}
                >
                  {pkg.name?.[0]?.toUpperCase() || 'P'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-slate-800">{pkg.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    <span className="font-mono text-slate-400">{pkg.id}</span>
                    {' · '}
                    <span>{Number(pkg.message_limit).toLocaleString()} msgs/mo</span>
                    {parseFloat(pkg.per_message_cost) > 0 && (
                      <span> · ${parseFloat(pkg.per_message_cost).toFixed(6)}/msg overage</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setModal(pkg)}>Edit</Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(pkg)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
