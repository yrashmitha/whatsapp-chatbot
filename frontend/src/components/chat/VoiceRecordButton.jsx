import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

/**
 * The container the browser will actually give us.
 *
 * Ogg/Opus is what WhatsApp wants, and Chrome will not produce it, so webm is
 * the usual outcome and the server converts. Asking for ogg first still helps
 * on Firefox, where it saves a transcode.
 *
 * @returns {string} a mime type, or '' to let the browser choose
 */
function pickMimeType() {
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

/**
 * Hold-to-talk button that records and sends a voice note into the chat.
 *
 * Recording goes straight to the customer rather than into the voice-clip
 * library: a one-off reply is not a reusable clip, and asking someone to name
 * it and invent a trigger keyword first is why they would never use it.
 *
 * @param {Object} props
 * @param {string} props.phone
 * @param {string} props.clientId
 * @param {Function} [props.onSent]
 */
export default function VoiceRecordButton({ phone, clientId, onSent }) {
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef(null);
  // Held between recordings on purpose. Stopping the tracks releases the
  // microphone, and iOS then treats the next getUserMedia as a fresh request
  // and prompts again, so an operator answering ten people was asked ten times.
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const abortRef = useRef(false);
  const params = clientId ? { client_id: clientId } : {};

  const send = useMutation({
    mutationFn: async (blob) => {
      const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('audio', new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type }));
      form.append('phone', phone);
      await api.post('/voice-clips/send-recording', form, {
        params, headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => onSent?.(),
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not send the voice note'),
  });

  // Release the microphone when the operator leaves the chat, so the tab is
  // not holding it open all day.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // A running count, so nobody discovers afterwards that they recorded four
  // minutes of silence.
  useEffect(() => {
    if (!recording) { setSeconds(0); return; }
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const start = async () => {
    try {
      // Reuse the open microphone if we still have a live one.
      let stream = streamRef.current;
      if (!stream || !stream.getAudioTracks().some(t => t.readyState === 'live')) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      }
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      abortRef.current = false;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        // Deliberately not stopping the tracks here; see streamRef above. The
        // browser's own recording indicator stays on while the tab is open,
        // which is honest - the page does still hold the microphone.
        if (abortRef.current) return;
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        // Under a second is a slip of the finger, not a message.
        if (blob.size < 1000) return;
        send.mutate(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error('No microphone, or permission was refused.');
    }
  };

  const stop = (cancel = false) => {
    abortRef.current = cancel;
    recorderRef.current?.stop();
    setRecording(false);
  };

  if (recording) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-red-600 font-medium tabular-nums flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
        </span>
        <button onClick={() => stop(true)} title="Discard"
          className="w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-red-500 cursor-pointer">
          ✕
        </button>
        <button onClick={() => stop(false)} title="Send"
          className="w-9 h-9 rounded-xl border-0 bg-violet-600 text-white hover:bg-violet-700 cursor-pointer">
          ➤
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={start}
      disabled={send.isPending}
      title="Record a voice note"
      className="w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-violet-500 hover:border-violet-300 cursor-pointer disabled:opacity-50"
    >
      {send.isPending ? '…' : '🎤'}
    </button>
  );
}
