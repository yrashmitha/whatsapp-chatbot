'use strict';

const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../db');

// ── Default system prompt (fallback if DB has none) ───────────────────────────

const DEFAULT_SYSTEM_PROMPT = `
1. Identity & Role
You are a World-Class Business Strategy Consultant & Forensic Auditor specialized in the Sri Lankan market. Your internal logic is strictly built on MJ DeMarco's "CENTS" framework (Control, Entry, Need, Time, Scale). Your mission is to audit the user's business and provide a roadmap to move from "Slowlane" (hard labor/low profit) to "Fastlane" (automated systems).

2. Intent & Ambition Detection (Phase 1)
Upon the first message, identify the user's category:

THE ARCHITECT: New business idea (Validation & Entry).

THE OPTIMIZER: Existing business (Sales & Scaling).

Ambition Check (CRITICAL): Identify if they want a Side Hustle (Pocket money) or a Scalable Business (Growth-oriented). Tailor all depth and strategic advice based on this specific goal.

3. Natural Interrogation Logic
Be Human: Act like a high-level mentor having a coffee. Avoid robotic or repetitive phrasing.

One Question Rule: Ask ONLY ONE logical follow-up question at a time to keep the chat short and engaging.

The 5-8 Question Rule: Do not provide ANY final strategy or roadmap until you have asked at least 5-8 deep, probing questions to find the "Root Cause" of their business bottleneck.

Anti-Pattern Rule: Do not use pre-set examples or scripts. Treat every user as a unique case study and build the conversation from scratch based on their specific answers.

4. CENTS Audit & SL Context
Evaluate every business model against these internal pillars:

Control/Entry/Need/Time/Scale: Factor in Sri Lankan realities such as high inflation, VAT, WhatsApp dominance, delivery/trust issues, and the current economic climate.

Challenge the User: If they give vague or emotional answers, challenge them with data-driven questions. Ask for numbers (Revenue, margins, time spent).

5. The IT/AI Automation Pivot
When you identify a manual labor bottleneck (e.g., handwriting, manual typing, repetitive tasks):

Explain the power of IT and AI Automation as the only way to achieve "Scale" and "Time" freedom.

The Recommendation: Suggest that a custom software/AI system is the bridge to the Fastlane.

6. The Creator Connection (Consultation Call)
The Pivot: Explain that while a full system might seem expensive, a professional conversation is free and essential.

CTA: Encourage the user to contact your creator (the developer behind 'Nova') for a Strategy Call. Position him as an expert in automating manual businesses.

7. Exit Protocol & Emotional Closing (The End)
Trigger: Exit the conversation once the solution/CTA is delivered OR the user says "Thank you/I understand."

The Closing Guidelines (Do NOT script - Generate naturally):

Transparency: Reveal that you (Nova) are a paid resource maintained by your creator's personal investment.

Context: Mention that they likely found you via a Facebook post.

The "Why": Explain that this high-level audit was given for free because the creator wants to empower Sri Lankan entrepreneurs.

The Favor: Ask for a small favor in return—a review on the creator's wall or a comment on the original FB post.

Gratitude: End with a warm, encouraging, and human-centric wish for their business success.

Tone & Language
Tone: Professional, direct, analytical, yet supportive and grounded.

Language: Respond in the user's preferred language (Sinhala, English, or Singlish).

━━━ Language Detection (MANDATORY) ━━━
Every user message is wrapped with [CURRENT_MESSAGE_START] and [CURRENT_MESSAGE_END] markers.
Detect the language of the text inside those markers and respond in that SAME language.
If the user writes in Sinhala → reply in Sinhala.
If the user writes in English → reply in English.
If the user mixes both (Singlish) → match their style.
Never switch languages mid-conversation unless the user switches first.
`.trim();

// ── Gemini factory ────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getConsultModel(systemPrompt) {
  return genAI.getGenerativeModel({
    model: 'gemini-3.1-flash-lite',
    systemInstruction: systemPrompt || DEFAULT_SYSTEM_PROMPT,
    tools: [{ googleSearch: {} }, { codeExecution: {} }],
  });
}

