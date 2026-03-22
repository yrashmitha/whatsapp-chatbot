/**
 * @module services/gemini
 * @description Gemini AI service layer.
 * Manages model instances, chat sessions, message handling (including
 * function-calling loops, order markers), and cost tracking.
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const db           = require('../db');
const buildSystemInstruction = require('./buildInstruction');
const { buildOrderFieldsInstruction, buildContactInstruction } = require('./buildInstruction');
const pluginLoader = require('./pluginLoader');
const { embedText } = require('./embedder');
const { makeLogger } = require('../utils/logger');

// ─── Gemini client ────────────────────────────────────────────────────────────
const systemInstruction = buildSystemInstruction();
console.log(`[STARTUP] System instruction loaded (${systemInstruction.length} chars)`);

/** @type {import('@google/generative-ai').GoogleGenerativeAI} */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/** @type {import('@google/generative-ai').GenerativeModel} Default global model */
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction,
  generationConfig: {
    temperature: 0.7,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 4096,
    thinkingConfig: { thinkingBudget: 1024 },
  }
});

// ─── Cost calculation (Gemini 2.5 Flash pricing) ─────────────────────────────
const PRICE_INPUT  = 0.075 / 1_000_000;
const PRICE_OUTPUT = 0.30  / 1_000_000;

/**
 * Calculate the approximate cost of a Gemini API call.
 *
 * @param {number} i - Input token count
 * @param {number} o - Output token count
 * @returns {number} Cost in USD
 */
function calcCost(i, o) { return i * PRICE_INPUT + o * PRICE_OUTPUT; }

// ─── Order marker definitions ─────────────────────────────────────────────────
/** @type {RegExp} Matches [[ORDER_COMPLETE:{...}]] markers */
const ORDER_MARKER_REGEX   = /\[\[ORDER_COMPLETE:([\s\S]*?)\]\]/;
/** @type {RegExp} Matches [[ORDER_UPDATE:{...}]] markers */
const ORDER_UPDATE_REGEX   = /\[\[ORDER_UPDATE:([\s\S]*?)\]\]/;
/** @type {RegExp} Matches [[UPDATE_SUMMARY:...]] markers */
const UPDATE_SUMMARY_REGEX = /\[\[UPDATE_SUMMARY:([\s\S]*?)\]\]/;
/** @type {RegExp} Matches [[PAYMENT_IDENTIFIED:{...}]] markers */
const PAYMENT_IDENTIFIED_REGEX = /\[\[PAYMENT_IDENTIFIED:([\s\S]*?)\]\]/;
/**
 * Generate a unique order ID in the format <PREFIX><YEAR>-<NNNN>.
 *
 * @param {Object|null} client - Client config object (provides order_id_prefix)
 * @returns {Promise<string>} Generated order ID
 */
async function generateOrderId(client) {
  const prefix = (client && client.order_id_prefix) || 'PJ';
  const year   = new Date().getFullYear();
  const cnt    = await db.countOrdersByYear(`${prefix}${year}-%`, client?.id);
  const id     = `${prefix}${year}-${String(cnt + 1).padStart(4, '0')}`;
  console.log(`[ORDER_ID] Generated: ${id} (existing count: ${cnt})`);
  return id;
}

/**
 * Build a status note string listing the most recent orders for a phone number.
 * Injected at the start of each message so the AI is aware of order state.
 *
 * @param {string} phoneNumber - E.164 customer phone number
 * @returns {Promise<string|null>} Multi-line status note, or null if no orders
 */
async function buildOrderStatusNote(phoneNumber, clientId) {
  const all = await db.getOrdersByPhone(phoneNumber, clientId);
  if (!all.length) return null;
  const orders = all.slice(0, 5);
  const lines = orders.map(o => {
    const cf = o.custom_fields
      ? (typeof o.custom_fields === 'string' ? (() => { try { return JSON.parse(o.custom_fields); } catch { return {}; } })() : o.custom_fields)
      : {};
    const cfStr = Object.entries(cf).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `[ORDER ${o.order_id}: status=${o.status}, date=${String(o.created_at).split('T')[0]}${cfStr ? ', ' + cfStr : ''}${o.notes ? ', notes: ' + o.notes : ''}]`;
  });
  const note = lines.join('\n');
  const suffix = all.length > 5 ? `\n[NOTE: Showing last 5 orders only. Customer has ${all.length} orders total.]` : '';
  return note + suffix;
}

