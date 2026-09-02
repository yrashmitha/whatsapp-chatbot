/**
 * @module services/whatsapp
 * @description WhatsApp Cloud API send helpers (client-aware).
 * Handles text messages, image/document sends, template image uploads,
 * and multi-part bot replies split on [[MSG_BREAK]] markers.
 */

'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const { META_ACCESS_TOKEN, PHONE_NUMBER_ID, UPLOADS_DIR } = require('../config/env');

const TEMPLATES_DIR    = path.join(__dirname, '../../public', 'templates');

/**
 * Cache of uploaded template image filenames → WhatsApp media_id.
 * Populated once at startup by uploadTemplateImages().
 *
 * @type {Map<string, string>}
 */
const templateMediaIds = new Map();

/**
 * Return the active WhatsApp access token for a client.
 * Falls back to the global META_ACCESS_TOKEN when no client override is set.
 *
 * @param {Object|null} client - Client config object (may be null)
 * @returns {string} Access token
 */
function waToken(client) {
  return (client && client.waToken) || META_ACCESS_TOKEN;
}

/**
 * Return the WhatsApp Phone Number ID for a client.
 * Falls back to the global PHONE_NUMBER_ID when no client override is set.
 *
 * @param {Object|null} client - Client config object (may be null)
 * @returns {string} Phone Number ID
 */
function waPhoneId(client) {
  return (client && client.phone_number_id) || PHONE_NUMBER_ID;
}

/**
 * Upload all images from the templates directory to WhatsApp at startup,
 * populating templateMediaIds so they can be sent by media_id instead of URL.
 *
 * @returns {Promise<void>}
 */
