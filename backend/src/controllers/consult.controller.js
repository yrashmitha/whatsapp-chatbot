'use strict';

const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../db');
const { detectPhase, validatePhase, buildPhasePrompt } = require('../services/phaseEngine');

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

// ── Multilingual language detection block (always appended) ──────────────────

const MULTILINGUAL_BLOCK = `LANGUAGE RULE — HIGHEST PRIORITY:
The customer's current message is always wrapped between [CURRENT_MESSAGE_START] and [CURRENT_MESSAGE_END] markers. Detect the language of the text inside those markers and reply accordingly:
- If the message is in English → reply in English
- If the message is in Sinhala script (Unicode) → reply in Sinhala script
- If the message is in Singlish (Sinhala written using Latin/English letters) → reply in proper Sinhala script (Unicode), NOT in Singlish. Singlish uses common Sinhala words romanized, such as: mama, mata, eka, denna, ganna, kohomada, api, oya, danne, inne, hadanna, puluwan, kiyanna, karana, thibba, awilla, yanna, wage, wenna, karanna, wisthara, hari, nehe, ow, mokakda, kawda, koheda, kiyala, danna, gatta, aawa, giyaa, hitiye, hitiye, pennanna, oyata, oyage
- For any other language → reply in that same language
Ignore the language of all previous messages in the conversation history.`.trim();

/**
 * Build the effective system prompt:
 * - Strips [[MULTILINGUAL]] control flag (not AI content — it's a marker)
 * - Always appends the language detection block if not already present
 */
function buildEffectivePrompt(rawPrompt) {
  let prompt = (rawPrompt || DEFAULT_SYSTEM_PROMPT)
    .replace(/^\[\[MULTILINGUAL\]\]\s*/i, '')
    .trim();
  if (!prompt.includes('[CURRENT_MESSAGE_START]') && !prompt.includes('LANGUAGE RULE')) {
    prompt += '\n\n' + MULTILINGUAL_BLOCK;
  }
  return prompt;
}

