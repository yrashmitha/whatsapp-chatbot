require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const multer  = require('multer');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Persistent uploads directory (Railway volume at /data) ───────────────────
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/data/uploads';
if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}
}
const uploadDisk = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
      const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
// CRM media send: images, PDFs, audio up to 16 MB
const uploadMedia = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^(image\/|application\/pdf|audio\/)/.test(file.mimetype));
  },
});
const buildSystemInstruction = require('./buildInstruction');
const { buildOrderFieldsInstruction, buildContactInstruction } = require('./buildInstruction');
const db           = require('./db');
const clientRouter = require('./clientRouter');
const pluginLoader = require('./pluginLoader');
const { embedText, productToText } = require('./embedder');
const { chunkText } = require('./chunker');

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
    thinkingConfig: { thinkingBudget: 1024 },
  }
});

// ─── Cost calculation (Gemini 2.5 Flash pricing) ─────────────────────────────
const PRICE_INPUT  = 0.075 / 1_000_000;
const PRICE_OUTPUT = 0.30  / 1_000_000;
function calcCost(i, o) { return i * PRICE_INPUT + o * PRICE_OUTPUT; }

// ─── Order ID generation ──────────────────────────────────────────────────────
const ORDER_MARKER_REGEX   = /\[\[ORDER_COMPLETE:([\s\S]*?)\]\]/;
const ORDER_UPDATE_REGEX   = /\[\[ORDER_UPDATE:([\s\S]*?)\]\]/;
const UPDATE_SUMMARY_REGEX = /\[\[UPDATE_SUMMARY:([\s\S]*?)\]\]/;
const PAYMENT_MARKER      = '[[PAYMENT_CHECK]]';
const HOROSCOPE_MARKER    = '[[HOROSCOPE_RECEIVED]]';

async function generateOrderId(client) {
  const prefix = (client && client.order_id_prefix) || 'PJ';
  const year   = new Date().getFullYear();
  const cnt    = await db.countOrdersByYear(`${prefix}${year}-%`);
  const id     = `${prefix}${year}-${String(cnt + 1).padStart(4, '0')}`;
  console.log(`[ORDER_ID] Generated: ${id} (existing count: ${cnt})`);
  return id;
}


// ─── Session builder ──────────────────────────────────────────────────────────
async function buildChatSession(phoneNumber, client) {
  console.log(`[SESSION] Building session for ${phoneNumber}`);
  const existingOrders = await db.getOrdersByPhone(phoneNumber);
  console.log(`[SESSION] Found ${existingOrders.length} existing orders for ${phoneNumber}`);
  let initialHistory = [];

  if (existingOrders.length > 0) {
    const orderList = existingOrders
      .map(o => {
        const cf = o.custom_fields ? (typeof o.custom_fields === 'string' ? (() => { try { return JSON.parse(o.custom_fields); } catch { return {}; } })() : o.custom_fields) : {};
        const cfStr = Object.entries(cf).map(([k, v]) => `${k}: ${v}`).join(', ');
        return `Order ID: ${o.order_id} | Status: ${o.status} | horoscope_received: ${!!o.horoscope_received} | receipt_received: ${!!o.receipt_received} | Date: ${String(o.created_at).split('T')[0]}${cfStr ? ' | ' + cfStr : ''}${o.notes ? ' | Notes: ' + o.notes : ''}`;
      })
      .join('\n');

    initialHistory = [
      { role: 'user',  parts: [{ text: `[SYSTEM NOTE — not from customer]: This customer already has the following orders:\n${orderList}\nIf they ask about an order, refer to this list. If they are placing a new order, proceed normally.` }] },
      { role: 'model', parts: [{ text: "[Noted. I have the customer's order history and document submission status on file.]" }] },
    ];
    console.log(`[SESSION] Injected order history into initial context`);
  }

  // Always build per-client model to inject order fields + custom prompt
  let chatModel = model;
  if (client) {
    const baseInstruction = buildSystemInstruction.forClient(client);
    const orderFieldsBlock = buildOrderFieldsInstruction(client.order_fields || []);
    const contactBlock = buildContactInstruction(client.contact_number || null);
    const mediaItems = await db.getClientMedia(client.id);
    let mediaBlock = '';
    if (mediaItems.length > 0) {
      mediaBlock = '\n\n━━━ Media Images You Can Send ━━━\n'
        + 'Use the send_image tool to deliver images to the customer. Send them at the right moment based on these descriptions:\n'
        + mediaItems.map(m => `- "${m.title}": ${m.description}\n  URL: ${m.image_url}`).join('\n');
    }
    const kbBlock = (client?.knowledge_base_enabled && db.IS_PG)
      ? '\n\n━━━ KNOWLEDGE BASE — MANDATORY ━━━\n'
        + 'You have a search_knowledge tool connected to a live knowledge base. '
        + 'You MUST call search_knowledge BEFORE answering ANY customer question — no exceptions. '
        + 'Never answer from your own memory or training data. '
        + 'If search returns no results, tell the customer you could not find information on that topic. '
        + 'You may call search_knowledge multiple times with different queries for complex questions.'
      : '';
    const summaryBlock = '\n\n━━━ AI SUMMARY / ORDER NOTES ━━━\n'
      + 'When you place an order using [[ORDER_COMPLETE:{...}]], always include a "summary" field in the JSON with a detailed internal note. '
      + 'This note is invisible to the customer and is used by the team for reference. '
      + 'Include: customer\'s main request, any special requirements, priorities, urgency, and key conversation details. '
      + 'Example: [[ORDER_COMPLETE:{"customer_name":"...", ..., "summary":"Customer needs horoscope for marriage decision, DOB missing, very urgent, follow up needed"}]]\n'
      + 'You can also update this summary at any point during the conversation by outputting (invisible to customer):\n'
      + '[[UPDATE_SUMMARY: updated detailed note here ]]\n'
      + 'Use this when you learn new important details about the customer or their situation.';
    let fullInstruction = baseInstruction + orderFieldsBlock + contactBlock + mediaBlock + kbBlock + summaryBlock;
    // Plugin hook: append extra instruction
    const _pluginForInstr = pluginLoader.loadPlugin(client?.id, client?.plugin_enabled);
    if (_pluginForInstr?.appendInstruction) {
      try {
        const extra = _pluginForInstr.appendInstruction(fullInstruction, client);
        if (extra) fullInstruction += '\n\n' + extra;
      } catch (e) { console.error(`[PLUGIN] appendInstruction error for ${client?.id}:`, e.message); }
    }
    chatModel = genAI.getGenerativeModel({
      model: client.ai_model || 'gemini-2.5-flash',
      systemInstruction: fullInstruction,
      generationConfig: {
        temperature: parseFloat(client.temperature) || 0.7,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 1024 },
      },
    });
    console.log(`[SESSION] Built client model for ${client.id} | mode=${client.system_prompt_mode} | orderFields=${client.order_fields?.length || 0} | contactNumber=${client.contact_number || 'none'} | instructionLen=${fullInstruction.length}`);
    console.log(`[SESSION] Full system instruction: ${fullInstruction.replace(/\n/g, '\\n')}`);
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
        description: 'Search the product catalog. You MUST call this function BEFORE recommending, describing, or naming any specific product — even when making suggestions based on customer preferences (e.g. "office scent", "fresh", "woody"). Build a query from the customer\'s preferences and search first. Call this when a customer asks about products, availability, price, features, or when you want to recommend something. When a customer mentions a total budget, calculate max_price = budget - delivery_fee and pass it to filter results.' + attrHint + ' STRICT RULE: Only tell the customer about products that appear in the search results. If the result is "No matching products found", tell the customer that item is not available. NEVER invent, guess, or mention any product not returned by this search.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search query, e.g. "red cotton shirt size L under 2000 LKR"' },
            max_price: { type: 'NUMBER', description: 'Maximum product price (excluding delivery). If customer mentions a total budget, subtract the delivery fee to get this value. Example: budget Rs 1500 with Rs 300 delivery → max_price: 1200. Only set this when the customer has explicitly stated a budget limit.' }
          },
          required: ['query']
        }
      }]
    }];
    console.log(`[SESSION] Product search tool enabled for client ${client.id} (${attrSchema.length} attr fields)`);
  }

  // Add knowledge base search tool if enabled
  console.log(`[SESSION] knowledge_base_enabled=${client?.knowledge_base_enabled}, IS_PG=${db.IS_PG} → KB tool will ${client?.knowledge_base_enabled && db.IS_PG ? 'BE' : 'NOT BE'} added`);
  if (client?.knowledge_base_enabled && db.IS_PG) {
    const kbDecl = {
      name: 'search_knowledge',
      description: 'This is the Knowledge Base Tool (දත්ත ලබාගැනීමේ ක්රමවේදය / දත්ත ගබඩාව). You MUST call this tool before answering ANY question — never answer from your own memory. IMPORTANT: Always translate the search query to SINHALA keywords before searching, because all content is stored in Sinhala. Call multiple times with different Sinhala queries if the question has multiple aspects. Only use what is returned — never invent information.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'The customer question or topic to search for' }
        },
        required: ['query']
      }
    };
    if (tools.length > 0) {
      tools[0].functionDeclarations.push(kbDecl);
    } else {
      tools = [{ functionDeclarations: [kbDecl] }];
    }
    console.log(`[SESSION] Knowledge base search tool enabled for client ${client.id}`);
  }

  // Always add send_image tool (for media library)
  const sendImageDecl = {
    name: 'send_image',
    description: 'Send an image to the customer. Use this based on the media image descriptions in your system instructions — send images at exactly the right moment. Pass the exact image_url from your instructions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        image_url: { type: 'STRING', description: 'The direct image URL to send' },
        caption:   { type: 'STRING', description: 'Short caption shown under the image' },
      },
      required: ['image_url'],
    },
  };
  if (tools.length > 0) {
    tools[0].functionDeclarations.push(sendImageDecl);
  } else {
    tools = [{ functionDeclarations: [sendImageDecl] }];
  }
  // Plugin hook: extra tools
  const _pluginForTools = pluginLoader.loadPlugin(client?.id, client?.plugin_enabled);
  if (_pluginForTools?.getExtraTools) {
    try {
      const extras = _pluginForTools.getExtraTools(client);
      if (extras?.length) {
        if (tools.length > 0) extras.forEach(t => tools[0].functionDeclarations.push(t));
        else tools = [{ functionDeclarations: extras }];
        console.log(`[PLUGIN] ${client.id}: added ${extras.length} extra tool(s)`);
      }
    } catch (e) { console.error(`[PLUGIN] getExtraTools error for ${client?.id}:`, e.message); }
  }

  // Load last 40 messages from DB so context survives server restarts
  const SESSION_MSG_LIMIT = 40;
  const dbMsgs = await db.getMessagesByPhone(phoneNumber);
  const recentMsgs = dbMsgs.slice(-SESSION_MSG_LIMIT);
  const msgHistory = recentMsgs
    .filter(m => !m.message_text.startsWith('[SYSTEM NOTE'))
    .map(m => ({
      role: m.sender_type === 'user' ? 'user' : 'model',
      parts: [{ text: m.message_text }],
    }));

  // Gemini requires alternating user/model turns — merge consecutive same-role entries
  const mergedHistory = [];
  for (const msg of msgHistory) {
    const last = mergedHistory[mergedHistory.length - 1];
    if (last && last.role === msg.role) {
      last.parts[0].text += '\n' + msg.parts[0].text;
    } else {
      mergedHistory.push({ role: msg.role, parts: [{ text: msg.parts[0].text }] });
    }
  }
  // History must start with 'user' turn
  while (mergedHistory.length > 0 && mergedHistory[0].role !== 'user') mergedHistory.shift();

  const fullHistory = [...initialHistory, ...mergedHistory];
  console.log(`[SESSION] Loaded ${mergedHistory.length} messages from DB into session context`);

  const registeredTools = tools.flatMap(t => t.functionDeclarations?.map(d => d.name) || []);
  console.log(`[SESSION] Tools registered for this session: [${registeredTools.join(', ')}]`);

  return chatModel.startChat({ history: fullHistory, tools });
}

