import { useState, useRef } from 'react';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

export default function MessageInput({ phone, clientId, onSent }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const fileRef = useRef();

  const send = async (message, type = 'text') => {
    if (!message.trim() && type === 'text') return;
    setSending(true);
    try {
      await api.post('/send', { phone, message, type, ...(clientId && { client_id: clientId }) });
      setText('');
      onSent?.();
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(text);
    }
  };

  return (
    <div className="p-3 border-t border-slate-200 bg-white flex items-end gap-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKey}
        rows={1}
        placeholder="Type a message… (Enter to send)"
        className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-none max-h-32 overflow-y-auto"
        style={{ lineHeight: '1.5' }}
      />
      <button
        onClick={() => send(text)}
        disabled={sending || !text.trim()}
        className="shrink-0 w-9 h-9 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-xl flex items-center justify-center cursor-pointer border-0 transition-colors"
      >
        {sending ? (
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
        ) : '→'}
      </button>
    </div>
  );
}