// ── Gemini factory ────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getConsultModel(rawPrompt, phaseTools = []) {
  // Always include googleSearch; add function declarations for phase-enabled tools
  const tools = [{ googleSearch: {} }];
  // Phase tools are informational strings (search_knowledge, send_image) — not FC tools in consult
  // They're used to shape the system prompt, not as actual Gemini function declarations
  return genAI.getGenerativeModel({
    model: 'gemini-3.1-flash-lite-preview',
    systemInstruction: buildEffectivePrompt(rawPrompt),
    tools,
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
 * Log Google Search grounding metadata if Gemini used search for this response.
 */
function logGrounding(result, phoneTag, sessionId) {
  try {
    const candidate = result.response.candidates?.[0];
    if (!candidate) return;
    const meta = candidate.groundingMetadata;
    if (!meta) return; // model did not use search grounding for this response
    const queries = meta.webSearchQueries || [];
    const chunks  = meta.groundingChunks  || [];
    if (queries.length === 0 && chunks.length === 0) return;
    if (queries.length) {
      console.log(`[CONSULT][search] ${phoneTag} | session=${sessionId} | queries=${JSON.stringify(queries)}`);
    }
    if (chunks.length) {
      const sources = chunks.slice(0, 5).map(c => c.web?.uri || c.web?.title || '?');
      console.log(`[CONSULT][search] ${phoneTag} | session=${sessionId} | sources=${JSON.stringify(sources)}`);
    }
  } catch { /* non-fatal */ }
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
  const phoneTag = `+94${phone || '?'}`;

  try {
    const config       = await getConsultConfig();
    const activePrompt = buildEffectivePrompt(config.system_prompt);
    const model        = getConsultModel(config.system_prompt);
    const chat         = model.startChat({ history: [] });
    const wrapped      = wrapMessage(firstMessage);

    console.log(`[CONSULT][session] ${phoneTag} | session=${sessionId} | model=gemini-3.1-flash-lite-preview | instrLen=${activePrompt.length}`);
    console.log(`[CONSULT][session] System instruction: ${activePrompt.replace(/\n/g, '\\n')}`);
    console.log(`[CONSULT][gemini][req] ${phoneTag} | session=${sessionId} | historyTurns=0 | msgLen=${wrapped.length}`);
    console.log(`[CONSULT][gemini][req] ${phoneTag} | Full prompt: ${wrapped.replace(/\n/g, '\\n')}`);

    const t0      = Date.now();
    const result  = await sendWithRetry(chat, wrapped, sessionId);
    const reply   = result.response.text();
    const elapsed = Date.now() - t0;

    console.log(`[CONSULT][gemini][res] ${phoneTag} | session=${sessionId} | replyLen=${reply.length} | elapsed=${elapsed}ms`);
    console.log(`[CONSULT][gemini][res] ${phoneTag} | Full reply: ${reply.replace(/\n/g, '\\n')}`);
    logGrounding(result, phoneTag, sessionId);

    consultSessions.set(session_token, { chat, lastUsed: Date.now() });

    // Split on [[MSG_BREAK]] — same pattern as main gemini service
    const parts = reply.split('[[MSG_BREAK]]').map(p => p.trim()).filter(Boolean);
    const replyForDb = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    if (parts.length > 1) {
      console.log(`[CONSULT][gemini][res] ${phoneTag} | session=${sessionId} | MSG_BREAK split into ${parts.length} parts`);
    }

    // Store clean text (markers stripped) in DB
    await db.pgQuery(
      `INSERT INTO consult_messages (session_id, role, text) VALUES ($1,'user',$2),($1,'model',$3)`,
      [sessionId, firstMessage, replyForDb]
    );

    res.json({ parts });
  } catch (e) {
    console.error(`[CONSULT][error] ${phoneTag} | session=${sessionId} | onboard failed: ${e.message}`);
    res.status(500).json({ error: 'Failed to start consultation' });
  }
}

async function chat(req, res) {
  const { session_token, message } = req.body;
  if (!session_token || !message) return res.status(400).json({ error: 'session_token and message required' });

  const { rows } = await db.pgQuery(
    `SELECT id, phone, current_phase, completed_phases FROM consult_sessions WHERE session_token=$1`,
    [session_token]
  );
  if (!rows.length) {
    console.warn(`[CONSULT][chat] Session not found: ${session_token.slice(0,8)}...`);
    return res.status(404).json({ error: 'Session not found' });
  }
  const sessionId       = rows[0].id;
  const phoneTag        = `+94${rows[0].phone || '?'}`;
  const completedPhases = rows[0].completed_phases || [];

  // Check model message count — hard limit of 50 replies per session
  const { rows: countRows } = await db.pgQuery(
    `SELECT COUNT(*)::int AS total FROM consult_messages WHERE session_id=$1 AND role='model'`,
    [sessionId]
  );
  const config      = await getConsultConfig();
  const msgLimit    = config.max_messages || 50;
  if (countRows[0].total >= msgLimit) {
    console.log(`[CONSULT][limit] ${phoneTag} | session=${sessionId} | message limit reached (${countRows[0].total}/${msgLimit} model msgs)`);
    const limitMsg = `It's been a pleasure talking with you and I truly hope our conversation has been helpful for your business journey.\n\nMy creator has set a hard limit for each session because he is spending his own money to run me and offer this service to you completely free. To make sure everyone gets a fair opportunity, he had to limit each session to 50 replies.\n\nIf you'd like to share your thoughts or feedback on this experience, he'd really appreciate a comment on his Facebook page. It means a lot when people take a moment to do that.\n\nWishing you the very best with your business. You've got this.`;
    return res.json({ parts: [limitMsg], limit_reached: true });
  }

  console.log(`[CONSULT][chat] ${phoneTag} | session=${sessionId} | IN: "${message.slice(0,80).replace(/\n/g,'\\n')}"`);

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

    const activePrompt = buildEffectivePrompt(config.system_prompt);

    // ── Phase Engine (if consult has a flow_config configured) ───────────────
    let messageToSend = wrapMessage(message);
    let resolvedPhase = null;

    if (config.flow_config?.nodes?.length) {
      try {
        const detectedId = await detectPhase(config.flow_config.nodes, geminiChat._history, message);
        const validation = validatePhase(detectedId, completedPhases, config.flow_config);
        const { instructionBlock } = buildPhasePrompt(validation.resolvedPhase, validation, config.flow_config);

        resolvedPhase = validation.resolvedPhase;
        messageToSend = `${instructionBlock}\n\n${wrapMessage(message)}`;

        console.log(`[CONSULT][phase] ${phoneTag} | session=${sessionId} | detected="${detectedId}" resolved="${resolvedPhase}" completed=${JSON.stringify(completedPhases)}`);
      } catch (phaseErr) {
        console.error(`[CONSULT][phase] error (non-fatal, continuing without phase): ${phaseErr.message}`);
      }
    }

    const wrapped = messageToSend;

    console.log(`[CONSULT][session] ${phoneTag} | session=${sessionId} | System instruction: ${activePrompt.replace(/\n/g, '\\n')}`);
    console.log(`[CONSULT][gemini][req] ${phoneTag} | session=${sessionId} | historyTurns=${geminiChat._history.length} | instrLen=${activePrompt.length} | msgLen=${wrapped.length}`);
    console.log(`[CONSULT][gemini][req] ${phoneTag} | Full prompt: ${wrapped.replace(/\n/g, '\\n')}`);

    const t0      = Date.now();
    const result  = await sendWithRetry(geminiChat, wrapped, sessionId);
    const reply   = result.response.text();
    const elapsed = Date.now() - t0;

    console.log(`[CONSULT][gemini][res] ${phoneTag} | session=${sessionId} | replyLen=${reply.length} | elapsed=${elapsed}ms`);
    console.log(`[CONSULT][gemini][res] ${phoneTag} | Full reply: ${reply.replace(/\n/g, '\\n')}`);
    logGrounding(result, phoneTag, sessionId);

    // Split on [[MSG_BREAK]] — same pattern as main gemini service
    const parts = reply.split('[[MSG_BREAK]]').map(p => p.trim()).filter(Boolean);
    const replyForDb = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    if (parts.length > 1) {
      console.log(`[CONSULT][gemini][res] ${phoneTag} | session=${sessionId} | MSG_BREAK split into ${parts.length} parts`);
    }

    // Store clean text (markers stripped) in DB
    await db.pgQuery(
      `INSERT INTO consult_messages (session_id, role, text) VALUES ($1,'user',$2),($1,'model',$3)`,
      [sessionId, message, replyForDb]
    );

    // Persist phase state to DB if phase engine was active
    if (resolvedPhase) {
      const nowCompleted = [...new Set([...completedPhases, resolvedPhase])];
      await db.pgQuery(
        `UPDATE consult_sessions SET current_phase=$1, completed_phases=$2 WHERE id=$3`,
        [resolvedPhase, JSON.stringify(nowCompleted), sessionId]
      );
    }

    res.json({ parts });
  } catch (e) {
    console.error(`[CONSULT][error] ${phoneTag} | session=${sessionId} | chat failed: ${e.message}`);
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
  res.json({
    session: sessionRows[0],
    messages,
    currentPhase:    sessionRows[0].current_phase    || null,
    completedPhases: sessionRows[0].completed_phases || [],
  });
}

async function getConfig(req, res) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const config = await getConsultConfig();
  // Don't expose access_code as plaintext — just indicate if it's set
  res.json({
    system_prompt:   config.system_prompt || '',
    max_sessions:    config.max_sessions,
    max_messages:    config.max_messages ?? 50,
    access_code_set: !!(config.access_code || process.env.CONSULT_ACCESS_CODE),
  });
}

async function updateConfig(req, res) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { system_prompt, max_sessions, max_messages, access_code } = req.body;

  const fields = [];
  const vals   = [];
  let i = 1;

  if (system_prompt !== undefined) { fields.push(`system_prompt=$${i++}`); vals.push(system_prompt || null); }
  if (max_sessions  !== undefined) { fields.push(`max_sessions=$${i++}`);  vals.push(Math.max(1, parseInt(max_sessions) || 10)); }
  if (max_messages  !== undefined) { fields.push(`max_messages=$${i++}`);  vals.push(Math.max(1, parseInt(max_messages) || 50)); }
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

async function deleteSession(req, res) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { token } = req.params;
  const { rows } = await db.pgQuery(
    `DELETE FROM consult_sessions WHERE session_token=$1 RETURNING id`, [token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Session not found' });
  // Remove from in-memory map too
  consultSessions.delete(token);
  console.log(`[CONSULT][admin] Session ${rows[0].id} deleted by superadmin`);
  res.json({ ok: true });
}

async function clearMessages(req, res) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { token } = req.params;
  const { rows } = await db.pgQuery(
    `SELECT id FROM consult_sessions WHERE session_token=$1`, [token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Session not found' });
  const { rowCount } = await db.pgQuery(
    `DELETE FROM consult_messages WHERE session_id=$1`, [rows[0].id]
  );
  // Drop in-memory chat so it rebuilds fresh (empty history)
  consultSessions.delete(token);
  console.log(`[CONSULT][admin] Cleared ${rowCount} messages from session ${rows[0].id}`);
  res.json({ ok: true, deleted: rowCount });
}

module.exports = { startSession, onboard, chat, resumeSession, getSessions, getSessionMessages, getConfig, updateConfig, deleteSession, clearMessages };
