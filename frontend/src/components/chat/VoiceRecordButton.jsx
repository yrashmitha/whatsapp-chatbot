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
  // What the microphone is actually hearing, newest last. It is the only proof
  // on screen that the recording is real: a clock keeps counting whether or not
  // the browser is capturing anything.
  const [bars, setBars] = useState(() => Array(28).fill(0));
  const [silent, setSilent] = useState(false);
  const recorderRef = useRef(null);
  // Held between recordings on purpose. Stopping the tracks releases the
  // microphone, and iOS then treats the next getUserMedia as a fresh request
  // and prompts again, so an operator answering ten people was asked ten times.
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const abortRef = useRef(false);
  const startedAtRef = useRef(0);
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
  //
  // Measured from the moment recording began, not counted in ticks. A phone
  // delays timers when the page is busy, the battery is low or the screen
  // dims, and a counter that adds one per tick loses every tick that is
  // late: the clock froze at 00:00 or crawled behind the real recording.
  // Checking four times a second keeps the display within a quarter second,
  // and React skips the render when the number of seconds has not changed.
  useEffect(() => {
    if (!recording) { setSeconds(0); return; }
    const tick = () => setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    tick();
    const t = setInterval(tick, 250);
    // Catch up the moment the screen wakes or the tab comes back.
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [recording]);

  // Live input level. Failing to build the meter (an old browser, an audio
  // session that refuses a second consumer) must never cost the recording, so
  // everything here is allowed to fail quietly and the banner just has no bars.
  useEffect(() => {
    if (!recording || !streamRef.current) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx; let src; let timer;
    try {
      ctx = new AC();
      ctx.resume?.();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src = ctx.createMediaStreamSource(streamRef.current);
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let lastSoundAt = Date.now();
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
        if (peak > 0.02) lastSoundAt = Date.now();
        setBars(b => [...b.slice(1), Math.min(1, peak * 2.5)]);
        // Three seconds of nothing is a muted or unplugged microphone far more
        // often than a pause in speech.
        setSilent(Date.now() - lastSoundAt > 3000);
      }, 100);
    } catch { /* recording carries on without the meter */ }
    return () => {
      clearInterval(timer);
      try { src?.disconnect(); } catch { /* already gone */ }
      ctx?.close?.().catch(() => {});
      setBars(Array(28).fill(0));
      setSilent(false);
    };
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
      startedAtRef.current = Date.now();
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
    const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    return (
      <>
        {/* In the icon row: this is the button that is live. */}
        <div
          className="shrink-0 w-10 h-10 @xl:w-9 @xl:h-9 rounded-xl bg-red-500 text-white flex items-center justify-center animate-pulse"
          aria-hidden="true"
        >
          🎤
        </div>
        {/* Across the whole composer, so it cannot be missed or mistaken for a
            button that merely opened. Red while it is hearing you, amber when it
            is not. */}
        <div
          role="status"
          aria-live="polite"
          className={`absolute bottom-full left-0 right-0 z-30 px-3 py-2 flex items-center gap-3 text-white shadow-lg ${silent ? 'bg-amber-600' : 'bg-red-600'}`}
        >
          <span className="flex items-center gap-2 text-sm font-semibold shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
            {silent ? 'No sound' : 'Recording'}
          </span>
          <span className="text-sm tabular-nums shrink-0">{clock}</span>
          <div className="flex-1 min-w-0 flex items-center justify-end gap-[2px] h-8 overflow-hidden" aria-hidden="true">
            {silent ? (
              <span className="text-xs truncate">Cannot hear you. Check the microphone.</span>
            ) : bars.map((v, i) => (
              <span key={i} className="w-[3px] rounded-full bg-white/90 shrink-0" style={{ height: `${Math.max(3, Math.round(v * 28))}px` }} />
            ))}
          </div>
          <button
            onClick={() => stop(true)}
            className="shrink-0 px-3 h-9 rounded-xl border border-white/50 bg-transparent text-white text-sm cursor-pointer"
          >
            Discard
          </button>
          <button
            onClick={() => stop(false)}
            className="shrink-0 px-4 h-9 rounded-xl border-0 bg-white text-red-700 text-sm font-semibold cursor-pointer"
          >
            Send
          </button>
        </div>
      </>
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
