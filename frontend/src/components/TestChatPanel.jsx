import { useState, useRef, useEffect } from 'react';
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
export default function TestChatPanel({ clientId, sessionId, onSessionReset }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const endRef = useRef(null);
  const params = clientId ? { client_id: clientId } : {};

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['test-chat', sessionId, clientId],
    queryFn: () => api.get(`/test-chat/${sessionId}/messages`, { params }).then(r => r.data),
    enabled: !!clientId && !!sessionId,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (message) => api.post(`/test-chat/${sessionId}/message`, { message, ...params }, { params })
      .then(r => r.data),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['test-chat', sessionId, clientId] });
      if (d.fallback) toast.error('The bot returned its fallback message');
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Failed to send'),
  });

  const resetMutation = useMutation({
    mutationFn: () => api.delete(`/test-chat/${sessionId}`, { params }),
    onSuccess: () => { onSessionReset?.(); toast.success('Session cleared'); },
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
    <div className="flex flex-col h-[65vh] bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <span className="text-xs text-slate-500">
          Test session · <code className="font-mono">{sessionId}</code>
        </span>
        <button
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
          className="text-xs text-violet-600 hover:text-violet-700 bg-transparent border-0 cursor-pointer disabled:opacity-50"
        >
          {resetMutation.isPending ? 'Clearing…' : 'Start fresh'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
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

        {messages.map((m, i) => {
          const mine = m.sender_type === 'user';
          return (
            <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                  mine ? 'bg-violet-600 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                }`}
              >
                {m.message_text}
                {m.media_type && (
                  <span className={`block mt-1 text-[10px] ${mine ? 'text-violet-200' : 'text-slate-400'}`}>
                    [{m.media_type}]
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {sendMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 text-slate-400 px-3 py-2 rounded-2xl rounded-bl-sm text-sm flex items-center gap-2">
              <Spinner size="sm" /> typing…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="px-3 py-2.5 border-t border-slate-200 flex gap-2 bg-white">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type a message as the customer…"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
        />
        <Button type="submit" disabled={sendMutation.isPending || !text.trim()}>Send</Button>
      </form>
    </div>
  );
}
