/**
 * @module services/gemini
 * @description Gemini AI service layer.
 * Manages model instances, chat sessions, message handling (including
 * function-calling loops, order markers), and cost tracking.
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const quickReplyBlocks = require('./quickReplyBlocks');
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
    thinkingConfig: { thinkingBudget: 8192 },
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
/**
 * The numeric value of an amount a payment slip was read as.
 *
 * Vision returns figures with whatever decoration the slip carried: "LKR
 * 3490.00", "Rs. 3,490/=", "3490". Everything downstream wants a number, so
 * strip the decoration and only accept the result if it is one.
 *
 * @param {*} raw
 * @returns {number|null} null when nothing numeric survives
 */
function parseSlipAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const runs = String(raw).replace(/,/g, '').match(/[0-9]+(?:\.[0-9]+)?/g);
  if (!runs) return null;
  const best = runs.sort((a, b) => b.length - a.length)[0];
  const n = parseFloat(best);
  return Number.isFinite(n) ? n : null;
}

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

    const voiceClips = await db.getVoiceClips(client.id);
    let voiceBlock = '';
    if (voiceClips.length > 0) {
      voiceBlock = '\n\n━━━ Voice Clips You Can Send ━━━\n'
        + 'You can send a pre-recorded voice message to the customer by including a [[VOICE:keyword]] token anywhere in your reply. '
        + 'The token will be stripped from the visible text and the audio will be delivered separately. '
        + 'Use voice clips at the right moment — for greetings, confirmations, or emotional moments.\n'
        + 'Available voice clips:\n'
        + voiceClips.map(v => `- [[VOICE:${v.trigger_keyword}]] — "${v.name}"`).join('\n');
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
    let fullInstruction = baseInstruction + orderFieldsBlock + contactBlock + mediaBlock + voiceBlock + kbBlock + summaryBlock;
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
        maxOutputTokens: 3000,
        thinkingConfig: { thinkingBudget: client.thinking_budget ?? 8192 },
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

  // Recording an order used to depend on the model emitting a [[ORDER_COMPLETE:{…}]]
  // marker with valid JSON inside it. When the JSON was malformed the order was
  // dropped with only a log line, and a customer who had confirmed everything
  // simply never appeared in the CRM. A tool call is schema-checked by the API,
  // so it either arrives correctly or not at all.
  const orderFieldDefs = client?.order_fields || [];
  if (orderFieldDefs.length > 0) {
    const properties = {};
    for (const f of orderFieldDefs) {
      if (!f?.key) continue;
      properties[f.key] = {
        type: 'STRING',
        description: `${f.label || f.key}${f.description ? ` — ${f.description}` : ''}${f.required ? ' (required)' : ' (optional)'}`,
      };
    }
    properties.summary = {
      type: 'STRING',
      description: 'A short internal note for the team: what the customer wants, which package, anything unusual. Never shown to the customer.',
    };
    const placeOrderDecl = {
      name: 'place_order',
      description: 'Record the customer\'s order. Call this the moment the customer has confirmed their details are correct, and only then. Call it exactly once per customer. Pass every detail you collected. The customer sees nothing when you call it, so continue the conversation normally afterwards.',
      parameters: {
        type: 'OBJECT',
        properties,
        required: orderFieldDefs.filter(f => f?.required && f.key).map(f => f.key),
      },
    };
    tools[0].functionDeclarations.push(placeOrderDecl);
    console.log(`[SESSION] place_order tool enabled for ${client.id} (${Object.keys(properties).length - 1} fields)`);
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
      parts: [{ text: historyTextFor(m) }],
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

  const session = chatModel.startChat({ history: fullHistory, tools });
  session._chatModel = chatModel;
  return session;
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

/**
 * Remove thought parts from chat history so leaked reasoning is never replayed.
 *
 * The SDK appends every model turn to _history, including each round trip of the
 * function-calling loop. Leaving reasoning in there teaches the model that
 * reasoning is an acceptable thing to emit as an answer, so one leak becomes a
 * habit for the rest of the conversation.
 *
 * Parts carrying a thoughtSignature are kept — signatures are the supported way
 * to carry reasoning context across function calls, and dropping them degrades
 * tool use. A turn left with no parts gets a single space, because the API
 * rejects an empty parts array.
 *
 * @param {Array<{role: string, parts: Array}>} history - mutated in place
 * @param {{info: Function}} log
 */
function stripThoughtsFromHistory(history, log) {
  if (!Array.isArray(history)) return;
  let stripped = 0;
  for (const turn of history) {
    if (turn?.role !== 'model' || !Array.isArray(turn.parts)) continue;
    const before = turn.parts.length;
    turn.parts = turn.parts.filter(p => !p.thought || p.thoughtSignature);
    stripped += before - turn.parts.length;
    if (turn.parts.length === 0) turn.parts = [{ text: ' ' }];
  }
  if (stripped > 0) log.info(`[THOUGHT_STRIP] Removed ${stripped} thought part(s) across ${history.length} history turns`);
}

/**
 * Detect chain-of-thought that arrived as an ordinary answer.
 *
 * The part-level `p.thought` filter handles reasoning the model labels as such.
 * The damaging case is the one it does not label: planning prose emitted as a
 * normal text part, which no structural flag distinguishes from a real reply.
 * This looks at the text itself instead.
 *
 * Deliberately conservative — a genuine reply speaks to the customer as "you"
 * and never cites its own instructions, so these patterns do not appear in one:
 *   - any strong internal-reference marker, OR
 *   - third-person customer reference plus a first-person planning verb, OR
 *   - an explicit first-message planning preamble.
 *
 * @param {string} text - the final customer-facing reply
 * @returns {boolean} true when the reply looks like leaked reasoning
 */
function looksLikeReasoningLeak(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 40) return false; // short replies are never reasoning dumps

  // Markers a genuine customer reply never contains.
  const STRONG = [
    /\bfirst (response|message) rule\b/i,
    /\bknowledge base (clearly )?(states|says|mentions|might not have)\b/i,
    /\bthe system prompt\b/i,
    /\bCORE FACTS\b/,
    /\bGLOBAL LAW\b/i,
    /\bHARD RULES\b/,
    /\bPHASE \d\b/,
    /\bthe `?\w+`? tool (did not|does not|returned)\b/i,
    /default_api|tool_code|functionCall|search_knowledge\(|search_products\(|print\(/,
    /```/,
  ];
  if (STRONG.some(re => re.test(t))) return true;

  // Third-person customer reference plus a first-person planning verb.
  const thirdPerson = /\b(the user|the customer)('?s)?\b/i.test(t);
  const planning    = /\bI (should|need to|have to|must|will|am going to)\b/i.test(t);
  if (thirdPerson && planning) return true;

  // Explicit first-message planning preamble.
  if (/\b(since|because|as) this (is|appears to be) (the|their) first (message|response)\b/i.test(t)) return true;

  return false;
}

/**
 * How a stored message should read when it goes back into the model as history.
 *
 * A menu is stored as its body text so the CRM transcript reads naturally, but
 * the model did not write that body as prose — it wrote words and a marker, and
 * the sender turned the marker into a menu. Replaying the body alone teaches it
 * that menu bodies are things you type, and it stops emitting markers
 * altogether. Seen in the wild: a conversation that used five menus one day and
 * none the next, typing the bodies out instead.
 *
 * @param {Object} m - a messages row
 * @returns {string}
 */
function historyTextFor(m) {
  const text = m.message_text || '';

  // An approved WhatsApp template that was sent to this customer. Replayed
  // as one line rather than as its own words: the model imitates what it is
  // shown, and seven hundred characters of approved marketing copy in the
  // history is an invitation to write more of it. The line still says what
  // was promised, because the customer's next message is a reply to it and
  // a bot that does not know an offer was made will answer the wrong thing.
  const tpl = text.match(/^\[template_sent:([a-zA-Z0-9_-]+)\]/);
  if (tpl) {
    const body = text.slice(tpl[0].length).trim();
    const gist = body.replace(/\s+/g, ' ').slice(0, 240);
    return `[We sent this customer the "${tpl[1]}" WhatsApp template. It said: ${gist}`
      + `${body.length > 240 ? '…' : ''}. Anything they say next is likely a reply to it.]`;
  }

  let menu = m.interactive;
  if (!menu) return text;
  if (typeof menu === 'string') { try { menu = JSON.parse(menu); } catch { return text; } }
  if (!menu?.id) return text;
  // A named block is replayed as its name. The model wrote [[QR:2990]], not
  // nine hundred characters of Sinhala, and showing it the words instead
  // teaches it to type them out by hand next time. That is how the menus
  // broke: their bodies were stored as prose and the model copied them.
  if (menu.kind === 'quick_reply') return `[[QR:${menu.id}]]`;
  const kind = menu.kind === 'buttons' ? 'BUTTONS' : 'LIST';
  return `${text}\n[[${kind}:${menu.id}]]`;
}

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
        const histText = historyTextFor(m);
        if (last && last.role === role) { last.parts[0].text += '\n' + histText; }
        else merged.push({ role, parts: [{ text: histText }] });
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
  let toolOrderId = null;           // set when the model calls place_order
  // Every tool the model invoked this turn, for the Test Chat debug panel.
  const toolCalls = [];
  const initialFcCalls = candidate.functionCalls();
  log.info(`[FC] Gemini initial response has ${initialFcCalls?.length || 0} function call(s): [${(initialFcCalls || []).map(f => f.name).join(', ')}]`);
  while (candidate.functionCalls()?.length > 0 && fcLoopCount++ < 8) {
    const calls = candidate.functionCalls();
    for (const c of calls) toolCalls.push({ name: c.name, args: c.args });
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

      } else if (fc.name === 'place_order') {
        if (toolOrderId) {
          // Already recorded this turn; acknowledging without creating a second
          // order is safer than letting a retry duplicate it.
          log.warn('[ORDER] place_order called again in the same turn — ignoring');
          functionResponses.push({ functionResponse: { name: 'place_order', response: { ok: true, order_id: toolOrderId, note: 'already recorded' } } });
        } else {
          try {
            const details = { ...fc.args };
            toolOrderId = await generateOrderId(client);
            await db.insertOrder(toolOrderId, phoneNumber, client?.id ?? null, details);
            log.info(`[ORDER] place_order created ${toolOrderId}`);
            require('./metaConversions').fireCAPIEvent(client?.id, 'Lead', phoneNumber, { order_id: toolOrderId }).catch(() => {});
            if (details.summary) await db.updateOrderAISummary(toolOrderId, details.summary);
            const name = details.customer_name || details.b || details.name;
            if (name) await db.upsertCustomer(phoneNumber, name, client?.id);
            functionResponses.push({ functionResponse: { name: 'place_order', response: { ok: true, order_id: toolOrderId } } });
          } catch (e) {
            log.error('[ORDER] place_order failed:', e.message);
            functionResponses.push({ functionResponse: { name: 'place_order', response: { ok: false, error: 'Could not record the order' } } });
          }
        }
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

  stripThoughtsFromHistory(chatSession._history, log);

  // Filter out thought parts so they never reach the customer.
  // Use candidates[0].content.parts and skip any part with thought:true.
  // Fall back to candidate.text() (with think-block stripping) when no non-thought text
  // is found — covers both empty rawParts (SDK version mismatch) and all-thought-parts cases.
  const rawParts = candidate.candidates?.[0]?.content?.parts || [];
  const finishReason = candidate.candidates?.[0]?.finishReason;
  const nonThoughtText = rawParts
    .filter(p => !p.thought && typeof p.text === 'string')
    .map(p => p.text)
    .join('');
  let rawReply = nonThoughtText;
  if (!rawReply) {
    // All parts were thought-only, or rawParts was empty (SDK mismatch) — strip think blocks and use text().
    // candidate.text() throws when finishReason is SAFETY/RECITATION; catch so we stay in the fallback path
    // instead of propagating the exception and bypassing isFallback / needs_attention logic.
    let sdkText = '';
    try {
      sdkText = candidate.text?.() || '';
    } catch (e) {
      log.warn(`[GEMINI] candidate.text() threw (finishReason=${finishReason}): ${e.message}`);
    }
    rawReply = sdkText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (rawReply) log.warn(`[GEMINI] Non-thought text empty (finishReason=${finishReason}, parts=${rawParts.length}) — used stripped candidate.text() fallback`);
  }
  log.info(`[GEMINI] Raw response JSON: ${JSON.stringify({ finishReason, parts: rawParts.map(p => ({ thought: !!p.thought, text: p.text?.slice(0, 300) })), rawReply: rawReply.slice(0, 500) })}`);

  let botReply  = rawReply
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*') // convert markdown **bold** → WhatsApp *bold*
    .replace(/\[ORDER STATUS[^\]]*\]\s*/gi, '') // strip any echoed ORDER STATUS note wherever it appears
    .trim();

  // [[SILENT]] — system prompt instructed intentional silence (e.g. post-flow ack
  // suppression when the customer just says "ok"/"👍"). Catch it BEFORE the recovery
  // nudge / fallback so it is never sent and never flagged as a failed reply.
  if (/^\[\[SILENT\]\]$/i.test(botReply)) {
    log.info('[GEMINI] [[SILENT]] token received — suppressing reply');
    const usage        = result.response.usageMetadata || {};
    const inputTokens  = usage.promptTokenCount     || usage.inputTokenCount  || 0;
    const outputTokens = usage.candidatesTokenCount || usage.outputTokenCount || 0;
    const callCostUSD  = calcCost(inputTokens, outputTokens);
    return { botReply: '', orderId: null, paymentReceived: false, callCostUSD, inputTokens, outputTokens, imagesToSend: [], productImagesToSend: [], isFallback: false, toolCalls };
  }

  // If still empty, recover based on the finish reason.
  if (!botReply) {
    log.warn(`[GEMINI] Empty reply after all fallbacks (finishReason=${finishReason}) — attempting recovery`);
    // SAFETY/RECITATION: nudge will also be blocked — skip it entirely.
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      log.warn(`[GEMINI] Skipping recovery nudge — finishReason=${finishReason} means nudge will also be blocked`);
    } else {
      try {
        // MALFORMED_FUNCTION_CALL: model tried to call a tool but generated broken JSON.
        // A plain nudge won't help — the session is stuck waiting for a tool response.
        // Send an explicit instruction to abandon the tool call and answer in text instead.
        const recoveryMsg = finishReason === 'MALFORMED_FUNCTION_CALL'
          ? 'Your last tool call had a formatting error and could not be executed. Ignore it and answer the customer\'s question directly in plain text now, without calling any tools.'
          : 'Reply to the customer now with a short direct text message. Do not think — just reply.';

        const nudge = await chatSession.sendMessage(recoveryMsg);
        const nudgeParts = nudge.response.candidates?.[0]?.content?.parts || [];
        botReply = nudgeParts
          .filter(p => !p.thought && typeof p.text === 'string')
          .map(p => p.text)
          .join('')
          .trim();
        if (!botReply) {
          let nudgeSdk = '';
          try { nudgeSdk = nudge.response.text?.() || ''; } catch (_) {}
          botReply = nudgeSdk.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        }
        if (!botReply) log.warn('[GEMINI] Recovery nudge also returned empty');
        else log.info(`[GEMINI] Recovery nudge reply: "${botReply.substring(0, 80)}"`);
      } catch (e) {
        log.error('[GEMINI] Recovery nudge failed:', e.message);
      }
    }
  }

  let isFallback = false;
  if (!botReply) {
    log.warn('[GEMINI] Still empty after nudge — using fallback message');
    botReply = client?.error_message || "Sorry, I didn't get that. Could you please try again? 🙏";
    isFallback = true;
  }

  // ── Reasoning-leak backstop ────────────────────────────────────────────────
  // Last line of defence for reasoning that arrived unflagged as a normal answer.
  // Regenerate once from clean history; if that leaks too, send nothing and flag
  // the chat, because a customer seeing internal monologue is worse than silence.
  if (botReply && !isFallback && looksLikeReasoningLeak(botReply)) {
    log.warn(`[LEAK_GUARD] Reasoning leak detected — regenerating. Head: "${botReply.slice(0, 120)}"`);
    let regen = '';
    try {
      const cleanHistory = (chatSession._history || [])
        .filter(turn => !turn.parts?.some(p => p.functionCall || p.functionResponse));
      while (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') cleanHistory.shift();
      const r = await chatSession._chatModel.generateContent({
        contents: cleanHistory,
        generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      });
      const rParts = r.response.candidates?.[0]?.content?.parts || [];
      regen = rParts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
    } catch (e) {
      log.error('[LEAK_GUARD] Regenerate failed:', e.message);
    }

    if (regen && !looksLikeReasoningLeak(regen)) {
      log.info(`[LEAK_GUARD] Regeneration clean — using it. Head: "${regen.slice(0, 80)}"`);
      botReply = regen;
      // Overwrite the leaked text in live history too, or it re-enters context
      // on the next turn and the model learns from it.
      for (let i = (chatSession._history?.length || 0) - 1; i >= 0; i--) {
        if (chatSession._history[i].role !== 'model') continue;
        const parts = chatSession._history[i].parts || [];
        const idx = parts.findIndex(p => typeof p.text === 'string' && !p.thought);
        if (idx >= 0) parts[idx].text = botReply;
        break;
      }
    } else {
      log.warn('[LEAK_GUARD] Regeneration still leaked or empty — suppressing reply, flagging for review');
      try {
        await db.pgQuery(
          `UPDATE customers SET needs_attention=TRUE WHERE phone_number=$1 AND client_id=$2`,
          [phoneNumber, client?.id ?? null]
        );
      } catch (_) { /* flagging is best-effort; suppression is the guarantee */ }
      // Usage is tallied further down, past this early return — compute it here
      // so a suppressed turn is still billed and counted like any other.
      const leakUsage  = result.response.usageMetadata || {};
      const leakIn     = leakUsage.promptTokenCount     || leakUsage.inputTokenCount  || 0;
      const leakOut    = leakUsage.candidatesTokenCount || leakUsage.outputTokenCount || 0;
      return { botReply: '', orderId: null, paymentReceived: false, callCostUSD: calcCost(leakIn, leakOut), inputTokens: leakIn, outputTokens: leakOut, imagesToSend: [], productImagesToSend: [], isFallback: false, toolCalls };
    }
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

  let orderId = toolOrderId;
  if (orderId) botReply += `\n\n✅ *ඔබේ Order ID: ${orderId}*`;
  const orderMatch = botReply.match(ORDER_MARKER_REGEX);
  if (orderMatch && !orderId) {
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
      require('./metaConversions').fireCAPIEvent(client?.id, 'Lead', phoneNumber, { order_id: orderId }).catch(() => {});
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

  // A marker emitted as well as the tool call still has to be removed, or the
  // customer reads the raw JSON.
  if (orderMatch && toolOrderId) botReply = botReply.replace(ORDER_MARKER_REGEX, '').trim();

  const updateMatch = botReply.match(ORDER_UPDATE_REGEX);
  if (updateMatch) {
    botReply = botReply.replace(ORDER_UPDATE_REGEX, '').trim();
    try {
      const { order_id, updates } = JSON.parse(updateMatch[1]);
      if (!order_id || !updates || typeof updates !== 'object') {
        // A prompt asking for the wrong shape used to fail here in silence, so
        // a client could believe payments were being recorded for months while
        // nothing happened. Say so loudly instead.
        log.warn(`[ORDER] ORDER_UPDATE ignored — expected {"order_id":"…","updates":{…}}, got: ${updateMatch[1].slice(0, 120)}`);
      }
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
      const slipAmount = parseSlipAmount(paymentData.amount);
      if (paymentData.amount != null && slipAmount === null) {
        log.warn(`[ORDER] PAYMENT_IDENTIFIED: unreadable amount ${JSON.stringify(paymentData.amount)}`);
      }
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
            amount:    slipAmount !== null ? slipAmount.toFixed(2) : null,
            amount_raw: paymentData.amount != null ? String(paymentData.amount) : null,
            date:      paymentData.date      || null,
            bank:      paymentData.bank      || null,
            ref:       paymentData.ref       || null,
            identified_at: new Date().toISOString(),
          },
        });
        log.info(`[ORDER] Payment identified flag set on ${order.order_id}`);

        // Move it into the queue of slips waiting to be checked against the
        // bank. Only from a state that has not been settled yet: an order
        // already marked paid, delivered or cancelled must not be dragged
        // backwards because a customer sent the receipt a second time.
        const UNSETTLED = ['pending', 'started', 'pending-payment'];
        if (UNSETTLED.includes(order.status)) {
          await db.pgQuery(
            `UPDATE orders SET status='payment_identified'
              WHERE order_id=$1 AND client_id=$2 AND status = ANY($3)`,
            [order.order_id, client?.id ?? null, UNSETTLED]);
          log.info(`[ORDER] ${order.order_id} moved to payment_identified, awaiting a bank check`);
        }
        require('./metaConversions').fireCAPIEvent(client?.id, 'Purchase', phoneNumber, {
          order_id: order.order_id,
          currency: 'LKR',
          value:    slipAmount || 0,
        }).catch(() => {});
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

  // Swap [[QR:title]] for the block it names, before anything else looks at
  // the text. The words then travel as ordinary message content: they are sent,
  // stored and shown exactly as if the model had written them, which is what
  // keeps the CRM honest about what the customer received.
  let usedBlocks = [];
  try {
    const resolved = await quickReplyBlocks.resolveBlocks(client?.id, botReply);
    if (resolved.missing.length) {
      log.warn(`[QR] no block named ${resolved.missing.join(', ')} for ${client?.id}`);
    }
    if (resolved.used.length || resolved.missing.length) {
      botReply = resolved.text;
      usedBlocks = resolved.used;
      if (resolved.used.length) log.info(`[QR] sent block(s): ${resolved.used.join(', ')}`);
    }
  } catch (e) {
    log.error('[QR] could not resolve a block:', e.message);
  }

  // Strip [[MSG_BREAK]] markers before saving to DB (clean single text for history)
  // Strip the markers that tell the sender what to do; they are not part of
  // what the customer read, and seeing them in the CRM makes it impossible to
  // tell at a glance what was actually sent. MSG_BREAK survives so the CRM can
  // draw the parts as the separate messages they were.
  const botReplyForDb = botReply
    .replace(/\[\[(?:LIST|BUTTONS|CTA):[a-z0-9_]+\]\]/gi, '')
    .replace(/\[\[VOICE:[a-z0-9_]+\]\]/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  await db.insertMessage(phoneNumber, botReplyForDb, 'bot', callCostUSD, client?.id ?? null);
  log.info(`[DB] Saved bot reply cost=$${callCostUSD.toFixed(6)}`);

  // After saving to DB, clear botReply so the webhook controller's empty-check
  // also blocks the send — belt-and-suspenders on top of isFallback flag.
  if (isFallback) botReply = '';

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

  return { botReply, orderId, paymentReceived, callCostUSD, inputTokens, outputTokens, imagesToSend, productImagesToSend, isFallback, toolCalls };
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