async function buildOrderStatusNote(phoneNumber) {
  const all = await db.getOrdersByPhone(phoneNumber);
  if (!all.length) return null;
  const orders = all.slice(0, 5);
  const lines = orders.map(o => {
    const cf = o.custom_fields
      ? (typeof o.custom_fields === 'string' ? (() => { try { return JSON.parse(o.custom_fields); } catch { return {}; } })() : o.custom_fields)
      : {};
    const cfStr = Object.entries(cf).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `[ORDER ${o.order_id}: status=${o.status}, horoscope_received=${!!o.horoscope_received}, receipt_received=${!!o.receipt_received}, date=${String(o.created_at).split('T')[0]}${cfStr ? ', ' + cfStr : ''}${o.notes ? ', notes: ' + o.notes : ''}]`;
  });
  const note = lines.join('\n');
  const suffix = all.length > 5 ? `\n[NOTE: Showing last 5 orders only. Customer has ${all.length} orders total.]` : '';
  return note + suffix;
}

// ─── Handle incoming message ──────────────────────────────────────────────────
async function handleMessage(phoneNumber, userMessage, chatSession, { skipUserInsert = false, client = null, retryNote = null } = {}) {
  console.log(`[IN] ${phoneNumber}: "${userMessage.substring(0, 100)}"`);

  await db.upsertCustomer(phoneNumber, null, client?.id);
  if (!skipUserInsert) {
    await db.insertMessage(phoneNumber, userMessage, 'user', null, client?.id ?? null);
    console.log(`[DB] Saved user message for ${phoneNumber}`);
  }

  // If in-memory history is empty, reload last 40 messages from DB
  if (!chatSession._history || chatSession._history.length === 0) {
    const dbMsgs = await db.getMessagesByPhone(phoneNumber);
    if (dbMsgs.length > 0) {
      const recent = dbMsgs.slice(-40).filter(m => !m.message_text.startsWith('[SYSTEM NOTE'));
      const merged = [];
      for (const m of recent) {
        const role = m.sender_type === 'user' ? 'user' : 'model';
        const last = merged[merged.length - 1];
        if (last && last.role === role) { last.parts[0].text += '\n' + m.message_text; }
        else merged.push({ role, parts: [{ text: m.message_text }] });
      }
      while (merged.length && merged[0].role !== 'user') merged.shift();
      chatSession._history = merged;
      console.log(`[SESSION] Reloaded ${merged.length} messages from DB into empty session`);
    }
  }

  // Inject current order status so AI knows what documents are already received
  const statusNote = await buildOrderStatusNote(phoneNumber);
  let messageToSend = statusNote ? `${statusNote}\n\n${userMessage}` : userMessage;
  if (retryNote) messageToSend = `${retryNote}\n\n${messageToSend}`;

  console.log(`[GEMINI] Full prompt: ${messageToSend.replace(/\n/g, '\\n')}`);
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await chatSession.sendMessage(messageToSend);
      break;
    } catch (aiErr) {
      const retryable = /503|unavailable|overloaded/i.test(aiErr.message || '');
      const funcTurnErr = /function response turn/i.test(aiErr.message || '');
      console.error(`[GEMINI] Attempt ${attempt}/3 failed:`, aiErr.message);
      if (attempt < 3 && retryable) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else if (attempt < 3 && funcTurnErr && chatSession._history) {
        // History has orphaned functionCall/functionResponse turns — strip them and retry
        console.warn('[GEMINI] Sanitizing history due to function turn mismatch, retrying...');
        chatSession._history = chatSession._history.filter(
          turn => !turn.parts?.some(p => p.functionCall || p.functionResponse)
        );
        while (chatSession._history.length > 0 && chatSession._history[0].role !== 'user') {
          chatSession._history.shift();
        }
      } else {
        throw aiErr;
      }
    }
  }
  let candidate = result.response;

  // ── Function calling loop ──────────────────────────────────────────────────
  let fcLoopCount = 0;
  const productImagesToSend = []; // track images to send after text reply
  const initialFcCalls = candidate.functionCalls();
  console.log(`[FC] Gemini initial response has ${initialFcCalls?.length || 0} function call(s): [${(initialFcCalls || []).map(f => f.name).join(', ')}]`);
  while (candidate.functionCalls()?.length > 0 && fcLoopCount++ < 8) {
    const calls = candidate.functionCalls();
    const functionResponses = [];
    let anyHandled = false;

    for (const fc of calls) {
      if (fc.name === 'search_products' && client?.product_catalog_enabled && db.IS_PG) {
        const maxPrice = (fc.args.max_price != null && fc.args.max_price > 0) ? fc.args.max_price : null;
        console.log(`[RAG] search_products called with query: "${fc.args.query}"${maxPrice != null ? ` | max_price: ${maxPrice}` : ''}`);
        let resultText = 'No matching products found.';
        const limit = client.max_products_in_context || 5;
        const formatProducts = (products) => products.map(p => {
          const price = p.price_max ? `${p.price}–${p.price_max}` : (p.price || '?');
          const attrs = p.attributes && typeof p.attributes === 'object' && Object.keys(p.attributes).length > 0
            ? ' | ' + Object.entries(p.attributes).map(([k, v]) => `${k}: ${v}`).join(', ')
            : '';
          return `• [product_id:${p.id}] ${p.name}${p.sku ? ` (${p.sku})` : ''} | ${p.currency} ${price}${p.category ? ` | ${p.category}` : ''}${attrs}${p.description ? ` — ${p.description}` : ''}`;
        }).join('\n');

        let products = [];
        try {
          const emb = await embedText(fc.args.query);
          products = await db.vectorSearchProducts(client.id, emb, limit, maxPrice);
          if (products.length > 0) {
            console.log(`[RAG] Vector search returned ${products.length} products`);
            resultText = formatProducts(products);
          }
        } catch (e) {
          console.warn('[RAG] Vector search failed, falling back to FTS:', e.message);
        }

        if (!products.length) {
          try {
            products = await db.searchProducts(client.id, fc.args.query, limit, maxPrice);
            if (products.length > 0) {
              console.log(`[RAG] FTS fallback returned ${products.length} products`);
              resultText = formatProducts(products);
            }
          } catch (e) {
            console.warn('[RAG] FTS fallback failed:', e.message);
          }
        }

        for (const p of products) {
          if (p.image_url) productImagesToSend.push({ url: p.image_url, caption: p.name });
        }

        const finalResult = products.length === 0
          ? 'No matching products found. Do NOT suggest or mention any product — tell the customer this item is not available.'
          : resultText;
        functionResponses.push({ functionResponse: { name: 'search_products', response: { result: finalResult } } });
        anyHandled = true;

      } else if (fc.name === 'search_knowledge' && client?.knowledge_base_enabled && db.IS_PG) {
        console.log(`[RAG] search_knowledge called with query: "${fc.args.query}"`);
        let resultText = 'No relevant information found in the knowledge base.';
        try {
          const emb = await embedText(fc.args.query);
          const chunks = await db.vectorSearchKnowledge(client.id, emb, 8);
          if (chunks.length > 0) {
            console.log(`[RAG] Knowledge base returned ${chunks.length} chunks`);
            resultText = 'IMPORTANT: Answer using ONLY the exact information below. Do not change numbers, add details, or use any outside knowledge.\n\n'
              + chunks.map(c => `[${c.title}]\n${c.content}`).join('\n\n---\n\n');
          } else {
            console.log(`[RAG] Knowledge base returned no results`);
          }
        } catch (e) {
          console.warn('[RAG] Knowledge search failed:', e.message);
        }
        functionResponses.push({ functionResponse: { name: 'search_knowledge', response: { result: resultText } } });
        anyHandled = true;

      } else if (fc.name === 'send_image') {
        const { image_url, caption = '' } = fc.args;
        console.log(`[MEDIA] send_image called: url="${image_url}" caption="${caption}"`);
        if (image_url) productImagesToSend.push({ url: image_url, caption });
        functionResponses.push({ functionResponse: { name: 'send_image', response: { ok: true } } });
        anyHandled = true;
      } else {
        // Plugin hook: handle custom tool call
        const _pluginForTool = pluginLoader.loadPlugin(client?.id, client?.plugin_enabled);
        if (_pluginForTool?.handleToolCall) {
          try {
            const pluginResult = await _pluginForTool.handleToolCall(fc.name, fc.args, client, { phoneNumber, db });
            if (pluginResult !== null) {
              console.log(`[PLUGIN] ${client?.id}: handled tool call "${fc.name}"`);
              functionResponses.push({ functionResponse: { name: fc.name, response: pluginResult } });
              anyHandled = true;
            }
          } catch (e) { console.error(`[PLUGIN] handleToolCall error for ${client?.id}:`, e.message); }
        }
      }
    }

    if (!anyHandled) break;
    result    = await chatSession.sendMessage(functionResponses);
    candidate = result.response;
  }

  // Filter out thought parts so they never reach the customer
  const rawParts = candidate.candidates?.[0]?.content?.parts || [];
  const nonThoughtText = rawParts
    .filter(p => !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('');
  const rawReply = nonThoughtText || candidate.text() || '';

  let botReply  = rawReply
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*') // convert markdown **bold** → WhatsApp *bold*
    .replace(/\[ORDER STATUS[^\]]*\]\s*/gi, '') // strip any echoed ORDER STATUS note wherever it appears
    .trim();

  // If Gemini returned empty text (e.g. incomplete function call cycle), send a safe fallback
  // But skip the fallback if images were sent — the image IS the reply
  if (!botReply && productImagesToSend.length === 0) {
    console.warn('[GEMINI] Empty reply after processing — using fallback');
    botReply = client?.error_message || "Sorry, I didn't get that. Could you please try again? 🙏";
  }

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
  console.log(`[OUT] "${botReply.substring(0, 120)}" | tokens in=${inputTokens} out=${outputTokens} cost=$${callCostUSD.toFixed(6)}`);

  let orderId = null;
  const orderMatch = botReply.match(ORDER_MARKER_REGEX);
  if (orderMatch) {
    console.log(`[ORDER] ORDER_COMPLETE marker detected`);
    botReply = botReply.replace(ORDER_MARKER_REGEX, '').trim();

    let details = null;
    try {
      // Gemini sometimes escapes apostrophes as \' which is invalid JSON — sanitize first
      const sanitized = orderMatch[1].replace(/\\'/g, "'");
      details = JSON.parse(sanitized);
    } catch (e) {
      console.error(`[ORDER] Failed to parse order JSON from marker:`, e.message, orderMatch[1]);
    }

    if (details) {
      orderId = await generateOrderId(client);
      await db.insertOrder(orderId, phoneNumber, client?.id ?? null, details);
      console.log(`[ORDER] Saved order ${orderId} for ${phoneNumber}`);
      if (details.summary) {
        await db.updateOrderAISummary(orderId, details.summary);
        console.log(`[ORDER] AI summary saved for ${orderId}`);
      }
      if (details.customer_name) {
        await db.upsertCustomer(phoneNumber, details.customer_name, client?.id);
        console.log(`[DB] Updated customer name: ${details.customer_name}`);
      }
      botReply += `\n\n✅ *ඔබේ Order ID: ${orderId}*`;
    } else {
      console.warn(`[ORDER] ORDER_COMPLETE marker found but JSON parse failed`);
    }
  }

  const updateMatch = botReply.match(ORDER_UPDATE_REGEX);
  if (updateMatch) {
    botReply = botReply.replace(ORDER_UPDATE_REGEX, '').trim();
    try {
      const { order_id, updates } = JSON.parse(updateMatch[1]);
      if (order_id && updates && typeof updates === 'object') {
        const existing = await db.getOrdersByPhone(phoneNumber);
        const order = existing.find(o => o.order_id === order_id);
        if (order) {
          const cf = order.custom_fields
            ? (typeof order.custom_fields === 'string' ? JSON.parse(order.custom_fields) : order.custom_fields)
            : {};
          await db.updateOrderCustomFields(order_id, { ...cf, ...updates });
          console.log(`[ORDER] Updated fields for ${order_id}:`, updates);
        } else {
          console.warn(`[ORDER] ORDER_UPDATE: order ${order_id} not found for ${phoneNumber}`);
        }
      }
    } catch (e) { console.error('[ORDER] ORDER_UPDATE parse failed:', e.message); }
  }

  const summaryMatch = botReply.match(UPDATE_SUMMARY_REGEX);
  if (summaryMatch) {
    botReply = botReply.replace(UPDATE_SUMMARY_REGEX, '').trim();
    const summaryText = summaryMatch[1].trim();
    try {
      const latestOrder = await db.getLatestOrder(phoneNumber);
      if (latestOrder) {
        await db.updateOrderAISummary(latestOrder.order_id, summaryText);
        console.log(`[ORDER] AI summary updated for ${latestOrder.order_id}`);
      } else {
        console.warn(`[ORDER] UPDATE_SUMMARY: no order found for ${phoneNumber}`);
      }
    } catch (e) { console.error('[ORDER] UPDATE_SUMMARY failed:', e.message); }
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

  // Plugin hook: process custom markers
  const _pluginForMarkers = pluginLoader.loadPlugin(client?.id, client?.plugin_enabled);
  if (_pluginForMarkers?.processMarkers) {
    try {
      botReply = await _pluginForMarkers.processMarkers(botReply, client, { phoneNumber, db, orderId: null });
    } catch (e) { console.error(`[PLUGIN] processMarkers error for ${client?.id}:`, e.message); }
  }

  // Strip [[MSG_BREAK]] markers before saving to DB (clean single text for history)
  const botReplyForDb = botReply.replace(/\[\[MSG_BREAK\]\]/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  await db.insertMessage(phoneNumber, botReplyForDb, 'bot', callCostUSD, client?.id ?? null);
  console.log(`[DB] Saved bot reply for ${phoneNumber} cost=$${callCostUSD.toFixed(6)}`);

  // Sliding window: keep only last 40 entries in memory, drop oldest from front
  const MAX_HISTORY = 40;
  if (chatSession._history?.length > MAX_HISTORY) {
    chatSession._history.splice(0, chatSession._history.length - MAX_HISTORY);
    // After trimming, remove any orphaned function turns from the front.
    // Trimming can split a functionCall/functionResponse pair, leaving a
    // dangling functionResponse (or model functionCall) which causes Gemini 400.
    while (chatSession._history.length > 0) {
      const first = chatSession._history[0];
      const isFuncTurn = first.parts?.some(p => p.functionCall || p.functionResponse);
      if (first.role !== 'user' || isFuncTurn) {
        chatSession._history.shift();
      } else {
        break;
      }
    }
  }

  return { botReply, orderId, paymentReceived, callCostUSD, inputTokens, outputTokens, imagesToSend, productImagesToSend };
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
  const isPdf  = filename.toLowerCase().endsWith('.pdf');
  const mediaId = templateMediaIds.get(filename);
  const fileUrl = `${process.env.PUBLIC_URL || 'https://whatsapp-chatbot-production-038d.up.railway.app'}/templates/${encodeURIComponent(filename)}`;

  console.log(`[WA-IMG] Sending "${filename}" (${isPdf ? 'pdf' : 'image'}) to ${to} via ${mediaId ? 'media_id' : 'link'}`);
  try {
    if (isPdf) {
      const document = mediaId ? { id: mediaId, filename, caption } : { link: fileUrl, filename, caption };
      await axios.post(
        `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
        { messaging_product: 'whatsapp', to, type: 'document', document },
        { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
      );
    } else {
      const image = mediaId ? { id: mediaId, caption } : { link: fileUrl, caption };
      await axios.post(
        `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
        { messaging_product: 'whatsapp', to, type: 'image', image },
        { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
      );
    }
    console.log(`[WA-IMG] Sent successfully to ${to}`);
  } catch (err) {
    console.error(`[WA-IMG] Send failed to ${to}:`, err?.response?.data ?? err.message);
  }
}

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

// Split reply on [[MSG_BREAK]] and send as separate WhatsApp messages with a short delay
async function sendBotReply(to, botReply, client) {
  const parts = botReply.split('[[MSG_BREAK]]').map(p => p.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    await sendWhatsAppMessage(to, parts[i], client);
    if (i < parts.length - 1) await new Promise(r => setTimeout(r, 800));
  }
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '20mb' }));

// Serve React CRM build (primary)
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  console.log('[STARTUP] Serving React frontend from', FRONTEND_DIST);
}
// Serve uploaded media files from the persistent volume
app.use('/uploads', express.static(UPLOADS_DIR));
// Legacy HTML pages still accessible at /legacy/*
app.use('/legacy', express.static(path.join(__dirname, 'public')));

