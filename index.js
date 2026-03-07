require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path    = require('path');
const fs      = require('fs');
const buildSystemInstruction = require('./buildInstruction');
const db      = require('./db');

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
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction });

// ─── Cost calculation (Gemini 2.5 Flash pricing) ─────────────────────────────
const PRICE_INPUT  = 0.075 / 1_000_000;
const PRICE_OUTPUT = 0.30  / 1_000_000;
function calcCost(i, o) { return i * PRICE_INPUT + o * PRICE_OUTPUT; }

// ─── Order ID generation ──────────────────────────────────────────────────────
const ORDER_MARKER   = '[[ORDER_COMPLETE]]';
const PAYMENT_MARKER = '[[PAYMENT_CHECK]]';

async function generateOrderId() {
  const year = new Date().getFullYear();
  const cnt  = await db.countOrdersByYear(`PJ${year}-%`);
  const id   = `PJ${year}-${String(cnt + 1).padStart(4, '0')}`;
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
async function buildChatSession(phoneNumber) {
  console.log(`[SESSION] Building session for ${phoneNumber}`);
  const existingOrders = await db.getOrdersByPhone(phoneNumber);
  console.log(`[SESSION] Found ${existingOrders.length} existing orders for ${phoneNumber}`);
  let initialHistory = [];

  if (existingOrders.length > 0) {
    const orderList = existingOrders
      .map(o => `Order ID: ${o.order_id} | Package: ${o.package || '?'} | Status: ${o.status} | Date: ${String(o.created_at).split('T')[0]}`)
      .join('\n');

    initialHistory = [
      { role: 'user',  parts: [{ text: `[SYSTEM NOTE — not from customer]: This customer already has the following orders:\n${orderList}\nIf they ask about an order, refer to this list. If they are placing a new order, proceed normally.` }] },
      { role: 'model', parts: [{ text: "[Noted. I have the customer's order history on file.]" }] },
    ];
    console.log(`[SESSION] Injected order history into initial context`);
  }

  return model.startChat({ history: initialHistory });
}

// ─── Handle incoming message ──────────────────────────────────────────────────
async function handleMessage(phoneNumber, userMessage, chatSession) {
  console.log(`[MSG] Handling message from ${phoneNumber}: "${userMessage.substring(0, 80)}"`);

  await db.upsertCustomer(phoneNumber, null);
  await db.insertMessage(phoneNumber, userMessage, 'user');
  console.log(`[DB] Saved user message for ${phoneNumber}`);

  console.log(`[GEMINI] Sending message to Gemini...`);
  const result  = await chatSession.sendMessage(userMessage);
  let botReply  = result.response.text()
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*'); // convert markdown **bold** → WhatsApp *bold*

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
  const inputTokens  = usage.promptTokenCount     || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
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
      orderId = await generateOrderId();
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

  let paymentReceived = false;
  if (botReply.includes(PAYMENT_MARKER)) {
    botReply = botReply.replace(PAYMENT_MARKER, '').replace(/\n{3,}/g, '\n\n').trim();
    try {
      await db.updateLatestOrderStatus(phoneNumber, 'payment_received');
      console.log(`[PAYMENT] Status updated to payment_received for ${phoneNumber}`);
    } catch (err) {
      console.error(`[PAYMENT] Failed to update order status:`, err.message);
    }
    paymentReceived = true;
  }

  await db.insertMessage(phoneNumber, botReply, 'bot');
  console.log(`[DB] Saved bot reply for ${phoneNumber}`);
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

// ─── WhatsApp image send helper ───────────────────────────────────────────────
async function sendWhatsAppImage(to, filename, caption) {
  const mediaId = templateMediaIds.get(filename);
  const image   = mediaId
    ? { id: mediaId, caption }
    : { link: `${process.env.PUBLIC_URL || 'https://whatsapp-chatbot-production-038d.up.railway.app'}/templates/${encodeURIComponent(filename)}`, caption };

  console.log(`[WA-IMG] Sending "${filename}" to ${to} via ${mediaId ? 'media_id' : 'link'}`);
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to, type: 'image', image },
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log(`[WA-IMG] Image sent successfully to ${to}`);
  } catch (err) {
    console.error(`[WA-IMG] Send failed to ${to}:`, err?.response?.data ?? err.message);
  }
}

