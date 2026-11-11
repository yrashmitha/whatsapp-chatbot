/**
 * Sending several attachments to a customer at once.
 *
 * WhatsApp has its own caps per kind of file, and a file over one uploads fine
 * and then fails at delivery, which reads to the operator like a random fault.
 * So each file is checked here first and a bad one is named with the reason,
 * before anything is uploaded.
 */

/** What WhatsApp will deliver, in MB. PDFs are held to the upload cap of the send route. */
const LIMIT_MB = { image: 5, video: 16, audio: 16, pdf: 16 };

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
  else if (type === 'video/mp4' || type === 'video/3gpp') kind = 'video';
  else if (type === 'application/pdf') kind = 'pdf';
  else if (type.startsWith('audio/')) kind = 'audio';

  if (!kind) {
    if (type === 'video/quicktime' || name.endsWith('.mov')) {
      return { error: 'iPhone .mov videos are not accepted by WhatsApp, save it as MP4' };
    }
    if (type.startsWith('video/')) return { error: 'only MP4 videos can be sent' };
    if (type.startsWith('image/')) return { error: 'only JPG or PNG photos can be sent' };
    return { error: 'this kind of file cannot be sent' };
  }
  const mb = file.size / 1048576;
  if (mb > LIMIT_MB[kind]) {
    const what = kind === 'pdf' ? 'PDFs' : `${kind}s`;
    return { error: `${mb.toFixed(1)} MB, WhatsApp takes ${what} up to ${LIMIT_MB[kind]} MB` };
  }
  return { kind };
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
