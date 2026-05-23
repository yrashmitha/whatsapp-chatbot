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
const { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppAudio, sendBotReply, waToken, waPhoneId, markMessageRead } = require('../services/whatsapp');
const { chatSessions } = require('../workers/sessionManager');
const { UPLOADS_DIR } = require('../config/env');
const { analyzePaymentDocument, buildAnalysisNote } = require('../services/imageAnalysis');
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

      if (!value?.messages?.length) {
        console.log(`[WEBHOOK-POST] No messages in payload (status update or other event) — skipping`);
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

      const msg  = value.messages[0];
      // From March 31 2026, Meta may omit phone number for username-enabled users.
      // Fall back to BSUID (business-scoped user ID) from contacts array.
      from = msg.from || value.contacts?.[0]?.user_id;
      let sessionKey = `${client.id}:${from}`;

      const traceId = genTraceId();
      log = makeLogger(traceId, client.id, from);

      // Human-like delay → mark read (blue ticks)
      // Note: WhatsApp Cloud API does not support typing indicators
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
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

        await db.insertMessage(from, userLabel, 'user', null, client?.id ?? null, 'image', customerMediaUrl);

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
              const analysis = await analyzePaymentDocument(imgBuffer, imgMimeType, cfg.api_key || null);
              log.info(`[IMAGE-ANALYZER] Result: type=${analysis.document_type} payment=${analysis.is_payment_related} amount=${analysis.amount}`);

              let pendingOrders = [];
              if (analysis.is_payment_related) {
                const orders = await db.getOrdersByPhone(from, client.id);
                pendingOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
              }

              imageNote = buildAnalysisNote(analysis, caption, pendingOrders, cfg.verification_prompt || '');
            }
          } catch (e) {
            console.warn('[IMAGE-ANALYZER] Failed, using default note:', e.message);
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
          await sendWhatsAppImage(from, filename, imgCaption, client);
          const isPdf = filename.toLowerCase().endsWith('.pdf');
          await db.insertMessage(from, isPdf ? `[PDF: ${filename}]` : `[Image: ${filename}]`, 'bot', null, client?.id ?? null, isPdf ? 'pdf' : 'image', `/templates/${encodeURIComponent(filename)}`);
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
        await db.insertMessage(from, `[Document: ${docFileName}]`, 'user', null, client?.id ?? null, 'pdf', docStoredUrl);

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
              const analysis = await analyzePaymentDocument(docBuffer, docMimeType, cfg.api_key || null);
              log.info(`[IMAGE-ANALYZER] PDF result: type=${analysis.document_type} payment=${analysis.is_payment_related} amount=${analysis.amount}`);

              let pendingOrders = [];
              if (analysis.is_payment_related) {
                const orders = await db.getOrdersByPhone(from, client.id);
                pendingOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
              }

              const docNote = buildAnalysisNote(analysis, '', pendingOrders, cfg.verification_prompt || '');
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
          await sendWhatsAppMessage(from, 'ලිපිය ලැබුණා, ස්තූතියි! 🙏', client);
        }
        return;
      }

      // ── Text messages ───────────────────────────────────────────────────────
      userMessage = msg.text?.body;
      if (!userMessage) {
        log.warn(`[WEBHOOK] Unsupported message type "${msg.type}" — skipping`);
        return;
      }

      // Global AI kill switch — if disabled for this client, send fallback message
      if (client.ai_enabled === false) {
        await db.upsertCustomer(from, null, client.id);
        await db.insertMessage(from, userMessage, 'user', null, client.id);
        const disabledMsg = client.contact_number
          ? `Our assistant is currently unavailable. Please contact us directly at ${client.contact_number} 🙏`
          : `Our assistant is currently unavailable. We'll get back to you shortly 🙏`;
        await sendWhatsAppMessage(from, disabledMsg, client);
        await db.insertMessage(from, disabledMsg, 'bot', null, client.id);
        log.info(`[WEBHOOK] AI disabled — fallback sent`);
        return;
      }

      // Check per-chat AI mode — if disabled, store message and skip Gemini
      const aiEnabled = await db.getCustomerAiEnabled(from, client.id);
      if (!aiEnabled) {
        await db.upsertCustomer(from, null, client.id);
        await db.insertMessage(from, userMessage, 'user', null, client.id);
        log.info(`[WEBHOOK] AI disabled for this chat — message stored, no reply sent`);
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
          await db.insertMessage(from, userMessage, 'user', null, client.id);
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
      } else if (!botReply.trim()) {
        log.warn(`[WEBHOOK] Empty botReply from Gemini — skipping send`);
      } else {
        await sendBotReply(from, botReply, client);
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
        await sendWhatsAppImage(from, filename, caption, client);
        const isPdf = filename.toLowerCase().endsWith('.pdf');
        await db.insertMessage(from, isPdf ? `[PDF: ${filename}]` : `[Image: ${filename}]`, 'bot', null, client?.id ?? null, isPdf ? 'pdf' : 'image', `/templates/${encodeURIComponent(filename)}`);
      }

      // Send product images / PDFs from RAG search or send_image tool
      for (const { url, caption } of (productImagesToSend || [])) {
        const isPdf = /\.pdf(\?|$)/i.test(url);
        const waBody = isPdf
          ? { messaging_product: 'whatsapp', to: from, type: 'document', document: { link: url, filename: caption || 'document.pdf', caption } }
          : { messaging_product: 'whatsapp', to: from, type: 'image',    image:    { link: url, caption } };
        try {
          await axios.post(
            `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
            waBody,
            { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
          );
          await db.insertMessage(from, isPdf ? `[PDF: ${caption}]` : `[Image: ${caption}]`, 'bot', null, client?.id ?? null, isPdf ? 'pdf' : 'image', url);
          log.info(`[WA-MEDIA] Sent ${isPdf ? 'PDF' : 'image'}: ${caption}`);
        } catch (e) {
          log.warn(`[WA-MEDIA] Failed to send "${caption}":`, e?.response?.data ?? e.message);
        }
      }
    } catch (err) {
      log.error(`[WEBHOOK] ERROR:`, err?.response?.data ?? err.message);
      if (from && client && userMessage) {
        try {
          const apology = client.error_message ||
            "We're experiencing a short technical issue. We'll get back to you in a few minutes - sorry for the inconvenience! 🙏";
          await sendWhatsAppMessage(from, apology, client);
        } catch (_) {}
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
