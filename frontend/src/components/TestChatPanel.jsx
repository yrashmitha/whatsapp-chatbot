import { useState, useRef, useEffect, useCallback } from 'react';
import { formatWhatsApp } from '../lib/whatsappFormat';

// In production frontend+backend share the same origin, so relative /templates/
// paths work as-is. In dev, set VITE_BACKEND_URL to load them from Railway.
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
function resolveMediaUrl(url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${BACKEND_URL}${url}`;
}
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import Button from './ui/Button';
import Spinner from './ui/Spinner';
import { useToast } from './ui/Toast';

/**
 * A real conversation against a throwaway test customer.
 *
 * Runs the same pipeline a WhatsApp message does — same prompt, same tools,
 * same history — so behaviour seen here is behaviour a customer would get.
 */

/** One labelled block in the debug panel. */
function DebugRow({ label, children }) {
  return (
    <div className="px-3 py-2 border-b border-slate-100 last:border-b-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</div>
      {children}
    </div>
  );
}

/**
 * What the last turn actually did — which tools ran, what the model cost, and
 * what has been collected so far. Without it a wrong reply gives no clue
 * whether the prompt, the tools, or the data was at fault.
 */
function DebugPanel({ debug, onClose }) {
  if (!debug) {
    return (
      <div className="w-72 shrink-0 border-l border-slate-200 bg-slate-50 flex items-center justify-center">
        <p className="text-xs text-slate-400 px-4 text-center">Send a message to see what the turn did.</p>
      </div>
    );
  }
  const fields = debug.order?.fields || {};
  return (
    <div className="w-72 shrink-0 border-l border-slate-200 bg-slate-50 overflow-y-auto">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-slate-50">
        <span className="text-xs font-semibold text-slate-700">Last turn</span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 text-base leading-none bg-transparent border-0 cursor-pointer px-1"
        >×</button>
      </div>

      <DebugRow label="Prompt">
        <div className="text-xs text-slate-600">
          {debug.promptChars?.toLocaleString()} chars
          {debug.draftPromptActive && (
            <span className="ml-1.5 text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
              draft
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5">{debug.model}</div>
      </DebugRow>

      <DebugRow label="Tools called">
        {debug.toolCalls?.length ? (
          <div className="flex flex-col gap-1.5">
            {debug.toolCalls.map((t, i) => (
              <div key={i}>
                <div className="text-xs font-medium text-teal-700">{t.name}</div>
                {t.args && Object.keys(t.args).length > 0 && (
                  <pre className="text-[10px] text-slate-500 bg-white border border-slate-200 rounded p-1.5 mt-0.5 overflow-x-auto">
                    {JSON.stringify(t.args, null, 1)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ) : <span className="text-xs text-slate-400">none</span>}
      </DebugRow>

      <DebugRow label="Tokens">
        <div className="text-xs text-slate-600">
          in {debug.inputTokens?.toLocaleString() ?? '?'} · out {debug.outputTokens?.toLocaleString() ?? '?'}
        </div>
        {debug.costUSD != null && (
          <div className="text-[11px] text-slate-400 mt-0.5">${debug.costUSD.toFixed(6)}</div>
        )}
      </DebugRow>

      <DebugRow label="Collected so far">
        {Object.keys(fields).length ? (
          <div className="flex flex-col gap-0.5">
            {Object.entries(fields).map(([k, v]) => (
              <div key={k} className="text-[11px] flex gap-1.5">
                <span className="text-slate-400 shrink-0">{k}</span>
                <span className="text-slate-700 break-all">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
          </div>
        ) : <span className="text-xs text-slate-400">nothing yet</span>}
      </DebugRow>

      {debug.order && (
        <DebugRow label="Order">
          <div className="text-xs text-slate-600">{debug.order.orderId}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{debug.order.status}</div>
        </DebugRow>
      )}

      {debug.fallback && (
        <DebugRow label="Warning">
          <span className="text-xs text-red-600">
            Fallback reply — the model failed and this would be suppressed in production.
          </span>
        </DebugRow>
      )}
    </div>
  );
}

export default function TestChatPanel({ clientId, sessionId, onSessionReset }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [debug, setDebug] = useState(null);
  const [debugOpen, setDebugOpen] = useState(true);
  const scrollRef = useRef(null);
  const params = clientId ? { client_id: clientId } : {};

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['test-chat', sessionId, clientId],
    queryFn: () => api.get(`/test-chat/${sessionId}/messages`, { params }).then(r => r.data),
    enabled: !!clientId && !!sessionId,
  });

  // Pin to the newest message. Driven off the scroll container rather than a
  // sentinel element, so it still lands at the bottom when the reply that just
  // arrived is taller than the viewport.
  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, []);

  useEffect(scrollToEnd, [messages, scrollToEnd]);

  const sendMutation = useMutation({
    mutationFn: (message) => api.post(`/test-chat/${sessionId}/message`, { message, ...params }, { params })
      .then(r => r.data),
    onSuccess: (d) => {
      setDebug(d.debug || null);
      qc.invalidateQueries({ queryKey: ['test-chat', sessionId, clientId] });
      scrollToEnd();
      if (d.fallback) toast.error('The bot returned its fallback message');
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Failed to send'),
  });

  // Keep the typing bubble in view while the reply is being written.
  useEffect(() => { if (sendMutation.isPending) scrollToEnd(); }, [sendMutation.isPending, scrollToEnd]);

  const resetMutation = useMutation({
    mutationFn: () => api.delete(`/test-chat/${sessionId}`, { params }),
    onSuccess: () => { setDebug(null); onSessionReset?.(); toast.success('Session cleared'); },
    onError: (err) => toast.error(err?.response?.data?.error || 'Failed to reset'),
  });

  function send(e) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || sendMutation.isPending) return;
    setText('');
    sendMutation.mutate(t);
  }

  if (!clientId) {
    return <p className="text-sm text-slate-400">Select a client from the sidebar first.</p>;
  }

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
        <span className="text-xs text-slate-500 truncate">
          Test session · <code className="font-mono">{sessionId}</code>
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setDebugOpen(o => !o)}
            className={`text-xs px-2 py-0.5 rounded-full border-0 cursor-pointer font-medium ${
              debugOpen ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
            }`}
          >Debug</button>
          <button
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            className="text-xs text-violet-600 hover:text-violet-700 bg-transparent border-0 cursor-pointer disabled:opacity-50"
          >{resetMutation.isPending ? 'Clearing…' : 'Start fresh'}</button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
            {isLoading && (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-400 py-6">
                <Spinner size="sm" /> Loading…
              </div>
            )}

            {!isLoading && messages.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">
                Send a message to try this client's bot. Nothing here reaches a real customer.
              </p>
            )}

            {messages.flatMap((m, i) => {
              const mine = m.sender_type === 'user';

              // A review screenshot or sample chart the assistant sent — its
              // own bubble, an actual thumbnail, not text with a [image] tag.
              if (m.media_type === 'image' && m.media_url) {
                const url = resolveMediaUrl(m.media_url);
                return (
                  <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <a href={url} target="_blank" rel="noreferrer" className="max-w-[60%]">
                      <img src={url} alt="" className="rounded-xl border border-slate-200 max-w-full" />
                    </a>
                  </div>
                );
              }
              if (m.media_type === 'pdf' && m.media_url) {
                const url = resolveMediaUrl(m.media_url);
                return (
                  <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-[78%] px-3 py-2 rounded-2xl text-sm bg-slate-100 text-slate-800 rounded-bl-sm no-underline"
                    >
                      📄 {String(m.message_text || 'document.pdf').replace(/^\[PDF: /, '').replace(/\]$/, '')}
                    </a>
                  </div>
                );
              }

              // The sender splits a reply on [[MSG_BREAK]] and delivers each
              // part as its own WhatsApp message. Test Chat has to do the same
              // or it shows one bubble with the marker in it, which is neither
              // what the model wrote nor what a customer receives.
              const parts = String(m.message_text || '')
                .split('[[MSG_BREAK]]').map(p => p.trim()).filter(Boolean);
              const bubbles = parts.length ? parts : [''];
              return bubbles.map((part, j) => (
                <div key={`${i}-${j}`} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                      mine ? 'bg-violet-600 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                    }`}
                  >
                    {formatWhatsApp(part)}
                    {bubbles.length > 1 && (
                      <span className={`block mt-1 text-[10px] ${mine ? 'text-violet-200' : 'text-slate-400'}`}>
                        message {j + 1} of {bubbles.length}
                      </span>
                    )}
                    {m.media_type && j === bubbles.length - 1 && (
                      <span className={`block mt-1 text-[10px] ${mine ? 'text-violet-200' : 'text-slate-400'}`}>
                        [{m.media_type}]
                      </span>
                    )}
                  </div>
                </div>
              ));
            })}

            {sendMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-slate-100 text-slate-400 px-3 py-2 rounded-2xl rounded-bl-sm text-sm flex items-center gap-2">
                  <Spinner size="sm" /> typing…
                </div>
              </div>
            )}
          </div>

          <form onSubmit={send} className="px-3 py-2.5 border-t border-slate-200 flex gap-2 bg-white shrink-0">
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Type a message as the customer…"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
            <Button type="submit" disabled={sendMutation.isPending || !text.trim()}>Send</Button>
          </form>
        </div>

        {debugOpen && <DebugPanel debug={debug} onClose={() => setDebugOpen(false)} />}
      </div>
    </div>
  );
}