// ─── WhatsApp send helper ─────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  console.log(`[WA] Sending message to ${to} (${text.length} chars)`);
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log(`[WA] Message sent successfully to ${to}`);
  } catch (err) {
    console.error(`[WA] Send failed to ${to}:`, err?.response?.data ?? err.message);
    throw err;
  }
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
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

      const msg  = value.messages[0];
      const from = msg.from;

      console.log(`[WEBHOOK-POST] msg type=${msg.type} from=${from}`);

      // ── Image messages ──────────────────────────────────────────────────────
      if (msg.type === 'image') {
        const caption = msg.image?.caption?.trim() || '';
        console.log(`[WEBHOOK-POST] Image from ${from} | caption="${caption}"`);

        await db.upsertCustomer(from, null);

        if (!chatSessions.has(from)) {
          chatSessions.set(from, { chat: await buildChatSession(from), phoneNumber: from });
        }
        const imgSession = chatSessions.get(from);

        if (!caption) {
          // Image only — no text to process
          const reply = 'ඔබේ photo ලැබුණා 🙏 mata images / photos directly kiyawanna baha. ape team member ata ata mewa balala oba sambanda karaganawa. 😊';
          await db.insertMessage(from, '[Image]', 'user');
          await db.insertMessage(from, reply, 'bot');
          await sendWhatsAppMessage(from, reply);
        } else {
          // Image with caption — process caption through AI, append image note
          await db.insertMessage(from, `[Image: ${caption}]`, 'user');
          const result  = await imgSession.chat.sendMessage(caption);
          let aiReply   = result.response.text()
            .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
            .replace(/\[\[SEND_IMAGE:[^\]]+\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
          aiReply += '\n\n_(📷 ඔබේ photo ගැන: mata images directly kiyawanna baha. ape team member mewa balala oba sambanda karaganawa 🙏)_';
          await db.insertMessage(from, aiReply, 'bot');
          await sendWhatsAppMessage(from, aiReply);
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

      if (!chatSessions.has(from)) {
        console.log(`[WEBHOOK-POST] New WhatsApp session for ${from}`);
        chatSessions.set(from, {
          chat:        await buildChatSession(from),
          phoneNumber: from,
        });
      }
      const session = chatSessions.get(from);

      const { botReply, imagesToSend } = await handleMessage(from, userMessage, session.chat);
      console.log(`[OUT] ${from}: ${botReply.substring(0, 120)}`);
      await sendWhatsAppMessage(from, botReply);

      for (const filename of imagesToSend) {
        const caption = filename.toLowerCase().startsWith('horoscope')
          ? 'ලග්න කොටු 12 සහ නවාංශ කොටු 12 දෙකම පෙනෙන ලෙස photo send කරන්න 🙏'
          : 'මේවා මම ඉක්මනින්ම හොයාගත්ත කීප දෙනෙකුගේ screenshots 🙏';
        await sendWhatsAppImage(from, filename, caption);
        await db.insertMessage(from, `[Image: ${filename}]`, 'bot');
      }
    } catch (err) {
      console.error(`[WEBHOOK-POST] ERROR:`, err?.response?.data ?? err.message);
    }
  })();
});

// ─── Admin auth middleware ─────────────────────────────────────────────────────
function adminAuth(req, res, next) {
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

// POST /admin/send — human reply (text or image)
app.post('/admin/send', adminAuth, async (req, res) => {
  const { phone, text, imageBase64, imageType, imageUrl } = req.body;
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
      // Upload image to WhatsApp media API
      const buffer = Buffer.from(imageBase64, 'base64');
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('type', imageType);
      formData.append('file', new Blob([buffer], { type: imageType }), 'image.jpg');

      const uploadRes = await fetch(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`,
        { method: 'POST', headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }, body: formData }
      );
      const uploadData = await uploadRes.json();
      if (!uploadData.id) throw new Error(`Media upload failed: ${JSON.stringify(uploadData)}`);
      console.log(`[ADMIN] Media uploaded, id=${uploadData.id}`);

      // Send image message
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        { messaging_product: 'whatsapp', to: phone, type: 'image', image: { id: uploadData.id, caption: text || '' } },
        { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      await db.insertMessage(phone, `[Image]${text ? ': ' + text : ''}`, 'bot');
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
    console.log(`[ADMIN] Follow-up generated for ${phone}: "${followupText.substring(0, 80)}"`);
    res.json({ ok: true, message: followupText });
  } catch (err) {
    console.error(`[ADMIN] followup error:`, err.message);
    res.status(500).json({ error: err.message });
  }
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
}).catch(err => {
  console.error(`[STARTUP] DB init FAILED:`, err.message || err);
  console.error(`[STARTUP] Full error:`, JSON.stringify(err, Object.getOwnPropertyNames(err)));
  process.exit(1);
});