// ── In-memory sessions: token → { chat, lastUsed } ───────────────────────────

const consultSessions = new Map();

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  let evicted = 0;
  for (const [token, s] of consultSessions) {
    if (s.lastUsed < cutoff) { consultSessions.delete(token); evicted++; }
  }
  if (evicted) console.log(`[CONSULT][evict] Evicted ${evicted} idle sessions. Active: ${consultSessions.size}`);
}, 30 * 60 * 1000);

// ── DB config helper ──────────────────────────────────────────────────────────

async function getConsultConfig() {
  const { rows } = await db.pgQuery(`SELECT * FROM consult_config WHERE id=1`);
  return rows[0] || { system_prompt: null, max_sessions: 10, access_code: null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap a user message with language-detection markers (same as main gemini service). */
function wrapMessage(text) {
  return `[CURRENT_MESSAGE_START]\n${text}\n[CURRENT_MESSAGE_END]`;
}

/**
 * Merge consecutive same-role turns and ensure history starts with 'user'.
 * Mirrors the logic in gemini.js buildChatSession.
 */
function mergeHistory(msgs) {
  // Keep only last 40 messages
  const recent = msgs.slice(-40);
  const merged = [];
  for (const m of recent) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.parts[0].text += '\n' + m.text;
    } else {
      merged.push({ role: m.role, parts: [{ text: m.text }] });
    }
  }
  // Gemini requires history to start with a 'user' turn
  while (merged.length > 0 && merged[0].role !== 'user') merged.shift();
  return merged;
}

/**
 * Send a message to Gemini with up to 3 retries for transient 503/overload errors.
 */
async function sendWithRetry(geminiChat, message, sessionId) {
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await geminiChat.sendMessage(message);
      break;
    } catch (err) {
      const retryable = /503|unavailable|overloaded/i.test(err.message || '');
      console.error(`[CONSULT][gemini][err] session=${sessionId} attempt=${attempt}/3: ${err.message}`);
      if (attempt < 3 && retryable) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else {
        throw err;
      }
    }
  }
  return result;
}

// ── Rebuild chat from DB history ──────────────────────────────────────────────

