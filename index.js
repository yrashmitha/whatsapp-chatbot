require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path    = require('path');
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
const ORDER_MARKER = '[[ORDER_COMPLETE]]';

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

  await db.insertMessage(phoneNumber, userMessage, 'user');
  await db.upsertCustomer(phoneNumber, null);
  console.log(`[DB] Saved user message for ${phoneNumber}`);

  console.log(`[GEMINI] Sending message to Gemini...`);
  const result  = await chatSession.sendMessage(userMessage);
  let botReply  = result.response.text();

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

  await db.insertMessage(phoneNumber, botReply, 'bot');
  console.log(`[DB] Saved bot reply for ${phoneNumber}`);
  return { botReply, orderId, callCostUSD, inputTokens, outputTokens };
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
    const { botReply, orderId, callCostUSD, inputTokens, outputTokens } =
      await handleMessage(phoneNumber, userMessage, session.chat);

    session.totalCostUSD      += callCostUSD;
    session.totalInputTokens  += inputTokens;
    session.totalOutputTokens += outputTokens;

    console.log(`[/chat] Response sent | orderId=${orderId} | sessionTotal=$${session.totalCostUSD.toFixed(6)}`);

    res.json({
      reply: botReply,
      orderId,
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

      const msg         = value.messages[0];
      const from        = msg.from;
      const userMessage = msg.text?.body;

      console.log(`[WEBHOOK-POST] msg type=${msg.type} from=${from}`);

      if (!userMessage) {
        console.log(`[WEBHOOK-POST] Non-text message from ${from} — skipping`);
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

      const { botReply } = await handleMessage(from, userMessage, session.chat);
      console.log(`[OUT] ${from}: ${botReply.substring(0, 120)}`);
      await sendWhatsAppMessage(from, botReply);
    } catch (err) {
      console.error(`[WEBHOOK-POST] ERROR:`, err?.response?.data ?? err.message);
    }
  })();
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

db.init().then(() => {
  console.log(`[DB] Initialized successfully`);
  app.listen(PORT, () => {
    console.log(`[STARTUP] Server running on port ${PORT}`);
    console.log(`[STARTUP] Database: ${db.IS_PG ? 'PostgreSQL' : 'SQLite (local)'}`);
  });
}).catch(err => {
  console.error(`[STARTUP] DB init FAILED:`, err.message);
  process.exit(1);
});
