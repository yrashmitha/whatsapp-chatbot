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
 * Transcode a file to Ogg/Opus beside itself, removing the original on success.
 *
 * Never throws and never rejects. A machine without ffmpeg - a local dev box,
 * say - gets the original path back and the audio still sends, just not as a
 * voice-note bubble. Failing the upload instead would trade a cosmetic problem
 * for a broken feature.
 *
 * @param {string} inputPath - absolute path to the uploaded audio
 * @returns {Promise<string>} the resulting path, or the input if it could not be converted
 */
function transcodeToOggOpus(inputPath) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(dir, `${base}.ogg`);

  return new Promise((resolve) => {
    if (path.extname(inputPath).toLowerCase() === '.ogg') return resolve(inputPath);
    execFile(
      'ffmpeg',
      // 32k mono opus: voice, not music. Small enough to send instantly.
      ['-y', '-i', inputPath, '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-vn', outputPath],
      { timeout: 30000 },
      (err) => {
        if (err) {
          console.warn('[AUDIO] ffmpeg unavailable or failed, keeping the original:', err.message);
          return resolve(inputPath);
        }
        fs.unlink(inputPath, () => {});
        resolve(outputPath);
      }
    );
  });
}

module.exports = { transcodeToOggOpus };
