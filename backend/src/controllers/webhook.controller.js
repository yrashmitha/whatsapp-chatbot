/**
 * @module controllers/webhook.controller
 * @description Handlers for the WhatsApp webhook routes
 * (GET verification, POST message processing).
 */

'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const db     = require('../db');
const clientRouter = require('../services/clientRouter');
const { buildChatSession, handleMessage } = require('../services/gemini');
const { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppAudio, sendBotReply, sendWhatsAppInteractiveList, sendWhatsAppReplyButtons, waToken, waPhoneId, markMessageRead } = require('../services/whatsapp');
const { chatSessions } = require('../workers/sessionManager');
const { UPLOADS_DIR, PUBLIC_URL } = require('../config/env');
const { analyzePaymentDocument, buildAnalysisNote } = require('../services/imageAnalysis');
const { extractFromBuffer } = require('../services/mediaExtractor');
const { getGeminiKey } = require('../services/clientKeys');
const { genTraceId, makeLogger } = require('../utils/logger');

/**
 * GET /webhook — Meta webhook verification challenge.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {void}
 */
function verifyMetaSignature(req) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.warn('[WEBHOOK-SIG] META_APP_SECRET not set — skipping signature verification');
    return true;
  }
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) {
    console.warn('[WEBHOOK-SIG] Missing X-Hub-Signature-256 header — rejecting request');
    return false;
  }
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  try {
    const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    console.log(`[WEBHOOK-SIG] Signature check: ${valid ? 'PASSED' : 'FAILED'}`);
    return valid;
  } catch {
    console.warn('[WEBHOOK-SIG] Signature comparison error — rejecting request');
    return false;
  }
}

function verifyWebhook(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log(`[WEBHOOK-GET] mode=${mode} token_match=${token === process.env.WEBHOOK_VERIFY_TOKEN}`);
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log(`[WEBHOOK-GET] Verified successfully`);
    return res.status(200).send(challenge);
  }
  console.warn(`[WEBHOOK-GET] Verification FAILED — token mismatch or wrong mode`);
  res.sendStatus(403);
}

/**
 * Keep the ad a message arrived through, if it arrived through one.
 *
 * WhatsApp attaches this to the first message after a click-to-WhatsApp ad and
 * never sends it again, so it is recorded before anything that could fail or
 * return early. Every click is kept; the first one is also stamped on the
 * customer, because that is what a sale gets attributed to.
 *
 * @param {string} clientId
 * @param {string} phone
 * @param {Object|undefined} referral - the webhook's referral object
 * @returns {Promise<void>}
 */
/**
 * Copy an ad's picture into uploads, and return the path to serve it from.
 *
 * Meta's own url is signed and carries an expiry, so it is useless to a chat
 * someone opens next month. Best effort: a failure costs the card its picture
 * and nothing else.
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function cacheAdThumb(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 5 * 1024 * 1024 });
    const type = String(res.headers['content-type'] || '');
    if (!type.startsWith('image/')) return null;
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const name = `ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(UPLOADS_DIR, name), Buffer.from(res.data));
    return `${PUBLIC_URL || ''}/uploads/${name}`;
  } catch (e) {
    console.warn('[REFERRAL] could not cache the ad image:', e.message);
    return null;
  }
}

/**
 * Read what a customer sent, and remember it, whether or not the bot replies.
 *
 * Silencing the bot should stop it talking, not stop it looking. A payment slip
 * that arrives during a takeover is still a payment slip, and the amount and
 * bank on it are what the CRM needs to move the order to payment_identified.
 * Before this, 45% of images went unread because they landed while the bot was
 * paused.
 *
 * Sends nothing. Stores the reading against the message and returns the note
 * for the caller to use if it is going to reply.
 *
 * @param {object}      client
 * @param {Buffer}      buffer
 * @param {string}      mime
 * @param {string|null} caption
 * @param {string}      wamid
 * @param {string}      from
 * @param {object}      log
 * @returns {Promise<string|null>} a note describing the image, or null
 */
async function readInboundImage(client, buffer, mime, caption, wamid, from, log) {
  if (!buffer || !client?.id || !db.IS_PG) return null;

  // The payment analyser first: it knows what a slip looks like and checks the
  // account against the one we expect.
  try {
    const on = await db.pgQuery(
      `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='image_analyzer' AND enabled=TRUE`,
      [client.id]
    );
    if (on.rows.length) {
      const cfg = await db.getPluginConfig(client.id, 'image_analyzer');
      const analysis = await analyzePaymentDocument(buffer, mime, cfg.api_key || await getGeminiKey(client.id), {
        account: cfg.expected_account || null,
        bank:    cfg.expected_bank    || null,
        names:   cfg.expected_names   || null,
        prompt:  cfg.extraction_prompt || null,
      });
      log.info(`[IMAGE-ANALYZER] type=${analysis.document_type} payment=${analysis.is_payment_related} amount=${analysis.amount}`);

      let pending = [];
      if (analysis.is_payment_related) {
        const orders = await db.getOrdersByPhone(from, client.id);
        pending = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
      }
      await db.setMessageExtraction(wamid, analysis)
        .catch(e => log.warn('[IMAGE-ANALYZER] could not store the reading:', e.message));
      return buildAnalysisNote(analysis, caption, pending, cfg.verification_prompt || '');
    }
  } catch (e) {
    log.warn('[IMAGE-ANALYZER] failed:', e.message);
  }

  // Otherwise the general extractor, which at least says what is in the picture.
  try {
    const on = await db.pgQuery(
      `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='media_extractor' AND enabled=TRUE`,
      [client.id]
    );
    if (!on.rows.length) return null;
    const { text: extracted } = await extractFromBuffer(buffer, mime, 'photo', null, await getGeminiKey(client.id));
    if (!extracted) return null;
    await db.setMessageExtraction(wamid, { text: extracted })
      .catch(e => log.warn('[MEDIA-EXTRACTOR] could not store the reading:', e.message));
    return caption ? `${extracted}\n[Customer also included a caption: "${caption}"]` : extracted;
  } catch (e) {
    log.warn('[MEDIA-EXTRACTOR] failed:', e.message);
    return null;
  }
}