// ─── JWT Auth ─────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

function jwtAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

// For super admin: use ?client_id= param; for clients: always use their own id
function resolveClientId(req) {
  if (req.user?.role === 'superadmin') return req.query.client_id || req.body?.client_id || null;
  return req.user?.clientId || null;
}

// Log every incoming request
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

const chatSessions = new Map();

// Evict sessions idle for more than 2 hours to prevent memory growth
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  let evicted = 0;
  for (const [key, session] of chatSessions.entries()) {
    if ((session.lastUsed || 0) < cutoff) {
      chatSessions.delete(key);
      evicted++;
    }
  }
  if (evicted > 0) console.log(`[SESSION-GC] Evicted ${evicted} idle sessions, ${chatSessions.size} remaining`);
}, 30 * 60 * 1000); // run every 30 min

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
  session.lastUsed = Date.now();

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

      console.log(`[WEBHOOK-POST] client=${client.id} msg type=${msg.type} from=${from}`);

      // ── Image messages ──────────────────────────────────────────────────────
      if (msg.type === 'image') {
        const caption = msg.image?.caption?.trim() || '';
        console.log(`[WEBHOOK-POST] Image from ${from} | caption="${caption}"`);

        await db.upsertCustomer(from, null, client?.id);
        if (chatSessions.has(sessionKey)) {
          const dbMsgs = await db.getMessagesByPhone(from);
          if (dbMsgs.length === 0) chatSessions.delete(sessionKey);
        }
        if (!chatSessions.has(sessionKey)) {
          chatSessions.set(sessionKey, { chat: await buildChatSession(from, client), phoneNumber: from });
        }
        const imgSession = chatSessions.get(sessionKey);
        imgSession.lastUsed = Date.now();

        const imageNote = caption
          ? `[Customer sent a photo with caption: "${caption}". You cannot see the image itself. Respond based on context — if this is likely their horoscope chart, acknowledge it and add [[HOROSCOPE_RECEIVED]]. If it looks like a payment receipt, acknowledge and add [[PAYMENT_CHECK]]. Also add a short note that you cannot view images directly but the team will review it.]`
          : `[Customer sent a photo (no caption). You cannot see the image. Based on the current conversation stage — if a horoscope photo was expected, acknowledge it as the horoscope and add [[HOROSCOPE_RECEIVED]]. If payment was pending and a receipt was expected, acknowledge it as the receipt and add [[PAYMENT_CHECK]]. Add a short note that you cannot view images but the team will review it.]`;

        const mediaId = msg.image?.id || '';
        const userLabel = `[Photo:${mediaId}]${caption ? ` ${caption}` : ''}`;

        let customerMediaUrl = null;
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
              const mimeType = metaRes.data?.mime_type || 'image/jpeg';
              const ext = mimeType.split('/')[1]?.split(';')[0] || 'jpg';
              const fname = `wa-${from}-${Date.now()}.${ext}`;
              fs.writeFileSync(path.join(UPLOADS_DIR, fname), imgRes.data);
              customerMediaUrl = `/uploads/${fname}`;
              console.log(`[MEDIA-DL] Customer image saved: ${fname}`);
            }
          } catch (e) {
            console.warn('[MEDIA-DL] Failed to download customer image:', e.message);
          }
        }

        await db.insertMessage(from, userLabel, 'user', null, client?.id ?? null, 'image', customerMediaUrl);

        const { botReply, imagesToSend } = await handleMessage(from, imageNote, imgSession.chat, { skipUserInsert: true, client });
        if (botReply.trim()) await sendBotReply(from, botReply, client);

        for (const filename of imagesToSend) {
          const imgCaption = filename.toLowerCase().startsWith('horoscope')
            ? 'ලග්න කොටු 12 සහ නවාංශ කොටු 12 දෙකම පෙනෙන ලෙස photo send කරන්න 🙏'
            : 'මේවා මම ඉක්මනින්ම හොයාගත්ත කීප දෙනෙකුගේ screenshots 🙏';
          await sendWhatsAppImage(from, filename, imgCaption, client);
          const isPdf = filename.toLowerCase().endsWith('.pdf');
          await db.insertMessage(from, isPdf ? `[PDF: ${filename}]` : `[Image: ${filename}]`, 'bot', null, client?.id ?? null, isPdf ? 'pdf' : 'image', `/templates/${encodeURIComponent(filename)}`);
        }
        return;
      }

      // ── Document messages (PDFs etc.) ───────────────────────────────────────
      if (msg.type === 'document') {
        const docMediaId = msg.document?.id;
        const docFileName = msg.document?.filename || 'document.pdf';
        let docStoredUrl = null;
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
              const safeName = docFileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
              const fname = `wa-doc-${from}-${Date.now()}-${safeName}`;
              fs.writeFileSync(path.join(UPLOADS_DIR, fname), docRes.data);
              docStoredUrl = `/uploads/${fname}`;
              console.log(`[MEDIA-DL] Customer document saved: ${fname}`);
            }
          } catch (e) {
            console.warn('[MEDIA-DL] Failed to download customer document:', e.message);
          }
        }
        await db.upsertCustomer(from, null, client?.id);
        await db.insertMessage(from, `[Document: ${docFileName}]`, 'user', null, client?.id ?? null, 'pdf', docStoredUrl);
        await sendWhatsAppMessage(from, 'ලිපිය ලැබුණා, ස්තූතියි! 🙏', client);
        return;
      }

      // ── Text messages ───────────────────────────────────────────────────────
      userMessage = msg.text?.body;
      if (!userMessage) {
        console.log(`[WEBHOOK-POST] Unsupported message type "${msg.type}" from ${from} — skipping`);
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
        const dbMsgs = await db.getMessagesByPhone(from);
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
});

