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

const PITCH_PRESETS = [
  { label: 'Lower', st: -3 },
  { label: 'Normal', st: 0 },
  { label: 'Higher', st: 3 },
  { label: 'Much higher', st: 6 },
];

// Levelling is on from the start: a microphone recording is often far quieter than a normal voice note.
const DEFAULT_FX = { semitones: 0, warmth: 0, reverb: 'off', denoise: false, ambient: 'none', ambientLevel: 10, normalize: true, boost: 0 };
const FX_KEY = 'ga_voice_fx';
const LAST_SENT_KEY = 'ga_voice_last_sent_fx';

const clamp = (n, min, max, step) => Math.max(min, Math.min(max, Math.round(n / step) * step));

/** Settings from the browser's storage, kept inside the ranges the server accepts. */
function readFx(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return {
      semitones: clamp(Number(o.semitones) || 0, -8, 8, 0.5),
      warmth: clamp(Number(o.warmth) || 0, -5, 5, 0.5),
      reverb: ['soft', 'room'].includes(o.reverb) ? o.reverb : 'off',
      denoise: !!o.denoise,
      ambient: ['om', 'bell', 'both'].includes(o.ambient) ? o.ambient : 'none',
      ambientLevel: clamp(Number(o.ambientLevel) || 10, 1, 30, 1),
      normalize: o.normalize !== false,                 // settings saved before this existed get levelling too
      boost: clamp(Number(o.boost) || 0, 0, 12, 1),
    };
  } catch { return null; }
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));
const AMBIENT_NAMES = { om: 'Om hum', bell: 'Bell ring', both: 'Om + bell' };

/** One short line with every number, so it is easy to remember what worked. */
function summary(fx) {
  const parts = [`Pitch ${signed(fx.semitones)}`, `Warmth ${signed(fx.warmth)}`, `Echo ${fx.reverb}`, fx.denoise ? 'Clean' : 'No cleanup'];
  parts.push(fx.ambient === 'none' ? 'No background' : `${AMBIENT_NAMES[fx.ambient]} ${fx.ambientLevel}`);
  parts.push(fx.normalize ? 'Levelled' : 'Not levelled');
  if (fx.boost) parts.push(`Boost +${fx.boost} dB`);
  return parts.join(' · ');
}

function clock(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** A number you can type, or step with minus and plus. */
function NumberField({ label, hint, value, min, max, step, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(clamp(value - step, min, max, step))}
          className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-lg leading-none cursor-pointer hover:border-violet-400"
          aria-label={`Lower ${label}`}
        >−</button>
        <input
          type="number" min={min} max={max} step={step} value={value}
          onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(clamp(n, min, max, step)); }}
          className="w-20 h-9 text-center text-lg font-bold tabular-nums text-violet-700 border border-slate-300 rounded-lg outline-none focus:border-violet-500"
          aria-label={label}
        />
        <button
          onClick={() => onChange(clamp(value + step, min, max, step))}
          className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-lg leading-none cursor-pointer hover:border-violet-400"
          aria-label={`Raise ${label}`}
        >+</button>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
    </div>
  );
}

