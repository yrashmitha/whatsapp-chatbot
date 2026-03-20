/**
 * @module controllers/webhook.controller
 * @description Handlers for the WhatsApp webhook routes
 * (GET verification, POST message processing).
 */

'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const db     = require('../db');
const clientRouter = require('../services/clientRouter');
const { buildChatSession, handleMessage } = require('../services/gemini');
const { sendWhatsAppMessage, sendWhatsAppImage, sendBotReply, waToken, waPhoneId, markMessageRead } = require('../services/whatsapp');
const { chatSessions } = require('../workers/sessionManager');
const { UPLOADS_DIR } = require('../config/env');
const { analyzePaymentDocument, buildAnalysisNote } = require('../services/imageAnalysis');

/**
 * GET /webhook — Meta webhook verification challenge.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {void}
 */
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
  res.sendStatus(200);

  // Declare outside try so catch block can reference them for error recovery
  let from = null, client = null, userMessage = null;

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
      from = msg.from;
      let sessionKey = `${client.id}:${from}`;

      // Mark message as read immediately (blue ticks) — expected by Meta
      markMessageRead(msg.id, client).catch(() => {});

      console.log(`[WEBHOOK-POST] client=${client.id} msg type=${msg.type} from=${from}`);

      // ── Image messages ──────────────────────────────────────────────────────
      if (msg.type === 'image') {
        const caption = msg.image?.caption?.trim() || '';
        console.log(`[WEBHOOK-POST] Image from ${from} | caption="${caption}"`);

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
              console.log(`[IMAGE-ANALYZER] Analyzing image for client=${client.id}`);
              const cfg = await db.getPluginConfig(client.id, 'image_analyzer');
              const analysis = await analyzePaymentDocument(imgBuffer, imgMimeType, cfg.api_key || null);
              console.log(`[IMAGE-ANALYZER] Result: type=${analysis.document_type} payment=${analysis.is_payment_related} amount=${analysis.amount}`);

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

        const { botReply, imagesToSend, productImagesToSend: imgProductImages } = await handleMessage(from, imageNote, imgSession.chat, { skipUserInsert: true, client });
        if (botReply.trim()) await sendBotReply(from, botReply, client);

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
              console.log(`[IMAGE-ANALYZER] Analyzing PDF for client=${client.id}`);
              // Build a session if needed (mirrors image path)
              if (!chatSessions.has(sessionKey)) {
                chatSessions.set(sessionKey, { chat: await buildChatSession(from, client), phoneNumber: from });
              }
              const docSession = chatSessions.get(sessionKey);
              docSession.lastUsed = Date.now();

              const cfg = await db.getPluginConfig(client.id, 'image_analyzer');
              const analysis = await analyzePaymentDocument(docBuffer, docMimeType, cfg.api_key || null);
              console.log(`[IMAGE-ANALYZER] PDF result: type=${analysis.document_type} payment=${analysis.is_payment_related} amount=${analysis.amount}`);

              let pendingOrders = [];
              if (analysis.is_payment_related) {
                const orders = await db.getOrdersByPhone(from, client.id);
                pendingOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
              }

              const docNote = buildAnalysisNote(analysis, '', pendingOrders, cfg.verification_prompt || '');
              const { botReply: docReply, imagesToSend: docImages, productImagesToSend: docProductImages } = await handleMessage(from, docNote, docSession.chat, { skipUserInsert: true, client });
              if (docReply.trim()) await sendBotReply(from, docReply, client);
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
        console.log(`[WEBHOOK-POST] Unsupported message type "${msg.type}" from ${from} — skipping`);
        return;
      }

      // Global AI kill switch — if disabled for this client, store message and skip Gemini
      if (client.ai_enabled === false) {
        await db.upsertCustomer(from, null, client.id);
        await db.insertMessage(from, userMessage, 'user', null, client.id);
        console.log(`[WEBHOOK] AI globally disabled for client ${client.id} — message stored, no reply sent`);
        return;
      }

      // Check per-chat AI mode — if disabled, store message and skip Gemini
      const aiEnabled = await db.getCustomerAiEnabled(from, client.id);
      if (!aiEnabled) {
        await db.upsertCustomer(from, null, client.id);
        await db.insertMessage(from, userMessage, 'user', null, client.id);
        console.log(`[webhook] AI disabled for ${client.id}:${from} — message stored, no reply sent`);
        return;
      }

      // Invalidate stale in-memory session if DB was cleared externally
      if (chatSessions.has(sessionKey)) {
        const dbMsgs = await db.getMessagesByPhone(from, client?.id);
        if (dbMsgs.length === 0) {
          console.log(`[WEBHOOK-POST] DB cleared for ${from} — rebuilding session`);
          chatSessions.delete(sessionKey);
        }
      }
      const settingsFingerprint = `${client.ai_model}|${client.knowledge_base_enabled}|${client.product_catalog_enabled}`;

      const existingSession = chatSessions.get(sessionKey);
      if (!existingSession || existingSession.settingsFingerprint !== settingsFingerprint) {
        if (existingSession) console.log(`[WEBHOOK-POST] Settings changed — rebuilding session for ${client.id}:${from}`);
        else console.log(`[WEBHOOK-POST] New WhatsApp session for ${client.id}:${from}`);
        chatSessions.set(sessionKey, {
          chat:                await buildChatSession(from, client),
          phoneNumber:         from,
          settingsFingerprint,
        });
      }
      const session = chatSessions.get(sessionKey);
      session.lastUsed = Date.now();

      const { botReply, imagesToSend, productImagesToSend } = await handleMessage(from, userMessage, session.chat, { client });
      if (!botReply.trim()) {
        console.warn(`[WEBHOOK-POST] Empty botReply from Gemini for ${from} — skipping send`);
      } else {
        // Small human-like delay before replying (avoids instant 0ms bot pattern)
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
        await sendBotReply(from, botReply, client);
      }

      for (const filename of imagesToSend) {
        const caption = filename.toLowerCase().startsWith('horoscope')
          ? 'ලග්න කොටු 12 සහ නවාංශ කොටු 12 දෙකම පෙනෙන ලෙස photo send කරන්න 🙏'
          : 'මේවා මම ඉක්මනින්ම හොයාගත්ත කීප දෙනෙකුගේ screenshots 🙏';
        await sendWhatsAppImage(from, filename, caption, client);
        const isPdf = filename.toLowerCase().endsWith('.pdf');
        await db.insertMessage(from, isPdf ? `[PDF: ${filename}]` : `[Image: ${filename}]`, 'bot', null, client?.id ?? null, isPdf ? 'pdf' : 'image', `/templates/${encodeURIComponent(filename)}`);
      }

      // Send product images from RAG search
      for (const { url, caption } of (productImagesToSend || [])) {
        try {
          await axios.post(
            `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
            { messaging_product: 'whatsapp', to: from, type: 'image', image: { link: url, caption } },
            { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
          );
          await db.insertMessage(from, `[Image: ${caption}]`, 'bot', null, client?.id ?? null, 'image', url);
          console.log(`[WA-IMG] Product image sent: ${caption}`);
        } catch (e) {
          console.warn(`[WA-IMG] Failed to send product image "${caption}":`, e?.response?.data ?? e.message);
        }
      }
    } catch (err) {
      console.error(`[WEBHOOK-POST] ERROR:`, err?.response?.data ?? err.message);
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
