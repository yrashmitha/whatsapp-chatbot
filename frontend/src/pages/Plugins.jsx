import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

const ALL_PLUGINS = [
  {
    id: 'astro_vedic_chart',
    defaultName: 'Vedic Astro Chart',
    description: "Generates personalized astrology-based WhatsApp messages using the customer's vedic birth chart.",
  },
  {
    id: 'horoscope_reading',
    defaultName: 'Horoscope Reading',
    description: 'Generates full 10-section Vedic horoscope Word documents for payment_received orders.',
  },
  {
    id: 'ai_call_answering',
    defaultName: 'AI Call Answering',
    description: 'Answers inbound Twilio phone calls with an AI agent, transcribes the conversation, and logs it in the CRM.',
  },
];

function PluginCard({ pluginMeta, clientId, superAdmin }) {
  const toast = useToast();
  const isHoroscope   = pluginMeta.id === 'horoscope_reading';
  const isCallAnswering = pluginMeta.id === 'ai_call_answering';

  const [config, setConfig] = useState(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [specialNote, setSpecialNote]   = useState('');
  const [greeting, setGreeting]         = useState('');
  const [ttsVoice, setTtsVoice]         = useState('');
  const [sttLanguage, setSttLanguage]   = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    setConfig(null);
    api.get(`/plugins/${pluginMeta.id}/config`, { params: { client_id: clientId } })
      .then(r => {
        setConfig(r.data);
        setName(r.data.name || pluginMeta.defaultName);
        setPrompt(r.data.prompt || '');
        setApiKey(r.data.api_key || '');
        setSystemPrompt(r.data.system_prompt || '');
        setSpecialNote(r.data.special_note || '');
        setGreeting(r.data.greeting || '');
        setTtsVoice(r.data.tts_voice || 'Kore');
        setSttLanguage(r.data.stt_language || 'en-US');
      })
      .catch(() => {
        setConfig({});
        setName(pluginMeta.defaultName);
        setPrompt('');
        setApiKey('');
        setSystemPrompt('');
        setSpecialNote('');
        setGreeting('');
        setTtsVoice('Kore');
        setSttLanguage('en-US');
      });
  }, [pluginMeta.id, clientId]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { client_id: clientId, api_key: apiKey };
      if (superAdmin) body.name = name;
      if (isHoroscope) {
        body.system_prompt = systemPrompt;
        body.special_note  = specialNote;
      } else if (isCallAnswering) {
        body.system_prompt = systemPrompt;
        body.greeting      = greeting;
        body.tts_voice     = ttsVoice;
        body.stt_language  = sttLanguage;
      } else {
        body.prompt = prompt;
      }
      await api.put(`/plugins/${pluginMeta.id}/config`, body);
      toast.success('Plugin config saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className="p-4 bg-white border border-slate-200 rounded-xl text-sm text-slate-400">Loading…</div>
    );
  }

  return (
    <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold text-slate-800 mb-0.5">{name || pluginMeta.defaultName}</div>
        <p className="text-xs text-slate-500">{pluginMeta.description}</p>
        {superAdmin && (
          <p className="text-xs text-slate-400 mt-0.5">Plugin ID: <code className="font-mono">{pluginMeta.id}</code></p>
        )}
      </div>

      {superAdmin && (
        <div>
          <label className="text-xs font-medium text-slate-500 block mb-1">Display Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
        </div>
      )}

      {!isCallAnswering && (
      <div>
        <label className="text-xs font-medium text-slate-500 block mb-1">FreeAstro API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="Enter your FreeAstro API key…"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 font-mono"
        />
        <p className="text-xs text-slate-400 mt-1">Get your key at freeastroapi.com</p>
      </div>
      )}

      {isCallAnswering && (
        <>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Greeting</label>
            <p className="text-xs text-slate-400 mb-1.5">First thing the AI says when it answers the call.</p>
            <input
              type="text"
              value={greeting}
              onChange={e => setGreeting(e.target.value)}
              placeholder="Hello! How can I help you today?"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">System Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">AI personality and instructions for handling calls.</p>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={6}
              placeholder="You are a helpful AI phone receptionist. Keep responses short and conversational..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">TTS Voice (Gemini)</label>
            <p className="text-xs text-slate-400 mb-1.5">Gemini prebuilt voice — supports Sinhala and 100+ languages automatically.</p>
            <select
              value={ttsVoice}
              onChange={e => setTtsVoice(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              {['Kore','Leda','Puck','Charon','Zephyr','Fenrir','Enceladus','Aoede','Algieba','Despina','Sulafat','Orus','Gacrux','Iapetus','Schedar','Achernar','Achird','Algenib','Alnilam','Autonoe','Callirrhoe','Erinome','Laomedeia','Pulcherrima','Rasalgethi','Sadachbia','Sadaltager','Umbriel','Vindemiatrix','Zubenelgenubi'].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">Voice is language-agnostic — it speaks whatever language the text is in.</p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">STT Language (Caller speech)</label>
            <p className="text-xs text-slate-400 mb-1.5">Language Twilio uses to transcribe the caller's speech.</p>
            <select
              value={sttLanguage}
              onChange={e => setSttLanguage(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="en-US">English (en-US)</option>
              <option value="si-LK">Sinhala (si-LK)</option>
              <option value="en-GB">English UK (en-GB)</option>
              <option value="hi-IN">Hindi (hi-IN)</option>
              <option value="ta-LK">Tamil Sri Lanka (ta-LK)</option>
            </select>
          </div>
        </>
      )}

      {!isHoroscope && !isCallAnswering && (
        <div>
          <label className="text-xs font-medium text-slate-500 block mb-1">Gemini Prompt</label>

          <p className="text-xs text-slate-400 mb-1.5">
            Use <code className="font-mono bg-slate-100 px-1 rounded">{'{chart_json}'}</code> where chart data will be inserted.
          </p>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={8}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
          />
        </div>
      )}

      {isHoroscope && (
        <>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">System Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">
              This becomes the Gemini system instruction for all 10 sections. Include your astrologer persona, language guidelines, etc.
            </p>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="ඔබ දක්ෂ වෛදික ජ්‍යෝතිෂ විශේෂඥයෙකි…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Special Note (Final Page)</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Static text added as the last page of every Word document (e.g. disclaimer, contact info).
            </p>
            <textarea
              value={specialNote}
              onChange={e => setSpecialNote(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="විශේෂ ශාස්ත්‍රීය සටහන…"
            />
          </div>
        </>
      )}

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

  // Fetch enabled addons to filter which plugin cards to show
  const { data: addonsData } = useQuery({
    queryKey: ['addons-status', clientId],
    queryFn: () => api.get('/crm/addons-status', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
  });

  const enabledAddons = addonsData?.addons || [];
  const visiblePlugins = ALL_PLUGINS.filter(p => enabledAddons.includes(p.id));

  return (
    <Layout>
      <div className="p-6 max-w-2xl overflow-y-auto h-full">
        <h1 className="text-lg font-bold text-slate-800 mb-1">Plugins</h1>
        <p className="text-sm text-slate-500 mb-6">
          Configure plugin settings and custom prompts.
          {!clientId && <span className="text-amber-600 font-medium"> Select a client from the sidebar first.</span>}
        </p>

        {clientId && visiblePlugins.length === 0 && (
          <div className="text-sm text-slate-400">No plugins are enabled for this client. Enable them from the Addons page.</div>
        )}

        {clientId && visiblePlugins.length > 0 && (
          <div className="flex flex-col gap-4">
            {visiblePlugins.map(p => (
              <PluginCard key={p.id} pluginMeta={p} clientId={clientId} superAdmin={superAdmin} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