/**
 * Record a voice note, change how it sounds, hear it, and send it to the
 * customer as a WhatsApp voice note.
 *
 * What can change: the pitch (the speed stays the same), the warmth, a soft echo,
 * noise cleanup, and a calm background sound (an Om hum or a bell). It all
 * happens on the server, so what plays in the preview is exactly what the
 * customer receives. If the server cannot apply the settings, nothing is sent.
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
  const [fx, setFx] = useState(() => readFx(FX_KEY) || DEFAULT_FX);
  const [lastSent] = useState(() => readFx(LAST_SENT_KEY));
  const [blob, setBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewKey, setPreviewKey] = useState('');    // the settings the preview was made with
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  // The last look before it goes to the customer.
  const [confirming, setConfirming] = useState(false);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const audioRef = useRef(null);
  const params = clientId ? { client_id: clientId } : {};
  const fxKey = JSON.stringify(fx);

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

  const change = (patch) => {
    const next = { ...fx, ...patch };
    setFx(next);
    try { localStorage.setItem(FX_KEY, JSON.stringify(next)); } catch { /* not saved */ }
  };

  const resetTake = () => {
    setBlob(null); setPreviewUrl(''); setPreviewKey(''); setSeconds(0); setPhase('idle');
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
      setPreviewUrl(''); setPreviewKey(''); setBlob(null);
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
    form.append('semitones', String(fx.semitones));
    form.append('warmth', String(fx.warmth));
    form.append('reverb', fx.reverb);
    form.append('denoise', fx.denoise ? '1' : '0');
    form.append('ambient', fx.ambient);
    form.append('ambient_level', String(fx.ambientLevel));
    form.append('normalize', fx.normalize ? '1' : '0');
    form.append('boost', String(fx.boost));
    return form;
  };

  const hear = async () => {
    if (!blob || busy) return;
    setBusy(true);
    try {
      const res = await api.post('/voice-clips/pitch-preview', buildForm(), {
        params, responseType: 'blob', headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreviewUrl(URL.createObjectURL(res.data));
      setPreviewKey(fxKey);
      // Play as soon as it is ready; a browser that blocks autoplay just shows the player.
      setTimeout(() => audioRef.current?.play?.().catch(() => {}), 50);
    } catch {
      toast.error('Could not change the voice. Try again.');
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
      toast.success(`Voice note sent. ${summary(fx)}`);
      try { localStorage.setItem(LAST_SENT_KEY, fxKey); } catch { /* not saved */ }
      resetTake();
      onSent?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not send the voice note');
    } finally {
      setSending(false);
    }
  };

  const stale = previewUrl && previewKey !== fxKey;
  // Changing any setting, or recording again, cancels a pending confirmation.
  useEffect(() => { setConfirming(false); }, [fxKey, blob]);
  const selCls = 'h-9 px-2 text-sm border border-slate-300 rounded-lg bg-white outline-none focus:border-violet-500';

  return (
    <div className="border border-violet-200 bg-violet-50/50 rounded-xl p-3 flex flex-col gap-3">
      <div>
        <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Voice note</p>
        <p className="text-xs text-slate-500 mt-0.5">Read the script aloud, shape the sound, listen, then send.</p>
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
          <div className="flex flex-col gap-3">
            <NumberField
              label="Pitch number (speed stays the same)" value={fx.semitones} min={-8} max={8} step={0.5}
              hint="−8 lower … 0 your own voice … +8 higher" onChange={v => change({ semitones: v })}
            />
            <div className="flex flex-wrap gap-1.5">
              {PITCH_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => change({ semitones: p.st })}
                  className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer ${fx.semitones === p.st ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
                >
                  {p.label} ({signed(p.st)})
                </button>
              ))}
            </div>

            <NumberField
              label="Warmth number" value={fx.warmth} min={-5} max={5} step={0.5}
              hint="+ fuller and deeper, − brighter" onChange={v => change({ warmth: v })}
            />

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Soft echo</label>
                <select className={selCls} value={fx.reverb} onChange={e => change({ reverb: e.target.value })}>
                  <option value="off">Off</option>
                  <option value="soft">Soft (rings about 1 second)</option>
                  <option value="room">Room (rings about 1.5 seconds)</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer self-end h-9">
                <input type="checkbox" checked={fx.denoise} onChange={e => change({ denoise: e.target.checked })} />
                Clean fan and hiss noise
              </label>
            </div>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Calm background sound</label>
                <select className={selCls} value={fx.ambient} onChange={e => change({ ambient: e.target.value })}>
                  <option value="none">None</option>
                  <option value="om">Om hum</option>
                  <option value="bell">Bell ring</option>
                  <option value="both">Om hum and bell ring</option>
                </select>
              </div>
              {fx.ambient !== 'none' && (
                <NumberField
                  label="Background level" value={fx.ambientLevel} min={1} max={30} step={1}
                  hint="quiet 5 … 10 … 20 louder" onChange={v => change({ ambientLevel: v })}
                />
              )}
            </div>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer h-9">
                <input type="checkbox" checked={fx.normalize} onChange={e => change({ normalize: e.target.checked })} />
                Make the volume normal (fixes a quiet recording)
              </label>
              <NumberField
                label="Extra loudness (dB)" value={fx.boost} min={0} max={12} step={1}
                hint="0 = none, 3 = a bit louder, 6 = much louder" onChange={v => change({ boost: v })}
              />
            </div>

            <p className="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
              <span className="font-semibold text-violet-700">Now:</span> {summary(fx)}
              {lastSent && <><br /><span className="font-semibold text-slate-500">Last sent:</span> {summary(lastSent)}</>}
            </p>
          </div>

          {previewUrl && (
            <div>
              <audio ref={audioRef} src={previewUrl} controls className="w-full h-9" />
              {stale && <p className="text-xs text-amber-600 mt-1">A setting changed. Press "Hear it" again before sending.</p>}
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
              onClick={() => setConfirming(true)}
              disabled={sending || !previewUrl || stale || confirming}
              title={!previewUrl ? 'Press Hear it first' : ''}
              className="flex-1 min-w-[10rem] px-4 py-2 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)' }}
            >
              ✉ Send voice note
            </button>
          </div>

          {confirming && (
            <div role="alertdialog" aria-label="Confirm sending the voice note" className="border border-amber-300 bg-amber-50 rounded-xl p-3 flex flex-col gap-2">
              <p className="text-sm font-semibold text-amber-900">Send this voice note to {phone}?</p>
              <p className="text-xs text-amber-900">
                It will go to the customer exactly as you just heard it, with these settings:
                <br /><span className="font-semibold">{summary(fx)}</span>
              </p>
              <p className="text-xs text-amber-800">Did you listen to all of it, and does it sound right?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirming(false)} disabled={sending} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl cursor-pointer disabled:opacity-50">
                  Not yet
                </button>
                <button onClick={send} disabled={sending} className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 bg-emerald-600 hover:bg-emerald-700">
                  {sending ? 'Sending…' : 'Yes, send it now'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
