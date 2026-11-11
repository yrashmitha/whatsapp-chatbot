import { useState, useRef, useEffect } from 'react';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

/**
 * The container the browser will actually give us. Ogg first (Firefox), then
 * webm; the server converts either to the Ogg/Opus that WhatsApp plays as a
 * voice note.
 */
function pickMimeType() {
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

const PRESETS = [
  { label: 'Lower', st: -3 },
  { label: 'Normal', st: 0 },
  { label: 'Higher', st: 3 },
  { label: 'Much higher', st: 6 },
];

function readSaved() {
  try {
    const n = Number(localStorage.getItem('ga_voice_semitones'));
    return Number.isFinite(n) ? Math.max(-8, Math.min(8, n)) : 0;
  } catch { return 0; }
}

function clock(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Record a voice note, change only its pitch, hear it, and send it to the
 * customer as a WhatsApp voice note. The pitch change happens on the server, so
 * what plays in the preview is exactly what the customer receives. The speed is
 * not changed.
 *
 * Props:
 *   phone     {string}  Customer phone number
 *   clientId  {string}  Multi-tenant client ID
 *   onSent    {Function} Called after the voice note was sent
 */
export default function PitchVoiceRecorder({ phone, clientId, onSent }) {
  const toast = useToast();
  const [phase, setPhase] = useState('idle');          // idle | recording | recorded
  const [seconds, setSeconds] = useState(0);
  const [semitones, setSemitones] = useState(readSaved);
  const [blob, setBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewSt, setPreviewSt] = useState(null);    // the pitch the preview was made at
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const audioRef = useRef(null);
  const params = clientId ? { client_id: clientId } : {};

  // Release the microphone and any preview file when the modal closes.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // Timed from the real start, so a busy phone cannot make the clock lie.
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const tick = () => setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [phase]);

  const resetTake = () => {
    setBlob(null); setPreviewUrl(''); setPreviewSt(null); setSeconds(0); setPhase('idle');
  };

  const start = async () => {
    try {
      let stream = streamRef.current;
      if (!stream || !stream.getAudioTracks().some(t => t.readyState === 'live')) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      }
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const b = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        if (b.size < 1000) { resetTake(); return; }   // a slip of the finger
        setBlob(b);
        setPhase('recorded');
      };
      recorderRef.current = recorder;
      recorder.start();
      startedAtRef.current = Date.now();
      setPreviewUrl(''); setPreviewSt(null); setBlob(null);
      setPhase('recording');
    } catch {
      toast.error('No microphone, or permission was refused.');
    }
  };

  const stop = () => recorderRef.current?.stop();

  const buildForm = () => {
    const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', new File([blob], `angel-${Date.now()}.${ext}`, { type: blob.type }));
    form.append('semitones', String(semitones));
    return form;
  };

  const savePitch = (st) => {
    setSemitones(st);
    try { localStorage.setItem('ga_voice_semitones', String(st)); } catch { /* not saved */ }
  };

  const hear = async () => {
    if (!blob || busy) return;
    setBusy(true);
    try {
      const res = await api.post('/voice-clips/pitch-preview', buildForm(), {
        params, responseType: 'blob', headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = URL.createObjectURL(res.data);
      setPreviewUrl(url);
      setPreviewSt(semitones);
      // Play as soon as it is ready; a browser that blocks autoplay just shows the player.
      setTimeout(() => audioRef.current?.play?.().catch(() => {}), 50);
    } catch (e) {
      toast.error('Could not change the pitch. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!blob || sending) return;
    setSending(true);
    try {
      const form = buildForm();
      form.append('phone', phone);
      await api.post('/voice-clips/send-recording', form, {
        params, headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Voice note sent');
      resetTake();
      onSent?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not send the voice note');
    } finally {
      setSending(false);
    }
  };

  const stale = previewUrl && previewSt !== semitones;
  const sign = semitones > 0 ? `+${semitones}` : String(semitones);

  return (
    <div className="border border-violet-200 bg-violet-50/50 rounded-xl p-3 flex flex-col gap-3">
      <div>
        <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Voice note</p>
        <p className="text-xs text-slate-500 mt-0.5">Read the message aloud, change only the pitch, listen, then send.</p>
      </div>

      {phase === 'idle' && (
        <button onClick={start} className="self-start px-4 py-2 text-sm font-medium text-white rounded-xl border-0 cursor-pointer bg-violet-600 hover:bg-violet-700">
          🎤 Start recording
        </button>
      )}

      {phase === 'recording' && (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-red-600">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" /> Recording
          </span>
          <span className="text-sm tabular-nums text-slate-600">{clock(seconds)}</span>
          <button onClick={stop} className="px-4 py-2 text-sm font-medium text-white rounded-xl border-0 cursor-pointer bg-red-600 hover:bg-red-700">
            ■ Stop
          </button>
        </div>
      )}

      {phase === 'recorded' && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-600">Pitch (speed stays the same)</label>
              <span className="text-xs tabular-nums font-semibold text-violet-700">{sign} semitones</span>
            </div>
            <input
              type="range" min="-8" max="8" step="0.5" value={semitones}
              onChange={e => savePitch(Number(e.target.value))}
              className="w-full accent-violet-600"
              aria-label="Pitch in semitones"
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => savePitch(p.st)}
                  className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer ${semitones === p.st ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {previewUrl && (
            <div>
              <audio ref={audioRef} src={previewUrl} controls className="w-full h-9" />
              {stale && <p className="text-xs text-amber-600 mt-1">The pitch changed. Press "Hear it" again before sending.</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={hear} disabled={busy} className="px-4 py-2 text-sm font-medium text-violet-700 bg-white border border-violet-300 hover:bg-violet-50 rounded-xl cursor-pointer disabled:opacity-50">
              {busy ? 'Changing…' : '▶ Hear it'}
            </button>
            <button onClick={resetTake} disabled={sending} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer disabled:opacity-50">
              ↺ Record again
            </button>
            <button
              onClick={send}
              disabled={sending || !previewUrl || stale}
              title={!previewUrl ? 'Press Hear it first' : ''}
              className="flex-1 min-w-[10rem] px-4 py-2 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)' }}
            >
              {sending ? 'Sending…' : '✉ Send voice note'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