/**
 * Fetch an inbound media file and keep it, returning the url to serve it from.
 *
 * WhatsApp hands over an id, not a file. The id buys a short-lived download url
 * and then expires, so this has to happen while the message is being handled.
 * A chat opened tomorrow cannot go back and get it.
 *
 * @param {string} mediaId
 * @param {string} from    - the customer's number, used only in the filename
 * @param {Object} client
 * @returns {Promise<string|null>} a /uploads path, or null if it could not be fetched
 */
async function keepInboundMedia(mediaId, from, client) {
  if (!mediaId) return null;
  try {
    const meta = await axios.get(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${waToken(client)}` } }
    );
    const dlUrl = meta.data?.url;
    if (!dlUrl) return null;
    const res = await axios.get(dlUrl, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${waToken(client)}` },
    });
    const mime = meta.data?.mime_type || 'application/octet-stream';
    const ext = (mime.split('/')[1] || 'bin').split(';')[0];
    const fname = `wa-${from}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fname), res.data);
    console.log(`[MEDIA-DL] kept ${fname} (${mime})`);
    // The bytes come back too. The caller may want to read the image even
    // when the bot is silent, and fetching it twice would be wasteful.
    return { url: `/uploads/${fname}`, buffer: Buffer.from(res.data), mime };
  } catch (e) {
    console.warn('[MEDIA-DL] could not keep inbound media:', e.message);
    return null;
  }
}

async function recordReferral(clientId, phone, referral) {
  if (!referral || typeof referral !== 'object') return;
  const adId = referral.source_id || null;
  try {
    // An image ad carries image_url, a video one carries thumbnail_url.
    const thumb = await cacheAdThumb(referral.image_url || referral.thumbnail_url);
    await db.pgQuery(
      `INSERT INTO ad_referrals
         (client_id, phone_number, source_id, source_type, source_url, headline, body, media_type, ctwa_clid, raw, thumb_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
      [clientId, phone, adId, referral.source_type || null, referral.source_url || null,
       referral.headline || null, referral.body || null, referral.media_type || null,
       referral.ctwa_clid || null, JSON.stringify(referral), thumb]);

    // First touch only: COALESCE leaves an existing attribution alone.
    await db.pgQuery(
      `UPDATE customers
          SET first_ad_id       = COALESCE(first_ad_id, $3),
              first_ad_headline = COALESCE(first_ad_headline, $4),
              first_ad_at       = COALESCE(first_ad_at, NOW())
        WHERE phone_number = $2 AND client_id = $1`,
      [clientId, phone, adId, referral.headline || null]);
    console.log(`[REFERRAL] ${clientId}/${phone} arrived from ad ${adId || '(no id)'}`);
  } catch (e) {
    // Never let attribution break a conversation.
    console.warn('[REFERRAL] could not record:', e.message);
  }
}

/**
 * POST /webhook — process incoming WhatsApp messages (text, image, document).
 * Responds 200 immediately and handles the message asynchronously.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {void}
 */
