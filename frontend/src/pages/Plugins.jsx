import { useState, useEffect } from 'react';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

const PLUGIN_LIST = [
  {
    id: 'astro_vedic_chart',
    defaultName: 'Vedic Astro Chart',
    description: 'Generates personalized astrology-based WhatsApp messages using the customer\'s vedic birth chart.',
  },
];

function PluginCard({ pluginMeta, clientId }) {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    api.get(`/plugins/${pluginMeta.id}/config`, { params: { client_id: clientId } })
      .then(r => {
        setConfig(r.data);
        setName(r.data.name || pluginMeta.defaultName);
        setPrompt(r.data.prompt || '');
      })
      .catch(() => {
        setName(pluginMeta.defaultName);
        setPrompt('');
      });
  }, [pluginMeta.id, clientId]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plugins/${pluginMeta.id}/config`, { client_id: clientId, name, prompt });
      toast.success('Plugin config saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!config && clientId) {
    return (
      <div className="p-4 bg-white border border-slate-200 rounded-xl text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold text-slate-800 mb-0.5">{pluginMeta.defaultName}</div>
        <p className="text-xs text-slate-500">{pluginMeta.description}</p>
        <p className="text-xs text-slate-400 mt-0.5">Plugin ID: <code className="font-mono">{pluginMeta.id}</code></p>
      </div>

      <div>
        <label className="text-xs font-medium text-slate-500 block mb-1">Display Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-slate-500 block mb-1">Gemini Prompt</label>
        <p className="text-xs text-slate-400 mb-1.5">
          Use <code className="font-mono bg-slate-100 px-1 rounded">{'{chart_json}'}</code> where the chart data should be inserted.
        </p>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={8}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl cursor-pointer border-0 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function Plugins() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? selectedClientId : user?.clientId;

  if (!superAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full text-slate-400 text-sm">
          Plugin management is available to superadmin only.
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-2xl">
        <h1 className="text-lg font-bold text-slate-800 mb-1">Plugins</h1>
        <p className="text-sm text-slate-500 mb-6">
          Configure plugin settings and custom prompts for the selected client.
          {!clientId && <span className="text-amber-600 font-medium"> Select a client from the sidebar first.</span>}
        </p>

        {clientId && (
          <div className="flex flex-col gap-4">
            {PLUGIN_LIST.map(p => (
              <PluginCard key={p.id} pluginMeta={p} clientId={clientId} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