async function uploadTemplateImages() {
  if (!fs.existsSync(TEMPLATES_DIR)) return;
  const files = fs.readdirSync(TEMPLATES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  if (files.length === 0) return;

  for (const filename of files) {
    try {
      const buffer = fs.readFileSync(path.join(TEMPLATES_DIR, filename));
      const ext    = filename.split('.').pop().toLowerCase();
      const mime   = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', mime);
      form.append('file', new Blob([buffer], { type: mime }), filename);

      const res  = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`,
        { method: 'POST', headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }, body: form });
      const data = await res.json();

      if (data.id) {
        templateMediaIds.set(filename, data.id);
        console.log(`[TEMPLATES] Uploaded "${filename}" → media_id=${data.id}`);
      } else {
        console.warn(`[TEMPLATES] Upload failed for "${filename}":`, JSON.stringify(data));
      }
    } catch (err) {
      console.error(`[TEMPLATES] Error uploading "${filename}":`, err.message);
    }
  }
}

/**
 * Send an image or PDF template file to a WhatsApp recipient.
 * Uses media_id (cached) when available, falls back to a public URL.
 *
 * @param {string}      to       - Recipient E.164 phone number
 * @param {string}      filename - Template filename (must exist in /public/templates/)
 * @param {string}      caption  - Caption shown under the image/document
 * @param {Object|null} client   - Client config object
 * @returns {Promise<string|null>} WhatsApp message ID, so a delivery receipt
 *   can be matched to it, or null when the send failed
 */
async function sendWhatsAppImage(to, filename, caption, client) {
  const isPdf  = filename.toLowerCase().endsWith('.pdf');
  const mediaId = templateMediaIds.get(filename);
  const fileUrl = `${process.env.PUBLIC_URL || 'https://whatsapp-chatbot-production-038d.up.railway.app'}/templates/${encodeURIComponent(filename)}`;

  console.log(`[WA-IMG] Sending "${filename}" (${isPdf ? 'pdf' : 'image'}) to ${to} via ${mediaId ? 'media_id' : 'link'}`);
  try {
    const body = isPdf
      ? { messaging_product: 'whatsapp', to, type: 'document', document: mediaId ? { id: mediaId, filename, caption } : { link: fileUrl, filename, caption } }
      : { messaging_product: 'whatsapp', to, type: 'image',    image:    mediaId ? { id: mediaId, caption } : { link: fileUrl, caption } };
    const resp = await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      body,
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
    console.log(`[WA-IMG] Sent successfully to ${to}`);
    return resp.data?.messages?.[0]?.id || null;
  } catch (err) {
    console.error(`[WA-IMG] Send failed to ${to}:`, err?.response?.data ?? err.message);
    return null;
  }
}

/**
 * Send a plain text message to a WhatsApp recipient.
 * Returns the WhatsApp message ID (wamid) on success.
 *
 * @param {string}      to     - Recipient E.164 phone number
 * @param {string}      text   - Message body text
 * @param {Object|null} client - Client config object
 * @returns {Promise<string|null>} WhatsApp message ID or null
 */
async function sendWhatsAppMessage(to, text, client) {
  console.log(`[WA] Sending message to ${to} (${text.length} chars)`);
  try {
    const resp = await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
    console.log(`[WA] Message sent successfully to ${to}`);
    return resp.data?.messages?.[0]?.id || null;
  } catch (err) {
    console.error(`[WA] Send failed to ${to}:`, err?.response?.data ?? err.message);
    throw err;
  }
}

/**
 * Split a bot reply on [[MSG_BREAK]] markers and send each part as a
 * separate WhatsApp message with an 800 ms inter-message delay.
 *
 * @param {string}      to       - Recipient E.164 phone number
 * @param {string}      botReply - Full reply text (may contain [[MSG_BREAK]] markers)
 * @param {Object|null} client   - Client config object
 * @returns {Promise<void>}
 */
/**
 * WhatsApp's limits for an interactive list. Meta rejects the entire message if
 * any one of these is exceeded, so fields are trimmed rather than sent as-is —
 * a shortened menu still reaches the customer, a rejected one does not.
 */
const LIST_LIMITS = {
  header: 60, body: 1024, footer: 60, button: 20,
  rowId: 200, rowTitle: 24, rowDescription: 72,
  sections: 10, rows: 10,
};

/**
 * Limits for reply buttons and CTA-URL buttons. Same rejection rule as lists:
 * one over-long field and Meta drops the whole message.
 */
const BUTTON_LIMITS = { header: 60, body: 1024, footer: 60, title: 20, id: 256, buttons: 3 };
const CTA_LIMITS    = { header: 60, body: 1024, footer: 60, displayText: 20 };

/**
 * POST a built interactive payload. Shared by all three interactive senders so
 * the URL, auth and error shape stay identical between them.
 *
 * @param {string} to
 * @param {Object} interactive
 * @param {Object} client
 * @param {string} tag - Log prefix
 * @returns {Promise<string|null>} wamid on success, null on failure
 */
async function postInteractive(to, interactive, client, tag) {
  try {
    const resp = await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'interactive', interactive },
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
    return resp.data?.messages?.[0]?.id || null;
  } catch (err) {
    console.error(`${tag} Send failed:`, err?.response?.data ?? err.message);
    return null;
  }
}

/**
 * Attach the optional header and footer both buttons and CTAs accept.
 *
 * @param {Object} interactive - Mutated in place
 * @param {Object} menu
 * @param {Object} limits
 */
function addHeaderFooter(interactive, menu, limits) {
  if (menu.header) interactive.header = { type: 'text', text: fit(menu.header, limits.header, 'header') };
  if (menu.footer) interactive.footer = { text: fit(menu.footer, limits.footer, 'footer') };
}

/**
 * Send up to three reply buttons — tapped inline, with no sheet to open.
 *
 * The right shape for a two or three way decision ("shall we start?"), where a
 * list would make the customer open a menu to pick one of two things. Above
 * three options, use a list instead.
 *
 * The tapped button comes back through the same webhook branch as a list row,
 * carrying its title as the message text.
 *
 * @param {string} to     - Recipient in E.164
 * @param {Object} menu   - { header?, body, footer?, buttons: [{ id, title }] }
 * @param {Object} client - Client row, for its own token and phone number
 * @returns {Promise<string|null>} wamid, or null if nothing was sent
 */
async function sendWhatsAppReplyButtons(to, menu, client) {
  const source = Array.isArray(menu?.buttons) ? menu.buttons : [];
  const buttons = source.slice(0, BUTTON_LIMITS.buttons).map(b => ({
    type: 'reply',
    reply: {
      id:    fit(b.id || b.title, BUTTON_LIMITS.id, 'button id'),
      title: fit(b.title, BUTTON_LIMITS.title, `button title "${b.title}"`),
    },
  })).filter(b => b.reply.title.trim());

  if (!buttons.length) {
    console.warn('[WA-BTN] No buttons in menu — nothing sent');
    return null;
  }
  if (source.length > BUTTON_LIMITS.buttons) {
    console.warn(`[WA-BTN] ${source.length} buttons given, WhatsApp allows ${BUTTON_LIMITS.buttons} — the rest are dropped`);
  }

  const interactive = {
    type: 'button',
    body: { text: fit(menu.body || ' ', BUTTON_LIMITS.body, 'body') },
    action: { buttons },
  };
  addHeaderFooter(interactive, menu, BUTTON_LIMITS);

  const wamid = await postInteractive(to, interactive, client, '[WA-BTN]');
  if (wamid) console.log(`[WA-BTN] Sent ${buttons.length} reply buttons to ${to}`);
  return wamid;
}

/**
 * Send a call-to-action button that opens a URL.
 *
 * A bare link in message text is easy to miss and easy to mistype; this renders
 * as a real button. Unlike reply buttons nothing comes back through the
 * webhook when it is tapped — the customer leaves for the browser — so use it
 * for payment pages and bank details, not for anything the bot must react to.
 *
 * @param {string} to     - Recipient in E.164
 * @param {Object} cta    - { header?, body, footer?, display_text, url }
 * @param {Object} client - Client row, for its own token and phone number
 * @returns {Promise<string|null>} wamid, or null if nothing was sent
 */
async function sendWhatsAppCtaUrl(to, cta, client) {
  const url = String(cta?.url || '').trim();
  // Meta accepts only http(s) here, and a rejected message is silent from the
  // customer's side, so refuse early and say why.
  if (!/^https?:\/\//i.test(url)) {
    console.warn(`[WA-CTA] "${url || '(empty)'}" is not an http(s) URL — nothing sent`);
    return null;
  }

  const interactive = {
    type: 'cta_url',
    body: { text: fit(cta.body || ' ', CTA_LIMITS.body, 'body') },
    action: {
      name: 'cta_url',
      parameters: {
        display_text: fit(cta.display_text || 'Open', CTA_LIMITS.displayText, 'CTA label'),
        url,
      },
    },
  };
  addHeaderFooter(interactive, cta, CTA_LIMITS);

  const wamid = await postInteractive(to, interactive, client, '[WA-CTA]');
  if (wamid) console.log(`[WA-CTA] Sent a CTA button to ${to} → ${url}`);
  return wamid;
}

/**
 * Trim a string to a limit, warning when it actually had to cut.
 *
 * @param {string} v
 * @param {number} max
 * @param {string} label - For the warning
 * @returns {string}
 */
function fit(v, max, label) {
  const s = String(v == null ? '' : v);
  if (s.length <= max) return s;
  console.warn(`[WA-INT] ${label} is ${s.length} chars, over the ${max} limit — trimmed`);
  return s.slice(0, max);
}

/**
 * Send an interactive list — a tappable menu, instead of asking the customer to
 * type a number back.
 *
 * Needs no template and no pre-approval, but only works inside the 24-hour
 * customer service window, so it is for replying to someone, never for opening
 * a conversation.
 *
 * @param {string} to     - Recipient in E.164
 * @param {Object} menu   - { header?, body, footer?, button, sections: [{ title, rows: [{ id, title, description? }] }] }
 * @param {Object} client - Client row, for its own token and phone number
 * @returns {Promise<boolean>} Whether the send succeeded
 */
async function sendWhatsAppInteractiveList(to, menu, client) {
  if (!menu || !Array.isArray(menu.sections) || !menu.sections.length) {
    console.warn('[WA-LIST] No sections in menu — nothing sent');
    return false;
  }

  let rowBudget = LIST_LIMITS.rows;
  const sections = menu.sections.slice(0, LIST_LIMITS.sections).map(sec => {
    const rows = (sec.rows || []).slice(0, rowBudget).map(r => {
      const row = {
        id:    fit(r.id, LIST_LIMITS.rowId, 'row id'),
        title: fit(r.title, LIST_LIMITS.rowTitle, `row title "${r.title}"`),
      };
      // An empty description is rejected outright, so omit it instead.
      const d = fit(r.description || '', LIST_LIMITS.rowDescription, 'row description');
      if (d.trim()) row.description = d;
      return row;
    });
    rowBudget -= rows.length;
    return { title: fit(sec.title || ' ', LIST_LIMITS.rowTitle, 'section title'), rows };
  }).filter(sec => sec.rows.length);

  const totalRows = sections.reduce((n, sec) => n + sec.rows.length, 0);
  if (!totalRows) {
    console.warn('[WA-LIST] No rows survived validation — nothing sent');
    return false;
  }

  const interactive = {
    type: 'list',
    body: { text: fit(menu.body || ' ', LIST_LIMITS.body, 'body') },
    action: {
      button: fit(menu.button || 'Select', LIST_LIMITS.button, 'button label'),
      sections,
    },
  };
  if (menu.header) interactive.header = { type: 'text', text: fit(menu.header, LIST_LIMITS.header, 'header') };
  if (menu.footer) interactive.footer = { text: fit(menu.footer, LIST_LIMITS.footer, 'footer') };

  const wamid = await postInteractive(to, interactive, client, '[WA-LIST]');
  if (wamid) console.log(`[WA-LIST] Sent a ${totalRows}-row list to ${to}`);
  // Returns the id rather than a boolean so the delivery receipt can be matched
  // to it. Still truthy on success, so existing `if (sent)` callers are fine.
  return wamid;
}

async function sendBotReply(to, botReply, client) {
  const parts = botReply.split('[[MSG_BREAK]]').map(p => p.trim()).filter(Boolean);
  const wamids = [];
  for (let i = 0; i < parts.length; i++) {
    const id = await sendWhatsAppMessage(to, parts[i], client);
    if (id) wamids.push(id);
    if (i < parts.length - 1) await new Promise(r => setTimeout(r, 800));
  }
  return wamids;
}

/**
 * Mark an incoming WhatsApp message as read (sends blue ticks).
 * Call this immediately when a customer message arrives.
 *
 * @param {string}      wamid  - WhatsApp message ID from the webhook payload
 * @param {Object|null} client - Client config object
 * @returns {Promise<void>}
 */
async function markMessageRead(wamid, client) {
  if (!wamid) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: wamid },
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.warn(`[WA] markMessageRead failed for ${wamid}:`, err?.response?.data?.error?.message || err.message);
  }
}

/**
 * Send a typing indicator to a WhatsApp recipient.
 * Shows the "typing..." dots in the customer's chat while Nova processes the reply.
 *
 * @param {string}      to     - Recipient E.164 phone number
 * @param {Object|null} client - Client config object
 * @returns {Promise<void>}
 */
async function sendTypingIndicator(to, client) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'typing_indicator',
        typing_indicator: { type: 'text' },
      },
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // Typing indicators are not supported on all accounts — fail silently
    console.warn(`[WA] typing indicator not supported:`, err?.response?.data?.error?.message || err.message);
  }
}

/**
 * Upload audio bytes to WhatsApp and return a media_id.
 * @throws if Meta rejects the upload
 */
async function uploadAudioToMeta(buffer, mime, filename, client) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const res  = await fetch(`https://graph.facebook.com/v18.0/${waPhoneId(client)}/media`,
    { method: 'POST', headers: { Authorization: `Bearer ${waToken(client)}` }, body: form });
  const data = await res.json();
  if (!data.id) throw new Error(JSON.stringify(data));
  return data.id;
}

const AUDIO_MIME = {
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', amr: 'audio/amr',
};

/**
 * Get the audio bytes: read from the local uploads dir when the URL points
 * there (a container fetching its own public domain can hairpin-fail on
 * Railway), otherwise fetch the URL.
 *
 * @returns {Promise<{buffer: Buffer, mime: string, name: string}>}
 */
async function loadAudioBytes(audioUrl) {
  const name = (audioUrl.split('?')[0].split('/').pop()) || 'audio.ogg';
  const ext  = name.split('.').pop().toLowerCase();
  const mime = AUDIO_MIME[ext] || 'audio/ogg';

  if (audioUrl.includes('/uploads/')) {
    const local = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(local)) {
      return { buffer: fs.readFileSync(local), mime, name };
    }
  }
  const r = await fetch(audioUrl);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return { buffer: Buffer.from(await r.arrayBuffer()), mime, name };
}

/**
 * Send an audio file to a WhatsApp recipient.
 *
 * @param {string}      to       - Recipient E.164 phone number
 * @param {string}      audioUrl - Audio file URL (a /uploads/ path is read from disk)
 * @param {Object|null} client   - Client config object
 * @returns {Promise<string|null>} WhatsApp message ID or null
 */
async function sendWhatsAppAudio(to, audioUrl, client) {
  console.log(`[WA-AUDIO] Sending audio to ${to}: ${audioUrl}`);
  try {
    // Upload the bytes and send by media_id. A bare `link` makes Meta re-fetch
    // the file itself and fails with 131053 ("media upload error") even when
    // the URL is perfectly reachable.
    let audio;
    try {
      const { buffer, mime, name } = await loadAudioBytes(audioUrl);
      const id = await uploadAudioToMeta(buffer, mime, name, client);
      audio = { id };
      console.log(`[WA-AUDIO] uploaded ${buffer.length}B (${mime}) → media_id=${id}`);
    } catch (upErr) {
      console.warn(`[WA-AUDIO] upload failed, falling back to link:`, upErr.message);
      audio = { link: audioUrl };
    }
    const resp = await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      { messaging_product: 'whatsapp', to, type: 'audio', audio },
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
    console.log(`[WA-AUDIO] Sent successfully to ${to}`);
    return resp.data?.messages?.[0]?.id || null;
  } catch (err) {
    console.error(`[WA-AUDIO] Send failed to ${to}:`, err?.response?.data ?? err.message);
    return null;
  }
}

module.exports = {
  sendWhatsAppInteractiveList,
  sendWhatsAppReplyButtons,
  sendWhatsAppCtaUrl,
  waToken,
  waPhoneId,
  uploadTemplateImages,
  templateMediaIds,
  sendWhatsAppImage,
  sendWhatsAppMessage,
  sendWhatsAppAudio,
  sendBotReply,
  markMessageRead,
  sendTypingIndicator,
};
