import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

export default function Addons() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const toast = useToast();
  const qc = useQueryClient();

  const clientId = superAdmin ? selectedClientId : user?.clientId;

  const { data, isLoading } = useQuery({
    queryKey: ['addons', clientId],
    queryFn: () => api.get('/addons', { params: { client_id: clientId } }).then(r => r.data),
    enabled: superAdmin && !!clientId,
  });

  const toggle = async (addonId, currentEnabled) => {
    try {
      await api.put(`/addons/${addonId}`, { client_id: clientId, enabled: !currentEnabled });
      qc.invalidateQueries({ queryKey: ['addons', clientId] });
      qc.invalidateQueries({ queryKey: ['addons-status'] });
      toast.success(currentEnabled ? 'Addon disabled' : 'Addon enabled');
    } catch {
      toast.error('Failed to update addon');
    }
  };

  if (!superAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full text-slate-400 text-sm">
          Addon management is available to superadmin only.
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-2xl">
        <h1 className="text-lg font-bold text-slate-800 mb-1">Addons</h1>
        <p className="text-sm text-slate-500 mb-6">
          Enable or disable optional features for the selected client.
          {!clientId && <span className="text-amber-600 font-medium"> Select a client from the sidebar first.</span>}
        </p>

        {!clientId ? null : isLoading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : (
          <div className="flex flex-col gap-3">
            {(data?.addons || []).map(addon => (
              <div
                key={addon.id}
                className="flex items-start justify-between gap-4 p-4 bg-white border border-slate-200 rounded-xl"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-slate-800">{addon.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      addon.enabled
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {addon.enabled ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">{addon.description}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={addon.enabled}
                    onChange={() => toggle(addon.id, addon.enabled)}
                  />
                  <div className="w-10 h-5 bg-slate-200 peer-checked:bg-violet-600 rounded-full transition-colors
                    after:content-[''] after:absolute after:top-0.5 after:left-0.5
                    after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all
                    peer-checked:after:translate-x-5" />
                </label>
              </div>
            ))}
            {data?.addons?.length === 0 && (
              <div className="text-sm text-slate-400">No addons available.</div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