/**
 * Build a Gemini chat session for a customer, loading DB history and
 * configuring client-specific model settings, tools, and system instruction.
 *
 * @param {string}      phoneNumber - E.164 customer phone number
 * @param {Object|null} client      - Client config object
 * @returns {Promise<import('@google/generative-ai').ChatSession>} Configured chat session
 */
async function buildChatSession(phoneNumber, client) {
  console.log(`[SESSION] Building session for ${phoneNumber}`);
  const existingOrders = await db.getOrdersByPhone(phoneNumber, client?.id);
  console.log(`[SESSION] Found ${existingOrders.length} existing orders for ${phoneNumber}`);
  let initialHistory = [];

  if (existingOrders.length > 0) {
    const orderList = existingOrders
      .map(o => {
        const cf = o.custom_fields ? (typeof o.custom_fields === 'string' ? (() => { try { return JSON.parse(o.custom_fields); } catch { return {}; } })() : o.custom_fields) : {};
        const cfStr = Object.entries(cf).map(([k, v]) => `${k}: ${v}`).join(', ');
        return `Order ID: ${o.order_id} | Status: ${o.status} | Date: ${String(o.created_at).split('T')[0]}${cfStr ? ' | ' + cfStr : ''}${o.notes ? ' | Notes: ' + o.notes : ''}`;
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
      mediaBlock = '\n\n━━━ Media Files You Can Send ━━━\n'
        + 'Use the send_image tool to deliver images or PDF documents to the customer. Send them at the right moment based on these descriptions:\n'
        + mediaItems.map(m => `- "${m.title}" [${/\.pdf(\?|$)/i.test(m.image_url) ? 'PDF document' : 'image'}]: ${m.description}\n  URL: ${m.image_url}`).join('\n');
    }
    const hasProductCatalog = client?.product_catalog_enabled && db.IS_PG;
    const kbBlock = (client?.knowledge_base_enabled && db.IS_PG)
      ? '\n\n━━━ KNOWLEDGE BASE — MANDATORY ━━━\n'
        + 'Never answer from your own memory or training data. Always use the search tools.\n'
        + (hasProductCatalog
          ? 'TOOL ROUTING — follow strictly, regardless of what language the customer writes in:\n'
            + '- ANY question about price, cost, package tiers, plan options, plan comparison, what is included in a plan, or how much something costs → call search_products FIRST. This includes Sinhala queries such as "මිල", "පැකේජ", "කොපමණ", "ගාස්තු".\n'
            + '- Questions about policies, FAQs, how things work, delivery, terms, or general business info → call search_knowledge FIRST\n'
            + '- MANDATORY FALLBACK: If the first tool returns no useful results, you MUST call the other tool before doing anything else. Never skip this step.\n'
            + '- Only after BOTH tools have been called and BOTH returned no useful results → escalate to a human\n'
            + '- Never answer from your own knowledge. Never escalate after only one tool has been tried.\n'
          : 'Call search_knowledge before answering any customer question. If no useful results, tell the customer you could not find that information.\n')
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
    const clientApiKey = client.gemini_api_key
      || (client.use_system_gemini_key ? process.env.GEMINI_API_KEY : null);
    if (!clientApiKey) throw new Error(`No Gemini API key configured for client ${client.id}`);
    const clientGenAI = clientApiKey !== process.env.GEMINI_API_KEY
      ? new GoogleGenerativeAI(clientApiKey)
      : genAI;
    chatModel = clientGenAI.getGenerativeModel({
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
    description: 'Send an image or PDF document to the customer. Use this based on the media file descriptions in your system instructions — send files at exactly the right moment. Pass the exact image_url from your instructions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        image_url: { type: 'STRING', description: 'The direct file URL to send (image or PDF)' },
        caption:   { type: 'STRING', description: 'Short caption shown under the file. Always generate a relevant caption based on the file title and description — never leave this empty.' },
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
  const dbMsgs = await db.getMessagesByPhone(phoneNumber, client?.id);
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

/**
 * Handle an incoming message: send to Gemini, process function calls,
 * parse order/payment markers, persist to DB, and return the bot reply.
 *
 * @param {string} phoneNumber   - E.164 customer phone number
 * @param {string} userMessage   - Customer's message text
 * @param {Object} chatSession   - Active Gemini ChatSession instance
 * @param {Object} [options]
 * @param {boolean} [options.skipUserInsert] - If true, skip inserting the user message into DB
 * @param {Object|null} [options.client]     - Client config object
 * @param {string|null} [options.retryNote]  - Optional retry context prefix
 * @returns {Promise<{botReply: string, orderId: string|null, paymentReceived: boolean,
 *   callCostUSD: number, inputTokens: number, outputTokens: number,
 *   imagesToSend: string[], productImagesToSend: Array<{url: string, caption: string}>}>}
 */
async function handleMessage(phoneNumber, userMessage, chatSession, { skipUserInsert = false, client = null, retryNote = null, traceId = '?' } = {}) {
  const log = makeLogger(traceId, client?.id, phoneNumber);
  log.info(`[IN] "${userMessage.substring(0, 100)}"`);

  await db.upsertCustomer(phoneNumber, null, client?.id);
  if (!skipUserInsert) {
    await db.insertMessage(phoneNumber, userMessage, 'user', null, client?.id ?? null);
    log.info(`[DB] Saved user message`);
  }

  // For multilingual clients: always reload history from DB so _history is always
  // clean (no accumulated label noise from previous turns).
  const isMultilingual = client?.custom_prompt?.trim().startsWith('[[MULTILINGUAL]]');
  if (isMultilingual) {
    chatSession._history = [];
    log.info(`[LANG] Multilingual — forcing fresh DB history reload`);
  }

  // If in-memory history is empty, reload last 40 messages from DB
  if (!chatSession._history || chatSession._history.length === 0) {
    const dbMsgs = await db.getMessagesByPhone(phoneNumber, client?.id);
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
      log.info(`[SESSION] Reloaded ${merged.length} messages from DB${isMultilingual ? ' (multilingual)' : ''}`);
    }
  }

  // Inject current order status so AI knows what documents are already received
  const statusNote = await buildOrderStatusNote(phoneNumber, client?.id);
  let messageToSend = statusNote ? `${statusNote}\n\n${userMessage}` : userMessage;
  if (retryNote) messageToSend = `${retryNote}\n\n${messageToSend}`;

  // For multilingual clients: wrap current message with a clear marker so the system
  // instruction can unambiguously reference it for language detection.
  // History is always clean (reloaded from DB above), so no label accumulates.
  if (isMultilingual) {
    messageToSend = `[CURRENT_MESSAGE_START]\n${messageToSend}\n[CURRENT_MESSAGE_END]`;
    log.info(`[LANG] Wrapped message with language marker`);
  }

  log.info(`[GEMINI] Sending message | historyTurns=${chatSession._history?.length || 0} | msgLen=${messageToSend.length} | preview="${messageToSend.slice(0, 80).replace(/\n/g, '\\n')}"`);
  log.info(`[GEMINI] Full prompt: ${messageToSend.replace(/\n/g, '\\n')}`);
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await chatSession.sendMessage(messageToSend);
      break;
    } catch (aiErr) {
      const retryable = /503|unavailable|overloaded/i.test(aiErr.message || '');
      const funcTurnErr = /function response turn/i.test(aiErr.message || '');
      log.error(`[GEMINI] Attempt ${attempt}/3 failed:`, aiErr.message);
      if (attempt < 3 && retryable) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else if (attempt < 3 && funcTurnErr && chatSession._history) {
        // History has orphaned functionCall/functionResponse turns — strip them and retry
        log.warn('[GEMINI] Sanitizing history due to function turn mismatch, retrying...');
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
  log.info(`[FC] Gemini initial response has ${initialFcCalls?.length || 0} function call(s): [${(initialFcCalls || []).map(f => f.name).join(', ')}]`);
  while (candidate.functionCalls()?.length > 0 && fcLoopCount++ < 8) {
    const calls = candidate.functionCalls();
    const functionResponses = [];
    let anyHandled = false;

    for (const fc of calls) {
      if (fc.name === 'search_products' && client?.product_catalog_enabled && db.IS_PG) {
        const maxPrice = (fc.args.max_price != null && fc.args.max_price > 0) ? fc.args.max_price : null;
        log.info(`[RAG] search_products called with query: "${fc.args.query}"${maxPrice != null ? ` | max_price: ${maxPrice}` : ''}`);
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
            log.info(`[RAG] Vector search returned ${products.length} products`);
            resultText = formatProducts(products);
          }
        } catch (e) {
          log.warn('[RAG] Vector search failed, falling back to FTS:', e.message);
        }

        if (!products.length) {
          try {
            products = await db.searchProducts(client.id, fc.args.query, limit, maxPrice);
            if (products.length > 0) {
              log.info(`[RAG] FTS fallback returned ${products.length} products`);
              resultText = formatProducts(products);
            }
          } catch (e) {
            log.warn('[RAG] FTS fallback failed:', e.message);
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
        log.info(`[RAG] search_knowledge called with query: "${fc.args.query}"`);
        let resultText = 'No relevant information found in the knowledge base.';
        try {
          const emb = await embedText(fc.args.query);
          const chunks = await db.vectorSearchKnowledge(client.id, emb, 8);
          if (chunks.length > 0) {
            log.info(`[RAG] Knowledge base returned ${chunks.length} chunks`);
            resultText = 'IMPORTANT: Answer using ONLY the exact information below. Do not change numbers, add details, or use any outside knowledge.\n\n'
              + chunks.map(c => `[${c.title}]\n${c.content}`).join('\n\n---\n\n');
          } else {
            log.info(`[RAG] Knowledge base returned no results`);
          }
        } catch (e) {
          log.warn('[RAG] Knowledge search failed:', e.message);
        }
        functionResponses.push({ functionResponse: { name: 'search_knowledge', response: { result: resultText } } });
        anyHandled = true;

      } else if (fc.name === 'send_image') {
        const { image_url, caption = '' } = fc.args;
        log.info(`[MEDIA] send_image called: url="${image_url}" caption="${caption}"`);
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
  log.info(`[GEMINI] Raw response JSON: ${JSON.stringify({ parts: rawParts.map(p => ({ thought: !!p.thought, text: p.text?.slice(0, 300) })), rawReply: rawReply.slice(0, 500) })}`);

  let botReply  = rawReply
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*') // convert markdown **bold** → WhatsApp *bold*
    .replace(/\[ORDER STATUS[^\]]*\]\s*/gi, '') // strip any echoed ORDER STATUS note wherever it appears
    .trim();

  // If Gemini returned only thought parts or exited the function loop without text,
  // send one extra nudge to get a plain-text answer before falling back to the error message.
  // Always nudge when text is empty — even if media is queued, we still need a text reply
  if (!botReply) {
    log.warn('[GEMINI] Empty reply — nudging Gemini for plain text response');
    try {
      const nudge = await chatSession.sendMessage('Please provide your text reply now.');
      const nudgeParts = nudge.response.candidates?.[0]?.content?.parts || [];
      botReply = nudgeParts
        .filter(p => !p.thought && typeof p.text === 'string')
        .map(p => p.text)
        .join('')
        .trim();
      if (!botReply) botReply = nudge.response.text?.() || '';
      log.info(`[GEMINI] Nudge reply: "${botReply.substring(0, 80)}"`);
    } catch (e) {
      log.error('[GEMINI] Nudge failed:', e.message);
    }
  }

  if (!botReply) {
    log.warn('[GEMINI] Still empty after nudge — using fallback message');
    botReply = client?.error_message || "Sorry, I didn't get that. Could you please try again? 🙏";
  }

  // Extract [[SEND_IMAGE:filename]] markers
  const IMAGE_RE = /\[\[SEND_IMAGE:([^\]]+)\]\]/g;
  const imagesToSend = [];
  let m;
  while ((m = IMAGE_RE.exec(botReply)) !== null) imagesToSend.push(m[1].trim());
  if (imagesToSend.length > 0) {
    botReply = botReply.replace(/\[\[SEND_IMAGE:[^\]]+\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    log.info(`[MSG] Image markers found: ${imagesToSend.join(', ')}`);
  }

  const usage        = result.response.usageMetadata || {};
  log.info(`[GEMINI] usageMetadata raw: ${JSON.stringify(usage)}`);
  const inputTokens  = usage.promptTokenCount     || usage.inputTokenCount  || 0;
  const outputTokens = usage.candidatesTokenCount || usage.outputTokenCount || 0;
  const callCostUSD  = calcCost(inputTokens, outputTokens);
  log.info(`[OUT] "${botReply.substring(0, 120)}" | tokens in=${inputTokens} out=${outputTokens} cost=$${callCostUSD.toFixed(6)}`);

  let orderId = null;
  const orderMatch = botReply.match(ORDER_MARKER_REGEX);
  if (orderMatch) {
    log.info(`[ORDER] ORDER_COMPLETE marker detected`);
    botReply = botReply.replace(ORDER_MARKER_REGEX, '').trim();

    let details = null;
    try {
      // Gemini sometimes escapes apostrophes as \' which is invalid JSON — sanitize first
      const sanitized = orderMatch[1].replace(/\\'/g, "'");
      details = JSON.parse(sanitized);
    } catch (e) {
      log.error(`[ORDER] Failed to parse order JSON from marker:`, e.message, orderMatch[1]);
    }

    if (details) {
      orderId = await generateOrderId(client);
      await db.insertOrder(orderId, phoneNumber, client?.id ?? null, details);
      log.info(`[ORDER] Saved order ${orderId}`);
      if (details.summary) {
        await db.updateOrderAISummary(orderId, details.summary);
        log.info(`[ORDER] AI summary saved for ${orderId}`);
      }
      if (details.customer_name) {
        await db.upsertCustomer(phoneNumber, details.customer_name, client?.id);
        log.info(`[DB] Updated customer name: ${details.customer_name}`);
      }
      botReply += `\n\n✅ *ඔබේ Order ID: ${orderId}*`;
    } else {
      log.warn(`[ORDER] ORDER_COMPLETE marker found but JSON parse failed`);
    }
  }

  const updateMatch = botReply.match(ORDER_UPDATE_REGEX);
  if (updateMatch) {
    botReply = botReply.replace(ORDER_UPDATE_REGEX, '').trim();
    try {
      const { order_id, updates } = JSON.parse(updateMatch[1]);
      if (order_id && updates && typeof updates === 'object') {
        const existing = await db.getOrdersByPhone(phoneNumber, client?.id);
        const order = existing.find(o => o.order_id === order_id);
        if (order) {
          const cf = order.custom_fields
            ? (typeof order.custom_fields === 'string' ? JSON.parse(order.custom_fields) : order.custom_fields)
            : {};
          await db.updateOrderCustomFields(order_id, { ...cf, ...updates });
          log.info(`[ORDER] Updated fields for ${order_id}:`, updates);
        } else {
          log.warn(`[ORDER] ORDER_UPDATE: order ${order_id} not found`);
        }
      }
    } catch (e) { log.error('[ORDER] ORDER_UPDATE parse failed:', e.message); }
  }

  const summaryMatch = botReply.match(UPDATE_SUMMARY_REGEX);
  if (summaryMatch) {
    botReply = botReply.replace(UPDATE_SUMMARY_REGEX, '').trim();
    const summaryText = summaryMatch[1].trim();
    try {
      const latestOrder = await db.getLatestOrder(phoneNumber, client?.id);
      if (latestOrder) {
        await db.updateOrderAISummary(latestOrder.order_id, summaryText);
        log.info(`[ORDER] AI summary updated for ${latestOrder.order_id}`);
      } else {
        log.warn(`[ORDER] UPDATE_SUMMARY: no order found`);
      }
    } catch (e) { log.error('[ORDER] UPDATE_SUMMARY failed:', e.message); }
  }

  const paymentMatch = botReply.match(PAYMENT_IDENTIFIED_REGEX);
  if (paymentMatch) {
    botReply = botReply.replace(PAYMENT_IDENTIFIED_REGEX, '').trim();
    try {
      const paymentData = JSON.parse(paymentMatch[1]);
      const targetOrderId = paymentData.order_id;
      const orders = await db.getOrdersByPhone(phoneNumber, client?.id);
      const order = targetOrderId
        ? orders.find(o => o.order_id === targetOrderId)
        : orders.find(o => o.status !== 'completed' && o.status !== 'cancelled');
      if (order) {
        const cf = order.custom_fields
          ? (typeof order.custom_fields === 'string' ? JSON.parse(order.custom_fields) : order.custom_fields)
          : {};
        await db.updateOrderCustomFields(order.order_id, {
          ...cf,
          payment_identified: {
            amount:    paymentData.amount    || null,
            date:      paymentData.date      || null,
            bank:      paymentData.bank      || null,
            ref:       paymentData.ref       || null,
            identified_at: new Date().toISOString(),
          },
        });
        log.info(`[ORDER] Payment identified flag set on ${order.order_id}`);
      } else {
        log.warn(`[ORDER] PAYMENT_IDENTIFIED: no matching order`);
      }
    } catch (e) { log.error('[ORDER] PAYMENT_IDENTIFIED failed:', e.message); }
  }

  let paymentReceived = false;

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
  log.info(`[DB] Saved bot reply cost=$${callCostUSD.toFixed(6)}`);

  // Sliding window: keep only last 40 entries in memory, drop oldest from front
  const MAX_HISTORY = 40;
  if (chatSession._history?.length > MAX_HISTORY) {
    chatSession._history.splice(0, chatSession._history.length - MAX_HISTORY);
    // After trimming, remove any orphaned function turns from the front.
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

module.exports = {
  genAI,
  model,
  calcCost,
  buildChatSession,
  handleMessage,
  generateOrderId,
  buildOrderStatusNote,
  ORDER_MARKER_REGEX,
  ORDER_UPDATE_REGEX,
  UPDATE_SUMMARY_REGEX,
};
