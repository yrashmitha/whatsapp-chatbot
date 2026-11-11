/**
 * @module services/audioTranscode
 * @description Turn whatever was recorded or uploaded into Ogg/Opus.
 *
 * WhatsApp renders a native voice note - waveform, inline playback, the bubble
 * people expect - only for Ogg/Opus. A browser's MediaRecorder mostly produces
 * webm/opus, and an uploaded file could be mp3, m4a or wav. None of those come
 * out as a voice note; at best they arrive as a file attachment, which is not
 * the same thing to a customer.
 *
 * Ported from the wwjs service, which learned this the hard way. Needs the
 * ffmpeg binary on PATH; see nixpacks.toml.
 */

'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Semitones to shift the voice by, kept inside a range that still sounds like a
 * person. Anything unusable means no change.
 *
 * @param {*} v
 * @returns {number} a multiple of 0.5 between -8 and 8; 0 means untouched
 */
function clampSemitones(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(-8, Math.min(8, n)) * 2) / 2;
}

/** A number kept inside a range and rounded to a step; fallback when unusable. */
function clampNum(v, min, max, step, fallback = 0) {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return fallback;
  return Math.round(Math.max(min, Math.min(max, n)) / step) * step;
}

/**
 * Echo presets: several quick repeats that fade, which the ear hears as a room
 * and not a single slap echo. "soft" rings for about a second, "room" for about
 * a second and a half. The input gain is lowered so the repeats do not make the
 * voice louder.
 */
const REVERB_PRESETS = {
  soft: 'aecho=0.7:0.9:60|130|210|300|400:0.30|0.24|0.18|0.12|0.08',
  room: 'aecho=0.7:0.9:80|170|270|390|520|680|860:0.38|0.32|0.26|0.2|0.15|0.1|0.06',
};
const AMBIENT_KINDS = ['om', 'bell', 'both'];

/**
 * Everything the operator can change about a voice note, cleaned up. Unknown or
 * out-of-range values become "no change", so a forged request cannot reach ffmpeg.
 *
 * @param {Object} [src] - request body: semitones, reverb, warmth, denoise, ambient, ambient_level
 * @returns {{semitones:number, reverb:string, warmth:number, denoise:boolean, ambient:string, ambientLevel:number}}
 */
function parseVoiceFx(src = {}) {
  const semitones = clampSemitones(src.semitones);
  const reverb = Object.prototype.hasOwnProperty.call(REVERB_PRESETS, src.reverb) ? src.reverb : 'off';
  const warmth = clampNum(src.warmth, -5, 5, 0.5);
  const denoise = src.denoise === true || src.denoise === '1' || src.denoise === 'true';
  const level = clampNum(src.ambient_level ?? src.ambientLevel, 0, 30, 1, 10);
  const ambient = AMBIENT_KINDS.includes(src.ambient) && level > 0 ? src.ambient : 'none';
  return { semitones, reverb, warmth, denoise, ambient, ambientLevel: level };
}

/** True when any setting would change the recording. */
function hasFx(fx) {
  return !!(fx.semitones || fx.reverb !== 'off' || fx.warmth || fx.denoise || fx.ambient !== 'none');
}

/**
 * The filters applied to the voice itself, in order: pitch, noise cleanup,
 * warmth, then echo. Pitch moves first so the later steps shape the final voice.
 *
 * Pitch plays the samples at a different rate, which moves the pitch and the
 * speed together; atempo then undoes the speed change, so a 40 second recording
 * stays 40 seconds.
 *
 * @param {ReturnType<typeof parseVoiceFx>} fx
 * @returns {string[]}
 */
function voiceChain(fx) {
  const c = [];
  if (fx.semitones) {
    const ratio = Math.pow(2, fx.semitones / 12);
    c.push('aresample=48000', `asetrate=${Math.round(48000 * ratio)}`, 'aresample=48000', `atempo=${(1 / ratio).toFixed(5)}`);
  }
  // Rumble below 80 Hz and steady hiss or fan noise.
  if (fx.denoise) c.push('highpass=f=80', 'afftdn=nr=20:nf=-50');
  // Positive warmth is fuller (more bass, a little less treble); negative is brighter.
  if (fx.warmth) c.push(`bass=g=${(fx.warmth * 1.5).toFixed(1)}:f=180`, `treble=g=${(-fx.warmth).toFixed(1)}:f=4500`);
  if (fx.reverb !== 'off') c.push(REVERB_PRESETS[fx.reverb]);
  return c;
}

/**
 * A calm background made from nothing but maths, so there is no file to ship or
 * license. "om" is a soft low hum with its overtones (136.1 Hz, the pitch usually
 * given for Om) that slowly swells; "bell" is a bell strike every nine seconds
 * that rings out and fades. It is a synthetic hum, not a recorded chant.
 *
 * @param {string} kind - om | bell | both
 * @returns {string} an aevalsrc expression
 */
function ambientExpr(kind) {
  const om = '(0.20*sin(2*PI*136.1*t)+0.10*sin(2*PI*272.2*t)+0.06*sin(2*PI*408.3*t)+0.03*sin(2*PI*68.05*t))*(1+0.18*sin(2*PI*0.12*t))';
  const bell = '0.22*(sin(2*PI*523.25*mod(t,9))+0.7*sin(2*PI*525.1*mod(t,9))+0.45*sin(2*PI*1046.5*mod(t,9))+0.25*sin(2*PI*1568*mod(t,9)))*exp(-0.9*mod(t,9))';
  if (kind === 'om') return om;
  if (kind === 'bell') return bell;
  return `${om}+${bell}`;
}

