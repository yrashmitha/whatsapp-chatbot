import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import TestChatPanel from '../components/TestChatPanel';
import MediaExtractPanel from '../components/MediaExtractPanel';
import Button from '../components/ui/Button';
import api from '../lib/api';
import { useToast } from '../components/ui/Toast';

const TABS = [
  { id: 'chat',    label: 'Chat' },
  { id: 'extract', label: 'File Reading' },
];

function newSessionId() {
  return 'test_' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, '');
}

export default function TestChat() {
  const { user, selectedClientId } = useAuthStore();
  const toast = useToast();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  const [tab, setTab] = useState('chat');
  const [sessionId, setSessionId] = useState(newSessionId);
  const [promptDraft, setPromptDraft] = useState('');
  const params = clientId ? { client_id: clientId } : {};

  const { data: config } = useQuery({
    queryKey: ['test-chat-config', clientId],
    queryFn: () => api.get('/test-chat/config', { params }).then(r => r.data),
    enabled: !!clientId,
  });

  useEffect(() => {
    if (config) setPromptDraft(config.test_system_prompt || '');
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: (system_prompt) => api.post('/test-chat/config', { system_prompt }, { params }).then(r => r.data),
    onSuccess: (d) => {
      toast.success(d.active ? 'Draft prompt applied to test sessions' : 'Draft prompt cleared');
      setSessionId(newSessionId());
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Failed to save'),
  });

  const active = !!(config?.test_system_prompt || '').trim();

  return (
    <Layout>
      <div className="p-6 overflow-y-auto h-full">
        <h1 className="text-lg font-bold text-slate-800 mb-1">Test Chat</h1>
        <p className="text-sm text-slate-500 mb-5">
          Try this client's bot without touching WhatsApp. It runs the real pipeline, so what
          you see here is what a customer would get.
          {!clientId && (
            <span className="text-amber-600 font-medium"> Select a client from the sidebar first.</span>
          )}
        </p>

        {clientId && (
          <>
            <div className="flex gap-1 mb-4">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`text-sm px-3 py-1.5 rounded-lg border-0 cursor-pointer font-medium transition-colors ${
                    tab === t.id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >{t.label}</button>
              ))}
            </div>

            {tab === 'chat' && (
              <div className="flex flex-col gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-700">Draft system prompt</span>
                    {active && (
                      <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        applied to test sessions
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mb-2">
                    Try a candidate prompt here first. It affects only Test Chat — real customers
                    keep the saved prompt until you copy this into Settings. Leave blank to test
                    the live one.
                  </p>
                  <textarea
                    value={promptDraft}
                    onChange={e => setPromptDraft(e.target.value)}
                    rows={8}
                    placeholder="Leave blank to use the client's live prompt…"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 resize-y font-mono"
                  />
                  <div className="flex gap-2 mt-2">
                    <Button onClick={() => saveMutation.mutate(promptDraft)} disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? 'Saving…' : 'Apply and restart session'}
                    </Button>
                    {active && (
                      <Button
                        variant="ghost"
                        onClick={() => { setPromptDraft(''); saveMutation.mutate(''); }}
                        disabled={saveMutation.isPending}
                      >Clear</Button>
                    )}
                  </div>
                </div>

                <TestChatPanel
                  clientId={clientId}
                  sessionId={sessionId}
                  onSessionReset={() => setSessionId(newSessionId())}
                />
              </div>
            )}

            {tab === 'extract' && <MediaExtractPanel clientId={clientId} />}
          </>
        )}
      </div>
    </Layout>
  );
}
