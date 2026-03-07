require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const buildSystemInstruction = require('./buildInstruction');

// ─── Load system instruction from products.json ───────────────────────────────
const systemInstruction = buildSystemInstruction();

// ─── Gemini client ────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction,
});

// ─── SQLite database ──────────────────────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new DatabaseSync(path.join(dataDir, 'chat.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    message_text TEXT NOT NULL,
    sender_type  TEXT NOT NULL CHECK(sender_type IN ('user','bot')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    phone_number TEXT PRIMARY KEY,
    name         TEXT,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     TEXT UNIQUE NOT NULL,
    phone_number TEXT NOT NULL,
    package      TEXT,
    birth_date   TEXT,
    birth_time   TEXT,
    birth_city   TEXT,
    problems     TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── DB helpers ───────────────────────────────────────────────────────────────
const insertMessage  = db.prepare('INSERT INTO messages (phone_number, message_text, sender_type) VALUES (?, ?, ?)');
const upsertCustomer = db.prepare(`
  INSERT INTO customers (phone_number, name, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(phone_number) DO UPDATE SET
    name       = COALESCE(excluded.name, name),
    updated_at = datetime('now')
`);
const insertOrder      = db.prepare('INSERT INTO orders (order_id, phone_number, package, birth_date, birth_time, birth_city, problems) VALUES (?, ?, ?, ?, ?, ?, ?)');
const getOrdersByPhone = db.prepare('SELECT * FROM orders WHERE phone_number = ? ORDER BY created_at DESC');
const countOrdersByYear = db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE order_id LIKE ?");

function generateOrderId() {
  const year = new Date().getFullYear();
  const row  = countOrdersByYear.get(`PJ${year}-%`);
  const seq  = String((row.cnt || 0) + 1).padStart(4, '0');
  return `PJ${year}-${seq}`;
}

// ─── Order extraction ─────────────────────────────────────────────────────────
const ORDER_MARKER = '[[ORDER_COMPLETE]]';

async function extractOrderDetails(history) {
  const historyText = history
    .map(m => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.parts.map(p => p.text).join('')}`)
    .join('\n');

  const result = await model.generateContent(
    `From the following conversation, extract the confirmed order details as JSON only (no other text). Use null for any unknown fields.\n\nConversation:\n${historyText}\n\nReturn only this JSON object:\n{"customer_name": null, "package": null, "birth_date": null, "birth_time": null, "birth_city": null, "problems": null}`
  );

  const text  = result.response.text().trim();
  const match = text.match(/\{[\s\S]*?\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { return null; }
  }
  return null;
}

// ─── Session builder (shared by web + WhatsApp) ───────────────────────────────
function buildChatSession(phoneNumber) {
  const existingOrders = getOrdersByPhone.all(phoneNumber);
  let initialHistory   = [];

  if (existingOrders.length > 0) {
    const orderList = existingOrders
      .map(o => `Order ID: ${o.order_id} | Package: ${o.package || '?'} | Status: ${o.status} | Date: ${o.created_at.split(' ')[0]}`)
      .join('\n');

    // Inject existing order context silently so bot is aware
    initialHistory = [
      { role: 'user',  parts: [{ text: `[SYSTEM NOTE — not from customer]: This customer already has the following orders:\n${orderList}\nIf they ask about an order, refer to this list. If they are placing a new order, proceed normally.` }] },
      { role: 'model', parts: [{ text: '[Noted. I have the customer\'s order history on file.]' }] },
    ];
  }

  return model.startChat({ history: initialHistory });
}

// ─── Cost calculation (Gemini 2.5 Flash pricing) ─────────────────────────────
// Input:  $0.075 / 1M tokens  |  Output: $0.30 / 1M tokens
const PRICE_INPUT  = 0.075  / 1_000_000;
const PRICE_OUTPUT = 0.30   / 1_000_000;

function calcCost(inputTokens, outputTokens) {
  return (inputTokens * PRICE_INPUT) + (outputTokens * PRICE_OUTPUT);
}

// ─── Handle incoming message (shared logic) ───────────────────────────────────
async function handleMessage(phoneNumber, userMessage, chatSession) {
  insertMessage.run(phoneNumber, userMessage, 'user');
  upsertCustomer.run(phoneNumber, null);

  const result  = await chatSession.sendMessage(userMessage);
  let botReply  = result.response.text();
  let orderId   = null;

  // Token usage from this call
  const usage       = result.response.usageMetadata || {};
  const inputTokens  = usage.promptTokenCount     || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  const callCostUSD  = calcCost(inputTokens, outputTokens);

  // Detect order completion marker
  if (botReply.includes(ORDER_MARKER)) {
    botReply = botReply.replace(ORDER_MARKER, '').trim();

    const history = await chatSession.getHistory();
    const details = await extractOrderDetails(history);

    if (details) {
      orderId = generateOrderId();
      insertOrder.run(
        orderId, phoneNumber,
        details.package    ?? null,
        details.birth_date ?? null,
        details.birth_time ?? null,
        details.birth_city ?? null,
        details.problems   ?? null
      );
      if (details.customer_name) {
        upsertCustomer.run(phoneNumber, details.customer_name);
      }
      botReply += `\n\n✅ *ඔබේ Order ID: ${orderId}*\nමෙය ආරක්ෂිතව සටහන් කර ගන්න. ඕනෑම ප්‍රශ්නයකදී මෙම ID ඉදිරිපත් කළ හැකියි. 🙏`;
      console.log(`[ORDER] ${orderId} saved for ${phoneNumber}`);
    }
  }

  insertMessage.run(phoneNumber, botReply, 'bot');
  return { botReply, orderId, callCostUSD, inputTokens, outputTokens };
}

// ─── WhatsApp send helper ─────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
    { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory sessions: sessionId → { chat, phoneNumber }
const chatSessions = new Map();

// POST /chat — Web UI
app.post('/chat', async (req, res) => {
  const userMessage = req.body?.message?.trim();
  const sessionId   = req.body?.sessionId;
  const phoneNumber = req.body?.phoneNumber?.trim() || sessionId;

  if (!userMessage) return res.status(400).json({ error: 'No message' });

  if (!chatSessions.has(sessionId)) {
    chatSessions.set(sessionId, {
      chat: buildChatSession(phoneNumber),
      phoneNumber,
      totalCostUSD:    0,
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

    res.json({
      reply:   botReply,
      orderId,
      usage: {
        callCostUSD:       +callCostUSD.toFixed(6),
        totalCostUSD:      +session.totalCostUSD.toFixed(6),
        totalInputTokens:  session.totalInputTokens,
        totalOutputTokens: session.totalOutputTokens,
      },
    });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Gemini error' });
  }
});

// GET /webhook — Meta verification
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified.');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// POST /webhook — WhatsApp messages
app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  (async () => {
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      if (!value?.messages?.length) return;

      const msg         = value.messages[0];
      const from        = msg.from;
      const userMessage = msg.text?.body;
      if (!userMessage) return;

      console.log(`[IN]  ${from}: ${userMessage}`);

      // Get or create WhatsApp session (keyed by phone number)
      if (!chatSessions.has(from)) {
        chatSessions.set(from, {
          chat: buildChatSession(from),
          phoneNumber: from,
        });
      }
      const session = chatSessions.get(from);

      const { botReply } = await handleMessage(from, userMessage, session.chat);

      console.log(`[OUT] ${from}: ${botReply}`);
      await sendWhatsAppMessage(from, botReply);
    } catch (err) {
      console.error('Webhook error:', err?.response?.data ?? err.message);
    }
  })();
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('System instruction loaded from products.json');
});
