import { useState, useRef, useEffect } from 'react';
import api from '../../lib/api';
import VoiceRecordButton from './VoiceRecordButton';
import { useToast } from '../ui/Toast';
import { checkFile, sendInOrder } from '../../lib/sendFiles';

function VoiceClipPickerModal({ open, onClose, phone, clientId, onSent }) {
  const [clips, setClips]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(null);
  const toast = useToast();
  const params = clientId ? { client_id: clientId } : {};

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/voice-clips', { params }).then(r => setClips(r.data.clips || [])).catch(() => setClips([])).finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const handleSend = async (clip) => {
    setSending(clip.id);
    try {
      await api.post('/voice-clips/send', { phone, clip_id: clip.id }, { params });
      toast.success(`Sent: ${clip.name}`);
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to send voice clip');
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-4 flex flex-col gap-3 mx-4 mb-4 sm:mb-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Send Voice Clip</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer border-0 bg-transparent">×</button>
        </div>

        {loading ? (
          <div className="py-6 flex justify-center text-slate-400 text-sm">Loading clips…</div>
        ) : clips.length === 0 ? (
          <p className="py-6 text-center text-slate-400 text-sm">No voice clips saved yet. Go to Voice Clips to add one.</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {clips.map(clip => (
              <div key={clip.id} className="flex items-center gap-3 p-2 rounded-xl border border-slate-100 hover:border-violet-200 hover:bg-violet-50 transition-colors">
                <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{clip.name}</p>
                  <code className="text-xs text-violet-500">[[VOICE:{clip.trigger_keyword}]]</code>
                </div>
                <button
                  onClick={() => handleSend(clip)}
                  disabled={sending === clip.id}
                  className="shrink-0 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg cursor-pointer border-0 transition-colors"
                >
                  {sending === clip.id ? '…' : 'Send'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const isPdfUrl   = (u) => /\.pdf(\?|$)/i.test(u || '');
const isVideoUrl = (u) => /\.(mp4|3gp)(\?|$)/i.test(u || '');

/**
 * Pick one or several of the business's saved images, PDFs or videos (the Media
 * library) and send them.
 *
 * Tapping an item selects it, tapping again unselects, and the number on each
 * tile is the order they will arrive in. Sending is a separate, deliberate tap,
 * because on a phone the grid is easy to brush and a wrong file to a customer
 * cannot be taken back. Images go as images (png/jpg are what WhatsApp
 * accepts), PDFs as documents and mp4 videos as videos.
 */
function ImagePickerModal({ open, onClose, phone, clientId, onSent }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]); // item ids, in the order tapped
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const params = clientId ? { client_id: clientId } : {};

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setCaption('');
    setLoading(true);
    api.get('/media', { params })
      .then(r => setItems((r.data.media || []).filter(m => /\.(png|jpe?g|pdf|mp4|3gp)(\?|$)/i.test(m.image_url || ''))))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const chosen = selected.map(id => items.find(m => m.id === id)).filter(Boolean);
  const toggle = (id) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const handleSend = async () => {
    if (!chosen.length) return;
    setSending(true);
    try {
      // A caption only makes sense on a single item; with several it is not offered.
      const one = chosen.length === 1;
      const { sent, failed } = await sendInOrder(chosen, async (m) => {
        const pdf = isPdfUrl(m.image_url);
        await api.post('/send', {
          phone, type: pdf ? 'document' : isVideoUrl(m.image_url) ? 'video' : 'image',
          mediaUrl: m.image_url, message: one ? caption.trim() : '',
          ...(pdf && { filename: m.title }),
          ...(clientId && { client_id: clientId }),
        });
        onSent?.();
      });
      if (!failed.length) {
        toast.success(one ? `Sent: ${chosen[0].title}` : `Sent ${sent} items`);
        onClose();
      } else {
        toast.error(`Sent ${sent} of ${chosen.length}. Not sent: ${failed.map(f => `${f.item.title} (${f.error})`).join('; ')}`);
        // Keep only what failed selected, so it can be retried as it is.
        setSelected(failed.map(f => f.item.id));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 flex flex-col gap-3 mx-4 mb-4 sm:mb-0 max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">
            Send Images, PDFs or Videos
            <span className="block text-xs font-normal text-slate-400">Tap to select one or more</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer border-0 bg-transparent">×</button>
        </div>

        {loading ? (
          <div className="py-6 flex justify-center text-slate-400 text-sm">Loading images…</div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-slate-400 text-sm">No images, PDFs or videos saved yet. Add some on the Media page.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 overflow-y-auto min-h-0">
            {items.map(m => {
              const order = selected.indexOf(m.id);
              return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                disabled={sending}
                className={`relative flex flex-col gap-1 p-1 rounded-xl border-2 bg-white cursor-pointer text-left transition-colors ${
                  order >= 0 ? 'border-violet-500 bg-violet-50' : 'border-transparent hover:border-violet-200'
                }`}
              >
                {order >= 0 && (
                  <span className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center shadow">
                    {order + 1}
                  </span>
                )}
                {isVideoUrl(m.image_url) ? (
                  <div className="w-full aspect-square rounded-lg bg-slate-800 flex flex-col items-center justify-center text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span className="text-xs font-bold mt-1">VIDEO</span>
                  </div>
                ) : isPdfUrl(m.image_url) ? (
                  <div className="w-full aspect-square rounded-lg bg-red-50 flex flex-col items-center justify-center text-red-600">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-xs font-bold mt-1">PDF</span>
                  </div>
                ) : (
                  <img src={m.image_url} alt={m.title} loading="lazy" className="w-full aspect-square object-cover rounded-lg bg-slate-100" />
                )}
                <span className="text-xs text-slate-600 truncate">{m.title}</span>
              </button>
              );
            })}
          </div>
        )}

        {chosen.length > 0 && (
          <div className="flex flex-col gap-2 shrink-0">
            {chosen.length === 1 && (
              <input
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Caption (optional)"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400"
              />
            )}
            <button
              onClick={handleSend}
              disabled={sending}
              className="w-full py-2.5 text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-xl cursor-pointer border-0"
            >
              {sending ? 'Sending…' : chosen.length === 1 ? `Send "${chosen[0].title}"` : `Send ${chosen.length} items in this order`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessageInput({ phone, clientId, strategy, crmMediaEnabled, followUpEnabled, reportLink, reportReleased, prefill, onPrefillConsumed, onSent }) {
  const [text, setText] = useState('');
  // Which follow-up variant is currently drafting ('1' | '2' | null).
  const [drafting, setDrafting] = useState(null);
  const [sending, setSending] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toast = useToast();
  const fileRef = useRef();
  const textareaRef = useRef();

  // ── Quick replies ────────────────────────────────────────────────────────────
  const [quickReplies, setQuickReplies] = useState([]);
  const [showQR, setShowQR]             = useState(false);
  const [qrFilter, setQrFilter]         = useState('');
  const [qrIndex, setQrIndex]           = useState(0);
  // Phone picker: opens without the keyboard so the chat stays in view.
  const [sheetOpen, setSheetOpen]       = useState(false);
  const [sheetCat, setSheetCat]         = useState('');   // '' = all
  const [sheetQuery, setSheetQuery]     = useState('');

  // Long-press a row in the sheet to read the whole reply in a popup.
  const [previewReply, setPreviewReply] = useState(null);
  const pressTimer   = useRef(null);
  const pressStart   = useRef(null);
  const longPressed  = useRef(false);

  const cancelPress = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const startPress = (r, e) => {
    longPressed.current = false;
    const t = e.touches?.[0] || e;
    pressStart.current = { x: t.clientX, y: t.clientY };
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(15);
      setPreviewReply(r);
    }, 450);
  };
  const movePress = (e) => {
    const s = pressStart.current, t = e.touches?.[0];
    if (!s || !t) return;
    // Scrolling the list must not count as a hold.
    if (Math.abs(t.clientX - s.x) > 10 || Math.abs(t.clientY - s.y) > 10) cancelPress();
  };

  useEffect(() => () => clearTimeout(pressTimer.current), []);

  useEffect(() => {
    // An operator in a B chat sends B's wording, so ask for what that strategy would send.
    const params = { ...(clientId ? { client_id: clientId } : {}), ...(strategy ? { strategy } : {}) };
    api.get('/quick-replies', { params }).then(r => setQuickReplies(r.data)).catch(() => {});
  }, [clientId, strategy]);

  const filtered = quickReplies.filter(r =>
    !qrFilter || r.title.toLowerCase().includes(qrFilter) || r.text.toLowerCase().includes(qrFilter)
  );

  const categories = [...new Set(quickReplies.map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sheetItems = quickReplies.filter(r => {
    if (sheetCat && r.category !== sheetCat) return false;
    const q = sheetQuery.trim().toLowerCase();
    return !q || r.title.toLowerCase().includes(q) || r.text.toLowerCase().includes(q);
  });

  /**
   * Draft a follow-up from the conversation so far and drop it into the box
   * for the agent to edit, rather than sending anything on its own.
   */
  const draftFollowUp = async (variant) => {
    if (drafting) return;
    setDrafting(variant);
    try {
      const params = clientId ? { client_id: clientId } : {};
      const r = await api.post('/plugins/follow-up',
        { phone, variant, ...(clientId && { client_id: clientId }) }, { params });
      setText(r.data.text || '');
      textareaRef.current?.focus();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to draft a follow-up');
    } finally {
      setDrafting(null);
    }
  };

  const selectReply = (r) => {
    setText(r.text);
    setShowQR(false);
    textareaRef.current?.focus();
  };

  // From the sheet: fill the box and close, without raising the keyboard. The
  // agent reads the text above the composer and taps into it only to edit.
  const pickFromSheet = (r) => {
    setText(r.text);
    setShowQR(false);
    setSheetOpen(false);
    setSheetQuery('');
  };
  // ────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (prefill) {
      setText(prefill);
      onPrefillConsumed?.();
    }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

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

  const sendReportLink = () => {
    if (!reportLink || sending) return;
    send(reportLink);
  };

  const reportLinkBtn = (
    <button
      type="button"
      onClick={sendReportLink}
      disabled={sending || !reportLink}
      title={reportLink
        ? (reportReleased ? 'Send the customer their report link' : 'Send the report link (report not released yet)')
        : 'No order with a report link for this customer'}
      className="shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-40 bg-white cursor-pointer"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
      </svg>
    </button>
  );

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    if (val.startsWith('/')) {
      setQrFilter(val.slice(1).toLowerCase());
      setShowQR(true);
      setQrIndex(0);
    } else {
      setShowQR(false);
    }
  };

  const handleKey = (e) => {
    if (showQR && filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setQrIndex(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setQrIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter')     { e.preventDefault(); selectReply(filtered[qrIndex]); return; }
      if (e.key === 'Escape')    { setShowQR(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(text);
    }
  };

  // One or many files from the phone or computer, sent one after another in the
  // order they were picked. Anything WhatsApp would refuse is named up front with
  // the reason and left out, so one bad file does not stop the rest.
  const handleFile = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    const ok = [];
    const skipped = [];
    for (const f of picked) {
      const c = checkFile(f);
      if (c.error) skipped.push(`${f.name} (${c.error})`); else ok.push(f);
    }
    if (skipped.length) toast.error(`Not sent: ${skipped.join('; ')}`);
    if (!ok.length) return;
    setSending(true);
    if (ok.length > 1) toast.info(`Sending ${ok.length} files in order…`);
    try {
      const { sent, failed } = await sendInOrder(ok, async (file) => {
        const form = new FormData();
        form.append('file', file);
        form.append('phone', phone);
        if (clientId) form.append('client_id', clientId);
        await api.post('/crm/send-media', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          params,
        });
        onSent?.();
      });
      if (failed.length) {
        toast.error(ok.length === 1
          ? (failed[0].error || 'Failed to send file')
          : `Sent ${sent} of ${ok.length}. Failed: ${failed.map(f => `${f.item.name} (${f.error})`).join('; ')}`);
      } else if (ok.length > 1) {
        toast.success(`Sent ${sent} files`);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,video/mp4,video/3gpp,application/pdf,audio/*"
        className="hidden"
        onChange={handleFile}
      />
      {/* Quick replies dropdown */}
      {showQR && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-3 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20 max-h-60 overflow-y-auto">
          {filtered.map((r, i) => (
            <button
              key={r.id}
              onMouseDown={e => { e.preventDefault(); selectReply(r); }}
              className={`w-full text-left px-3 py-2.5 flex flex-col gap-0.5 border-0 cursor-pointer transition-colors border-l-2 ${
                i === qrIndex
                  ? 'bg-violet-600 border-l-violet-800'
                  : 'hover:bg-slate-50 border-l-transparent'
              }`}
            >
              <span className={`text-xs font-semibold ${i === qrIndex ? 'text-white' : 'text-violet-600'}`}>/{r.title}</span>
              <span className={`text-xs truncate ${i === qrIndex ? 'text-violet-100' : 'text-slate-500'}`}>{r.text}</span>
            </button>
          ))}
        </div>
      )}

      {/* Attachments, voice and follow-up drafts. Always on show at a desk;
          behind the + on a phone, where the message itself needs the width. */}
      <div className={`px-2 pt-2 gap-2 bg-white border-t border-slate-200 ${toolsOpen ? 'flex' : 'hidden'} @xl:hidden`}>
          {crmMediaEnabled && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={sending}
                title="Send photos, videos, PDFs or audio (select several at once)" aria-label="Send photos, videos, PDFs or audio"
                className="shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-50 bg-white cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <button
                onClick={() => setShowImagePicker(true)}
                disabled={sending}
                title="Send a saved image, PDF or video" aria-label="Send a saved image, PDF or video"
                className="shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-50 bg-white cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                onClick={() => setShowVoicePicker(true)}
                disabled={sending}
                title="Send voice clip" aria-label="Send voice clip"
                className="shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-50 bg-white cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
              {/* Saved clips above; this records a new one and sends it. */}
              <VoiceRecordButton phone={phone} clientId={clientId} onSent={onSent} />
            </>
          )}
          {followUpEnabled && (
            <div className="shrink-0 flex items-center gap-1">
              {['1', '2'].map(variant => (
                <button
                  key={variant}
                  type="button"
                  onClick={() => draftFollowUp(variant)}
                  disabled={!!drafting}
                  title={variant === '1'
                    ? 'Draft a follow-up — message 1'
                    : 'Draft a follow-up — message 2'}
                  className="relative w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-50 bg-white cursor-pointer"
                >
                  {drafting === variant ? (
                    <span className="w-4 h-4 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin block" />
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                      </svg>
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-violet-100 text-violet-600 text-[9px] font-bold flex items-center justify-center leading-none">
                        {variant}
                      </span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
          {reportLinkBtn}
      </div>

      <div className="p-2 @xl:p-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-slate-200 bg-white flex items-end gap-2">
        <button
          onClick={() => setToolsOpen(o => !o)}
          className={`@xl:hidden shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center transition-transform bg-white cursor-pointer ${
            toolsOpen ? 'rotate-45 text-violet-500 border-violet-300' : 'text-slate-400'
          }`}
          aria-label="More"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>

        <button
          onClick={() => { textareaRef.current?.blur(); setSheetOpen(true); }}
          className="@xl:hidden shrink-0 w-10 h-10 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 bg-white cursor-pointer"
          aria-label="Quick replies" title="Quick replies"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </button>

        <div className="hidden @xl:flex items-end gap-2">
          {crmMediaEnabled && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={sending}
                title="Send photos, videos, PDFs or audio (select several at once)" aria-label="Send photos, videos, PDFs or audio"
                className="shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-50 bg-white cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <button
                onClick={() => setShowImagePicker(true)}
                disabled={sending}
                title="Send a saved image, PDF or video" aria-label="Send a saved image, PDF or video"
                className="shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-50 bg-white cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                onClick={() => setShowVoicePicker(true)}
                disabled={sending}
                title="Send voice clip" aria-label="Send voice clip"
                className="shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-50 bg-white cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
              {/* Saved clips above; this records a new one and sends it. */}
              <VoiceRecordButton phone={phone} clientId={clientId} onSent={onSent} />
            </>
          )}
          {followUpEnabled && (
            <div className="shrink-0 flex items-center gap-1">
              {['1', '2'].map(variant => (
                <button
                  key={variant}
                  type="button"
                  onClick={() => draftFollowUp(variant)}
                  disabled={!!drafting}
                  title={variant === '1'
                    ? 'Draft a follow-up — message 1'
                    : 'Draft a follow-up — message 2'}
                  className="relative w-10 h-10 @xl:w-9 @xl:h-9 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-violet-500 hover:border-violet-300 transition-colors disabled:opacity-50 bg-white cursor-pointer"
                >
                  {drafting === variant ? (
                    <span className="w-4 h-4 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin block" />
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                      </svg>
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-violet-100 text-violet-600 text-[9px] font-bold flex items-center justify-center leading-none">
                        {variant}
                      </span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
          {reportLinkBtn}
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKey}
          rows={1}
          placeholder="Type a message… (/ for quick replies)"
          className="flex-1 min-w-0 px-3 py-2 text-base @xl:text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-none overflow-hidden"
          style={{ lineHeight: '1.5', maxHeight: '200px', overflowY: 'auto' }}
        />
        <button
          onClick={() => send(text)}
          disabled={sending || !text.trim()}
          aria-label="Send message"
          className="shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-xl flex items-center justify-center cursor-pointer border-0 transition-colors"
        >
          {sending ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.27 3.13a.75.75 0 011.02-.9l16.5 8.25a.75.75 0 010 1.34l-16.5 8.25a.75.75 0 01-1.02-.9L6 12zm0 0h7.5" />
            </svg>
          )}
        </button>
      </div>

      {sheetOpen && (
        <div className="@xl:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/30" onClick={() => setSheetOpen(false)}>
          <div
            className="bg-white rounded-t-2xl shadow-xl flex flex-col h-[55dvh] pb-[env(safe-area-inset-bottom)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3 pt-3 pb-2">
              <input
                value={sheetQuery}
                onChange={e => setSheetQuery(e.target.value)}
                placeholder="Search quick replies"
                className="flex-1 min-w-0 px-3 py-2 text-base border border-slate-200 rounded-xl outline-none focus:border-violet-400"
              />
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Close"
                className="shrink-0 w-9 h-9 text-slate-400 text-xl leading-none border-0 bg-transparent cursor-pointer"
              >×</button>
            </div>

            {categories.length > 0 && (
              <div className="flex gap-2 px-3 pb-2 overflow-x-auto shrink-0">
                {['', ...categories].map(c => (
                  <button
                    key={c || '__all'}
                    onClick={() => setSheetCat(c)}
                    className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full border cursor-pointer ${
                      sheetCat === c
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >{c || 'All'}</button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto border-t border-slate-100">
              {sheetItems.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">
                  {quickReplies.length === 0 ? 'No quick replies yet.' : 'Nothing matches.'}
                </p>
              ) : sheetItems.map(r => (
                <button
                  key={r.id}
                  onClick={() => {
                    // The click that follows a long press must not pick the reply.
                    if (longPressed.current) { longPressed.current = false; return; }
                    pickFromSheet(r);
                  }}
                  onTouchStart={e => startPress(r, e)}
                  onTouchMove={movePress}
                  onTouchEnd={cancelPress}
                  onTouchCancel={cancelPress}
                  onContextMenu={e => e.preventDefault()}
                  style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
                  className="w-full text-left px-4 py-3 flex flex-col gap-0.5 border-0 border-b border-slate-100 bg-white active:bg-violet-50 cursor-pointer"
                >
                  <span className="text-xs font-semibold text-violet-600">{r.title}</span>
                  <span className="text-sm text-slate-600 line-clamp-2 break-words">{r.text}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {previewReply && (
        <div
          className="@xl:hidden fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setPreviewReply(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80dvh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
              <span className="text-sm font-semibold text-violet-600 truncate">{previewReply.title}</span>
              <button
                onClick={() => setPreviewReply(null)}
                aria-label="Close"
                className="shrink-0 w-8 h-8 text-slate-400 text-xl leading-none border-0 bg-transparent cursor-pointer"
              >×</button>
            </div>
            <p className="px-4 pb-3 text-sm text-slate-700 whitespace-pre-wrap break-words overflow-y-auto">
              {previewReply.text}
            </p>
            <div className="px-4 pb-4 pt-2 border-t border-slate-100">
              <button
                onClick={() => { const r = previewReply; setPreviewReply(null); pickFromSheet(r); }}
                className="w-full py-2.5 text-sm font-semibold text-white bg-violet-600 rounded-xl border-0 cursor-pointer"
              >Use this reply</button>
            </div>
          </div>
        </div>
      )}

      <ImagePickerModal
        open={showImagePicker}
        onClose={() => setShowImagePicker(false)}
        phone={phone}
        clientId={clientId}
        onSent={onSent}
      />
      <VoiceClipPickerModal
        open={showVoicePicker}
        onClose={() => setShowVoicePicker(false)}
        phone={phone}
        clientId={clientId}
        onSent={onSent}
      />
    </div>
  );
}
