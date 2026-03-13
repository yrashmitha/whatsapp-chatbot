import { useState, useRef } from 'react';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

export default function MessageInput({ phone, clientId, crmMediaEnabled, onSent }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const fileRef = useRef();

  const params = clientId ? { client_id: clientId } : {};

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

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setSending(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('phone', phone);
      if (clientId) form.append('client_id', clientId);
      await api.post('/crm/send-media', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        params,
      });
      onSent?.();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to send file');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-3 border-t border-slate-200 bg-white flex items-end gap-2">
      {crmMediaEnabled && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,audio/*"
            className="hidden"
            onChange={handleFile}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={sending}
            title="Send image, PDF or audio"
            className="shrink-0 w-9 h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-50 bg-white cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
        </>
      )}
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