function receiveWebhook(req, res) {
  if (!verifyMetaSignature(req)) {
    console.warn('[WEBHOOK] Signature verification failed — request rejected');
    return res.sendStatus(403);
  }
  res.sendStatus(200);

  // Declare outside try so catch block can reference them for error recovery
  let from = null, client = null, userMessage = null;
  let log = makeLogger(genTraceId(), null, null);

  (async () => {
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      console.log(`[WEBHOOK-POST] Received payload, has messages: ${!!value?.messages?.length}`);

      // Delivery receipts arrive as their own event with no messages array.
      // Record them before the early return, or a report that never reached the
      // customer is indistinguishable from one they read.
      if (value?.statuses?.length) {
        for (const st of value.statuses) {
          try {
            const e = st.errors?.[0];
            const matched = await db.updateMessageStatus(st.id, st.status, {
              code: e?.code, message: e?.title || e?.message,
            });
            if (st.status === 'failed') {
              console.warn(`[WA-STATUS] FAILED to ${st.recipient_id}: ${e?.code || '?'} ${e?.title || e?.message || 'unknown'} (wamid=${st.id})`);
            } else if (matched) {
              console.log(`[WA-STATUS] ${st.status} — ${st.recipient_id}`);
            }
          } catch (err) {
            console.warn('[WA-STATUS] Failed to record status:', err.message);
          }
        }
        return;
      }

      if (!value?.messages?.length) {
        console.log(`[WEBHOOK-POST] No messages in payload (other event) — skipping`);
        return;
      }

      // ── Resolve client from incoming phone_number_id ──────────────────────
      const incomingPhoneNumberId = value.metadata?.phone_number_id;
      client = await clientRouter.getClientByPhoneNumberId(incomingPhoneNumberId)
        || clientRouter.buildLocalClient();

      // DEV OVERRIDE: set DEV_CLIENT_ID in .env to force a specific client
      if (process.env.DEV_CLIENT_ID) {
        client = (await clientRouter.getClientById(process.env.DEV_CLIENT_ID)) || client;
      }

      // Meta requires the WABA id on business_messaging conversions and will
      // not let either of our tokens read it, but it is right here on every
      // inbound message. Recorded once, per client, without anyone typing it.
      const wabaId = req.body?.entry?.[0]?.id;
      if (wabaId && client?.id && client.waba_id !== wabaId) {
        db.pgQuery('UPDATE client_configs SET waba_id=$1 WHERE client_id=$2', [wabaId, client.id])
          .then(() => clientRouter.invalidateClient?.(client.id))
          .catch(() => {});
      }

      const msg  = value.messages[0];
      // From March 31 2026, Meta may omit phone number for username-enabled users.
      // Fall back to BSUID (business-scoped user ID) from contacts array.
      from = msg.from || value.contacts?.[0]?.user_id;
      let sessionKey = `${client.id}:${from}`;

      const traceId = genTraceId();
      log = makeLogger(traceId, client.id, from);

      // Before anything that can return early. The reply can be retried; the
      // referral arrives exactly once and is gone if this turn bails out.
      if (msg.referral) {
        await db.upsertCustomer(from, null, client.id);
        await recordReferral(client.id, from, msg.referral);
      }

      // Deliberately not marking it read yet. A blue tick says somebody read
      // this, and nobody has: the bot might be switched off, in which case the
      // customer would see their message go blue and then get nothing, which
      // reads as being ignored. The receipt is sent below, once we know the bot
      // is actually going to answer, or later when an operator opens the chat.
      // Note: WhatsApp Cloud API does not support typing indicators
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));

      // Whether the bot may answer at all, decided before anything is
      // dispatched on message type. This used to live below the text handling,
      // so a photo or a PDF was answered whatever the switch said: the operator
      // saw their typed conversation respected while the model kept replying to
      // everything the customer sent as an attachment.
      const botMayReply = await (async () => {
        if (client.ai_enabled === false) return false;
        return db.getCustomerAiEnabled(from, client.id);
      })();

      if (!botMayReply) {
        // Store it so a person can answer in the CRM, labelled the way the
        // branch below would have labelled it.
        const label = msg.type === 'image'
          ? `[Photo:${msg.image?.id || ''}]${msg.image?.caption ? ` ${msg.image.caption}` : ''}`
          : msg.type === 'document'
            ? `[Document: ${msg.document?.filename || 'file'}]`
            : msg.type === 'audio'
              ? '[Voice message]'
              : (msg.text?.body || msg.interactive?.list_reply?.title
                 || msg.interactive?.button_reply?.title
                 || msg.button?.text || `[${msg.type}]`);
        const mediaType = msg.type === 'image' ? 'image'
          : msg.type === 'document' ? 'pdf'
          : msg.type === 'audio' ? 'audio' : null;

        // Keep the file as well as the label. The bot is not going to look at
        // it, but the person handling this chat certainly wants to.
        const mediaId = msg.image?.id || msg.document?.id || msg.audio?.id || null;
        const kept = mediaType ? await keepInboundMedia(mediaId, from, client) : null;

        await db.upsertCustomer(from, null, client.id);
        await db.insertMessage(from, label, 'user', null, client.id, mediaType, kept?.url || null, msg.id);

        // Read it anyway. The bot is not going to say anything, but a slip is
        // still a slip and whoever is handling this chat needs the amount and
        // the bank without opening the picture themselves.
        if (msg.type === 'image' && kept?.buffer) {
          await readInboundImage(client, kept.buffer, kept.mime, msg.image?.caption || null, msg.id, from, log)
            .catch(e => log.warn('[WEBHOOK] could not read the image while silent:', e.message));
        }

        // An away message is opt-in and only for the global switch: a chat an
        // operator has taken over is being handled by a person, and telling
        // that customer nobody is available would be false.
        const away = client.ai_enabled === false ? (client.away_message || '').trim() : '';
        if (away) {
          const recent = await db.pgQuery(
            `SELECT 1 FROM messages
              WHERE client_id=$1 AND phone_number=$2 AND sender_type='bot'
                AND message_text=$3 AND created_at > NOW() - INTERVAL '6 hours'
              LIMIT 1`, [client.id, from, away]);
          if (!recent.rows.length) {
            await sendWhatsAppMessage(from, away, client);
            await db.insertMessage(from, away, 'bot', null, client.id);
            log.info(`[WEBHOOK] bot off - away message sent`);
            return;
          }
        }
        log.info(`[WEBHOOK] bot off for ${msg.type} - stored, nothing sent`);
        return;
      }

      // The bot is going to read it, so the tick is honest.
      markMessageRead(msg.id, client).catch(() => {});

      log.info(`[WEBHOOK] type=${msg.type}`);

      // ── Image messages ──────────────────────────────────────────────────────
      if (msg.type === 'image') {
        const caption = msg.image?.caption?.trim() || '';
        log.info(`[WEBHOOK] Image received | caption="${caption}"`);

        await db.upsertCustomer(from, null, client?.id);
        if (chatSessions.has(sessionKey)) {
          const dbMsgs = await db.getMessagesByPhone(from, client?.id);
          if (dbMsgs.length === 0) chatSessions.delete(sessionKey);
        }
        if (!chatSessions.has(sessionKey)) {
          chatSessions.set(sessionKey, { chat: await buildChatSession(from, client), phoneNumber: from });
        }
        const imgSession = chatSessions.get(sessionKey);
        imgSession.lastUsed = Date.now();

        const mediaId = msg.image?.id || '';
        const userLabel = `[Photo:${mediaId}]${caption ? ` ${caption}` : ''}`;

        let customerMediaUrl = null;
        let imgBuffer = null;
        let imgMimeType = 'image/jpeg';
        if (mediaId) {
          try {
            const metaRes = await axios.get(
              `https://graph.facebook.com/v18.0/${mediaId}`,
              { headers: { Authorization: `Bearer ${waToken(client)}` } }
            );
            const dlUrl = metaRes.data?.url;
            if (dlUrl) {
              const imgRes = await axios.get(dlUrl, {
                responseType: 'arraybuffer',
                headers: { Authorization: `Bearer ${waToken(client)}` }
              });
              imgMimeType = metaRes.data?.mime_type || 'image/jpeg';
              const ext = imgMimeType.split('/')[1]?.split(';')[0] || 'jpg';
              const fname = `wa-${from}-${Date.now()}.${ext}`;
              fs.writeFileSync(path.join(UPLOADS_DIR, fname), imgRes.data);
              customerMediaUrl = `/uploads/${fname}`;
              imgBuffer = Buffer.from(imgRes.data);
              console.log(`[MEDIA-DL] Customer image saved: ${fname}`);
            }
          } catch (e) {
            console.warn('[MEDIA-DL] Failed to download customer image:', e.message);
          }
        }

        await db.insertMessage(from, userLabel, 'user', null, client?.id ?? null, 'image', customerMediaUrl, msg.id);

        // ── Image Analyzer addon ────────────────────────────────────────────
        let imageNote = null;
        if (imgBuffer) {
          try {
            const analyzerCheck = await db.pgQuery(
              `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='image_analyzer' AND enabled=TRUE`,
              [client.id]
            );
            if (analyzerCheck.rows.length) {
              log.info(`[IMAGE-ANALYZER] Analyzing image`);
              const cfg = await db.getPluginConfig(client.id, 'image_analyzer');
              const analysis = await analyzePaymentDocument(imgBuffer, imgMimeType, cfg.api_key || await getGeminiKey(client.id), {
                account: cfg.expected_account || null,
                bank:    cfg.expected_bank    || null,
                names:   cfg.expected_names   || null,
                prompt:  cfg.extraction_prompt || null,
              });
              log.info(`[IMAGE-ANALYZER] Result: type=${analysis.document_type} payment=${analysis.is_payment_related} amount=${analysis.amount}`);

              let pendingOrders = [];
              if (analysis.is_payment_related) {
                const orders = await db.getOrdersByPhone(from, client.id);
                pendingOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
              }

              imageNote = buildAnalysisNote(analysis, caption, pendingOrders, cfg.verification_prompt || '');
              await db.setMessageExtraction(msg.id, analysis)
                .catch(e => log.warn('[IMAGE-ANALYZER] Could not store the reading:', e.message));
            }
          } catch (e) {
            console.warn('[IMAGE-ANALYZER] Failed, using default note:', e.message);
          }
        }
        if (!imageNote && imgBuffer && db.IS_PG) {
          try {
            const extractorCheck = await db.pgQuery(
              `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='media_extractor' AND enabled=TRUE`,
              [client.id]
            );
            if (extractorCheck.rows.length) {
              log.info('[MEDIA-EXTRACTOR] Extracting image content via Gemini');
              const { text: extracted } = await extractFromBuffer(imgBuffer, imgMimeType, 'photo', null, await getGeminiKey(client.id));
              if (extracted) {
                await db.setMessageExtraction(msg.id, { text: extracted })
                  .catch(e => log.warn('[MEDIA-EXTRACTOR] Could not store the reading:', e.message));
              }
              if (extracted) {
                imageNote = caption ? `${extracted}\n[Customer also included a caption: "${caption}"]` : extracted;
                log.info('[MEDIA-EXTRACTOR] Image extraction succeeded');
              }
            }
          } catch (e) {
            console.warn('[MEDIA-EXTRACTOR] Image extraction failed:', e.message);
          }
        }
        if (!imageNote) {
          imageNote = caption
            ? `[Customer sent a photo with caption: "${caption}". You cannot see the image itself. Acknowledge what the customer has sent and respond appropriately. Add a short note that you cannot view images directly but the team will review it.]`
            : `[Customer sent a photo (no caption). You cannot see the image. Acknowledge what the customer has sent and respond appropriately. Add a short note that you cannot view images but the team will review it.]`;
        }

        const { botReply, imagesToSend, productImagesToSend: imgProductImages, isFallback: imgFallback } = await handleMessage(from, imageNote, imgSession.chat, { skipUserInsert: true, client, traceId });
        if (imgFallback) {
          log.warn(`[WEBHOOK] Fallback triggered on image — suppressing reply to customer`);
          db.pgQuery(
            `UPDATE customers SET needs_attention=TRUE WHERE phone_number=$1 AND client_id=$2`,
            [from, client.id]
          ).catch(e => log.warn('[FALLBACK] Failed to set needs_attention:', e.message));
          if (client.owner_phone) {
            const notif = `⚠️ Bot fallback triggered\nCustomer: ${from}\nMessage: [Image]${msg.image?.caption ? ` "${msg.image.caption}"` : ''}`;
            sendWhatsAppMessage(client.owner_phone, notif, client).catch(e => log.warn('[FALLBACK-NOTIF] Failed:', e.message));
          }
        } else if (botReply.trim()) {
          await sendBotReply(from, botReply, client);
        }

        for (const filename of imagesToSend) {
          const imgCaption = filename.toLowerCase().startsWith('horoscope')
            ? 'ලග්න කොටු 12 සහ නවාංශ කොටු 12 දෙකම පෙනෙන ලෙස photo send කරන්න 🙏'
            : 'මේවා මම ඉක්මනින්ම හොයාගත්ත කීප දෙනෙකුගේ screenshots 🙏';
          const imgW = await sendWhatsAppImage(from, filename, imgCaption, client);
          const isPdf = filename.toLowerCase().endsWith('.pdf');
          await db.insertMessage(from, isPdf ? `[PDF: ${filename}]` : `[Image: ${filename}]`, 'bot', null, client?.id ?? null, isPdf ? 'pdf' : 'image', `/templates/${encodeURIComponent(filename)}`, imgW);
        }
        for (const { url, caption: pc } of (imgProductImages || [])) {
          try {
            await axios.post(
              `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
              { messaging_product: 'whatsapp', to: from, type: 'image', image: { link: url, caption: pc } },
              { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
            );
            await db.insertMessage(from, `[Image: ${pc}]`, 'bot', null, client?.id ?? null, 'image', url);
            console.log(`[WA-IMG] Media image sent after image message: ${pc}`);
          } catch (e) {
            console.warn(`[WA-IMG] Failed to send media image "${pc}":`, e?.response?.data ?? e.message);
          }
        }
        return;
      }

      // ── Document messages (PDFs etc.) ───────────────────────────────────────
      if (msg.type === 'document') {
        const docMediaId = msg.document?.id;
        const docFileName = msg.document?.filename || 'document.pdf';
        let docStoredUrl = null;
        let docBuffer = null;
        let docMimeType = 'application/pdf';
        if (docMediaId) {
          try {
            const metaRes = await axios.get(
              `https://graph.facebook.com/v18.0/${docMediaId}`,
              { headers: { Authorization: `Bearer ${waToken(client)}` } }
            );
            const dlUrl = metaRes.data?.url;
            if (dlUrl) {
              const docRes = await axios.get(dlUrl, {
                responseType: 'arraybuffer',
                headers: { Authorization: `Bearer ${waToken(client)}` }
              });
              docMimeType = metaRes.data?.mime_type || 'application/pdf';
              const safeName = docFileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
              const fname = `wa-doc-${from}-${Date.now()}-${safeName}`;
              fs.writeFileSync(path.join(UPLOADS_DIR, fname), docRes.data);
              docStoredUrl = `/uploads/${fname}`;
              docBuffer = Buffer.from(docRes.data);
              console.log(`[MEDIA-DL] Customer document saved: ${fname}`);
            }
          } catch (e) {
            console.warn('[MEDIA-DL] Failed to download customer document:', e.message);
          }
        }
        await db.upsertCustomer(from, null, client?.id);
        await db.insertMessage(from, `[Document: ${docFileName}]`, 'user', null, client?.id ?? null, 'pdf', docStoredUrl, msg.id);

        // ── Image Analyzer addon for PDFs ───────────────────────────────────
        let docAnalyzed = false;
        if (docBuffer) {
          try {
            const analyzerCheck = await db.pgQuery(
              `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='image_analyzer' AND enabled=TRUE`,
              [client.id]
            );
            if (analyzerCheck.rows.length) {
              log.info(`[IMAGE-ANALYZER] Analyzing PDF`);
              // Build a session if needed (mirrors image path)
              if (!chatSessions.has(sessionKey)) {
                chatSessions.set(sessionKey, { chat: await buildChatSession(from, client), phoneNumber: from });
              }
              const docSession = chatSessions.get(sessionKey);
              docSession.lastUsed = Date.now();

              const cfg = await db.getPluginConfig(client.id, 'image_analyzer');
              const analysis = await analyzePaymentDocument(docBuffer, docMimeType, cfg.api_key || await getGeminiKey(client.id), {
                account: cfg.expected_account || null,
                bank:    cfg.expected_bank    || null,
                names:   cfg.expected_names   || null,
                prompt:  cfg.extraction_prompt || null,
              });
              log.info(`[IMAGE-ANALYZER] PDF result: type=${analysis.document_type} payment=${analysis.is_payment_related} amount=${analysis.amount}`);

              let pendingOrders = [];
              if (analysis.is_payment_related) {
                const orders = await db.getOrdersByPhone(from, client.id);
                pendingOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
              }

              const docNote = buildAnalysisNote(analysis, '', pendingOrders, cfg.verification_prompt || '');
              await db.setMessageExtraction(msg.id, analysis)
                .catch(e => log.warn('[IMAGE-ANALYZER] Could not store the reading:', e.message));
              const { botReply: docReply, imagesToSend: docImages, productImagesToSend: docProductImages, isFallback: docFallback } = await handleMessage(from, docNote, docSession.chat, { skipUserInsert: true, client, traceId });
              if (docFallback) {
                log.warn(`[WEBHOOK] Fallback triggered on document — suppressing reply to customer`);
                db.pgQuery(
                  `UPDATE customers SET needs_attention=TRUE WHERE phone_number=$1 AND client_id=$2`,
                  [from, client.id]
                ).catch(e => log.warn('[FALLBACK] Failed to set needs_attention:', e.message));
                if (client.owner_phone) {
                  const notif = `⚠️ Bot fallback triggered\nCustomer: ${from}\nMessage: [Document: ${docFileName}]`;
                  sendWhatsAppMessage(client.owner_phone, notif, client).catch(e => log.warn('[FALLBACK-NOTIF] Failed:', e.message));
                }
              } else if (docReply.trim()) {
                await sendBotReply(from, docReply, client);
              }
              for (const filename of docImages) {
                await sendWhatsAppImage(from, filename, '', client);
              }
              for (const { url, caption: pc } of (docProductImages || [])) {
                try {
                  await axios.post(
                    `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
                    { messaging_product: 'whatsapp', to: from, type: 'image', image: { link: url, caption: pc } },
                    { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
                  );
                  await db.insertMessage(from, `[Image: ${pc}]`, 'bot', null, client?.id ?? null, 'image', url);
                  console.log(`[WA-IMG] Media image sent after PDF message: ${pc}`);
                } catch (e) {
                  console.warn(`[WA-IMG] Failed to send media image "${pc}":`, e?.response?.data ?? e.message);
                }
              }
              docAnalyzed = true;
            }
          } catch (e) {
            console.warn('[IMAGE-ANALYZER] PDF analysis failed:', e.message);
          }
        }
        if (!docAnalyzed) {
          let docExtracted = false;
          if (docBuffer && db.IS_PG) {
            try {
              const extractorCheck = await db.pgQuery(
                `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='media_extractor' AND enabled=TRUE`,
                [client.id]
              );
              if (extractorCheck.rows.length) {
                if (!chatSessions.has(sessionKey)) {
                  chatSessions.set(sessionKey, { chat: await buildChatSession(from, client), phoneNumber: from });
                }
                const docSession = chatSessions.get(sessionKey);
                docSession.lastUsed = Date.now();

                log.info('[MEDIA-EXTRACTOR] Extracting document content via Gemini');
                const { text: extracted } = await extractFromBuffer(docBuffer, docMimeType, docFileName, null, await getGeminiKey(client.id));
                if (extracted) {
                  await db.setMessageExtraction(msg.id, { text: extracted })
                    .catch(e => log.warn('[MEDIA-EXTRACTOR] Could not store the reading:', e.message));
                }
                const docNote = extracted || `[Customer sent a document (${docFileName}). Acknowledge receipt and let them know the team will review it.]`;
                log.info(`[MEDIA-EXTRACTOR] Document extraction ${extracted ? 'succeeded' : 'returned empty — using fallback note'}`);

                const { botReply: docReply, isFallback: docFallback } = await handleMessage(from, docNote, docSession.chat, { skipUserInsert: true, client, traceId });
                if (docFallback) {
                  log.warn('[WEBHOOK] Fallback on extracted document — suppressing reply');
                  await sendWhatsAppMessage(from, 'ලිපිය ලැබුණා, ස්තූතියි! 🙏', client);
                } else if (docReply.trim()) {
                  await sendBotReply(from, docReply, client);
                }
                docExtracted = true;
              }
            } catch (e) {
              console.warn('[MEDIA-EXTRACTOR] Document extraction failed:', e.message);
            }
          }
          if (!docExtracted) {
            await sendWhatsAppMessage(from, 'ලිපිය ලැබුණා, ස්තූතියි! 🙏', client);
          }
        }
        return;
      }

      // ── Interactive replies (list row or button tap) ────────────────────────
      // The customer chose rather than typed. Feed the row's title through as
      // the message so the assistant reads it exactly as if they had written it,
      // and nothing downstream needs to know the difference.
      if (msg.type === 'interactive') {
        const choice = msg.interactive?.list_reply || msg.interactive?.button_reply;
        if (choice) {
          userMessage = choice.title || choice.id;
          log.info(`[WEBHOOK] Interactive reply: id="${choice.id}" title="${choice.title || ''}"`);
        }
      }

      // A quick reply tapped on a *template* arrives as its own type, not as an
      // interactive reply, and carries the button's words in msg.button.text.
      // Without this the reply to a re-engagement template is dropped as an
      // unsupported type: the customer taps the offer and hears nothing back,
      // which is the worst possible outcome for a message we paid to send.
      if (msg.type === 'button') {
        userMessage = msg.button?.text || msg.button?.payload;
        log.info(`[WEBHOOK] Template button: "${userMessage || ''}"`);
      }

      // ── Text messages ───────────────────────────────────────────────────────
      userMessage = userMessage || msg.text?.body;
      if (!userMessage) {
        log.warn(`[WEBHOOK] Unsupported message type "${msg.type}" — skipping`);
        return;
      }


      // Package message limit check
      if (client.package_message_limit) {
        const freeLimit  = client.package_message_limit + (client.bonus_messages || 0);
        const totalLimit = freeLimit + (client.overage_limit || 0);
        // Billing period starts on the same day-of-month as the client's onboard date
        const billingDay = client.created_at ? new Date(client.created_at).getDate() : 1;
        const now = new Date();
        let periodStart = new Date(now.getFullYear(), now.getMonth(), billingDay);
        if (periodStart > now) periodStart = new Date(now.getFullYear(), now.getMonth() - 1, billingDay);
        const { rows: usageRows } = await db.pgQuery(
          `SELECT COUNT(*)::int AS cnt FROM messages
           WHERE client_id=$1 AND sender_type='bot'
           AND created_at >= $2`,
          [client.id, periodStart]
        );
        const used = usageRows[0].cnt;
        if (used >= totalLimit) {
          await db.upsertCustomer(from, null, client.id);
          await db.insertMessage(from, userMessage, 'user', null, client.id, null, null, msg.id);
          const limitMsg = client.contact_number
            ? `Our AI assistant has reached its monthly limit. Please contact us at ${client.contact_number} for assistance 🙏`
            : `Our AI assistant has reached its monthly limit. We'll be back next month 🙏`;
          await sendWhatsAppMessage(from, limitMsg, client);
          await db.insertMessage(from, limitMsg, 'bot', null, client.id);
          log.info(`[WEBHOOK] Monthly limit reached (${used}/${totalLimit})`);
          return;
        }
        if (used >= freeLimit) {
          log.info(`[WEBHOOK] Overage zone: ${used - freeLimit + 1}/${client.overage_limit} overage msgs used`);
        }
      }

      // Invalidate stale in-memory session if DB was cleared externally
      if (chatSessions.has(sessionKey)) {
        const dbMsgs = await db.getMessagesByPhone(from, client?.id);
        if (dbMsgs.length === 0) {
          log.info(`[SESSION] DB cleared — rebuilding session`);
          chatSessions.delete(sessionKey);
        }
      }
      const settingsFingerprint = `${client.ai_model}|${client.knowledge_base_enabled}|${client.product_catalog_enabled}`;

      const existingSession = chatSessions.get(sessionKey);
      if (!existingSession || existingSession.settingsFingerprint !== settingsFingerprint) {
        if (existingSession) log.info(`[SESSION] Settings changed — rebuilding session`);
        else log.info(`[SESSION] New session`);
        chatSessions.set(sessionKey, {
          chat:                await buildChatSession(from, client),
          phoneNumber:         from,
          settingsFingerprint,
        });
      }
      const session = chatSessions.get(sessionKey);
      session.lastUsed = Date.now();

      const { botReply: rawBotReply, imagesToSend, productImagesToSend, isFallback } = await handleMessage(from, userMessage, session.chat, { client, traceId });

      // Extract [[VOICE:keyword]] tokens before sending text
      const voiceTokenRegex = /\[\[VOICE:([a-z0-9_]+)\]\]/gi;
      const voiceKeywords = [];
      let botReply = rawBotReply;
      let vMatch;
      while ((vMatch = voiceTokenRegex.exec(rawBotReply)) !== null) {
        voiceKeywords.push(vMatch[1].toLowerCase());
      }
      if (voiceKeywords.length > 0) {
        botReply = rawBotReply.replace(/\[\[VOICE:[a-z0-9_]+\]\]/gi, '').replace(/\s{2,}/g, ' ').trim();
      }

      // Extract [[LIST:menu_id]] — a tappable menu instead of asking the
      // customer to type a number back. Same shape as the voice marker: pull
      // the ids out, strip them from the text, send after the words.
      const listIds = [];
      let lMatch;
      const listTokenRegex = /\[\[LIST:([a-z0-9_]+)\]\]/gi;
      while ((lMatch = listTokenRegex.exec(botReply)) !== null) listIds.push(lMatch[1].toLowerCase());
      if (listIds.length > 0) {
        botReply = botReply.replace(/\[\[LIST:[a-z0-9_]+\]\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
      }

      // [[BUTTONS:menu_id]] — up to three inline choices, for a decision too
      // small to be worth opening a list for.
      const buttonIds = [];
      let bMatch;
      const buttonTokenRegex = /\[\[BUTTONS:([a-z0-9_]+)\]\]/gi;
      while ((bMatch = buttonTokenRegex.exec(botReply)) !== null) buttonIds.push(bMatch[1].toLowerCase());
      if (buttonIds.length > 0) {
        botReply = botReply.replace(/\[\[BUTTONS:[a-z0-9_]+\]\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
      }

      if (isFallback) {
        log.warn(`[WEBHOOK] Fallback triggered — suppressing reply to customer`);
        db.pgQuery(
          `UPDATE customers SET needs_attention=TRUE WHERE phone_number=$1 AND client_id=$2`,
          [from, client.id]
        ).catch(e => log.warn('[FALLBACK] Failed to set needs_attention:', e.message));
        if (client.owner_phone) {
          const notif = `⚠️ Bot fallback triggered\nCustomer: ${from}\nMessage: ${userMessage.substring(0, 200)}`;
          sendWhatsAppMessage(client.owner_phone, notif, client).catch(e => log.warn('[FALLBACK-NOTIF] Failed:', e.message));
        }
        // Gemini usually recovers within seconds — retry once automatically before giving up
        ;(async () => {
          await new Promise(r => setTimeout(r, 8000));
          try {
            log.info(`[INSTANT-RETRY] Retrying for ${from}`);
            const retryNote = '[SYSTEM: Automatic retry after a brief delay. Reply naturally to the customer message without mentioning any delay or technical issue.]';
            const { botReply: retryReply, isFallback: retryFailed } = await handleMessage(
              from, userMessage, session.chat, { skipUserInsert: true, client, retryNote }
            );
            if (!retryFailed && retryReply.trim()) {
              await sendBotReply(from, retryReply, client);
              db.pgQuery(
                `UPDATE customers SET needs_attention=FALSE WHERE phone_number=$1 AND client_id=$2`,
                [from, client.id]
              ).catch(() => {});
              log.info(`[INSTANT-RETRY] Success for ${from}`);
            } else {
              log.warn(`[INSTANT-RETRY] Also failed for ${from} — queueing for later retry`);
              db.pgQuery(
                `INSERT INTO message_retry_queue (phone_number, client_id, message_text, retry_after)
                 VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
                [from, client.id, userMessage]
              ).catch(() => {});
            }
          } catch (e) {
            log.error(`[INSTANT-RETRY] Error for ${from}:`, e.message);
            db.pgQuery(
              `INSERT INTO message_retry_queue (phone_number, client_id, message_text, retry_after)
               VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
              [from, client.id, userMessage]
            ).catch(() => {});
          }
        })();
      } else if (!botReply.trim()) {
        log.warn(`[WEBHOOK] Empty botReply from Gemini — skipping send`);
      } else {
        const wamids = await sendBotReply(from, botReply, client);
        await db.attachWamidToLatestBotMessage(from, client.id, wamids[wamids.length - 1])
          .catch(e => log.warn('[WA-STATUS] Could not attach wamid:', e.message));
      }

      // Send any tappable menus the assistant asked for, after the words that
      // introduce them.
      for (const menuId of listIds) {
        try {
          const menu = (client.interactive_menus || {})[menuId];
          if (!menu) {
            log.warn(`[WA-LIST] No menu "${menuId}" configured for client ${client.id}`);
            continue;
          }
          const sent = await sendWhatsAppInteractiveList(from, menu, client);
          if (sent) {
            await db.insertMessage(from, menu.body || '', 'bot', null, client?.id ?? null,
              null, null, typeof sent === 'string' ? sent : null, { kind: 'list', id: menuId, ...menu });
          }
        } catch (e) {
          log.warn(`[WA-LIST] Failed to send menu "${menuId}":`, e.message);
        }
      }

      // Send any inline button choices the assistant asked for.
      for (const menuId of buttonIds) {
        try {
          const menu = (client.interactive_menus || {})[menuId];
          if (!menu) {
            log.warn(`[WA-BTN] No menu "${menuId}" configured for client ${client.id}`);
            continue;
          }
          const wamid = await sendWhatsAppReplyButtons(from, menu, client);
          if (wamid) {
            await db.insertMessage(from, menu.body || '', 'bot', null, client?.id ?? null,
              null, null, wamid, { kind: 'buttons', id: menuId, ...menu });
          }
        } catch (e) {
          log.warn(`[WA-BTN] Failed to send buttons "${menuId}":`, e.message);
        }
      }

      // Send voice clips referenced by the AI
      for (const keyword of voiceKeywords) {
        try {
          const clip = await db.getVoiceClipByKeyword(client.id, keyword);
          if (clip) {
            const wamid = await sendWhatsAppAudio(from, clip.audio_url, client);
            await db.insertMessage(from, `[Voice: ${clip.name}]`, 'bot', null, client?.id ?? null, 'audio', clip.audio_url, wamid);
            log.info(`[VOICE-CLIP] Sent "${clip.name}" (${keyword}) to ${from}`);
          } else {
            log.warn(`[VOICE-CLIP] No clip found for keyword "${keyword}" in client ${client.id}`);
          }
        } catch (e) {
          log.warn(`[VOICE-CLIP] Failed to send keyword "${keyword}":`, e.message);
        }
      }

      for (const filename of imagesToSend) {
        const caption = filename.toLowerCase().startsWith('horoscope')
          ? 'ලග්න කොටු 12 සහ නවාංශ කොටු 12 දෙකම පෙනෙන ලෙස photo send කරන්න 🙏'
          : 'මේවා මම ඉක්මනින්ම හොයාගත්ත කීප දෙනෙකුගේ screenshots 🙏';
        const imgWamid = await sendWhatsAppImage(from, filename, caption, client);
        const isPdf = filename.toLowerCase().endsWith('.pdf');
        await db.insertMessage(from, isPdf ? `[PDF: ${filename}]` : `[Image: ${filename}]`, 'bot', null, client?.id ?? null, isPdf ? 'pdf' : 'image', `/templates/${encodeURIComponent(filename)}`, imgWamid);
      }

      // Send product images / PDFs from RAG search or send_image tool
      for (const { url, caption } of (productImagesToSend || [])) {
        const isPdf = /\.pdf(\?|$)/i.test(url);
        const waBody = isPdf
          ? { messaging_product: 'whatsapp', to: from, type: 'document', document: { link: url, filename: caption || 'document.pdf', caption } }
          : { messaging_product: 'whatsapp', to: from, type: 'image',    image:    { link: url, caption } };
        try {
          const mediaResp = await axios.post(
            `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
            waBody,
            { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
          );
          await db.insertMessage(from, isPdf ? `[PDF: ${caption}]` : `[Image: ${caption}]`, 'bot', null, client?.id ?? null, isPdf ? 'pdf' : 'image', url,
            mediaResp.data?.messages?.[0]?.id || null);
          log.info(`[WA-MEDIA] Sent ${isPdf ? 'PDF' : 'image'}: ${caption}`);
        } catch (e) {
          log.warn(`[WA-MEDIA] Failed to send "${caption}":`, e?.response?.data ?? e.message);
        }
      }
    } catch (err) {
      log.error(`[WEBHOOK] ERROR:`, err?.response?.data ?? err.message);
      if (from && client && userMessage) {
        db.pgQuery(
          `UPDATE customers SET needs_attention=TRUE WHERE phone_number=$1 AND client_id=$2`,
          [from, client.id]
        ).catch(e => log.warn('[OUTER-CATCH] Failed to set needs_attention:', e.message));
        if (client.owner_phone) {
          const notif = `⚠️ Bot error\nCustomer: ${from}\nMessage: ${userMessage.substring(0, 200)}`;
          sendWhatsAppMessage(client.owner_phone, notif, client).catch(e => log.warn('[OUTER-CATCH-NOTIF] Failed:', e.message));
        }
        try {
          await db.pgQuery(
            `INSERT INTO message_retry_queue (phone_number, client_id, message_text, retry_after)
             VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
            [from, client.id, userMessage]
          );
          console.log(`[RETRY-QUEUE] Enqueued message from ${from} for retry in 5 min`);
        } catch (qErr) {
          console.error(`[RETRY-QUEUE] Failed to enqueue:`, qErr.message);
        }
      }
    }
  })();
}

module.exports = { verifyWebhook, receiveWebhook };