async function getOrRebuildChat(sessionToken) {
  if (consultSessions.has(sessionToken)) {
    const s = consultSessions.get(sessionToken);
    s.lastUsed = Date.now();
    return s.chat;
  }

  console.log(`[CONSULT][session] Rebuilding chat from DB for token ${sessionToken.slice(0,8)}...`);
  const { rows } = await db.pgQuery(
    `SELECT id FROM consult_sessions WHERE session_token=$1`, [sessionToken]
  );
  if (!rows.length) return null;

  const { rows: msgs } = await db.pgQuery(
    `SELECT role, text FROM consult_messages WHERE session_id=$1 ORDER BY created_at ASC`,
    [rows[0].id]
  );

  const history = mergeHistory(msgs);
  const config  = await getConsultConfig();
  const model   = getConsultModel(config.system_prompt);
  const chat    = model.startChat({ history });
  consultSessions.set(sessionToken, { chat, lastUsed: Date.now() });
  console.log(`[CONSULT][session] Rebuilt with ${history.length} turns (from ${msgs.length} raw messages)`);
  return chat;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function startSession(req, res) {
  const { code } = req.body;

  // Load config from DB (access_code takes priority over env)
  const config = await getConsultConfig();
  const expectedCode = (config.access_code || process.env.CONSULT_ACCESS_CODE || '').trim().toUpperCase();

  if (!expectedCode) {
    console.warn('[CONSULT][start] No access code configured — rejecting all requests');
    return res.status(503).json({ error: 'Consultation is not currently available.' });
  }

  if ((code || '').trim().toUpperCase() !== expectedCode) {
    console.log(`[CONSULT][start] Invalid code attempt: "${code}" from IP ${req.ip}`);
    return res.status(401).json({ error: 'Invalid access code' });
  }

  // Check session limit
  const { rows: countRows } = await db.pgQuery(`SELECT COUNT(*)::int AS total FROM consult_sessions`);
  const total = countRows[0].total;
  const limit = config.max_sessions || 10;

  if (total >= limit) {
    console.warn(`[CONSULT][limit] Session limit reached: ${total}/${limit}`);
    return res.status(403).json({ error: `This consultation is full (${limit} spots). Please check back later.` });
  }

  const sessionToken = crypto.randomUUID();
  await db.pgQuery(`INSERT INTO consult_sessions (session_token) VALUES ($1)`, [sessionToken]);

  console.log(`[CONSULT][start] New session created: ${sessionToken.slice(0,8)}... (${total + 1}/${limit} spots used)`);
  res.json({ session_token: sessionToken });
}

async function onboard(req, res) {
  const { session_token, name, business_name, business_type, phone } = req.body;
  if (!session_token) return res.status(400).json({ error: 'session_token required' });

  const { rows } = await db.pgQuery(
    `UPDATE consult_sessions SET name=$1, business_name=$2, business_type=$3, phone=$4
     WHERE session_token=$5 RETURNING id`,
    [name, business_name, business_type, phone, session_token]
  );
  if (!rows.length) {
    console.warn(`[CONSULT][onboard] Session not found: ${session_token.slice(0,8)}...`);
    return res.status(404).json({ error: 'Session not found' });
  }
  const sessionId = rows[0].id;

  console.log(`[CONSULT][onboard] ${name || 'Anonymous'} | ${business_name || '?'} | ${business_type || '?'} | +94${phone || '?'}`);

  // Raw text stored in DB; wrapped only for the Gemini call
  const firstMessage = `Hi, I'm ${name || 'there'}. My business is ${business_name || 'not named yet'}, which is a ${business_type || 'general'} business. My WhatsApp number is ${phone ? '+94' + phone : 'not provided'}.`;

  try {
    const config = await getConsultConfig();
    const model  = getConsultModel(config.system_prompt);
    const chat   = model.startChat({ history: [] });

    console.log(`[CONSULT][gemini][req] onboard session=${sessionId} historyTurns=0 msgLen=${firstMessage.length}`);
    const t0     = Date.now();
    const result = await sendWithRetry(chat, wrapMessage(firstMessage), sessionId);
    const reply  = result.response.text();
    const elapsed = Date.now() - t0;

    console.log(`[CONSULT][gemini][res] onboard session=${sessionId} replyLen=${reply.length} elapsed=${elapsed}ms`);

    consultSessions.set(session_token, { chat, lastUsed: Date.now() });

    // Store raw text (without wrapper markers) in DB
    await db.pgQuery(
      `INSERT INTO consult_messages (session_id, role, text) VALUES ($1,'user',$2),($1,'model',$3)`,
      [sessionId, firstMessage, reply]
    );

    res.json({ reply });
  } catch (e) {
    console.error(`[CONSULT][error] onboard failed for session ${sessionId}:`, e.message);
    res.status(500).json({ error: 'Failed to start consultation' });
  }
}

async function chat(req, res) {
  const { session_token, message } = req.body;
  if (!session_token || !message) return res.status(400).json({ error: 'session_token and message required' });

  const { rows } = await db.pgQuery(
    `SELECT id FROM consult_sessions WHERE session_token=$1`, [session_token]
  );
  if (!rows.length) {
    console.warn(`[CONSULT][chat] Session not found: ${session_token.slice(0,8)}...`);
    return res.status(404).json({ error: 'Session not found' });
  }
  const sessionId = rows[0].id;

  const preview = message.slice(0, 60) + (message.length > 60 ? '...' : '');
  console.log(`[CONSULT][chat] session=${sessionId} msg="${preview}"`);

  try {
    const geminiChat = await getOrRebuildChat(session_token);
    if (!geminiChat) return res.status(404).json({ error: 'Session not found' });

    // Multilingual mode: always reload history fresh from DB before each message
    // (prevents language-label noise accumulating in the in-memory history)
    const { rows: histMsgs } = await db.pgQuery(
      `SELECT role, text FROM consult_messages WHERE session_id=$1 ORDER BY created_at ASC`,
      [sessionId]
    );
    geminiChat._history = mergeHistory(histMsgs);
    console.log(`[CONSULT][gemini][req] session=${sessionId} historyTurns=${geminiChat._history.length} msgLen=${message.length}`);

    const t0      = Date.now();
    const result  = await sendWithRetry(geminiChat, wrapMessage(message), sessionId);
    const reply   = result.response.text();
    const elapsed = Date.now() - t0;

    console.log(`[CONSULT][gemini][res] session=${sessionId} replyLen=${reply.length} elapsed=${elapsed}ms`);

    // Store raw text (without wrapper markers) in DB
    await db.pgQuery(
      `INSERT INTO consult_messages (session_id, role, text) VALUES ($1,'user',$2),($1,'model',$3)`,
      [sessionId, message, reply]
    );

    res.json({ reply });
  } catch (e) {
    console.error(`[CONSULT][error] chat failed for session ${sessionId}:`, e.message);
    res.status(500).json({ error: 'Failed to get response' });
  }
}

async function resumeSession(req, res) {
  const { token } = req.params;
  const { rows } = await db.pgQuery(
    `SELECT id FROM consult_sessions WHERE session_token=$1`, [token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Session not found' });
  const { rows: messages } = await db.pgQuery(
    `SELECT role, text FROM consult_messages WHERE session_id=$1 ORDER BY created_at ASC`,
    [rows[0].id]
  );
  console.log(`[CONSULT][resume] session=${rows[0].id} — ${messages.length} messages loaded`);
  res.json({ messages });
}

async function getSessions(req, res) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  const { rows } = await db.pgQuery(
    `SELECT cs.id, cs.session_token, cs.name, cs.business_name, cs.business_type, cs.phone, cs.created_at,
            COUNT(cm.id)::int AS message_count
     FROM consult_sessions cs
     LEFT JOIN consult_messages cm ON cm.session_id = cs.id
     GROUP BY cs.id ORDER BY cs.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const { rows: countRows } = await db.pgQuery(`SELECT COUNT(*)::int AS total FROM consult_sessions`);
  res.json({ sessions: rows, total: countRows[0].total, page, limit });
}

async function getSessionMessages(req, res) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { token } = req.params;
  const { rows: sessionRows } = await db.pgQuery(
    `SELECT * FROM consult_sessions WHERE session_token=$1`, [token]
  );
  if (!sessionRows.length) return res.status(404).json({ error: 'Session not found' });
  const { rows: messages } = await db.pgQuery(
    `SELECT role, text, created_at FROM consult_messages WHERE session_id=$1 ORDER BY created_at ASC`,
    [sessionRows[0].id]
  );
  res.json({ session: sessionRows[0], messages });
}

async function getConfig(req, res) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const config = await getConsultConfig();
  // Don't expose access_code as plaintext — just indicate if it's set
  res.json({
    system_prompt: config.system_prompt || '',
    max_sessions:  config.max_sessions,
    access_code_set: !!(config.access_code || process.env.CONSULT_ACCESS_CODE),
  });
}

async function updateConfig(req, res) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { system_prompt, max_sessions, access_code } = req.body;

  const fields = [];
  const vals   = [];
  let i = 1;

  if (system_prompt !== undefined) { fields.push(`system_prompt=$${i++}`); vals.push(system_prompt || null); }
  if (max_sessions  !== undefined) { fields.push(`max_sessions=$${i++}`);  vals.push(Math.max(1, parseInt(max_sessions) || 10)); }
  if (access_code   !== undefined && access_code.trim()) {
    fields.push(`access_code=$${i++}`);
    vals.push(access_code.trim());
  }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  fields.push(`updated_at=NOW()`);
  vals.push(1); // WHERE id=1

  await db.pgQuery(
    `UPDATE consult_config SET ${fields.join(',')} WHERE id=$${i}`,
    vals
  );

  console.log(`[CONSULT][config] Updated by superadmin: ${fields.filter(f => !f.startsWith('updated')).join(', ')}`);
  res.json({ ok: true });
}

module.exports = { startSession, onboard, chat, resumeSession, getSessions, getSessionMessages, getConfig, updateConfig };
