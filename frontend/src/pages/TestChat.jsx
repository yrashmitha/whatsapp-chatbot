import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  const qc = useQueryClient();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  const [tab, setTab] = useState('chat');
  const [sessionId, setSessionId] = useState(newSessionId);
  const [draftEdit, setDraftEdit] = useState(null);
  // Which prompt strategy this test chat runs: 'A', 'B', or 'auto' (follow the live split).
  const [arm, setArm] = useState('B');
  const params = clientId ? { client_id: clientId } : {};

  const { data: config } = useQuery({
    queryKey: ['test-chat-config', clientId],
    queryFn: () => api.get('/test-chat/config', { params }).then(r => r.data),
    enabled: !!clientId,
  });

  const saveMutation = useMutation({
    mutationFn: (system_prompt) => api.post('/test-chat/config', { system_prompt, strategy: arm === 'B' ? 'B' : 'A' }, { params }).then(r => r.data),
    onSuccess: (d) => {
      toast.success(d.active ? 'Draft prompt applied to test sessions' : 'Draft prompt cleared');
      setDraftEdit(null);
      qc.invalidateQueries({ queryKey: ['test-chat-config', clientId] });
      setSessionId(newSessionId());
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Failed to save'),
  });

  const savedDraft = arm === 'B' ? (config?.test_system_prompt_b || '') : (config?.test_system_prompt || '');
  const promptDraft = draftEdit ?? savedDraft;
  const active = !!savedDraft.trim();

  function pickArm(next) {
    if (next === arm) return;
    setArm(next);
    setDraftEdit(null);
    setSessionId(newSessionId());
  }

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
              <div className="flex flex-col xl:flex-row gap-4 xl:h-[calc(100vh-14rem)]">
                <div className="bg-white border border-slate-200 rounded-xl p-4 xl:w-[26rem] xl:shrink-0 xl:overflow-y-auto">
                  <div className="flex gap-1 mb-3" role="tablist" aria-label="Prompt strategy">
                    {[['A', 'Strategy A'], ['B', 'Strategy B'], ['auto', 'Live split']].map(([id, label]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={arm === id}
                        onClick={() => pickArm(id)}
                        className={`text-xs px-3 py-1.5 rounded-lg border-0 cursor-pointer font-medium transition-colors ${
                          arm === id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >{label}</button>
                    ))}
                  </div>
                  {arm === 'B' && !config?.strategy_b_exists && !(config?.test_system_prompt_b || '').trim() && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mb-2">
                      Strategy B has no prompt yet. Write a draft below, or save one under Settings.
                    </p>
                  )}
                  {arm === 'auto' && (
                    <p className="text-xs text-slate-500 mb-2">
                      Follows the live split: the customer is given A or B the way a real new customer would be
                      ({config?.strategy_test_enabled ? 'the split is on' : 'the split is off, so this runs A'}).
                    </p>
                  )}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-700">Draft prompt, strategy {arm === 'auto' ? 'A and B' : arm}</span>
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
                    disabled={arm === 'auto'}
                    value={promptDraft}
                    onChange={e => setDraftEdit(e.target.value)}
                    rows={14}
                    placeholder="Leave blank to use the client's live prompt…"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 resize-y font-mono"
                  />
                  <div className="flex gap-2 mt-2">
                    <Button onClick={() => saveMutation.mutate(promptDraft)} disabled={saveMutation.isPending || arm === 'auto'}>
                      {saveMutation.isPending ? 'Saving…' : 'Apply and restart session'}
                    </Button>
                    {active && (
                      <Button
                        variant="ghost"
                        onClick={() => { setDraftEdit(''); saveMutation.mutate(''); }}
                        disabled={saveMutation.isPending}
                      >Clear</Button>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0 h-[65vh] xl:h-full">
                  <TestChatPanel
                    clientId={clientId}
                    sessionId={sessionId}
                    onSessionReset={() => setSessionId(newSessionId())}
                    strategy={arm}
                  />
                </div>
              </div>
            )}

            {tab === 'extract' && <MediaExtractPanel clientId={clientId} />}
          </>
        )}
      </div>
    </Layout>
  );
}
