/**
 * Sending several attachments to a customer at once.
 *
 * WhatsApp has its own caps per kind of file, and a file over one uploads fine
 * and then fails at delivery, which reads to the operator like a random fault.
 * So each file is checked here first and a bad one is named with the reason,
 * before anything is uploaded.
 *
 * Phones are the hard case. An iPhone gives the browser its videos as .mov and
 * its photos can be over WhatsApp's 5 MB. Videos therefore go up as they are
 * (up to 100 MB) and the server converts them to an MP4 that fits; photos over
 * 5 MB are shrunk here, in the browser, which turns them upright the way the
 * phone shows them, and makes the upload quicker on mobile data.
 */

/** WhatsApp's cap for a photo, which is what a shrunk photo has to fit under. */
const PHOTO_BYTES = 5 * 1024 * 1024;

/** How big a file may be when picked, in MB. Videos and big photos are made to fit after. */
const LIMIT_MB = { image: 40, video: 100, audio: 16, pdf: 16 };

const VIDEO_TYPES = ['video/mp4', 'video/3gpp', 'video/quicktime', 'video/webm', 'video/x-m4v'];

/**
 * Whether a picked file can go out on WhatsApp, and as what.
 *
 * @param {File} file
 * @returns {{ kind: 'image'|'video'|'pdf'|'audio' } | { error: string }}
 */
export function checkFile(file) {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  let kind = null;
  if (type === 'image/jpeg' || type === 'image/png') kind = 'image';
  else if (VIDEO_TYPES.includes(type) || (!type && /\.(mp4|mov|m4v|3gp|webm)$/.test(name))) kind = 'video';
  else if (type === 'application/pdf') kind = 'pdf';
  else if (type.startsWith('audio/')) kind = 'audio';

  if (!kind) {
    if (type.startsWith('video/')) return { error: 'this kind of video cannot be sent, use MP4 or MOV' };
    if (type.startsWith('image/')) return { error: 'only JPG or PNG photos can be sent' };
    return { error: 'this kind of file cannot be sent' };
  }
  const mb = file.size / 1048576;
  if (mb > LIMIT_MB[kind]) {
    const what = kind === 'pdf' ? 'PDFs' : `${kind}s`;
    return { error: `${mb.toFixed(1)} MB, ${what} can be up to ${LIMIT_MB[kind]} MB` };
  }
  return { kind };
}

/**
 * A photo small enough for WhatsApp. One already under 5 MB is returned as it
 * is; a bigger one is redrawn as a JPEG, shrinking until it fits.
 *
 * Drawn through an <img>, which modern browsers turn upright from the photo's
 * rotation tag, so a portrait shot does not arrive on its side.
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function shrinkImage(file) {
  if (file.size <= PHOTO_BYTES) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    for (const [maxSide, quality] of [[2560, 0.85], [2048, 0.8], [1600, 0.75], [1280, 0.7]]) {
      const scale = Math.min(1, maxSide / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w0 * scale);
      canvas.height = Math.round(h0 * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      if (blob && blob.size <= PHOTO_BYTES) {
        return new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      }
    }
    throw new Error('could not make this photo small enough');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Get a picked file ready to upload: big photos shrunk, everything else as is
 * (videos are converted on the server).
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function prepareForUpload(file) {
  return checkFile(file).kind === 'image' ? shrinkImage(file) : file;
}

/**
 * Send items one after another, in the order given, so they reach the customer
 * in that order. One failure does not stop the rest.
 *
 * The short gap is what the bot leaves between the parts of a reply: sent back
 * to back, WhatsApp delivers them out of order often enough to matter.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<void>} sendOne
 * @param {{ gapMs?: number }} [opts]
 * @returns {Promise<{ sent: number, failed: Array<{ item: T, error: string }> }>}
 */
export async function sendInOrder(items, sendOne, { gapMs = 700 } = {}) {
  const failed = [];
  let sent = 0;
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, gapMs));
    try {
      await sendOne(items[i], i);
      sent++;
    } catch (e) {
      failed.push({ item: items[i], error: e?.response?.data?.error || e?.message || 'failed' });
    }
  }
  return { sent, failed };
}
