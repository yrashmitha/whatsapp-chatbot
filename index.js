require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path    = require('path');
const fs      = require('fs');
const buildSystemInstruction = require('./buildInstruction');
const db           = require('./db');
const clientRouter = require('./clientRouter');
const { embedText, productToText } = require('./embedder');

// ─── WhatsApp credentials (test vs prod) ─────────────────────────────────────
const IS_TEST = (process.env.WHATSAPP_MODE || 'test') !== 'prod';
const META_ACCESS_TOKEN = IS_TEST ? process.env.TEST_META_ACCESS_TOKEN : process.env.PROD_META_ACCESS_TOKEN;
const PHONE_NUMBER_ID   = IS_TEST ? process.env.TEST_PHONE_NUMBER_ID   : process.env.PROD_PHONE_NUMBER_ID;
console.log(`[STARTUP] WhatsApp mode: ${IS_TEST ? 'TEST' : 'PROD'} | Phone Number ID: ${PHONE_NUMBER_ID}`);
console.log(`[STARTUP] META_ACCESS_TOKEN set: ${!!META_ACCESS_TOKEN}`);
console.log(`[STARTUP] GEMINI_API_KEY set: ${!!process.env.GEMINI_API_KEY}`);

// ─── Gemini client ────────────────────────────────────────────────────────────
const systemInstruction = buildSystemInstruction();
console.log(`[STARTUP] System instruction loaded (${systemInstruction.length} chars)`);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash', // මෙතන 2.0 හෝ ඔයා පාවිච්චි කරන version එක දාන්න
  systemInstruction,
  generationConfig: {
    temperature: 0.7,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 1024,
  }
});

// ─── Cost calculation (Gemini 2.5 Flash pricing) ─────────────────────────────
const PRICE_INPUT  = 0.075 / 1_000_000;
const PRICE_OUTPUT = 0.30  / 1_000_000;
function calcCost(i, o) { return i * PRICE_INPUT + o * PRICE_OUTPUT; }

// ─── Order ID generation ──────────────────────────────────────────────────────
const ORDER_MARKER      = '[[ORDER_COMPLETE]]';
const PAYMENT_MARKER    = '[[PAYMENT_CHECK]]';
const HOROSCOPE_MARKER  = '[[HOROSCOPE_RECEIVED]]';

async function generateOrderId(client) {
  const prefix = (client && client.order_id_prefix) || 'PJ';
  const year   = new Date().getFullYear();
  const cnt    = await db.countOrdersByYear(`${prefix}${year}-%`);
  const id     = `${prefix}${year}-${String(cnt + 1).padStart(4, '0')}`;
  console.log(`[ORDER_ID] Generated: ${id} (existing count: ${cnt})`);
  return id;
}

