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
      // 32k mono 48kHz opus, voice-tuned. Take only the first audio stream and
      // drop all metadata/video/chapters — a stray extra stream or odd sample
      // rate from a source .mp4 produces an .ogg that WhatsApp accepts on
      // upload but then rejects at delivery with error 131053.
      [
        '-y', '-i', inputPath,
        '-map', '0:a:0?', '-map_metadata', '-1', '-vn', '-dn',
        '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1',
        '-application', 'voip',
        '-f', 'ogg', outputPath,
      ],
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

module.exports = { transcodeToOggOpus, writeBrowserCopy };