// ─── Background retry worker ──────────────────────────────────────────────────
const RETRY_DELAYS_MIN = [5, 10, 20, 40, 60];

setInterval(async () => {
  try {
    const { rows } = await db.pgQuery(
      `SELECT * FROM message_retry_queue
       WHERE resolved_at IS NULL AND retry_after <= NOW() AND attempts < max_attempts
       ORDER BY retry_after LIMIT 5`
    );
    if (!rows.length) return;

    for (const item of rows) {
      const nextAttempt = item.attempts + 1;
      const nextDelay = RETRY_DELAYS_MIN[nextAttempt] || 60;
      await db.pgQuery(
        `UPDATE message_retry_queue SET attempts=$1, retry_after=NOW() + $2::interval WHERE id=$3`,
        [nextAttempt, `${nextDelay} minutes`, item.id]
      );

      try {
        console.log(`[RETRY-WORKER] Retrying msg from ${item.phone_number} (attempt ${nextAttempt}/${item.max_attempts})`);
        const client = await clientRouter.getClientById(item.client_id);
        if (!client) throw new Error('Client not found');

        const sessionKey = `${client.id}:${item.phone_number}`;
        if (!chatSessions.has(sessionKey)) {
          chatSessions.set(sessionKey, {
            chat: await buildChatSession(item.phone_number, client),
            phoneNumber: item.phone_number,
          });
        }
        const session = chatSessions.get(sessionKey);
        session.lastUsed = Date.now();

        const retryNote = `[SYSTEM: This is a retry. The customer's previous message could not be processed ${item.attempts} time(s) due to a temporary service issue. Please start your reply with a brief, natural apology for the short delay (e.g. "Sorry for the short wait! 🙏"), then respond normally to their message.]`;

        const { botReply } = await handleMessage(
          item.phone_number, item.message_text, session.chat,
          { skipUserInsert: true, client, retryNote }
        );

        await sendBotReply(item.phone_number, botReply, client);
        await db.pgQuery(`UPDATE message_retry_queue SET resolved_at=NOW() WHERE id=$1`, [item.id]);
        console.log(`[RETRY-WORKER] Success for ${item.phone_number}`);

      } catch (retryErr) {
        console.error(`[RETRY-WORKER] Attempt ${nextAttempt} failed for ${item.phone_number}:`, retryErr.message);
        // If the session history is corrupt, drop it so next attempt rebuilds fresh from DB
        if (/function response turn/i.test(retryErr.message || '')) {
          chatSessions.delete(sessionKey);
          console.warn(`[RETRY-WORKER] Dropped corrupt session for ${item.phone_number} — will rebuild on next attempt`);
        }
        if (nextAttempt >= item.max_attempts) {
          try {
            const client = await clientRouter.getClientById(item.client_id);
            if (client) {
              await sendWhatsAppMessage(
                item.phone_number,
                "We sincerely apologize — we're having prolonged technical difficulties. Please try contacting us again later. We're sorry for the trouble! 🙏",
                client
              );
            }
          } catch (_) {}
          await db.pgQuery(`UPDATE message_retry_queue SET resolved_at=NOW() WHERE id=$1`, [item.id]);
          console.log(`[RETRY-WORKER] Max attempts reached for ${item.phone_number} — resolved as failed`);
        }
      }
    }
  } catch (e) {
    console.error(`[RETRY-WORKER] Worker error:`, e.message);
  }
}, 2 * 60 * 1000);

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
      await db.insertMessage(phone, `[Image]${text ? ': ' + text : ''}`, 'bot', null, null, 'image', null);
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
        const pdfSaveName = `admin-pdf-${Date.now()}-${(fileName || 'document.pdf').replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, pdfSaveName), buffer);
        const pdfHostedUrl = `/uploads/${pdfSaveName}`;
        await db.insertMessage(phone, `[PDF: ${fileName || 'document.pdf'}]${text ? ' ' + text : ''}`, 'bot', null, null, 'pdf', pdfHostedUrl);
      } else {
        // Send as image
        await axios.post(
          `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
          { messaging_product: 'whatsapp', to: phone, type: 'image', image: { id: uploadData.id, caption: text || '' } },
          { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        await db.insertMessage(phone, `[Image]${text ? ': ' + text : ''}`, 'bot', null, null, 'image', null);
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
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
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
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
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
      `You are a warm assistant for a professional astrology service. Below is a conversation with a potential customer who has NOT placed an order yet.\n\nConversation:\n${historyText}\n\nWrite a single short, warm, natural follow-up WhatsApp message to re-engage this customer. Be genuine — not pushy. Do not list packages or prices unless they previously asked. Just warmly re-open the conversation.`
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

// POST /admin/upload-image — upload product image to Cloudinary
app.post('/admin/upload-image', adminAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  if (!cloud || !apiKey || !apiSecret) return res.status(500).json({ error: 'Cloudinary not configured' });
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha1')
      .update(`folder=products&timestamp=${timestamp}${apiSecret}`)
      .digest('hex');
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    form.append('folder', 'products');
    form.append('timestamp', String(timestamp));
    form.append('api_key', apiKey);
    form.append('signature', signature);
    const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.error?.message || 'Cloudinary error' });
    res.json({ url: data.secure_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

// ═══════════════════════════════════════════════════════════════════════════════
// CRM AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    // Check superadmin first
    const saRow = await db.pgQuery(`SELECT * FROM crm_users WHERE username=$1 AND role='superadmin'`, [username]);
    if (saRow.rows.length > 0) {
      const valid = await bcrypt.compare(password, saRow.rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ sub: username, role: 'superadmin', clientId: null }, JWT_SECRET, { expiresIn: '7d' });
      const user = { role: 'superadmin', clientId: null, name: 'Super Admin' };
      return res.json({ token, user });
    }
    // Check client user
    const cfgRow = await db.pgQuery(
      `SELECT cc.crm_password_hash, c.name FROM client_configs cc JOIN clients c ON c.id=cc.client_id WHERE cc.client_id=$1 AND c.active=TRUE`,
      [username]
    );
    if (!cfgRow.rows.length || !cfgRow.rows[0].crm_password_hash)
      return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, cfgRow.rows[0].crm_password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ sub: username, role: 'client', clientId: username }, JWT_SECRET, { expiresIn: '7d' });
    const user = { role: 'client', clientId: username, name: cfgRow.rows[0].name };
    return res.json({ token, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /auth/me
app.get('/auth/me', jwtAuth, (req, res) => res.json(req.user));

// POST /auth/set-password — set CRM password for a client (superadmin only or self)
app.post('/auth/set-password', jwtAuth, async (req, res) => {
  const { clientId, password } = req.body;
  if (!clientId || !password) return res.status(400).json({ error: 'clientId and password required' });
  if (req.user.role !== 'superadmin' && req.user.clientId !== clientId)
    return res.status(403).json({ error: 'Forbidden' });
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.pgQuery(`UPDATE client_configs SET crm_password_hash=$1 WHERE client_id=$2`, [hash, clientId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRM API ROUTES (JWT protected)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/clients — list clients (superadmin only)
app.get('/api/clients', jwtAuth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const r = await db.pgQuery(`SELECT c.id AS client_id, c.name, c.type, c.active, cc.brand_name, cc.brand_color FROM clients c LEFT JOIN client_configs cc ON cc.client_id=c.id WHERE c.active=TRUE ORDER BY c.name`);
    res.json({ clients: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/customers — paginated
app.get('/api/customers', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;
  try {
    const where = clientId
      ? `WHERE cu.client_id=$1 ${search ? "AND (cu.phone_number ILIKE $4 OR cu.name ILIKE $4)" : ''}`
      : `WHERE 1=1 ${search ? "AND (cu.phone_number ILIKE $3 OR cu.name ILIKE $3)" : ''}`;
    const params = clientId
      ? [clientId, limit, offset, ...(search ? [`%${search}%`] : [])]
      : [limit, offset, ...(search ? [`%${search}%`] : [])];
    const q = `
      SELECT cu.phone_number, cu.phone_number AS phone, cu.name, cu.client_id, cu.updated_at,
             COUNT(DISTINCT m.id) AS message_count,
             COUNT(DISTINCT o.id) AS order_count,
             MAX(m.created_at) AS last_message_at,
             BOOL_OR(m.media_type = 'image') AS has_image,
             BOOL_OR(m.media_type IN ('pdf', 'document', 'audio', 'voice')) AS has_document,
             (SELECT status FROM orders o2 WHERE o2.phone_number=cu.phone_number ORDER BY o2.created_at DESC LIMIT 1) AS latest_order_status,
             (SELECT COUNT(*) FROM messages m2
              WHERE m2.phone_number = cu.phone_number
                AND m2.client_id    = cu.client_id
                AND m2.sender_type  = 'user'
                AND m2.created_at   > COALESCE(cu.last_read_at, '1970-01-01T00:00:00Z')
             ) AS unread_count
      FROM customers cu
      LEFT JOIN messages m ON m.phone_number=cu.phone_number
      LEFT JOIN orders   o ON o.phone_number=cu.phone_number
      ${where}
      GROUP BY cu.phone_number, cu.name, cu.client_id, cu.updated_at, cu.last_read_at
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT ${clientId ? '$2' : '$1'} OFFSET ${clientId ? '$3' : '$2'}`;
    const countQ = clientId
      ? `SELECT COUNT(*) FROM customers cu ${search ? "WHERE client_id=$1 AND (phone_number ILIKE $2 OR name ILIKE $2)" : "WHERE client_id=$1"}`
      : `SELECT COUNT(*) FROM customers cu ${search ? "WHERE (phone_number ILIKE $1 OR name ILIKE $1)" : ''}`;
    const countParams = clientId ? [clientId, ...(search ? [`%${search}%`] : [])] : (search ? [`%${search}%`] : []);
    const [rows, countRes] = await Promise.all([db.pgQuery(q, params), db.pgQuery(countQ, countParams)]);
    res.json({ customers: rows.rows, total: parseInt(countRes.rows[0].count), page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/messages/:phone — cursor-based lazy load
app.get('/api/messages/:phone', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const before = req.query.before; // ISO timestamp
  try {
    const params = before
      ? (clientId ? [phone, clientId, before, limit] : [phone, before, limit])
      : (clientId ? [phone, clientId, limit] : [phone, limit]);
    const q = `
      SELECT id, phone_number, message_text, sender_type, created_at, cost_usd, media_type, media_url, wamid, is_deleted
      FROM messages
      WHERE phone_number=$1 ${clientId ? 'AND client_id=$2' : ''}
      ${before ? `AND created_at < ${clientId ? '$3' : '$2'}` : ''}
      ORDER BY created_at DESC
      LIMIT ${before ? (clientId ? '$4' : '$3') : (clientId ? '$3' : '$2')}`;
    const r = await db.pgQuery(q, params);
    const msgs = r.rows.reverse(); // oldest first
    res.json({ messages: msgs, hasMore: msgs.length === limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/send — send WhatsApp message
app.post('/api/send', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { phone, message, type = 'text', mediaUrl } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  try {
    const client = clientId ? await clientRouter.getClientById(clientId) : null;
    if (type === 'text') {
      const wamid = await sendWhatsAppMessage(phone, message, client);
      await db.insertMessage(phone, message, 'bot', null, clientId, null, null, wamid);
    } else if (type === 'image' && mediaUrl) {
      const imgResp = await axios.post(
        `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
        { messaging_product: 'whatsapp', to: phone, type: 'image', image: { link: mediaUrl, caption: message } },
        { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
      );
      const wamid = imgResp.data?.messages?.[0]?.id || null;
      await db.insertMessage(phone, `[Image] ${message}`, 'bot', null, clientId, 'image', mediaUrl, wamid);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e?.response?.data?.error?.message || e.message }); }
});

// DELETE /api/customers/:phone/messages
app.delete('/api/customers/:phone/messages', jwtAuth, async (req, res) => {
  try {
    const phone = req.params.phone;
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
    await db.pgQuery(`DELETE FROM messages WHERE phone_number=$1`, [phone]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/messages/:id — soft-delete a message from CRM view
// Note: WhatsApp Cloud API does not support recalling sent messages, so this is CRM-only
app.delete('/api/messages/:id', jwtAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid message id' });
  const clientId = resolveClientId(req);
  try {
    const deleted = await db.deleteMessage(id, clientId);
    if (!deleted) return res.status(404).json({ error: 'Message not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/customers/:phone
app.delete('/api/customers/:phone', jwtAuth, async (req, res) => {
  try {
    const phone = req.params.phone;
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
    await db.deleteCustomer(phone);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/customers/:phone/mark-read — reset unread badge
app.post('/api/customers/:phone/mark-read', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    await db.pgQuery(
      `UPDATE customers SET last_read_at = NOW() WHERE phone_number = $1 AND client_id = $2`,
      [phone, clientId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Addon management (superadmin only) ──────────────────────────────────────

// Catalog of available addons
const ADDON_CATALOG = [
  {
    id: 'crm_media_send',
    name: 'CRM Media Send',
    description: 'Allows CRM agents to send images, PDFs, and audio messages to WhatsApp customers directly from the chat interface.',
  },
  {
    id: 'astro_vedic_chart',
    name: 'Vedic Astro Chart',
    description: 'Generates personalized astrology-based WhatsApp messages for customers using their vedic birth chart, to help recover pending orders.',
  },
];

// GET /api/addons?client_id=X — list addons + enabled state for a client
app.get('/api/addons', jwtAuth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = await db.pgQuery(`SELECT addon_id, enabled FROM client_addons WHERE client_id=$1`, [clientId]);
    const enabledMap = Object.fromEntries(r.rows.map(row => [row.addon_id, row.enabled]));
    const addons = ADDON_CATALOG.map(a => ({ ...a, enabled: enabledMap[a.id] ?? false }));
    res.json({ addons });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/addons/:addonId — toggle addon for a client (superadmin only)
app.put('/api/addons/:addonId', jwtAuth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { addonId } = req.params;
  const { client_id: clientId, enabled } = req.body;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!ADDON_CATALOG.find(a => a.id === addonId)) return res.status(404).json({ error: 'Unknown addon' });
  try {
    await db.pgQuery(
      `INSERT INTO client_addons (client_id, addon_id, enabled) VALUES ($1,$2,$3)
       ON CONFLICT (client_id, addon_id) DO UPDATE SET enabled=$3`,
      [clientId, addonId, !!enabled]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/crm/addons-status — returns enabled addon IDs for current client (used by frontend)
app.get('/api/crm/addons-status', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.json({ addons: [] });
  try {
    const r = await db.pgQuery(
      `SELECT addon_id FROM client_addons WHERE client_id=$1 AND enabled=TRUE`,
      [clientId]
    );
    res.json({ addons: r.rows.map(row => row.addon_id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/crm/send-media — CRM agent sends image/pdf/audio to a WhatsApp customer
app.post('/api/crm/send-media', jwtAuth, uploadMedia.single('file'), async (req, res) => {
  const clientId = resolveClientId(req);
  const { phone, caption = '' } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    // Verify addon is enabled for this client
    const addonCheck = await db.pgQuery(
      `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='crm_media_send' AND enabled=TRUE`,
      [clientId]
    );
    if (!addonCheck.rows.length) return res.status(403).json({ error: 'crm_media_send addon not enabled' });

    const client = clientId ? await clientRouter.getClientById(clientId) : null;
    const base = process.env.PUBLIC_URL || '';
    const fileUrl = `${base}/uploads/${req.file.filename}`;
    const mime = req.file.mimetype;
    const origName = req.file.originalname;

    let waPayload;
    let mediaType;
    let msgText;

    if (/^image\//.test(mime)) {
      waPayload = { type: 'image', image: { link: fileUrl, ...(caption && { caption }) } };
      mediaType = 'image';
      msgText = caption || `[Image: ${origName}]`;
    } else if (mime === 'application/pdf') {
      waPayload = { type: 'document', document: { link: fileUrl, filename: origName, ...(caption && { caption }) } };
      mediaType = 'pdf';
      msgText = `[PDF: ${origName}]`;
    } else {
      waPayload = { type: 'audio', audio: { link: fileUrl } };
      mediaType = 'audio';
      msgText = `[Audio: ${origName}]`;
    }

    const mediaResp = await axios.post(
      `https://graph.facebook.com/v18.0/${waPhoneId(client)}/messages`,
      { messaging_product: 'whatsapp', to: phone, ...waPayload },
      { headers: { Authorization: `Bearer ${waToken(client)}`, 'Content-Type': 'application/json' } }
    );
    const wamid = mediaResp.data?.messages?.[0]?.id || null;

    await db.insertMessage(phone, msgText, 'bot', null, clientId, mediaType, fileUrl, wamid);
    res.json({ ok: true, url: fileUrl });
  } catch (e) {
    console.error('[CRM MEDIA] send-media error:', e.message);
    res.status(500).json({ error: e?.response?.data?.error?.message || e.message });
  }
});
// ─── Plugin routes ────────────────────────────────────────────────────────────

const DEFAULT_ASTRO_PROMPT = `You are a warm astrology consultant. Based on the following vedic birth chart data, write a short, personalized WhatsApp message (2-3 sentences) to the customer to encourage them to complete their pending reading booking. Mention one specific planetary placement or nakshatra from their chart. Keep the tone friendly, spiritual, and encouraging. Do not mention prices. Reply only with the message text, no labels or preamble.\n\nChart data:\n{chart_json}`;

// GET /api/plugins/:pluginId/config — get plugin config for current client
app.get('/api/plugins/:pluginId/config', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { pluginId } = req.params;
  try {
    const config = await db.getPluginConfig(clientId, pluginId);
    const defaults = pluginId === 'astro_vedic_chart'
      ? { name: 'Vedic Astro Chart', prompt: DEFAULT_ASTRO_PROMPT }
      : { name: pluginId, prompt: '' };
    res.json({ ...defaults, ...config });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/plugins/:pluginId/config — update plugin config (superadmin or own client)
app.put('/api/plugins/:pluginId/config', jwtAuth, async (req, res) => {
  const clientId = req.body.client_id || resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  // Allow superadmin for any client; allow client users to update their own config only
  if (req.user.role !== 'superadmin' && req.user.clientId !== clientId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { pluginId } = req.params;
  const { name, prompt, api_key } = req.body;
  try {
    const existing = await db.getPluginConfig(clientId, pluginId);
    const update = { ...existing };
    if (name !== undefined) update.name = name;
    if (prompt !== undefined) update.prompt = prompt;
    if (api_key !== undefined) update.api_key = api_key;
    await db.upsertPluginConfig(clientId, pluginId, update);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/plugins/:pluginId/customer-data/:phone — get saved customer data for a plugin
app.get('/api/plugins/:pluginId/customer-data/:phone', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { pluginId, phone } = req.params;
  try {
    const data = await db.getPluginCustomerData(clientId, phone, pluginId);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/plugins/astro-chart — generate astro message for a customer
app.post('/api/plugins/astro-chart', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  // Check addon enabled
  const addonCheck = await db.pgQuery(
    `SELECT enabled FROM client_addons WHERE client_id=$1 AND addon_id='astro_vedic_chart' AND enabled=TRUE`,
    [clientId]
  );
  if (!addonCheck.rows.length) return res.status(403).json({ error: 'astro_vedic_chart addon not enabled' });

  const { phone, birth_date, birth_time, lat, lng, birth_place_name } = req.body;
  if (!phone || !birth_date || !birth_time || lat == null || lng == null) {
    return res.status(400).json({ error: 'phone, birth_date, birth_time, lat, lng required' });
  }

  try {
    // Get plugin config first (need api_key before calling freeastroapi)
    const config = await db.getPluginConfig(clientId, 'astro_vedic_chart');

    // Save birth place for future pre-fill
    if (birth_place_name) {
      await db.upsertPluginCustomerData(clientId, phone, 'astro_vedic_chart', { birth_place_name, lat, lng });
    }

    // Parse birth date/time
    const [year, month, day] = birth_date.split('-').map(Number);
    const [hour, minute] = birth_time.split(':').map(Number);

    // Validate parsed values
    if (!year || !month || !day || isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute)) {
      return res.status(400).json({ error: 'Invalid birth date or time. Use YYYY-MM-DD and HH:MM format.' });
    }

    // Call freeastroapi
    const astroResp = await axios.post(
      'https://api.freeastroapi.com/api/v1/vedic/chart',
      { year, month, day, hour, minute, lat: parseFloat(lat), lng: parseFloat(lng), tz_str: 'Asia/Colombo', city: birth_place_name || '' },
      { headers: { 'x-api-key': config.api_key || process.env.FREEASTRO_API_KEY, 'Content-Type': 'application/json' } }
    );
    const chartData = astroResp.data;
    const promptTemplate = config.prompt || DEFAULT_ASTRO_PROMPT;
    const prompt = promptTemplate.replace('{chart_json}', JSON.stringify(chartData, null, 2));

    // Call Gemini
    const pluginModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const geminiResult = await pluginModel.generateContent(prompt);
    const text = geminiResult.response.text();

    res.json({ text });
  } catch (e) {
    console.error('[ASTRO] error:', e?.response?.data || e.message);
    const detail = e?.response?.data?.detail;
    const errMsg = Array.isArray(detail)
      ? detail.map(d => `${d.loc?.slice(-1)?.[0] || 'field'}: ${d.msg}`).join('; ')
      : (typeof detail === 'string' ? detail : e.message);
    res.status(500).json({ error: errMsg });
  }
});

// GET /api/customers/:phone/ai-mode
app.get('/api/customers/:phone/ai-mode', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  try {
    const enabled = await db.getCustomerAiEnabled(phone, clientId);
    res.json({ ai_enabled: enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/customers/:phone/ai-mode
app.patch('/api/customers/:phone/ai-mode', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { phone } = req.params;
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
  try {
    await db.setCustomerAiMode(phone, clientId, enabled);
    if (!enabled) chatSessions.delete(`${clientId}:${phone}`);
    res.json({ ok: true, ai_enabled: enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Media library endpoints ──────────────────────────────────────────────────
// POST /api/media/upload — upload an image file to the persistent volume
app.post('/api/media/upload', jwtAuth, uploadDisk.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received' });
  const base = process.env.PUBLIC_URL || '';
  const url  = `${base}/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});

app.get('/api/media', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try { res.json({ media: await db.getClientMedia(clientId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/media', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { title, description, image_url, sort_order = 0 } = req.body;
  if (!title || !description || !image_url) return res.status(400).json({ error: 'title, description, image_url required' });
  try {
    const id = await db.insertMedia(clientId, title, description, image_url, sort_order);
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/media/:id', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { title, description, image_url, sort_order = 0 } = req.body;
  try {
    await db.updateMedia(req.params.id, clientId, title, description, image_url, sort_order);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/media/:id', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  try {
    await db.deleteMedia(req.params.id, clientId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders — paginated
app.get('/api/orders', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';
  try {
    const conditions = [];
    const params = [];
    if (clientId) { params.push(clientId); conditions.push(`o.client_id=$${params.length}`); }
    if (status)   { params.push(status);   conditions.push(`o.status=$${params.length}`); }
    if (search)   { params.push(`%${search}%`); conditions.push(`(o.order_id ILIKE $${params.length} OR o.phone_number ILIKE $${params.length})`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);  const limitIdx  = params.length;
    params.push(offset); const offsetIdx = params.length;
    const countConditions = [];
    const countParams = [];
    if (clientId) { countParams.push(clientId); countConditions.push(`client_id=$${countParams.length}`); }
    if (status)   { countParams.push(status);   countConditions.push(`status=$${countParams.length}`); }
    if (search)   { countParams.push(`%${search}%`); countConditions.push(`(order_id ILIKE $${countParams.length} OR phone_number ILIKE $${countParams.length})`); }
    const countWhere = countConditions.length ? `WHERE ${countConditions.join(' AND ')}` : '';
    const [rows, countRes] = await Promise.all([
      db.pgQuery(`SELECT o.*, o.phone_number AS phone, cu.name AS customer_name FROM orders o LEFT JOIN customers cu ON cu.phone_number=o.phone_number ${where} ORDER BY o.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params),
      db.pgQuery(`SELECT COUNT(*) FROM orders ${countWhere}`, countParams),
    ]);
    res.json({ orders: rows.rows, total: parseInt(countRes.rows[0].count), page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/export — CSV download
app.get('/api/orders/export', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  try {
    const where = clientId ? 'WHERE o.client_id=$1' : '';
    const params = clientId ? [clientId] : [];
    const r = await db.pgQuery(
      `SELECT o.order_id, o.phone_number, cu.name AS customer_name, o.package, o.status,
              o.birth_date, o.birth_time, o.birth_city, o.problems,
              o.horoscope_received, o.receipt_received, o.created_at, o.client_id
       FROM orders o LEFT JOIN customers cu ON cu.phone_number=o.phone_number
       ${where} ORDER BY o.created_at DESC`, params
    );
    const cols = ['order_id','phone_number','customer_name','package','status','birth_date','birth_time','birth_city','problems','horoscope_received','receipt_received','created_at','client_id'];
    const csv  = [cols.join(','), ...r.rows.map(row =>
      cols.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(',')
    )].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/orders/:id/status
app.patch('/api/orders/:id/status', jwtAuth, async (req, res) => {
  try {
    await db.pgQuery(`UPDATE orders SET status=$1 WHERE order_id=$2`, [req.body.status, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/orders/:id/flags
app.patch('/api/orders/:id/flags', jwtAuth, async (req, res) => {
  const { horoscope_received, receipt_received } = req.body;
  try {
    const sets = [], params = [];
    if (horoscope_received !== undefined) { params.push(horoscope_received); sets.push(`horoscope_received=$${params.length}`); }
    if (receipt_received   !== undefined) { params.push(receipt_received);   sets.push(`receipt_received=$${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    await db.pgQuery(`UPDATE orders SET ${sets.join(',')} WHERE order_id=$${params.length}`, params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/orders/:id/fields
app.patch('/api/orders/:id/fields', jwtAuth, async (req, res) => {
  const { custom_fields } = req.body;
  if (!custom_fields || typeof custom_fields !== 'object')
    return res.status(400).json({ error: 'custom_fields object required' });
  try {
    await db.updateOrderCustomFields(req.params.id, custom_fields);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/orders/:id/notes
app.patch('/api/orders/:id/notes', jwtAuth, async (req, res) => {
  const { notes } = req.body;
  try {
    await db.pgQuery(`UPDATE orders SET notes=$1 WHERE order_id=$2`, [notes ?? null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/products
app.get('/api/products', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const search = req.query.search || '';
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;
  try {
    let r, countR;
    if (search) {
      r = await db.pgQuery(
        `SELECT * FROM client_products WHERE client_id=$1 AND (name ILIKE $2 OR description ILIKE $2 OR category ILIKE $2) ORDER BY category, sort_order, name LIMIT $3 OFFSET $4`,
        [clientId, `%${search}%`, limit, offset]
      );
      countR = await db.pgQuery(`SELECT COUNT(*) FROM client_products WHERE client_id=$1 AND (name ILIKE $2 OR description ILIKE $2 OR category ILIKE $2)`, [clientId, `%${search}%`]);
    } else {
      r = await db.pgQuery(`SELECT * FROM client_products WHERE client_id=$1 ORDER BY category, sort_order, name LIMIT $2 OFFSET $3`, [clientId, limit, offset]);
      countR = await db.pgQuery(`SELECT COUNT(*) FROM client_products WHERE client_id=$1`, [clientId]);
    }
    res.json({ products: r.rows, total: parseInt(countR.rows[0].count) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/products/:id
app.get('/api/products/:id', jwtAuth, async (req, res) => {
  try {
    const r = await db.pgQuery(`SELECT * FROM client_products WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ product: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/products
app.post('/api/products', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes, active } = req.body;
  if (!clientId || !name) return res.status(400).json({ error: 'name required' });
  try {
    const r = await db.pgQuery(
      `INSERT INTO client_products (client_id,name,description,price,price_max,currency,category,subcategory,sku,image_url,sort_order,attributes,active,qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [clientId, name, description||null, price||null, price_max||null, currency||'LKR', category||null, subcategory||null, sku||null, image_url||null, sort_order||0, JSON.stringify(attributes||{}), active !== false, parseInt(req.body.qty)||0]
    );
    try { const emb = await embedText(productToText(req.body)); await db.saveProductEmbedding(r.rows[0].id, emb); } catch (_) {}
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/products/:id
app.put('/api/products/:id', jwtAuth, async (req, res) => {
  const { name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes, active } = req.body;
  try {
    await db.pgQuery(
      `UPDATE client_products SET name=$1,description=$2,price=$3,price_max=$4,currency=$5,category=$6,subcategory=$7,sku=$8,image_url=$9,sort_order=$10,attributes=$11,active=$12,qty=$13,updated_at=NOW() WHERE id=$14`,
      [name, description||null, price||null, price_max||null, currency||'LKR', category||null, subcategory||null, sku||null, image_url||null, sort_order||0, JSON.stringify(attributes||{}), active !== false, parseInt(req.body.qty)||0, req.params.id]
    );
    try { const emb = await embedText(productToText(req.body)); await db.saveProductEmbedding(req.params.id, emb); } catch (_) {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/products/:id
app.delete('/api/products/:id', jwtAuth, async (req, res) => {
  try {
    await db.pgQuery(`DELETE FROM client_products WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/products/bulk
app.post('/api/products/bulk', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { products } = req.body;
  if (!clientId || !Array.isArray(products)) return res.status(400).json({ error: 'products[] required' });
  let schema = [];
  try { const r = await db.pgQuery(`SELECT field_key FROM client_attribute_schemas WHERE client_id=$1`, [clientId]); schema = r.rows; } catch (_) {}
  const validKeys = new Set(schema.map(s => s.field_key));
  const saved = [], errors = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p.name) { errors.push(`Row ${i+1}: name required`); continue; }
    if (p.attributes && validKeys.size > 0) {
      const unknown = Object.keys(p.attributes).filter(k => !validKeys.has(k));
      if (unknown.length) { errors.push(`Row ${i+1} (${p.name}): unknown attributes: ${unknown.join(', ')}`); continue; }
    }
    try {
      const r = await db.pgQuery(
        `INSERT INTO client_products (client_id,name,description,price,price_max,currency,category,subcategory,sku,image_url,sort_order,attributes,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [clientId, p.name, p.description||null, p.price||null, p.price_max||null, p.currency||'LKR', p.category||null, p.subcategory||null, p.sku||null, p.image_url||null, p.sort_order||i, p.attributes ? JSON.stringify(p.attributes) : null, p.active !== false]
      );
      saved.push(r.rows[0].id);
    } catch (e) { errors.push(`Row ${i+1} (${p.name}): ${e.message}`); }
  }
  res.json({ ok: true, saved: saved.length, errors });
});

// GET /api/attributes
app.get('/api/attributes', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = await db.pgQuery(`SELECT * FROM client_attribute_schemas WHERE client_id=$1 ORDER BY sort_order`, [clientId]);
    res.json({ attributes: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/attributes
app.post('/api/attributes', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { field_key, field_label, field_type, options, unit, filterable } = req.body;
  if (!clientId || !field_key || !field_label) return res.status(400).json({ error: 'field_key and field_label required' });
  try {
    await db.pgQuery(
      `INSERT INTO client_attribute_schemas (client_id,field_key,field_label,field_type,options,unit,filterable)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (client_id,field_key) DO UPDATE SET field_label=$3,field_type=$4,options=$5,unit=$6,filterable=$7`,
      [clientId, field_key, field_label, field_type||'text', options ? JSON.stringify(options) : null, unit||null, filterable !== false]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/attributes/:id
app.put('/api/attributes/:id', jwtAuth, async (req, res) => {
  const { field_label, field_type, options, unit, filterable } = req.body;
  try {
    await db.pgQuery(
      `UPDATE client_attribute_schemas SET field_label=$1,field_type=$2,options=$3,unit=$4,filterable=$5 WHERE id=$6`,
      [field_label, field_type||'text', options ? JSON.stringify(options) : null, unit||null, filterable !== false, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/attributes/:id
app.delete('/api/attributes/:id', jwtAuth, async (req, res) => {
  try {
    await db.pgQuery(`DELETE FROM client_attribute_schemas WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/attributes/bulk
app.post('/api/attributes/bulk', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  const { attributes } = req.body;
  if (!clientId || !Array.isArray(attributes)) return res.status(400).json({ error: 'attributes[] required' });
  const errors = [];
  for (let i = 0; i < attributes.length; i++) {
    const a = attributes[i];
    try {
      await db.pgQuery(
        `INSERT INTO client_attribute_schemas (client_id,field_key,field_label,field_type,options,unit,filterable,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (client_id,field_key) DO UPDATE SET field_label=$3,field_type=$4,options=$5,unit=$6,filterable=$7,sort_order=$8`,
        [clientId, a.field_key, a.field_label, a.field_type||'text', a.options ? JSON.stringify(a.options) : null, a.unit||null, a.filterable !== false, a.sort_order||i]
      );
    } catch (e) { errors.push(`${a.field_key}: ${e.message}`); }
  }
  res.json({ ok: true, saved: attributes.length - errors.length, errors });
});

// POST /api/upload-image
app.post('/api/upload-image', jwtAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  if (!cloud || !apiKey || !apiSecret) return res.status(500).json({ error: 'Cloudinary not configured' });
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha1').update(`folder=products&timestamp=${timestamp}${apiSecret}`).digest('hex');
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    form.append('folder', 'products');
    form.append('timestamp', String(timestamp));
    form.append('api_key', apiKey);
    form.append('signature', signature);
    const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.error?.message || 'Cloudinary error' });
    res.json({ url: data.secure_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/password
app.put('/api/settings/password', jwtAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword required' });
  const clientId = req.user.clientId;
  if (!clientId) return res.status(403).json({ error: 'Superadmin password change not supported via API' });
  try {
    const r = await db.pgQuery(`SELECT crm_password_hash FROM client_configs WHERE client_id=$1`, [clientId]);
    if (!r.rows.length || !r.rows[0].crm_password_hash) return res.status(400).json({ error: 'No password set' });
    const valid = await bcrypt.compare(currentPassword, r.rows[0].crm_password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.pgQuery(`UPDATE client_configs SET crm_password_hash=$1 WHERE client_id=$2`, [hash, clientId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/prompt
app.put('/api/settings/prompt', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { prompt, error_message, order_fields, contact_number, knowledge_base_enabled, product_catalog_enabled, plugin_enabled } = req.body;
  let parsedFields = [];
  if (Array.isArray(order_fields)) {
    parsedFields = order_fields
      .map(f => ({
        key: String(f.key || '').trim(),
        label: String(f.label || '').trim(),
        description: String(f.description || '').trim(),
        required: Boolean(f.required),
      }))
      .filter(f => f.key && f.label);
  }
  try {
    await db.pgQuery(
      `UPDATE client_configs SET custom_prompt=$1, error_message=$2, order_fields=$3, contact_number=$4, knowledge_base_enabled=$5, product_catalog_enabled=$6, system_prompt_mode='custom', updated_at=NOW(), plugin_enabled=COALESCE($8, plugin_enabled) WHERE client_id=$7`,
      [prompt || null, error_message || null, JSON.stringify(parsedFields), contact_number || null,
        knowledge_base_enabled === true || knowledge_base_enabled === 'true',
        product_catalog_enabled === true || product_catalog_enabled === 'true',
        clientId,
        // superadmin: can enable or disable; client: can only disable (set false), not enable
        plugin_enabled === false || plugin_enabled === 'false' ? false
          : (req.user?.role === 'superadmin' && (plugin_enabled === true || plugin_enabled === 'true')) ? true
          : null // null → COALESCE keeps existing DB value
      ]

    );
    clientRouter.invalidateCache(clientId);
    pluginLoader.invalidatePlugin(clientId);
    for (const key of chatSessions.keys()) {
      if (key.startsWith(`${clientId}:`)) chatSessions.delete(key);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/settings
app.get('/api/settings', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const r = await db.pgQuery(
      `SELECT custom_prompt, error_message, system_prompt_mode, temperature, brand_name, brand_color, order_fields, contact_number, knowledge_base_enabled, product_catalog_enabled, plugin_enabled FROM client_configs WHERE client_id=$1`,
      [clientId]
    );
    const row = r.rows[0] || {};
    if (row.order_fields && typeof row.order_fields === 'string') {
      try { row.order_fields = JSON.parse(row.order_fields); } catch { row.order_fields = []; }
    }
    if (!row.order_fields) row.order_fields = [];
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Knowledge base API ───────────────────────────────────────────────────────

// GET /api/knowledge — list document sections
app.get('/api/knowledge', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const sections = await db.getKnowledgeSections(clientId);
    res.json(sections);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/knowledge/:title/chunks — list chunks for a document
app.get('/api/knowledge/:title/chunks', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const chunks = await db.getKnowledgeChunksByTitle(clientId, decodeURIComponent(req.params.title));
    res.json(chunks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/knowledge — add a document (chunk + embed)
app.post('/api/knowledge', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
  try {
    const chunks = chunkText(content);
    if (!chunks.length) return res.status(400).json({ error: 'No content to embed' });
    const BATCH = 10;
    let total = 0;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const embeddings = await Promise.all(batch.map(text => embedText(text)));
      await db.insertKnowledgeChunks(clientId, title, batch.map((content, j) => ({ content, embedding: embeddings[j] })));
      total += batch.length;
    }
    console.log(`[KNOWLEDGE] Added ${total} chunks for client ${clientId} title="${title}"`);
    res.json({ ok: true, chunks: total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/knowledge/chunks/:id — edit a single chunk (re-embeds)
app.put('/api/knowledge/chunks/:id', jwtAuth, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  try {
    const embedding = await embedText(content);
    await db.updateKnowledgeChunk(parseInt(req.params.id), content, embedding);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/knowledge/chunks/:id — delete a single chunk
app.delete('/api/knowledge/chunks/:id', jwtAuth, async (req, res) => {
  try {
    await db.deleteKnowledgeChunk(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/knowledge/:title — delete all chunks for a document
app.delete('/api/knowledge/:title', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    await db.deleteKnowledgeByTitle(clientId, decodeURIComponent(req.params.title));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/media/:mediaId — proxy WhatsApp media
app.get('/api/media/:mediaId', jwtAuth, async (req, res) => {
  const clientId = resolveClientId(req);
  try {
    const client = clientId ? await clientRouter.getClientById(clientId) : null;
    const token = waToken(client);
    const urlRes = await axios.get(`https://graph.facebook.com/v18.0/${req.params.mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
    const mediaUrl = urlRes.data.url;
    const mediaRes = await axios.get(mediaUrl, { headers: { Authorization: `Bearer ${token}` }, responseType: 'arraybuffer' });
    res.set('Content-Type', mediaRes.headers['content-type'] || 'application/octet-stream');
    res.send(Buffer.from(mediaRes.data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SPA fallback — serve React app for all non-API routes ───────────────────
app.get('*', (req, res) => {
  const isBackendRoute =
    req.path.startsWith('/api') ||
    req.path.startsWith('/admin') ||
    req.path.startsWith('/auth') ||
    req.path.startsWith('/webhook') ||
    req.path.startsWith('/legacy');
  if (isBackendRoute) return res.status(404).json({ error: 'Not found' });
  // Don't serve HTML for asset requests — they must exist as static files
  if (path.extname(req.path)) return res.status(404).send('Not found');
  const indexFile = path.join(__dirname, '../frontend/dist/index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  res.status(503).send('App not built');
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
  // Seed superadmin if SUPERADMIN_PASSWORD is set and no superadmin row exists yet
  if (db.IS_PG && process.env.SUPERADMIN_PASSWORD) {
    try {
      const existing = await db.pgQuery(`SELECT id FROM crm_users WHERE username='superadmin'`);
      if (existing.rows.length === 0) {
        const hash = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 10);
        await db.pgQuery(`INSERT INTO crm_users (username, password_hash, role) VALUES ('superadmin', $1, 'superadmin')`, [hash]);
        console.log('[AUTH] Superadmin user created');
      }
    } catch (e) { console.warn('[AUTH] Superadmin seed failed:', e.message); }
  }
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