/**
 * The ffmpeg arguments for a set of settings.
 *
 * @param {ReturnType<typeof parseVoiceFx>} fx
 * @returns {{ pre: string[], filter: string[], map: string[] }} pre goes right after the input,
 *   filter and map go before the encoder options
 */
function fxArgs(fx) {
  const chain = voiceChain(fx);
  if (fx.ambient === 'none') {
    return { pre: [], filter: chain.length ? ['-af', chain.join(',')] : [], map: ['-map', '0:a:0?'] };
  }
  const gain = ((fx.ambientLevel / 100) * 1.5).toFixed(3);
  const graph = `[0:a:0]${chain.length ? chain.join(',') : 'anull'}[v];[1:a]volume=${gain}[b];`
    + '[v][b]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]';
  return {
    pre: ['-f', 'lavfi', '-i', `aevalsrc='${ambientExpr(fx.ambient)}':s=48000:d=300`],
    filter: ['-filter_complex', graph],
    map: ['-map', '[out]'],
  };
}

/**
 * A processed AAC copy of a recording, for the preview in the CRM. Plays in
 * every browser, which Ogg does not. The caller deletes the file.
 *
 * @param {string} inputPath
 * @param {Object|number} opts - voice settings, or just semitones
 * @returns {Promise<string>} path to the .m4a
 */
function pitchPreview(inputPath, opts) {
  const fx = parseVoiceFx(typeof opts === 'object' && opts ? opts : { semitones: opts });
  const a = fxArgs(fx);
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(dir, `${base}-preview.m4a`);
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-y', '-i', inputPath, ...a.pre, ...a.filter, ...a.map, '-vn',
       '-c:a', 'aac', '-b:a', '64k', '-ac', '1', outputPath],
      { timeout: 60000 },
      (err) => (err ? reject(new Error('Could not process the audio: ' + err.message)) : resolve(outputPath))
    );
  });
}

/**
 * Transcode a file to Ogg/Opus beside itself, removing the original on success.
 *
 * Without any voice settings this never throws and never rejects. A machine
 * without ffmpeg - a local dev box, say - gets the original path back and the
 * audio still sends, just not as a voice-note bubble. Failing the upload instead
 * would trade a cosmetic problem for a broken feature.
 *
 * WITH voice settings it rejects when ffmpeg fails. The operator changed the
 * voice on purpose, and quietly sending the unchanged recording would reach the
 * customer as the operator's real voice. Nothing is better than that.
 *
 * @param {string} inputPath - absolute path to the uploaded audio
 * @param {Object} [opts] - voice settings: semitones, reverb, warmth, denoise, ambient, ambient_level
 * @returns {Promise<string>} the resulting path, or the input if it could not be converted
 */
function transcodeToOggOpus(inputPath, opts = {}) {
  const fx = parseVoiceFx(opts);
  const active = hasFx(fx);
  const a = fxArgs(fx);
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const isOgg = path.extname(inputPath).toLowerCase() === '.ogg';
  // A processed file is a new file even when the source is already .ogg.
  const outputPath = path.join(dir, active && isOgg ? `${base}-fx.ogg` : `${base}.ogg`);

  return new Promise((resolve, reject) => {
    if (isOgg && !active) return resolve(inputPath);
    execFile(
      'ffmpeg',
      // 32k mono 48kHz opus, voice-tuned. Take only the first audio stream and
      // drop all metadata/video/chapters: a stray extra stream or odd sample
      // rate from a source .mp4 produces an .ogg that WhatsApp accepts on
      // upload but then rejects at delivery with error 131053.
      [
        '-y', '-i', inputPath, ...a.pre,
        ...a.filter, ...a.map, '-map_metadata', '-1', '-vn', '-dn',
        '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1',
        '-application', 'voip',
        '-f', 'ogg', outputPath,
      ],
      { timeout: 60000 },
      (err) => {
        if (err) {
          if (active) return reject(new Error('Could not apply the voice settings, so nothing was sent: ' + err.message));
          console.warn('[AUDIO] ffmpeg unavailable or failed, keeping the original:', err.message);
          return resolve(inputPath);
        }
        fs.unlink(inputPath, () => {});
        resolve(outputPath);
      }
    );
  });
}

/**
 * Write an AAC copy beside an audio file, for playing in a browser.
 *
 * Safari plays no Ogg, and Ogg is the only thing WhatsApp renders as a voice
 * note, so the two cannot be the same file. The CRM plays this one; WhatsApp
 * gets the Ogg. Same base name, so the player can find it without another
 * column or another lookup.
 *
 * Best effort in every sense: no ffmpeg, or a failure, simply means Safari
 * cannot play that particular clip, which is where we already were.
 *
 * @param {string} inputPath
 * @returns {Promise<string|null>} the .m4a path, or null
 */
function writeBrowserCopy(inputPath) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(dir, `${base}.m4a`);
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-y', '-i', inputPath, '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-vn', outputPath],
      { timeout: 30000 },
      (err) => {
        if (err) {
          console.warn('[AUDIO] no browser copy made:', err.message);
          return resolve(null);
        }
        resolve(outputPath);
      }
    );
  });
}

module.exports = { transcodeToOggOpus, writeBrowserCopy, pitchPreview, clampSemitones, parseVoiceFx, hasFx };
