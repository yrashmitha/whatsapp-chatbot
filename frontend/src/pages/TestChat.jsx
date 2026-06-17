import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

const newSessionId = () => 'test_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(16).slice(2));

export default function TestChat() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? selectedClientId : user?.clientId;
  const toast = useToast();

  const [sessionId, setSessionId] = useState(newSessionId);
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState('');
  const [busy, setBusy]           = useState(false);
  const fileRef = useRef(null);
  const endRef  = useRef(null);

  const params = clientId ? { client_id: clientId } : {};

  const loadMessages = useCallback(async () => {
    if (!clientId) return;
    try {
      const { data } = await api.get(`/plugins/webchat/${sessionId}/messages`, { params });
      setMessages(data.messages || []);
    } catch { /* ignore transient */ }
  }, [clientId, sessionId]);

  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !clientId) return;
    setInput('');
    setMessages(m => [...m, { sender_type: 'user', message_text: text, _optimistic: true }]);
    setBusy(true);
    try {
      await api.post(`/plugins/webchat/${sessionId}/message`, { message: text, client_id: clientId });
      await loadMessages();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file) => {
    if (!file || !clientId) return;
    setMessages(m => [...m, { sender_type: 'user', message_text: `📎 ${file.name}`, _optimistic: true }]);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('client_id', clientId);
      await api.post(`/plugins/webchat/${sessionId}/media`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await loadMessages();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const reset = async () => {
    try { await api.post(`/plugins/webchat/${sessionId}/reset`, { client_id: clientId }); } catch { /* ignore */ }
    setMessages([]);
    setSessionId(newSessionId());
    toast.success('New test session started');
  };

  return (
    <Layout>
      <div className="p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold text-slate-800">Test Chat</h1>
            <p className="text-sm text-slate-500">Chat with the AI exactly as a customer would — text or media. Nothing is sent to real WhatsApp.</p>
          </div>
          <button onClick={reset} className="px-3 py-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer">↺ New session</button>
        </div>

        {!clientId && <div className="text-sm text-amber-600">Select a client to start testing.</div>}

        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2">
          {messages.length === 0 && <p className="text-sm text-slate-400 m-auto">No messages yet — say hello 👋</p>}
          {messages.map((m, i) => {
            const isUser = m.sender_type === 'user';
            return (
              <div key={i} className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${isUser ? 'self-end bg-violet-600 text-white rounded-br-sm' : 'self-start bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                {m.message_text}
              </div>
            );
          })}
          {busy && <div className="self-start bg-white border border-slate-200 text-slate-400 text-sm px-3 py-2 rounded-2xl rounded-bl-sm">typing…</div>}
          <div ref={endRef} />
        </div>

        <div className="mt-3 flex gap-2 items-end">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy || !clientId}
            title="Upload image / PDF / audio / document"
            className="shrink-0 px-3 py-2.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer disabled:opacity-50"
          >📎</button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf,audio/*,.doc,.docx" className="hidden"
                 onChange={e => upload(e.target.files?.[0])} />
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="Type a message…"
            disabled={!clientId}
            className="flex-1 px-3 py-2.5 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-none"
          />
          <button onClick={send} disabled={busy || !input.trim() || !clientId}
                  className="shrink-0 px-4 py-2.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-xl border-0 cursor-pointer disabled:opacity-50">Send</button>
        </div>
      </div>
    </Layout>
  );
}