// ─── Order extraction ─────────────────────────────────────────────────────────
async function extractOrderDetails(history) {
  console.log(`[EXTRACT] Extracting order details from ${history.length} history messages`);
  const historyText = history
    .map(m => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.parts.map(p => p.text).join('')}`)
    .join('\n');

  const result = await model.generateContent(
    `From the following conversation, extract the confirmed order details as JSON only (no other text). Use null for any unknown fields.\n\nConversation:\n${historyText}\n\nReturn only this JSON object:\n{"customer_name": null, "package": null, "birth_date": null, "birth_time": null, "birth_city": null, "problems": null}`
  );

  const text  = result.response.text().trim();
  console.log(`[EXTRACT] Gemini raw response: ${text}`);
  const match = text.match(/\{[\s\S]*?\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      console.log(`[EXTRACT] Parsed:`, JSON.stringify(parsed));
      return parsed;
    } catch (e) {
      console.error(`[EXTRACT] JSON parse failed:`, e.message);
      return null;
    }
  }
  console.warn(`[EXTRACT] No JSON found in response`);
  return null;
}

// ─── Session builder ──────────────────────────────────────────────────────────
async function buildChatSession(phoneNumber, client) {
  console.log(`[SESSION] Building session for ${phoneNumber}`);
  const existingOrders = await db.getOrdersByPhone(phoneNumber);
  console.log(`[SESSION] Found ${existingOrders.length} existing orders for ${phoneNumber}`);
  let initialHistory = [];

  if (existingOrders.length > 0) {
    const orderList = existingOrders
      .map(o => `Order ID: ${o.order_id} | Package: ${o.package || '?'} | Status: ${o.status} | horoscope_received: ${!!o.horoscope_received} | receipt_received: ${!!o.receipt_received} | Date: ${String(o.created_at).split('T')[0]}`)
      .join('\n');

    initialHistory = [
      { role: 'user',  parts: [{ text: `[SYSTEM NOTE — not from customer]: This customer already has the following orders:\n${orderList}\nIf they ask about an order, refer to this list. If they are placing a new order, proceed normally.` }] },
      { role: 'model', parts: [{ text: "[Noted. I have the customer's order history and document submission status on file.]" }] },
    ];
    console.log(`[SESSION] Injected order history into initial context`);
  }

  // Use per-client model if the client has a custom prompt or different model
  let chatModel = model;
  if (client && (client.system_prompt_mode === 'custom' || client.ai_model !== 'gemini-2.5-flash')) {
    const instruction = buildSystemInstruction.forClient(client);
    chatModel = genAI.getGenerativeModel({
      model: client.ai_model || 'gemini-2.5-flash',
      systemInstruction: instruction,
      generationConfig: {
        temperature: parseFloat(client.temperature) || 0.7,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 1024,
      },
    });
    console.log(`[SESSION] Using custom model for client ${client.id} (mode=${client.system_prompt_mode})`);
  }

  // Build search_products tool for product-enabled clients (pgvector only)
  let tools = [];
  if (client?.product_catalog_enabled && db.IS_PG) {
    const attrSchema = await db.getAttributeSchema(client.id);
    const attrHint = attrSchema.length > 0
      ? ' Available product attributes for this client: ' +
        attrSchema.map(a => `${a.field_label}(${a.field_type}${a.unit ? ', unit:' + a.unit : ''})`).join(', ') + '.'
      : '';
    tools = [{
      functionDeclarations: [{
        name: 'search_products',
        description: 'Search the product catalog. Call this when a customer asks about products, availability, price, or features.' + attrHint,
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search query, e.g. "red cotton shirt size L under 2000 LKR"' }
          },
          required: ['query']
        }
      }]
    }];
    console.log(`[SESSION] Product search tool enabled for client ${client.id} (${attrSchema.length} attr fields)`);
  }

  return chatModel.startChat({ history: initialHistory, tools });
}

async function buildOrderStatusNote(phoneNumber) {
  const order = await db.getLatestOrder(phoneNumber);
  if (!order) return null;
  return `[ORDER STATUS — ${order.order_id}: horoscope_received=${!!order.horoscope_received}, receipt_received=${!!order.receipt_received}, status=${order.status}]`;
}

// ─── Handle incoming message ──────────────────────────────────────────────────
async function handleMessage(phoneNumber, userMessage, chatSession, { skipUserInsert = false, client = null } = {}) {
  console.log(`[MSG] Handling message from ${phoneNumber}: "${userMessage.substring(0, 80)}"`);

  await db.upsertCustomer(phoneNumber, null);
  if (!skipUserInsert) {
    await db.insertMessage(phoneNumber, userMessage, 'user');
    console.log(`[DB] Saved user message for ${phoneNumber}`);
  }

  // Inject current order status so AI knows what documents are already received
  const statusNote = await buildOrderStatusNote(phoneNumber);
  const messageToSend = statusNote ? `${statusNote}\n\n${userMessage}` : userMessage;

  console.log(`[GEMINI] Sending message to Gemini...`);
  let result    = await chatSession.sendMessage(messageToSend);
  let candidate = result.response;

  // ── Function calling loop (product search via pgvector) ──────────────────
  let fcLoopCount = 0;
  while (candidate.functionCalls()?.length > 0 && fcLoopCount++ < 3) {
    const fc = candidate.functionCalls()[0];
    if (fc.name === 'search_products' && client?.product_catalog_enabled && db.IS_PG) {
      console.log(`[RAG] search_products called with query: "${fc.args.query}"`);
      let resultText = 'No matching products found.';
      try {
        const emb      = await embedText(fc.args.query);
        const limit    = client.max_products_in_context || 5;
        const products = await db.vectorSearchProducts(client.id, emb, limit);
        if (products.length > 0) {
          resultText = products.map(p => {
            const price = p.price_max ? `${p.price}–${p.price_max}` : (p.price || '?');
            const attrs = p.attributes && typeof p.attributes === 'object' && Object.keys(p.attributes).length > 0
              ? ' | ' + Object.entries(p.attributes).map(([k, v]) => `${k}: ${v}`).join(', ')
              : '';
            return `• ${p.name}${p.sku ? ` (${p.sku})` : ''} | ${p.currency} ${price}${p.category ? ` | ${p.category}` : ''}${attrs}${p.description ? ` — ${p.description}` : ''}`;
          }).join('\n');
          console.log(`[RAG] Returning ${products.length} products to Gemini`);
        }
      } catch (e) {
        console.warn('[RAG] vector search failed:', e.message);
      }
      result    = await chatSession.sendMessage([{ functionResponse: { name: 'search_products', response: { result: resultText } } }]);
      candidate = result.response;
    } else {
      break;
    }
  }

  let botReply  = candidate.text()
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*') // convert markdown **bold** → WhatsApp *bold*
    .replace(/\[ORDER STATUS[^\]]*\]\s*/gi, '') // strip any echoed ORDER STATUS note wherever it appears
    .trim();

  // Extract [[SEND_IMAGE:filename]] markers
  const IMAGE_RE = /\[\[SEND_IMAGE:([^\]]+)\]\]/g;
  const imagesToSend = [];
  let m;
  while ((m = IMAGE_RE.exec(botReply)) !== null) imagesToSend.push(m[1].trim());
  if (imagesToSend.length > 0) {
    botReply = botReply.replace(/\[\[SEND_IMAGE:[^\]]+\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    console.log(`[MSG] Image markers found: ${imagesToSend.join(', ')}`);
  }

  const usage        = result.response.usageMetadata || {};
  console.log(`[GEMINI] usageMetadata raw:`, JSON.stringify(usage));
  const inputTokens  = usage.promptTokenCount     || usage.inputTokenCount  || 0;
  const outputTokens = usage.candidatesTokenCount || usage.outputTokenCount || 0;
  const callCostUSD  = calcCost(inputTokens, outputTokens);
  console.log(`[GEMINI] Tokens: in=${inputTokens} out=${outputTokens} cost=$${callCostUSD.toFixed(6)}`);
  console.log(`[GEMINI] Reply (first 120 chars): "${botReply.substring(0, 120)}"`);

  let orderId = null;
  if (botReply.includes(ORDER_MARKER)) {
    console.log(`[ORDER] ORDER_COMPLETE marker detected — starting order save`);
    botReply = botReply.replace(ORDER_MARKER, '').trim();

    const history = await chatSession.getHistory();
    const details = await extractOrderDetails(history);

    if (details) {
      orderId = await generateOrderId(client);
      await db.insertOrder(
        orderId, phoneNumber,
        details.package    ?? null,
        details.birth_date ?? null,
        details.birth_time ?? null,
        details.birth_city ?? null,
        details.problems   ?? null
      );
      console.log(`[ORDER] Saved order ${orderId} for ${phoneNumber}`);
      if (details.customer_name) {
        await db.upsertCustomer(phoneNumber, details.customer_name);
        console.log(`[DB] Updated customer name: ${details.customer_name}`);
      }
      botReply += `\n\n✅ *ඔබේ Order ID: ${orderId}*\nමෙය ආරක්ෂිතව සටහන් කර ගන්න. ඕනෑම ප්‍රශ්නයකදී මෙම ID ඉදිරිපත් කළ හැකියි. 🙏`;
    } else {
      console.warn(`[ORDER] ORDER_COMPLETE marker found but extractOrderDetails returned null`);
    }
  }

  if (botReply.includes(HOROSCOPE_MARKER)) {
    botReply = botReply.replace(HOROSCOPE_MARKER, '').replace(/\n{3,}/g, '\n\n').trim();
    try {
      await db.updateOrderFlags(phoneNumber, { horoscope_received: true });
      console.log(`[HOROSCOPE] horoscope_received=true for ${phoneNumber}`);
    } catch (err) {
      console.error(`[HOROSCOPE] Failed to update flag:`, err.message);
    }
  }

  let paymentReceived = false;
  if (botReply.includes(PAYMENT_MARKER)) {
    botReply = botReply.replace(PAYMENT_MARKER, '').replace(/\n{3,}/g, '\n\n').trim();
    try {
      await db.updateLatestOrderStatus(phoneNumber, 'payment_received');
      await db.updateOrderFlags(phoneNumber, { receipt_received: true });
      console.log(`[PAYMENT] Status=payment_received, receipt_received=true for ${phoneNumber}`);
    } catch (err) {
      console.error(`[PAYMENT] Failed to update order:`, err.message);
    }
    paymentReceived = true;
  }

  await db.insertMessage(phoneNumber, botReply, 'bot', callCostUSD);
  console.log(`[DB] Saved bot reply for ${phoneNumber} cost=$${callCostUSD.toFixed(6)}`);
  return { botReply, orderId, paymentReceived, callCostUSD, inputTokens, outputTokens, imagesToSend };
}

// ─── Template image media ID cache (uploaded once at startup) ─────────────────
const TEMPLATES_DIR    = path.join(__dirname, 'public', 'templates');
const templateMediaIds = new Map(); // filename → WhatsApp media_id

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

// ─── WhatsApp send helpers (client-aware) ────────────────────────────────────
function waToken(client)   { return (client && client.waToken)          || META_ACCESS_TOKEN; }
function waPhoneId(client) { return (client && client.phone_number_id)  || PHONE_NUMBER_ID;  }

async function sendWhatsAppImage(to, filename, caption, client) {
  const mediaId = templateMediaIds.get(filename);
  const image   = mediaId
    ? { id: mediaId, caption }
    : { link: `${process.env.PUBLIC_URL || 'https://whatsapp-chatbot-production-038d.up.railway.app'}/templates/${encodeURIComponent(filename)}`, caption };

  console.log(`[WA-IMG] Sending "${filename}" to ${to} via ${mediaId ? 'media_id' : 'link'}`);
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      { messaging_product: 'whatsapp', to, type: 'image', image },
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
    console.log(`[WA-IMG] Image sent successfully to ${to}`);
  } catch (err) {
    console.error(`[WA-IMG] Send failed to ${to}:`, err?.response?.data ?? err.message);
  }
}

async function sendWhatsAppMessage(to, text, client) {
  console.log(`[WA] Sending message to ${to} (${text.length} chars)`);
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
    console.log(`[WA] Message sent successfully to ${to}`);
  } catch (err) {
    console.error(`[WA] Send failed to ${to}:`, err?.response?.data ?? err.message);
    throw err;
  }
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Log every incoming request
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

const chatSessions = new Map();

// POST /chat — Web UI
app.post('/chat', async (req, res) => {
  const userMessage = req.body?.message?.trim();
  const sessionId   = req.body?.sessionId;
  const phoneNumber = req.body?.phoneNumber?.trim() || sessionId;

  console.log(`[/chat] session=${sessionId} phone=${phoneNumber} msg="${userMessage?.substring(0, 60)}"`);

  if (!userMessage) return res.status(400).json({ error: 'No message' });

  if (!chatSessions.has(sessionId)) {
    console.log(`[/chat] New session — building chat for ${phoneNumber}`);
    chatSessions.set(sessionId, {
      chat: await buildChatSession(phoneNumber),
      phoneNumber,
      totalCostUSD:      0,
      totalInputTokens:  0,
      totalOutputTokens: 0,
    });
  }

  const session = chatSessions.get(sessionId);

  try {
    const { botReply, orderId, callCostUSD, inputTokens, outputTokens, imagesToSend } =
      await handleMessage(phoneNumber, userMessage, session.chat);

    session.totalCostUSD      += callCostUSD;
    session.totalInputTokens  += inputTokens;
    session.totalOutputTokens += outputTokens;

    console.log(`[/chat] Response sent | orderId=${orderId} | sessionTotal=$${session.totalCostUSD.toFixed(6)}`);

    const base = process.env.PUBLIC_URL || 'https://whatsapp-chatbot-production-038d.up.railway.app';
    res.json({
      reply: botReply,
      orderId,
      images: imagesToSend.map(f => ({ filename: f, url: `${base}/templates/${f}` })),
      usage: {
        callCostUSD:       +callCostUSD.toFixed(6),
        totalCostUSD:      +session.totalCostUSD.toFixed(6),
        totalInputTokens:  session.totalInputTokens,
        totalOutputTokens: session.totalOutputTokens,
      },
    });
  } catch (err) {
    console.error(`[/chat] ERROR:`, err.message);
    res.status(500).json({ error: 'Gemini error' });
  }
});

// GET /webhook — Meta verification
app.get('/webhook', (req, res) => {
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
});

// POST /webhook — WhatsApp messages
app.post('/webhook', (req, res) => {
  res.sendStatus(200);

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
      let client = await clientRouter.getClientByPhoneNumberId(incomingPhoneNumberId)
        || clientRouter.buildLocalClient();

      // DEV OVERRIDE: set DEV_CLIENT_ID in .env to force a specific client
      if (process.env.DEV_CLIENT_ID) {
        client = (await clientRouter.getClientById(process.env.DEV_CLIENT_ID)) || client;
      }

      const msg  = value.messages[0];
      const from = msg.from;
      let sessionKey = `${client.id}:${from}`;

      console.log(`[WEBHOOK-POST] client=${client.id} msg type=${msg.type} from=${from}`);

      // ── Image messages ──────────────────────────────────────────────────────
      if (msg.type === 'image') {
        const caption = msg.image?.caption?.trim() || '';
        console.log(`[WEBHOOK-POST] Image from ${from} | caption="${caption}"`);

        await db.upsertCustomer(from, null);
        if (chatSessions.has(sessionKey)) {
          const dbMsgs = await db.getMessagesByPhone(from);
          if (dbMsgs.length === 0) chatSessions.delete(sessionKey);
        }
        if (!chatSessions.has(sessionKey)) {
          chatSessions.set(sessionKey, { chat: await buildChatSession(from, client), phoneNumber: from });
        }
        const imgSession = chatSessions.get(sessionKey);

        const imageNote = caption
          ? `[Customer sent a photo with caption: "${caption}". You cannot see the image itself. Respond based on context — if this is likely their horoscope chart, acknowledge it and add [[HOROSCOPE_RECEIVED]]. If it looks like a payment receipt, acknowledge and add [[PAYMENT_CHECK]]. Also add a short note that you cannot view images directly but the team will review it.]`
          : `[Customer sent a photo (no caption). You cannot see the image. Based on the current conversation stage — if a horoscope photo was expected, acknowledge it as the horoscope and add [[HOROSCOPE_RECEIVED]]. If payment was pending and a receipt was expected, acknowledge it as the receipt and add [[PAYMENT_CHECK]]. Add a short note that you cannot view images but the team will review it.]`;

        const mediaId = msg.image?.id || '';
        const userLabel = `[Photo:${mediaId}]${caption ? ` ${caption}` : ''}`;
        await db.insertMessage(from, userLabel, 'user');

        const { botReply, imagesToSend } = await handleMessage(from, imageNote, imgSession.chat, { skipUserInsert: true, client });
        console.log(`[OUT] ${from}: ${botReply.substring(0, 120)}`);
        await sendWhatsAppMessage(from, botReply, client);

        for (const filename of imagesToSend) {
          const imgCaption = filename.toLowerCase().startsWith('horoscope')
            ? 'ලග්න කොටු 12 සහ නවාංශ කොටු 12 දෙකම පෙනෙන ලෙස photo send කරන්න 🙏'
            : 'මේවා මම ඉක්මනින්ම හොයාගත්ත කීප දෙනෙකුගේ screenshots 🙏';
          await sendWhatsAppImage(from, filename, imgCaption, client);
          await db.insertMessage(from, `[Image: ${filename}]`, 'bot');
        }
        return;
      }

      // ── Text messages ───────────────────────────────────────────────────────
      const userMessage = msg.text?.body;
      if (!userMessage) {
        console.log(`[WEBHOOK-POST] Unsupported message type "${msg.type}" from ${from} — skipping`);
        return;
      }

      console.log(`[IN]  ${from}: ${userMessage}`);

      // Invalidate stale in-memory session if DB was cleared externally
      if (chatSessions.has(sessionKey)) {
        const dbMsgs = await db.getMessagesByPhone(from);
        if (dbMsgs.length === 0) {
          console.log(`[WEBHOOK-POST] DB cleared for ${from} — rebuilding session`);
          chatSessions.delete(sessionKey);
        }
      }
      if (!chatSessions.has(sessionKey)) {
        console.log(`[WEBHOOK-POST] New WhatsApp session for ${client.id}:${from}`);
        chatSessions.set(sessionKey, {
          chat:        await buildChatSession(from, client),
          phoneNumber: from,
        });
      }
      const session = chatSessions.get(sessionKey);

      const { botReply, imagesToSend } = await handleMessage(from, userMessage, session.chat, { client });
      console.log(`[OUT] ${from}: ${botReply.substring(0, 120)}`);
      await sendWhatsAppMessage(from, botReply, client);

      for (const filename of imagesToSend) {
        const caption = filename.toLowerCase().startsWith('horoscope')
          ? 'ලග්න කොටු 12 සහ නවාංශ කොටු 12 දෙකම පෙනෙන ලෙස photo send කරන්න 🙏'
          : 'මේවා මම ඉක්මනින්ම හොයාගත්ත කීප දෙනෙකුගේ screenshots 🙏';
        await sendWhatsAppImage(from, filename, caption, client);
        await db.insertMessage(from, `[Image: ${filename}]`, 'bot');
      }
    } catch (err) {
      console.error(`[WEBHOOK-POST] ERROR:`, err?.response?.data ?? err.message);
    }
  })();
});

// ─── Public catalog API ────────────────────────────────────────────────────────
// GET /api/catalog/:clientId — returns client branding + products grouped by category
app.get('/api/catalog/:clientId', async (req, res) => {
  const { clientId } = req.params;
  try {
    const client = await clientRouter.getClientById(clientId);
    if (!client || !client.active) return res.status(404).json({ error: 'Client not found' });

    const [productsRes, schemaRes] = await Promise.all([
      db.pgQuery(
        `SELECT id, name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes
         FROM client_products WHERE client_id = $1 AND active = TRUE ORDER BY category, sort_order, name`,
        [clientId]
      ),
      db.pgQuery(
        `SELECT field_key, field_label, field_type, options, unit FROM client_attribute_schemas
         WHERE client_id = $1 ORDER BY sort_order`,
        [clientId]
      ),
    ]);

    const products   = productsRes.rows || [];
    const attrSchema = schemaRes.rows   || [];

    // Group products by category
    const categories = {};
    for (const p of products) {
      const cat = p.category || 'General';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(p);
    }

    res.json({
      client: {
        id:         client.id,
        name:       client.brand_name || client.name,
        brand_color: client.brand_color || '#075e54',
        logo_url:   client.logo_url || null,
        phone_number_id: client.phone_number_id || null,
      },
      attrSchema,
      categories,
      totalProducts: products.length,
    });
  } catch (err) {
    console.error(`[CATALOG] Error for ${clientId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin auth middleware ─────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  return next(); // TODO: re-enable password check before production deploy
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return res.status(500).json({ error: 'ADMIN_PASSWORD not set' });
  const provided = req.query.pass || (req.headers.authorization || '').replace('Bearer ', '');
  if (provided !== pass) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /admin/templates — list images in public/templates/
app.get('/admin/templates', adminAuth, (_req, res) => {
  if (!fs.existsSync(TEMPLATES_DIR)) return res.json([]);
  const files = fs.readdirSync(TEMPLATES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
    .map(f => ({ name: f, url: `/templates/${f}` }));
  res.json(files);
});

// GET /admin/customers
app.get('/admin/customers', adminAuth, async (req, res) => {
  console.log(`[ADMIN] GET /admin/customers`);
  try {
    const customers = await db.getAllCustomers();
    res.json(customers);
  } catch (err) {
    console.error(`[ADMIN] customers error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/messages/:phone
app.get('/admin/messages/:phone', adminAuth, async (req, res) => {
  const phone = req.params.phone;
  console.log(`[ADMIN] GET /admin/messages/${phone}`);
  try {
    const [messages, orders] = await Promise.all([
      db.getMessagesByPhone(phone),
      db.getOrdersByPhone(phone),
    ]);
    res.json({ messages, orders });
  } catch (err) {
    console.error(`[ADMIN] messages error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/send — human reply (text, image, or PDF document)
app.post('/admin/send', adminAuth, async (req, res) => {
  const { phone, text, imageBase64, imageType, imageUrl, fileName } = req.body;
  console.log(`[ADMIN] POST /admin/send → ${phone} type=${imageUrl ? 'url' : imageBase64 ? 'upload' : 'text'}`);
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    if (imageUrl) {
      // Send template image by public URL — no upload needed
      const publicUrl = `${process.env.PUBLIC_URL || `https://whatsapp-chatbot-production-038d.up.railway.app`}${imageUrl}`;
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        { messaging_product: 'whatsapp', to: phone, type: 'image', image: { link: publicUrl, caption: text || '' } },
        { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      await db.insertMessage(phone, `[Image]${text ? ': ' + text : ''}`, 'bot');
      console.log(`[ADMIN] Template image sent to ${phone}: ${publicUrl}`);
    } else if (imageBase64 && imageType) {
      const isPdf = imageType === 'application/pdf';
      const buffer = Buffer.from(imageBase64, 'base64');
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('type', imageType);
      formData.append('file', new Blob([buffer], { type: imageType }), fileName || (isPdf ? 'document.pdf' : 'image.jpg'));

      const uploadRes = await fetch(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`,
        { method: 'POST', headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }, body: formData }
      );
      const uploadData = await uploadRes.json();
      if (!uploadData.id) throw new Error(`Media upload failed: ${JSON.stringify(uploadData)}`);
      console.log(`[ADMIN] Media uploaded, id=${uploadData.id} isPdf=${isPdf}`);

      if (isPdf) {
        // Send as document
        await axios.post(
          `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
          { messaging_product: 'whatsapp', to: phone, type: 'document', document: { id: uploadData.id, filename: fileName || 'document.pdf', caption: text || '' } },
          { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        await db.insertMessage(phone, `[PDF: ${fileName || 'document.pdf'}]${text ? ' ' + text : ''}`, 'bot');
      } else {
        // Send as image
        await axios.post(
          `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
          { messaging_product: 'whatsapp', to: phone, type: 'image', image: { id: uploadData.id, caption: text || '' } },
          { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        await db.insertMessage(phone, `[Image]${text ? ': ' + text : ''}`, 'bot');
      }
    } else if (text) {
      await sendWhatsAppMessage(phone, text);
      await db.insertMessage(phone, text, 'bot');
    } else {
      return res.status(400).json({ error: 'text or image required' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ADMIN] send error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/customer/:phone — delete customer + all messages + orders (CASCADE)
app.delete('/admin/customer/:phone', adminAuth, async (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  console.log(`[ADMIN] DELETE customer ${phone}`);
  try {
    chatSessions.delete(phone);
    await db.deleteCustomer(phone);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ADMIN] delete customer error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/customer/:phone/messages — delete chat history only
app.delete('/admin/customer/:phone/messages', adminAuth, async (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  console.log(`[ADMIN] DELETE messages for ${phone}`);
  try {
    chatSessions.delete(phone);
    await db.deleteMessages(phone);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ADMIN] delete messages error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /admin/order/:orderId/flags — toggle horoscope_received / receipt_received
app.patch('/admin/order/:orderId/flags', adminAuth, async (req, res) => {
  const { orderId } = req.params;
  const { horoscope_received, receipt_received } = req.body;
  console.log(`[ADMIN] PATCH /admin/order/${orderId}/flags`, req.body);
  try {
    await db.updateOrderFlagsById(orderId, { horoscope_received, receipt_received });
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ADMIN] flags update error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /admin/order/:orderId/status
app.patch('/admin/order/:orderId/status', adminAuth, async (req, res) => {
  const { orderId } = req.params;
  const { status }  = req.body;
  const allowed = ['pending', 'payment_received', 'paid', 'complete', 'cancelled'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }
  console.log(`[ADMIN] PATCH /admin/order/${orderId}/status → ${status}`);
  try {
    await db.updateOrderStatusById(orderId, status);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ADMIN] order status update error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/media/:mediaId — proxy WhatsApp media (fetches fresh URL on demand)
app.get('/admin/media/:mediaId', adminAuth, async (req, res) => {
  const { mediaId } = req.params;
  try {
    // Step 1: get the temporary media URL from WhatsApp
    const metaRes = await axios.get(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } }
    );
    const mediaUrl = metaRes.data.url;
    if (!mediaUrl) return res.status(404).json({ error: 'media URL not found' });

    // Step 2: fetch the binary and stream it back
    const imgRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
      responseType: 'stream',
    });
    res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    imgRes.data.pipe(res);
  } catch (err) {
    console.error(`[ADMIN] media proxy error for ${mediaId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/followup — AI-generated follow-up for leads
app.post('/admin/followup', adminAuth, async (req, res) => {
  const { phone } = req.body;
  console.log(`[ADMIN] POST /admin/followup → ${phone}`);
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    const messages = await db.getMessagesByPhone(phone);
    const historyText = messages
      .map(m => `${m.sender_type === 'user' ? 'Customer' : 'Assistant'}: ${m.message_text}`)
      .join('\n');

    const result = await model.generateContent(
      `You are a warm assistant for a professional astrology service. Below is a conversation with a potential customer who has NOT placed an order yet.\n\nConversation:\n${historyText}\n\nWrite a single short, warm, natural follow-up WhatsApp message to re-engage this customer. Use the same language they were using. Be genuine — not pushy. Do not list packages or prices unless they previously asked. Just warmly re-open the conversation.`
    );
    const followupText = result.response.text().trim();
    const usage = result.response.usageMetadata || {};
    const cost  = calcCost(usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    console.log(`[ADMIN] Follow-up generated for ${phone}: "${followupText.substring(0, 80)}" cost=$${cost.toFixed(6)}`);
    res.json({ ok: true, message: followupText, costUSD: +cost.toFixed(6) });
  } catch (err) {
    console.error(`[ADMIN] followup error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Product management API ───────────────────────────────────────────────────

// GET /admin/builtin-prompt — returns the fully-rendered built-in astrology prompt
app.get('/admin/builtin-prompt', adminAuth, (_req, res) => {
  try {
    const text = buildSystemInstruction();
    res.type('text/plain').send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/clients — list all clients
app.get('/admin/clients', adminAuth, async (_req, res) => {
  try {
    const clients = await clientRouter.getAllClients();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/clients/:clientId — get single client + config
app.get('/admin/clients/:clientId', adminAuth, async (req, res) => {
  try {
    const client = await clientRouter.getClientById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/clients — create new client + config
app.post('/admin/clients', adminAuth, async (req, res) => {
  const { id, name, type, phone_number_id, wa_token_env, ai_model, system_prompt_mode,
          custom_prompt, temperature, brand_name, brand_color, logo_url,
          order_id_prefix, product_catalog_enabled, order_flow_enabled, admin_password_env } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  try {
    await db.pgQuery(`INSERT INTO clients (id, name, type) VALUES ($1, $2, $3)`,
      [id, name, type || 'general']);
    await db.pgQuery(`
      INSERT INTO client_configs (client_id, phone_number_id, wa_token_env, ai_model,
        system_prompt_mode, custom_prompt, temperature, brand_name, brand_color, logo_url,
        order_id_prefix, product_catalog_enabled, order_flow_enabled, admin_password_env)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, phone_number_id || null, wa_token_env || null, ai_model || 'gemini-2.5-flash',
       system_prompt_mode || 'custom', custom_prompt || null,
       parseFloat(temperature) || 0.70, brand_name || name, brand_color || '#075e54',
       logo_url || null, order_id_prefix || id.toUpperCase().slice(0,6),
       product_catalog_enabled === true || product_catalog_enabled === 'true',
       order_flow_enabled !== false && order_flow_enabled !== 'false',
       admin_password_env || 'ADMIN_PASSWORD']);
    clientRouter.invalidateCache(id);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/clients/:clientId — update client config
app.put('/admin/clients/:clientId', adminAuth, async (req, res) => {
  const { clientId } = req.params;
  const { name, type, active, phone_number_id, wa_token_env, ai_model, system_prompt_mode,
          custom_prompt, temperature, brand_name, brand_color, logo_url,
          order_id_prefix, product_catalog_enabled, order_flow_enabled, admin_password_env } = req.body;
  try {
    if (name || type || active !== undefined) {
      await db.pgQuery(
        `UPDATE clients SET name=COALESCE($1,name), type=COALESCE($2,type), active=COALESCE($3,active) WHERE id=$4`,
        [name || null, type || null, active !== undefined ? active : null, clientId]
      );
    }
    await db.pgQuery(`
      UPDATE client_configs SET
        phone_number_id=$1, wa_token_env=$2, ai_model=$3, system_prompt_mode=$4,
        custom_prompt=$5, temperature=$6, brand_name=$7, brand_color=$8, logo_url=$9,
        order_id_prefix=$10, product_catalog_enabled=$11, order_flow_enabled=$12,
        admin_password_env=$13, updated_at=NOW()
      WHERE client_id=$14`,
      [phone_number_id || null, wa_token_env || null, ai_model || 'gemini-2.5-flash',
       system_prompt_mode || 'custom', custom_prompt || null,
       parseFloat(temperature) || 0.70, brand_name || null, brand_color || '#075e54',
       logo_url || null, order_id_prefix || null,
       product_catalog_enabled === true || product_catalog_enabled === 'true',
       order_flow_enabled !== false && order_flow_enabled !== 'false',
       admin_password_env || 'ADMIN_PASSWORD', clientId]);
    clientRouter.invalidateCache(clientId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/products?client_id=CLIENT_ID
app.get('/admin/products', adminAuth, async (req, res) => {
  const clientId = req.query.client_id || req.query.client;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const result = await db.pgQuery(
      `SELECT * FROM client_products WHERE client_id = $1 ORDER BY category, sort_order, name`,
      [clientId]
    );
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/products — create product
app.post('/admin/products', adminAuth, async (req, res) => {
  const { client_id, name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes } = req.body;
  if (!client_id || !name) return res.status(400).json({ error: 'client_id and name required' });
  try {
    const result = await db.pgQuery(
      `INSERT INTO client_products (client_id, name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [client_id, name, description || null, price || null, price_max || null,
       currency || 'LKR', category || null, subcategory || null, sku || null,
       image_url || null, sort_order || 0, JSON.stringify(attributes || {})]
    );
    const newId = result.rows[0].id;
    // Generate and save embedding asynchronously
    if (db.IS_PG) {
      embedText(productToText(req.body)).then(emb => db.saveProductEmbedding(newId, emb))
        .catch(e => console.warn('[EMBED] POST product:', e.message));
    }
    res.json({ ok: true, id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/products/:id — update product
app.put('/admin/products/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes, active } = req.body;
  try {
    await db.pgQuery(
      `UPDATE client_products SET name=$1, description=$2, price=$3, price_max=$4, currency=$5,
       category=$6, subcategory=$7, sku=$8, image_url=$9, sort_order=$10,
       attributes=$11, active=$12, updated_at=NOW() WHERE id=$13`,
      [name, description || null, price || null, price_max || null,
       currency || 'LKR', category || null, subcategory || null, sku || null,
       image_url || null, sort_order || 0, JSON.stringify(attributes || {}),
       active !== false, id]
    );
    // Re-embed on update
    if (db.IS_PG) {
      embedText(productToText(req.body)).then(emb => db.saveProductEmbedding(id, emb))
        .catch(e => console.warn('[EMBED] PUT product:', e.message));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/products/:id
app.delete('/admin/products/:id', adminAuth, async (req, res) => {
  try {
    await db.pgQuery(`DELETE FROM client_products WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/attributes?client=CLIENT_ID
app.get('/admin/attributes', adminAuth, async (req, res) => {
  const clientId = req.query.client || 'astrology_001';
  try {
    const result = await db.pgQuery(
      `SELECT * FROM client_attribute_schemas WHERE client_id = $1 ORDER BY sort_order`,
      [clientId]
    );
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/attributes — create attribute schema field
app.post('/admin/attributes', adminAuth, async (req, res) => {
  const { client_id, field_key, field_label, field_type, options, unit, filterable, sort_order } = req.body;
  if (!client_id || !field_key || !field_label) return res.status(400).json({ error: 'client_id, field_key, field_label required' });
  try {
    await db.pgQuery(
      `INSERT INTO client_attribute_schemas (client_id, field_key, field_label, field_type, options, unit, filterable, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id, field_key) DO UPDATE SET
         field_label=$3, field_type=$4, options=$5, unit=$6, filterable=$7, sort_order=$8`,
      [client_id, field_key, field_label, field_type || 'text',
       options ? JSON.stringify(options) : null, unit || null,
       filterable !== false, sort_order || 0]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/attributes/:id
app.delete('/admin/attributes/:id', adminAuth, async (req, res) => {
  try {
    await db.pgQuery(`DELETE FROM client_attribute_schemas WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/attributes/bulk — upsert full attribute schema from JSON array
app.post('/admin/attributes/bulk', adminAuth, async (req, res) => {
  const { client_id, attributes } = req.body;
  if (!client_id || !Array.isArray(attributes)) return res.status(400).json({ error: 'client_id and attributes[] required' });
  const errors = [];
  for (let i = 0; i < attributes.length; i++) {
    const a = attributes[i];
    if (!a.field_key || !a.field_label) { errors.push(`Item ${i}: field_key and field_label required`); continue; }
    try {
      await db.pgQuery(
        `INSERT INTO client_attribute_schemas (client_id, field_key, field_label, field_type, options, unit, filterable, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (client_id, field_key) DO UPDATE SET
           field_label=$3, field_type=$4, options=$5, unit=$6, filterable=$7, sort_order=$8`,
        [client_id, a.field_key, a.field_label, a.field_type || 'text',
         a.options ? JSON.stringify(a.options) : null, a.unit || null,
         a.filterable !== false, a.sort_order || i]
      );
    } catch (e) { errors.push(`Item ${i} (${a.field_key}): ${e.message}`); }
  }
  res.json({ ok: true, saved: attributes.length - errors.length, errors });
});

// POST /admin/products/bulk — import JSON array of products
app.post('/admin/products/bulk', adminAuth, async (req, res) => {
  const { client_id, products } = req.body;
  if (!client_id || !Array.isArray(products)) return res.status(400).json({ error: 'client_id and products[] required' });
  // Load attribute schema for validation
  let schema = [];
  try {
    const r = await db.pgQuery(`SELECT field_key, field_type FROM client_attribute_schemas WHERE client_id=$1`, [client_id]);
    schema = r.rows;
  } catch (_) {}
  const validKeys = new Set(schema.map(s => s.field_key));

  const saved = [], errors = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p.name) { errors.push(`Row ${i+1}: name is required`); continue; }
    // Validate attributes against schema
    if (p.attributes && validKeys.size > 0) {
      const unknown = Object.keys(p.attributes).filter(k => !validKeys.has(k));
      if (unknown.length) { errors.push(`Row ${i+1} (${p.name}): unknown attribute keys: ${unknown.join(', ')}`); continue; }
    }
    try {
      const r = await db.pgQuery(
        `INSERT INTO client_products (client_id,name,description,price,price_max,currency,category,subcategory,sku,image_url,sort_order,attributes,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [client_id, p.name, p.description||null, p.price||null, p.price_max||null, p.currency||'LKR',
         p.category||null, p.subcategory||null, p.sku||null, p.image_url||null, p.sort_order||i,
         p.attributes ? JSON.stringify(p.attributes) : null, p.active !== false]
      );
      saved.push(r.rows[0].id);
    } catch (e) { errors.push(`Row ${i+1} (${p.name}): ${e.message}`); }
  }
  res.json({ ok: true, saved: saved.length, errors });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// Start listening immediately so Railway health check passes
app.listen(PORT, () => {
  console.log(`[STARTUP] Server running on port ${PORT}`);
  console.log(`[STARTUP] Database: ${db.IS_PG ? 'PostgreSQL' : 'SQLite (local)'}`);
});

// Init DB in background, then upload template images
db.init().then(async () => {
  console.log(`[DB] Initialized successfully`);
  await uploadTemplateImages();
  // Auto-embed any products missing embeddings (non-blocking)
  if (db.IS_PG) {
    const { embedText, productToText } = require('./embedder');
    db.pgQuery(`SELECT id, name, description, category, subcategory, sku, attributes FROM client_products WHERE active = TRUE AND embedding IS NULL`)
      .then(async ({ rows }) => {
        if (!rows.length) return;
        console.log(`[EMBED] Backfilling ${rows.length} products...`);
        for (const p of rows) {
          try {
            const emb = await embedText(productToText(p));
            await db.saveProductEmbedding(p.id, emb);
            console.log(`[EMBED] ✓ ${p.name}`);
          } catch (e) { console.warn(`[EMBED] failed ${p.id}: ${e.message}`); }
        }
        console.log('[EMBED] Backfill done.');
      })
      .catch(e => console.warn('[EMBED] Backfill error:', e.message));
  }
}).catch(err => {
  console.error(`[STARTUP] DB init FAILED:`, err.message || err);
  console.error(`[STARTUP] Full error:`, JSON.stringify(err, Object.getOwnPropertyNames(err)));
  process.exit(1);
});
