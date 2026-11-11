/**
 * @module services/mediaPrep
 * @description Make a video an operator picked on a phone into one WhatsApp
 * will deliver.
 *
 * WhatsApp takes an MP4 with H.264 video and AAC audio, at most 16 MB. An iPhone
 * hands the browser a .mov, usually in HEVC, and phone videos are big. Refusing
 * those meant an operator on an iPhone could not send a video at all, so the
 * server converts: H.264/AAC MP4, at most 1280 px on the long side, with the
 * bitrate worked out from the length so the result fits under the cap. A file
 * that is already fine is sent untouched.
 *
 * Needs ffmpeg and ffprobe on PATH (nixpacks.toml installs them).
 */

'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const WA_VIDEO_BYTES = 16 * 1024 * 1024;
// Aim under the cap: the encoder overshoots a little and the container adds some.
const TARGET_BITS = 14.5 * 1024 * 1024 * 8;
const AUDIO_KBPS = 96;
const MAX_VIDEO_KBPS = 2500;
// Below this the picture is too poor to be worth sending; ask for a trim instead.
const MIN_VIDEO_KBPS = 200;
// All conversion attempts together, kept under the 6 minutes the CRM waits for
// an answer after the upload, with room left for the hand-off to WhatsApp.
const CONVERT_BUDGET_MS = 4 * 60 * 1000;

function run(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/**
 * What is inside a media file.
 *
 * @param {string} file
 * @returns {Promise<{ duration: number, video: Object|null, audio: Object|null }>}
 */
async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', file], 30000);
  const j = JSON.parse(out);
  const streams = j.streams || [];
  return {
    duration: parseFloat(j.format?.duration) || 0,
    video: streams.find(s => s.codec_type === 'video') || null,
    audio: streams.find(s => s.codec_type === 'audio') || null,
  };
}

/** "1:05" from seconds. */
function clock(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Turn an uploaded video into one WhatsApp accepts, beside the original.
 *
 * Resolves to the file to send: the original when it is already an H.264/AAC
 * MP4 under 16 MB, otherwise a converted copy (the original is then removed).
 * Rejects with a message meant for the operator when the video cannot be made
 * to fit, for example because it is too long.
 *
 * @param {string} inputPath
 * @param {string} mime - as the browser reported it
 * @returns {Promise<{ path: string, converted: boolean }>}
 */
async function prepareVideo(inputPath, mime) {
  const info = await probe(inputPath);
  if (!info.video) throw new Error('This file has no video in it.');
  const size = fs.statSync(inputPath).size;
  const isMp4 = mime === 'video/mp4' || /\.mp4$/i.test(inputPath);
  const ready = isMp4 && info.video.codec_name === 'h264'
    && (!info.audio || info.audio.codec_name === 'aac') && size <= WA_VIDEO_BYTES;
  if (ready) return { path: inputPath, converted: false };

  const duration = info.duration || 1;
  const audioK = info.audio ? AUDIO_KBPS : 0;
  let videoK = Math.min(MAX_VIDEO_KBPS, Math.floor(TARGET_BITS / duration / 1000) - audioK);
  if (videoK < MIN_VIDEO_KBPS) {
    const maxSec = Math.floor(TARGET_BITS / ((MIN_VIDEO_KBPS + audioK) * 1000));
    throw new Error(`This video is ${clock(duration)} long. WhatsApp only takes videos up to 16 MB, so it can be about ${clock(maxSec)} at most. Trim it and send again.`);
  }

  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const out = path.join(dir, `${base}-wa.mp4`);
  // Phones often film at 60 fps. Played in WhatsApp, 30 looks the same, and
  // converting half the frames takes about 40% less time on a small server.
  const [num, den] = String(info.video.r_frame_rate || '').split('/').map(Number);
  const fps = den ? num / den : num;
  const fpsFilter = fps > 31 ? 'fps=30,' : '';
  const started = Date.now();
  // Two goes: if the first comes out over the cap (very busy footage), the
  // second asks for less, if there is time left for it.
  for (const factor of [1, 0.75]) {
    const remaining = CONVERT_BUDGET_MS - (Date.now() - started);
    if (remaining < 20000) {
      fs.unlink(out, () => {});
      throw new Error('Converting this video took too long for the server. Try a shorter video, or trim it and send again.');
    }
    const k = Math.floor(videoK * factor);
    try {
      await run('ffmpeg', [
        '-y', '-i', inputPath,
        '-map', '0:v:0', '-map', '0:a:0?',
        // Fit inside 1280x1280 keeping the shape, with even sides as H.264 needs.
        // ffmpeg turns the picture upright from the phone's rotation flag.
        '-vf', `${fpsFilter}scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
        '-c:v', 'libx264', '-preset', 'superfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
        '-b:v', `${k}k`, '-maxrate', `${Math.floor(k * 1.5)}k`, '-bufsize', `${k * 2}k`,
        '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2',
        '-movflags', '+faststart', '-map_metadata', '-1', '-f', 'mp4', out,
      ], remaining);
    } catch (e) {
      fs.unlink(out, () => {});
      if (e.killed) throw new Error('Converting this video took too long for the server. Try a shorter video, or trim it and send again.');
      throw e;
    }
    if (fs.statSync(out).size <= WA_VIDEO_BYTES) {
      fs.unlink(inputPath, () => {});
      return { path: out, converted: true };
    }
  }
  fs.unlink(out, () => {});
  throw new Error('This video could not be made small enough for WhatsApp (16 MB). Trim it and send again.');
}

module.exports = { prepareVideo, probe, WA_VIDEO_BYTES };
