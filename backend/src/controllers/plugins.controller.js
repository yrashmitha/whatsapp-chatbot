/**
 * @module controllers/plugins.controller
 * @description Handlers for the plugin configuration API
 * (get/set config, get customer data, generate astro chart message).
 */

'use strict';

const db   = require('../db');
const { generateAstroMessage, DEFAULT_ASTRO_PROMPT } = require('../services/astro');
const { generateHoroscope, buildHoroscopeDoc, buildQuantumDoc, regenerateHoroscopeSection, generateWaMessage, renderYear, parseSinhalaDate, parseSinhalaTime } = require('../services/horoscope');
const { calculateVedicChart } = require('../services/vedicChart');
const { getFreeAstroKey, getGeminiKey, getGenAI, MissingClientKeyError } = require('../services/clientKeys');
const { getBrand, DEFAULT_BRAND } = require('../services/branding');
const { analyzeAura, generateQuantumReading, generateQuantumSections } = require('../services/quantumCode');
const {
  generateMarriageReading, generateMarriageSectionText, generateMarriageWaMessage,
  buildMarriageDoc, resolveMarriageConfig, historyFromSections,
} = require('../services/marriage');
const {
  generateMatchReading, generateMatchSectionText, buildMatchDoc, buildCoupleContext,
  resolveMatchConfig, historyFromSections: matchHistoryFromSections,
} = require('../services/matchReport');
const { buildPorondamDoc } = require('../services/porondamReport');

const { generateFollowUp, DEFAULT_FOLLOWUP_PROMPT } = require('../services/followup');
const { syncAudienceForClient, createAudienceForClient, getRecentEvents } = require('../services/metaConversions');
const resolveClientId = require('../middleware/resolveClientId');
const { customerNameFrom } = require('../utils/customerName');

/**
 * Default prompt template for the AI Fill (ai-prepare) feature.
 * Editable per-client via plugin config key `ai_fill_prompt`.
 * Placeholders interpolated at request time:
 *   {{customer_name}} {{birth_date}} {{birth_time}} {{birth_place}}
 *   {{lagna}} {{problems}} {{items}} {{chat_log}}
 */
const DEFAULT_AI_FILL_PROMPT = `You are an expert Vedic astrology assistant and Sinhala language expert helping prepare a horoscope reading request.

## Order Details
- Customer name: {{customer_name}}
- Birth date (raw): {{birth_date}}
- Birth time (raw): {{birth_time}}
- Birth place (raw): {{birth_place}}
- Lagna (if known): {{lagna}}
- Problem / concern: {{problems}}
- Items ordered: {{items}}

## Full Customer Chat Conversation
{{chat_log}}

## Your Task — return the exact JSON schema below, nothing else.

### birth_date_iso
Normalize the raw birth date to exactly "YYYY-MM-DD" format (e.g. "1990-03-15").
Sinhala month names: ජනවාරි=01 පෙබරවාරි=02 මාර්තු=03 අප්‍රේල්=04 මැයි=05 ජූනි=06 ජූලි=07 අගෝස්තු=08 සැප්තැම්බර්=09 ඔක්තෝබර්=10 නොවැම්බර්=11 දෙසැම්බර්=12
Return null if genuinely unknown.

### birth_time_24h
Normalize the raw birth time to exactly "HH:MM" 24-hour format.
CRITICAL: "ප.ව" means afternoon/PM. Add 12 to hours 1–11 for PM. Examples: "ප.ව 3.30" → "15:30", "ප.ව 9.00" → "21:00", "ප.ව 12.00" → "12:00".
"පෙ.ව" or "උදෑසන" or "උදේ" = AM (do NOT add 12). Examples: "පෙ.ව 6.30" → "06:30", "උදේ 3.30" → "03:30".
"සවස" or "රාත්‍රී" or "රාත්රී" or "දහවල්" = PM.
Midnight = "00:00". Noon = "12:00". Return null if genuinely unknown.

### birth_place_en
The English name of the birth place (translated from Sinhala if needed). Just the place name, no country suffix needed.

### lat
The latitude (decimal degrees) of the birth place. Use your geographic knowledge to return precise coordinates with minimum 4 decimal places for this specific town/city in Sri Lanka (or abroad if applicable). Return a number, not a string. Example: 8.4983 not 8.5

### lng
The longitude (decimal degrees) of the birth place. SAME requirement — minimum 4 decimal places of precision. Return a number, not a string. Example: 80.6015 not 80.6

### special_questions
Each special question has TWO separate fields:
- "question": the SHORT, polished Sinhala question shown to the CUSTOMER on the final PDF. Keep it clean and human — one clear sentence the customer reads and recognises as their concern. The customer sees ONLY this.
- "prompt": a DETAILED, descriptive instruction written FOR GEMINI ONLY (the customer NEVER sees this). Spell out the customer's exact situation from the chat, the specific angle to analyse, what the answer must cover, and what would give this person real clarity. Be explicit and information-rich — this is the real input that drives the quality of the generated answer. Include relevant context the customer mentioned (their fear, the decision, the timeline, the relationship, etc.). Written in Sinhala (English technical terms are fine where natural).

Read the customer's chat conversation carefully and identify SPECIFIC personal situations, fears, or concerns the customer mentioned — things beyond generic topics.

The following sections are ALREADY generated for every customer automatically. Do NOT create questions that duplicate what these sections already cover:
- පෞරුෂය — general personality analysis
- අධ්‍යාපනය — general education analysis
- වෘත්තීය ජීවිතය සහ ආර්ථික ශක්තිය — general career and financial analysis
- ප්‍රේමය සහ විවාහ ජීවිතය — general love and marriage analysis
- දේපළ, භූමිය, නිවාස සහ වාහන භාග්‍යය — general property analysis
- ශාරීරික සෞඛ්‍යය, මාරක අපල, හදිසි අනතුරු — general health analysis
- දරු පල — general children analysis
- මෙතෙක් දැක්වූ කරුණු අනුව ජීවන ගමනේ සමස්ත සාරාංශය — overall life summary
- වර්තමාන දශාව අනුව පලාපල — current dasha period analysis
- ජීවිතයේ අභියෝග ජයගැනීම සඳහා වූ පොදු ශාස්ත්‍රීය සහ බෞද්ධ පිළියම් — remedies

So a question like "දරුඵල ගැන බලන්න" or "විවාහය ගැන කියන්න" is USELESS — those sections already do that for everyone.

A special question is ONLY valid if it targets something SPECIFIC this customer personally mentioned in the chat — a specific struggle, fear, decision, or life situation that the generic sections won't address.

Before writing each question ask yourself: "What is the best angle to frame this so Gemini gives the most honest, direct, and valuable answer — something that gives THIS customer real clarity on their specific situation and makes them feel understood?"

IMPORTANT: If the customer's chat has NO specific personal concerns beyond the generic topics — return only the mandatory question below. Do not invent extra questions. Quality over quantity.

MANDATORY: Always include these two questions for every customer (add them LAST in the array, after any specific questions). For each, "question" is the short customer-facing text and "prompt" is the detailed Gemini instruction:
1. question: "ඉදිරි අවුරුදු 5 තුල විශේෂයෙන් සැලකිලිමත් විය යුතු කරුණු සහ කල යුතු, නොකල යුතු දේවල්"
   prompt: "මෙම පුද්ගලයාගේ ලග්නය, දශා සහ ගෝචර අනුව 2026 සිට ඉදිරි අවුරුදු 5 තුළ විශේෂයෙන් සැලකිලිමත් විය යුතු කරුණු, එළැඹෙන අවස්ථා සහ අවදානම් පැහැදිලිව දක්වන්න. එක් එක් කාල පරිච්ඡේදය සඳහා කල යුතු සහ නොකල යුතු දේවල් සෘජුව ලැයිස්තුගත කරන්න."
   sections: ["මෙතෙක් දැක්වූ කරුණු අනුව ජීවන ගමනේ සමස්ත සාරාංශය", "වර්තමාන දශාව අනුව පලාපල"]
2. question: "හදහනට අනුව ගැලපෙන ව්‍යාපාර සහ ඒවා ආරම්බ කිරීමට ගැලපෙන සුබ කාලය? දැනට ව්‍යාපාරයක් කරගෙන යන්නේ නම් එහි ඇතිවිය හැකි ගැටළු, බාදා සහ සාර්ථකත්වය වෙනුවෙන් කල යුතු දේවල්"
   prompt: "මෙම හදහනට ගැලපෙන ව්‍යාපාර වර්ග මොනවාද සහ ඒවා ආරම්භ කිරීමට සුදුසු සුබ දශා/කාල පරිච්ඡේද කවරේද යන්න විස්තර කරන්න. පුද්ගලයා දැනටමත් ව්‍යාපාරයක් කරගෙන යයි නම්, එහි ඇතිවිය හැකි ගැටළු සහ බාධා මොනවාද, සහ සාර්ථකත්වය සඳහා කල යුතු දේවල් මොනවාද යන්න ග්‍රහ පිහිටීම් මත පදනම්ව සෘජුව පවසන්න."
   sections: ["වෘත්තීය ජීවිතය සහ ආර්ථික ශක්තිය", "වර්තමාන දශාව අනුව පලාපල"]

Each question MUST:
- Both "question" and "prompt" written in Sinhala
- "question" short and customer-facing; "prompt" detailed and Gemini-facing
- Be about something SPECIFIC the customer mentioned — not a topic the generic sections already cover
- Be framed to get a direct, honest answer that gives real clarity to this specific person
- NOT be about remedies, pirith, or Buddhist practices

Example of BAD question: "දරුඵල සම්බන්ධයෙන් හදහනේ දැක්වෙන්නේ කුමක්ද" — this is what the දරු පල section already does
Example of GOOD pair:
  question: "වසර 3ක් තිස්සේ ප්‍රමාද වන දරු සුවය ලැබෙන්නේ කවදාද?"
  prompt: "මෙම පුද්ගලයා විවාහ වී ඇති නමුත් දරුවෙකු ලැබීම වසර 3ක් තිස්සේ ප්‍රමාද වෙමින් පවතී. 5 වැනි භාවය, එහි අධිපතියා, ගුරු සහ අදාළ ග්‍රහ පිහිටීම් විශ්ලේෂණය කර මෙම ප්‍රමාදයට සත්‍ය හේතුව කුමක්ද සහ දරු සුවය ලැබීමට වඩාත් සුදුසු දශා/කාල පරිච්ඡේදය කවදාද යන්න සෘජුව පවසන්න."

The "sections" array must use the exact Sinhala section keys from this list:
- "පෞරුෂය"
- "අධ්‍යාපනය"
- "වෘත්තීය ජීවිතය සහ ආර්ථික ශක්තිය"
- "ප්‍රේමය සහ විවාහ ජීවිතය"
- "දේපළ, භූමිය, නිවාස සහ වාහන භාග්‍යය"
- "ශාරීරික සෞඛ්‍යය, මාරක අපල, හදිසි අනතුරු"
- "දරු පල"
- "මෙතෙක් දැක්වූ කරුණු අනුව ජීවන ගමනේ සමස්ත සාරාංශය"
- "වර්තමාන දශාව අනුව පලාපල"
- "ජීවිතයේ අභියෝග ජයගැනීම සඳහා වූ පොදු ශාස්ත්‍රීය සහ බෞද්ධ පිළියම්"`;

/**
 * AI Fill prompt for the MATCH MAKING report. Deliberately separate from the horoscope
 * one: a match-making chat contains TWO people's birth details, and the only thing that
 * matters more than extracting them is attributing them to the right person. Guessing
 * wrong silently produces a confident, completely wrong compatibility report, so the
 * prompt is written to return null rather than guess.
 * Placeholder: {{chat_log}}
 */
const DEFAULT_MATCH_AI_FILL_PROMPT = `You are an expert Vedic astrology assistant and Sinhala language expert preparing a COUPLE COMPATIBILITY (ගැළපීම / match making) reading.

## Full Customer Chat Conversation
{{chat_log}}

## Your Task
This chat contains the birth details of TWO different people — a male (පිරිමි / boy) and a female (ගැහැනු / girl) — because the customer wants their horoscopes compared. Extract BOTH, and return the exact JSON schema below, nothing else.

## CRITICAL — attributing details to the right person
Getting this backwards produces a confident but completely wrong report, so be strict:
- Sinhala cues for the MALE: පිරිමි, පුතා, පුතාගේ, කොල්ලා, මහත්මයා, ඔහුගේ, මනාලයා, සැමියා, පිරිමි ළමයා
- Sinhala cues for the FEMALE: ගැහැනු, දුව, දුවගේ, කෙල්ල, මිස්, ඇයගේ, මනාලිය, බිරිඳ, ගැහැනු ළමයා
- Also use: which name is customarily male or female in Sri Lanka; the order the customer introduced them; and possessive context ("මගේ පුතාගේ උපන් දිනය…").
- If the chat gives two sets of details but you CANNOT confidently tell which is which, return null for BOTH. A wrong pairing is far worse than an empty form.
- If only ONE person's details appear, fill that person and return null for the other. NEVER duplicate one person's details into both slots, and never invent the second person.
- Return null for a person whose BIRTH DATE you cannot find, even if you found their name.

### name
The person's name as written in the chat (Sinhala or English, whichever the customer used). Empty string if never stated.

### birth_date_iso
Normalize to exactly "YYYY-MM-DD" (e.g. "1990-03-15").
Sinhala month names: ජනවාරි=01 පෙබරවාරි=02 මාර්තු=03 අප්‍රේල්=04 මැයි=05 ජූනි=06 ජූලි=07 අගෝස්තු=08 සැප්තැම්බර්=09 ඔක්තෝබර්=10 නොවැම්බර්=11 දෙසැම්බර්=12
Return null if genuinely unknown.

### birth_time_24h
Normalize to exactly "HH:MM" 24-hour format.
CRITICAL: "ප.ව" means afternoon/PM. Add 12 to hours 1–11 for PM. Examples: "ප.ව 3.30" → "15:30", "ප.ව 9.00" → "21:00", "ප.ව 12.00" → "12:00".
"පෙ.ව" or "උදෑසන" or "උදේ" = AM (do NOT add 12). Examples: "පෙ.ව 6.30" → "06:30", "උදේ 3.30" → "03:30".
"සවස" or "රාත්‍රී" or "රාත්රී" or "දහවල්" = PM.
Midnight = "00:00". Noon = "12:00". Return null if genuinely unknown.

### birth_place_en
The English name of that person's birth place (translated from Sinhala if needed). Just the place name, no country suffix. Each person has their OWN birth place — do not copy one to the other unless the chat actually says they were born in the same town.

### lat / lng
Latitude and longitude (decimal degrees) of THAT person's birth place. Use your geographic knowledge and return precise coordinates with a minimum of 4 decimal places. Return numbers, not strings. Example: 8.4983 / 80.6015 — not 8.5 / 80.6.

### special_questions
The specific things THIS COUPLE asked about their relationship. Two fields each:
- "question": the SHORT, polished Sinhala question shown to the customer in the final PDF. One clear sentence they will recognise as their own concern.
- "prompt": a DETAILED Sinhala instruction written FOR GEMINI ONLY (the customer never sees it). Spell out the couple's exact situation from the chat, the angle to analyse, and what the answer must cover.

The following are ALREADY covered by the report's standard sections. Do NOT create questions duplicating them:
- overall chart compatibility and ගැළපීම percentage
- personality similarities and complementary traits
- communication and intellectual understanding
- love, affection and emotional bonding
- physical and sexual compatibility
- conflict tendencies and how to resolve them
- current dasha periods and transits affecting the relationship
- childbirth prospects (දරු පල)
- long-term survival of the relationship
- major doshas (කුජ, ශනි මංගල, සර්ප) and their cancellation
- remedies
- final verdict on whether to proceed

A special question is ONLY valid if it targets something SPECIFIC this couple personally mentioned — family opposition, an age gap, a long-distance situation, a specific wedding date they are considering, a previous relationship, a health or financial worry, and so on.

If the chat contains no such specific concern, return an EMPTY array. Do not invent questions.`;

const { exec } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

function findSoffice() {
  if (process.platform !== 'win32') return 'soffice';
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files\\LibreOffice 7\\program\\soffice.exe',
    'C:\\Program Files\\LibreOffice 6\\program\\soffice.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) { console.log('[PDF] Found soffice at', c); return `"${c}"`; }
  }
  throw new Error('LibreOffice not found on this machine. Install it from https://www.libreoffice.org/download/download/ — PDF generation requires LibreOffice.');
}

async function convertDocxToPdf(tmpDocx, outDir, tmpHome, fontDir) {
  const soffice = findSoffice();
  console.log(`[PDF] platform=${process.platform}  soffice=${soffice}  tmpDocx=${tmpDocx}  outDir=${outDir}`);

  if (process.platform !== 'win32') {
    await new Promise(resolve =>
      exec(`fc-cache -f "${fontDir}"`, { env: { ...process.env, HOME: tmpHome } }, (err, stdout, stderr) => {
        if (err) console.warn('[PDF] fc-cache warning:', stderr || err.message);
        resolve();
      })
    );
  }

  await new Promise((resolve, reject) =>
    exec(
      `${soffice} --headless --convert-to pdf --outdir "${outDir}" "${tmpDocx}"`,
      { env: { ...process.env, HOME: tmpHome } },
      (err, stdout, stderr) => {
        console.log('[PDF] soffice stdout:', stdout);
        if (stderr) console.log('[PDF] soffice stderr:', stderr);
        if (err) {
          console.error('[PDF] soffice error:', err.message);
          reject(new Error(stderr || err.message));
        } else {
          resolve();
        }
      }
    )
  );
}

/**
 * GET /api/plugins/:pluginId/config — get plugin config for the current client.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getPluginConfig(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { pluginId } = req.params;
  try {
    const config = await db.getPluginConfig(clientId, pluginId);
    let defaults;
    if (pluginId === 'astro_vedic_chart') {
      defaults = { name: 'Vedic Astro Chart', prompt: DEFAULT_ASTRO_PROMPT };
    } else if (pluginId === 'horoscope_reading') {
      defaults = {
        name: 'Horoscope Reading', system_prompt: '', quantum_system_prompt: '', aura_system_prompt: '',
        horoscope_sections: [], quantum_sections: [], section_guides: {}, special_note: '',
        fixed_instructions: '', vip_section_label: '', remedies_section_label: '',
        special_questions_title: '', quantum_report_title: '', porondam_report_title: '',
        api_key: '', wa_message_prompt: '', ai_fill_prompt: DEFAULT_AI_FILL_PROMPT, quantum_enabled: true,
        // Editorial fields start empty. Seeding them from a built-in default
        // would put whichever client wrote that text into every other client's
        // report the moment they forgot to fill a field in.
        marriage_system_prompt: '', marriage_sections: [],
        marriage_special_note: '', marriage_wa_prompt: '',
        marriage_report_title: '', marriage_fixed_instructions: '',
        match_system_prompt: '', match_sections: [],
        match_special_note: '', match_report_title: '',
        match_questions_title: '', match_fixed_instructions: '',
        match_question_instructions: '',
        match_ai_fill_prompt: DEFAULT_MATCH_AI_FILL_PROMPT,
      };
    } else if (pluginId === 'ai_call_answering') {
      defaults = { name: 'AI Call Answering', system_prompt: '', greeting: 'Hello, how can I help you today?', tts_voice: 'Kore', stt_language: 'en-US' };
    } else if (pluginId === 'image_analyzer') {
      defaults = {
        name: 'Image Analyzer',
        verification_prompt: 'When a customer sends a payment slip:\n1. The amount and date must match one of their pending orders. Do NOT check the payer name — payments may be made by someone else on behalf of the customer.\n2. If the amount and date look correct and no fraud flags are raised, tell the customer their payment is received and being verified by the team. Then output: [[PAYMENT_IDENTIFIED:{"order_id":"ORDER_ID_HERE","amount":"AMOUNT","date":"DATE","bank":"BANK","ref":"REF"}]]\n3. If there are FRAUD CHECK flags (suspicious date etc.), politely ask the customer to clarify — do not accuse them. Output: [[UPDATE_SUMMARY:⚠️ SUSPICIOUS PAYMENT — Team review needed. Describe what was suspicious.]]\n4. If the amount does not match any pending order, politely ask the customer to check and clarify.\n5. Always mention the extracted amount and date so the customer can confirm.',
      };
    } else if (pluginId === 'follow_up_generator') {
      defaults = { name: 'Follow-up Generator', prompt: DEFAULT_FOLLOWUP_PROMPT, prompt2: '' };
    } else if (pluginId === 'meta_conversions') {
      defaults = { name: 'Meta Conversions', pixel_id: '', api_key: '', ad_account_id: '', audience_id: '' };
    } else if (pluginId === 'tarot_reading') {
      defaults = {
        name: 'Tarot Reading', prompt: '',
        page1_heading: '', page1_body: '',
        page2_heading: '', page2_body: '',
        page4_heading: '', page4_body: '',
      };
    } else {
      defaults = { name: pluginId, prompt: '' };
    }
    const merged = { ...defaults, ...config };

    // Empty match_sections now means exactly that: the client has not defined
    // their compatibility report yet, and generation will refuse until they do.

    res.json(merged);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * PUT /api/plugins/:pluginId/config — update plugin config (superadmin or own client).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updatePluginConfig(req, res) {
  const clientId = req.body.client_id || resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (req.user.role !== 'superadmin' && req.user.clientId !== clientId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { pluginId } = req.params;
  const { name, prompt, prompt2, api_key, system_prompt, quantum_system_prompt, aura_system_prompt, horoscope_sections, quantum_sections, section_guides, special_note, wa_message_prompt, ai_fill_prompt, greeting, tts_voice, stt_language, verification_prompt, extraction_prompt, expected_account, expected_bank, expected_names, page1_body, page2_body, page4_body, quantum_enabled, pixel_id, ad_account_id, audience_id, marriage_system_prompt, marriage_sections, marriage_special_note, marriage_wa_prompt, match_system_prompt, match_sections, match_special_note, match_ai_fill_prompt,
    fixed_instructions, vip_section_label, remedies_section_label, special_questions_title, quantum_report_title, porondam_report_title, porondam_special_note, marriage_report_title, marriage_fixed_instructions, match_report_title, match_questions_title, match_fixed_instructions, match_question_instructions, page1_heading, page2_heading, page4_heading } = req.body;
  try {
    const existing = await db.getPluginConfig(clientId, pluginId);
    const update = { ...existing };
    if (name !== undefined)          update.name          = name;
    if (extraction_prompt !== undefined) update.extraction_prompt = extraction_prompt;
    if (expected_account !== undefined)  update.expected_account  = expected_account;
    if (expected_bank !== undefined)     update.expected_bank     = expected_bank;
    if (expected_names !== undefined)    update.expected_names    = expected_names;
    if (prompt !== undefined)        update.prompt        = prompt;
    if (prompt2 !== undefined)       update.prompt2       = prompt2;
    if (api_key !== undefined)       update.api_key       = api_key;
    if (system_prompt !== undefined)         update.system_prompt         = system_prompt;
    if (quantum_system_prompt !== undefined) update.quantum_system_prompt = quantum_system_prompt;
    if (aura_system_prompt !== undefined)    update.aura_system_prompt    = aura_system_prompt;
    if (horoscope_sections !== undefined)    update.horoscope_sections    = horoscope_sections;
    if (quantum_sections !== undefined)      update.quantum_sections      = quantum_sections;
    if (section_guides !== undefined)        update.section_guides        = section_guides;
    if (special_note !== undefined)          update.special_note          = special_note;
    if (marriage_system_prompt !== undefined) update.marriage_system_prompt = marriage_system_prompt;
    if (marriage_sections !== undefined)      update.marriage_sections      = marriage_sections;
    if (marriage_special_note !== undefined)  update.marriage_special_note  = marriage_special_note;
    if (marriage_wa_prompt !== undefined)     update.marriage_wa_prompt     = marriage_wa_prompt;
    if (match_system_prompt !== undefined)    update.match_system_prompt    = match_system_prompt;
    if (match_sections !== undefined)         update.match_sections         = match_sections;
    if (match_special_note !== undefined)     update.match_special_note     = match_special_note;
    if (match_ai_fill_prompt !== undefined)   update.match_ai_fill_prompt   = match_ai_fill_prompt;
    if (wa_message_prompt !== undefined)     update.wa_message_prompt     = wa_message_prompt;
    if (ai_fill_prompt !== undefined)        update.ai_fill_prompt        = ai_fill_prompt;
    if (quantum_enabled !== undefined)       update.quantum_enabled       = quantum_enabled;
    if (greeting !== undefined)      update.greeting      = greeting;
    if (tts_voice !== undefined)     update.tts_voice     = tts_voice;
    if (stt_language !== undefined)         update.stt_language         = stt_language;
    if (verification_prompt !== undefined)  update.verification_prompt  = verification_prompt;
    if (page1_body !== undefined)    update.page1_body    = page1_body;
    if (page2_body !== undefined)    update.page2_body    = page2_body;
    if (page4_body !== undefined)    update.page4_body    = page4_body;
    if (pixel_id !== undefined)      update.pixel_id      = pixel_id;
    if (ad_account_id !== undefined) update.ad_account_id = ad_account_id;
    if (audience_id !== undefined)   update.audience_id   = audience_id;
    // Per-client report titles, section labels and fixed instructions.
    if (fixed_instructions !== undefined) update.fixed_instructions = fixed_instructions;
    if (vip_section_label !== undefined) update.vip_section_label = vip_section_label;
    if (remedies_section_label !== undefined) update.remedies_section_label = remedies_section_label;
    if (special_questions_title !== undefined) update.special_questions_title = special_questions_title;
    if (quantum_report_title !== undefined) update.quantum_report_title = quantum_report_title;
    if (porondam_report_title !== undefined) update.porondam_report_title = porondam_report_title;
    if (porondam_special_note !== undefined) update.porondam_special_note = porondam_special_note;
    if (marriage_report_title !== undefined) update.marriage_report_title = marriage_report_title;
    if (marriage_fixed_instructions !== undefined) update.marriage_fixed_instructions = marriage_fixed_instructions;
    if (match_report_title !== undefined) update.match_report_title = match_report_title;
    if (match_questions_title !== undefined) update.match_questions_title = match_questions_title;
    if (match_fixed_instructions !== undefined) update.match_fixed_instructions = match_fixed_instructions;
    if (match_question_instructions !== undefined) update.match_question_instructions = match_question_instructions;
    if (page1_heading !== undefined) update.page1_heading = page1_heading;
    if (page2_heading !== undefined) update.page2_heading = page2_heading;
    if (page4_heading !== undefined) update.page4_heading = page4_heading;
    await db.upsertPluginConfig(clientId, pluginId, update);
    res.json({ ok: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/:pluginId/customer-data/:phone — get saved customer data for a plugin.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getPluginCustomerData(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { pluginId, phone } = req.params;
  try {
    const data = await db.getPluginCustomerData(clientId, phone, pluginId);
    res.json(data);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * POST /api/plugins/astro-chart — generate an astro chart message for a customer.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function generateAstroChart(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  // Check addon enabled
  const addonCheckOk = await db.hasAddon(clientId, 'astro_vedic_chart');
  if (!addonCheckOk) return res.status(403).json({ error: 'astro_vedic_chart addon not enabled' });

  const { phone, birth_date, birth_time, lat, lng, birth_place_name } = req.body;
  if (!phone || !birth_date || !birth_time || lat == null || lng == null) {
    return res.status(400).json({ error: 'phone, birth_date, birth_time, lat, lng required' });
  }

  // Parse birth date/time
  const [year, month, day] = birth_date.split('-').map(s => parseInt(s, 10));
  const [hour, minute] = birth_time.split(':').map(s => parseInt(s, 10));

  // Validate parsed values
  if (
    isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute) ||
    year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 ||
    hour < 0 || hour > 23 || minute < 0 || minute > 59
  ) {
    return res.status(400).json({ error: `Invalid birth date or time. Received date="${birth_date}", time="${birth_time}". Use YYYY-MM-DD and HH:MM format.` });
  }

  try {
    const apiKey = await getFreeAstroKey(clientId);

    const text = await generateAstroMessage(clientId, phone, { year, month, day, hour, minute, lat, lng, birth_place_name }, apiKey);
    res.json({ text });
  } catch (e) {
    console.error('[ASTRO] error:', e?.response?.data || e.message);
    const detail = e?.response?.data?.detail;
    const errMsg = Array.isArray(detail)
      ? detail.map(d => `${d.loc?.slice(-1)?.[0] || 'field'}: ${d.msg}`).join('; ')
      : (typeof detail === 'string' ? detail : e.message);
    res.status(500).json({ error: errMsg });
  }
}

/**
 * POST /api/plugins/horoscope/analyze-aura — run Gemini Vision aura analysis on a selfie.
 *
 * Accepts multipart/form-data with field "image".
 * Saves result to horoscope_data.aura_analysis (reuses saved result unless ?override=1).
 * Returns the aura_analysis JSON so the frontend can display it immediately.
 */
async function analyzeAuraImage(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { order_id, override } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  if (!req.file)  return res.status(400).json({ error: 'image file required' });

  try {
    // Load existing horoscope_data
    const r = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1',
      [order_id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });

    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    // Return cached result unless override is explicitly requested
    if (hd.aura_analysis && override !== '1' && override !== 'true') {
      console.log('[AURA] Returning cached aura_analysis for order', order_id);
      return res.json({ aura_analysis: hd.aura_analysis, cached: true });
    }

    const config  = await db.getPluginConfig(clientId, 'horoscope_reading');
    const apiKey  = await getGeminiKey(clientId);

    const auraAnalysis = await analyzeAura(req.file.buffer, req.file.mimetype, apiKey, config.aura_system_prompt || '');

    // Save to horoscope_data.aura_analysis (jsonb_set preserves all other keys)
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{aura_analysis}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(auraAnalysis), order_id]
    );

    console.log('[AURA] Saved aura_analysis for order', order_id, '| af_score:', auraAnalysis.af_score);
    res.json({ aura_analysis: auraAnalysis, cached: false });
  } catch (e) {
    console.error('[AURA] Error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/horoscope/generate — generate full horoscope reading for an order.
 */
async function generateHoroscopeReading(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const {
    order_id, lat, lng, birth_place_name, birth_overrides,
    override_astro, special_questions, package_type,
    include_quantum, active_name, selected_sections, use_agent,
  } = req.body;
  if (!order_id || lat == null || lng == null) {
    return res.status(400).json({ error: 'order_id, lat, lng required' });
  }
  const addonCheckOk = await db.hasAddon(clientId, 'horoscope_reading');
  if (!addonCheckOk) return res.status(403).json({ error: 'horoscope_reading addon not enabled' });

  // Enforce server-side: ignore include_quantum if the feature is disabled in config
  const pluginCfg = await db.getPluginConfig(clientId, 'horoscope_reading');
  const effectiveIncludeQuantum = pluginCfg.quantum_enabled !== false ? !!include_quantum : false;

  if (effectiveIncludeQuantum && !active_name?.trim()) {
    return res.status(400).json({ error: 'active_name required when include_quantum is true' });
  }

  // Mark as generating immediately so the frontend can show progress
  if (db.IS_PG) {
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(jsonb_set(COALESCE(horoscope_data,'{}'), '{generating}', 'true'::jsonb), '{generating_at}', to_jsonb(NOW()::text)) WHERE order_id=$1`,
      [order_id]
    ).catch(() => {});
  }

  // Return immediately — generation runs in background
  res.json({ ok: true, generating: true });

  generateHoroscope(
    clientId, order_id,
    birth_overrides || {},
    lat, lng,
    birth_place_name || '',
    !!override_astro,
    Array.isArray(special_questions) ? special_questions : [],
    true,
    effectiveIncludeQuantum,
    (active_name || '').trim(),
    Array.isArray(selected_sections) && selected_sections.length > 0 ? selected_sections : null,
    !!use_agent
  ).catch(async (e) => {
    console.error('[HOROSCOPE] generate error:', e.message);
    const detail = e?.response?.data?.detail;
    const msg = Array.isArray(detail)
      ? detail.map(d => `${d.loc?.slice(-1)?.[0] || 'field'}: ${d.msg}`).join('; ')
      : (typeof detail === 'string' ? detail : e.message);
    // Save error state so the frontend can show it
    if (db.IS_PG) {
      await db.pgQuery(
        `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}') - 'generating', '{error}', $1::jsonb) WHERE order_id=$2`,
        [JSON.stringify(msg), order_id]
      ).catch(() => {});
    }
  });
}

/**
 * GET /api/plugins/horoscope/progress/:orderId — live generation status for polling.
 * Returns the `generating` flag, the agent's live `agent_progress` event, and whether
 * sections have been written yet (so the UI knows when the run finished).
 */
async function horoscopeProgress(req, res) {
  const { orderId } = req.params;
  try {
    const r = await db.pgQuery('SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});
    res.json({
      generating:     hd.generating === true,
      progress:       hd.progress || null,
      agent_progress: hd.agent_progress || null,
      agent_audit:    hd.agent_audit || null,
      has_sections:   !!(hd.sections && Object.keys(hd.sections).length > 0),
      error:          hd.error || null,
    });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * PATCH /api/plugins/horoscope/sections/:orderId — update saved section text.
 */
async function updateHoroscopeSections(req, res) {
  const { orderId } = req.params;
  const { sections, special_answers } = req.body;
  try {
    const existing = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof existing.rows[0].horoscope_data === 'string')
      ? JSON.parse(existing.rows[0].horoscope_data || '{}')
      : (existing.rows[0].horoscope_data || {});
    if (sections)        hd.sections        = { ...(hd.sections || {}), ...sections };
    if (special_answers) hd.special_answers = special_answers;
    await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(hd), orderId]);
    res.json({ ok: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download/:orderId — stream .docx for an order.
 */
async function downloadHoroscope(req, res) {
  const { orderId } = req.params;
  try {
    const r = await db.pgQuery(
      'SELECT phone_number, custom_fields, horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});
    if (!hd.sections) return res.status(404).json({ error: 'No horoscope data yet' });

    const cf = (typeof r.rows[0].custom_fields === 'string')
      ? JSON.parse(r.rows[0].custom_fields || '{}')
      : (r.rows[0].custom_fields || {});

    const clientId = resolveClientId(req);
    const config = clientId ? await db.getPluginConfig(clientId, 'horoscope_reading') : {};

    const buffer = await buildHoroscopeDoc({
      customerName:   customerNameFrom(cf),
      sections:       hd.sections,
      specialAnswers: hd.special_answers  || [],
      specialNote:    config.special_note || '',
      birthDate:      cf.birth_date || '',
      birthTime:      cf.birth_time || '',
      sectionOrder:   config.horoscope_sections || [],
      brand:          await getBrand(clientId),
      remediesLabel:  config.remedies_section_label || '',
      specialQuestionsTitle: config.special_questions_title || '',
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const phone    = (r.rows[0].phone_number || orderId).replace(/\D/g, '');
    const last4    = phone.slice(-4) || '0000';
    const parsed   = parseSinhalaDate(cf.birth_date || '');
    const birthday = parsed
      ? `${parsed.year}${String(parsed.month).padStart(2,'0')}${String(parsed.day).padStart(2,'0')}`
      : 'birthday';
    const filename = `horoscope-${last4}-${birthday}.docx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download-pdf/:orderId — stream PDF for an order.
 */
async function downloadHoroscopePdf(req, res) {
  const { orderId } = req.params;
  try {
    const r = await db.pgQuery(
      'SELECT phone_number, custom_fields, horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});
    if (!hd.sections) return res.status(404).json({ error: 'No horoscope data yet' });

    const cf = (typeof r.rows[0].custom_fields === 'string')
      ? JSON.parse(r.rows[0].custom_fields || '{}')
      : (r.rows[0].custom_fields || {});

    const clientId = resolveClientId(req);
    const config = clientId ? await db.getPluginConfig(clientId, 'horoscope_reading') : {};

    const docxBuffer = await buildHoroscopeDoc({
      customerName:   customerNameFrom(cf),
      sections:       hd.sections,
      specialAnswers: hd.special_answers  || [],
      specialNote:    config.special_note || '',
      birthDate:      cf.birth_date || '',
      birthTime:      cf.birth_time || '',
      sectionOrder:   config.horoscope_sections || [],
      brand:          await getBrand(clientId),
      remediesLabel:  config.remedies_section_label || '',
      specialQuestionsTitle: config.special_questions_title || '',
    });

    const uid  = `${orderId}-${Date.now()}`;
    const tmpHome = path.join(os.tmpdir(), `lo-home-${uid}`);
    const tmpDocx = path.join(os.tmpdir(), `horo-${uid}.docx`);
    const tmpPdf  = path.join(os.tmpdir(), `horo-${uid}.pdf`);

    const fontSrc = path.join(__dirname, '../assets/fonts');
    const fontDirs = [
      path.join(tmpHome, '.fonts'),
      path.join(tmpHome, '.local', 'share', 'fonts'),
      path.join(tmpHome, '.config', 'libreoffice', '4', 'user', 'fonts'),
    ];
    for (const dir of fontDirs) {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(fontSrc)) {
        if (f.endsWith('.ttf')) fs.copyFileSync(path.join(fontSrc, f), path.join(dir, f));
      }
    }

    fs.writeFileSync(tmpDocx, docxBuffer);
    await convertDocxToPdf(tmpDocx, os.tmpdir(), tmpHome, fontDirs[0]);

    const { PDFDocument } = require('pdf-lib');
    const rawPdf = fs.readFileSync(tmpPdf);
    const pdfDoc = await PDFDocument.load(rawPdf);
    const brand = await getBrand(clientId);
    pdfDoc.setTitle(brand.pdf.title || '');
    pdfDoc.setAuthor(brand.pdf.author || '');
    pdfDoc.setCreator(brand.pdf.producer || '');
    pdfDoc.setProducer(brand.pdf.producer || '');
    pdfDoc.setSubject(brand.pdf.subject || '');
    pdfDoc.setKeywords([]);
    const buffer = Buffer.from(await pdfDoc.save());
    fs.rm(tmpHome, { recursive: true, force: true }, () => {});
    fs.unlink(tmpDocx, () => {});
    fs.unlink(tmpPdf, () => {});

    const phone  = (r.rows[0].phone_number || orderId).replace(/\D/g, '');
    const last4  = phone.slice(-4) || '0000';
    const rawBirth = hd.birth_overrides?.birth_date || cf.birth_date || '';
    const parsed = parseSinhalaDate(rawBirth);
    const birthday = parsed
      ? `${parsed.year}${String(parsed.month).padStart(2,'0')}${String(parsed.day).padStart(2,'0')}`
      : rawBirth.replace(/[^0-9]/g, '').slice(0, 8) || 'birthday';
    const filename = `${phone}-${birthday}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * PATCH /api/plugins/horoscope/quantum-sections/:orderId — update saved quantum section content.
 */
async function updateQuantumSections(req, res) {
  const { orderId } = req.params;
  const { quantum_sections_data } = req.body;
  try {
    const existing = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof existing.rows[0].horoscope_data === 'string')
      ? JSON.parse(existing.rows[0].horoscope_data || '{}')
      : (existing.rows[0].horoscope_data || {});
    if (quantum_sections_data !== undefined) hd.quantum_sections_data = quantum_sections_data;
    await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(hd), orderId]);
    res.json({ ok: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download-quantum-docx/:orderId — stream raw Quantum+Aura .docx for preview.
 */
async function downloadQuantumDocx(req, res) {
  const { orderId } = req.params;
  const clientId = resolveClientId(req);
  try {
    const r = await db.pgQuery(
      'SELECT custom_fields, horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});
    if (!hd.quantum_data || !hd.aura_analysis) return res.status(404).json({ error: 'No quantum/aura data yet' });
    const cf = (typeof r.rows[0].custom_fields === 'string')
      ? JSON.parse(r.rows[0].custom_fields || '{}')
      : (r.rows[0].custom_fields || {});

    const config = clientId ? await db.getPluginConfig(clientId, 'horoscope_reading') : {};
    const buffer = await buildQuantumDoc({
      customerName:        customerNameFrom(cf),
      quantumData:         hd.quantum_data,
      auraAnalysis:        hd.aura_analysis,
      quantumReading:      hd.quantum_reading      || null,
      quantumSectionsData: hd.quantum_sections_data || null,
      brand:               await getBrand(clientId),
      reportTitle:         config.quantum_report_title || '',
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="quantum-${orderId}.docx"`);
    res.send(buffer);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download-quantum-pdf/:orderId — stream standalone Quantum+Aura PDF.
 */
async function downloadQuantumPdf(req, res) {
  const { orderId } = req.params;
  const clientId = resolveClientId(req);
  try {
    const r = await db.pgQuery(
      'SELECT phone_number, custom_fields, horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});
    if (!hd.quantum_data || !hd.aura_analysis) return res.status(404).json({ error: 'No quantum/aura data yet' });

    const cf = (typeof r.rows[0].custom_fields === 'string')
      ? JSON.parse(r.rows[0].custom_fields || '{}')
      : (r.rows[0].custom_fields || {});

    const config = clientId ? await db.getPluginConfig(clientId, 'horoscope_reading') : {};
    const docxBuffer = await buildQuantumDoc({
      customerName:        customerNameFrom(cf),
      quantumData:         hd.quantum_data,
      auraAnalysis:        hd.aura_analysis,
      quantumReading:      hd.quantum_reading      || null,
      quantumSectionsData: hd.quantum_sections_data || null,
      brand:               await getBrand(clientId),
      reportTitle:         config.quantum_report_title || '',
    });

    const uid  = `${orderId}-qc-${Date.now()}`;
    const tmpHome = path.join(os.tmpdir(), `lo-home-${uid}`);
    const tmpDocx = path.join(os.tmpdir(), `qc-${uid}.docx`);
    const tmpPdf  = path.join(os.tmpdir(), `qc-${uid}.pdf`);

    const fontSrc  = path.join(__dirname, '../assets/fonts');
    const fontDirs = [
      path.join(tmpHome, '.fonts'),
      path.join(tmpHome, '.local', 'share', 'fonts'),
      path.join(tmpHome, '.config', 'libreoffice', '4', 'user', 'fonts'),
    ];
    for (const dir of fontDirs) {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(fontSrc)) {
        if (f.endsWith('.ttf')) fs.copyFileSync(path.join(fontSrc, f), path.join(dir, f));
      }
    }

    fs.writeFileSync(tmpDocx, docxBuffer);
    await convertDocxToPdf(tmpDocx, os.tmpdir(), tmpHome, fontDirs[0]);

    const { PDFDocument } = require('pdf-lib');
    const rawPdf = fs.readFileSync(tmpPdf);
    const pdfDoc = await PDFDocument.load(rawPdf);
    const brandQ = await getBrand(clientId);
    const qCfg = await db.getPluginConfig(clientId, 'horoscope_reading');
    const quantumTitle = qCfg.quantum_report_title || '';
    pdfDoc.setTitle(quantumTitle);
    pdfDoc.setAuthor(brandQ.pdf.author || '');
    pdfDoc.setCreator(brandQ.pdf.producer || '');
    pdfDoc.setProducer(brandQ.pdf.producer || '');
    pdfDoc.setSubject(quantumTitle);
    pdfDoc.setKeywords([]);
    const buffer = Buffer.from(await pdfDoc.save());
    fs.rm(tmpHome, { recursive: true, force: true }, () => {});
    fs.unlink(tmpDocx, () => {});
    fs.unlink(tmpPdf, () => {});

    const phone    = (r.rows[0].phone_number || orderId).replace(/\D/g, '');
    const parsed   = parseSinhalaDate(cf.birth_date || '');
    const birthday = parsed
      ? `${parsed.year}${String(parsed.month).padStart(2,'0')}${String(parsed.day).padStart(2,'0')}`
      : (cf.birth_date || 'unknown').replace(/[^0-9]/g, '').slice(0, 8);
    const filename = `${phone}-${birthday}-aura.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

async function regenerateQuantumSections(req, res) {
  const { orderId } = req.params;
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  try {
    const r = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });

    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    if (!hd.quantum_data)   return res.status(400).json({ error: 'No quantum data. Generate horoscope with quantum first.' });
    if (!hd.aura_analysis)  return res.status(400).json({ error: 'No aura analysis found.' });

    // Mark quantum as generating so the drawer can reflect this even if reopened
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(jsonb_set(COALESCE(horoscope_data,'{}'), '{quantum_generating}', 'true'::jsonb), '{quantum_generating_at}', to_jsonb(NOW()::text)) WHERE order_id=$1`,
      [orderId]
    );

    res.json({ ok: true, generating: true });

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const quantumSystemPrompt = config.quantum_system_prompt || '';
    const hasConfigSections = Array.isArray(config.quantum_sections) && config.quantum_sections.length > 0;

    console.log('[REGEN-QUANTUM] Starting for order', orderId);
    console.log('[REGEN-QUANTUM] config.quantum_system_prompt:', quantumSystemPrompt ? `(${quantumSystemPrompt.length} chars) "${quantumSystemPrompt.slice(0, 120)}${quantumSystemPrompt.length > 120 ? '...' : ''}"` : '(empty — will use built-in default)');

    let reading = null;
    let sectionsData = null;

    if (hasConfigSections) {
      sectionsData = await generateQuantumSections(
        hd.quantum_data, hd.aura_analysis,
        config.quantum_sections, await getGeminiKey(clientId),
        quantumSystemPrompt,
        hd.chart_data?.vimshottari_dasha || null
      );
    } else {
      reading = await generateQuantumReading(
        hd.quantum_data, hd.aura_analysis, await getGeminiKey(clientId), quantumSystemPrompt
      );
    }

    const updated = {
      ...hd,
      ...(reading      && { quantum_reading: reading }),
      ...(sectionsData && { quantum_sections_data: sectionsData }),
    };
    delete updated.quantum_generating;
    await db.pgQuery(
      'UPDATE orders SET horoscope_data=$1 WHERE order_id=$2',
      [JSON.stringify(updated), orderId]
    );
    console.log('[REGEN-QUANTUM] Done for order', orderId);
  } catch (e) {
    console.error('[REGEN-QUANTUM] Error:', e.message);
    // Clear the generating flag even on error so the drawer doesn't get stuck
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = horoscope_data - 'quantum_generating' WHERE order_id=$1`,
      [orderId]
    ).catch(() => {});
  }
}

async function regenerateHoroscopeSectionHandler(req, res) {
  const { orderId } = req.params;
  const { label } = req.body;
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!label?.trim()) return res.status(400).json({ error: 'label required' });

  try {
    const r = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    if (!hd.chart_data) return res.status(400).json({ error: 'No chart data found.' });

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const systemPrompt = config.system_prompt || '';

    // Find guide for this section from config
    const sectionDef = Array.isArray(config.horoscope_sections)
      ? config.horoscope_sections.find(s => s.label === label.trim())
      : null;
    const sectionGuide = sectionDef?.guide || config.section_guides?.[label.trim()] || '';

    console.log(`[REGEN-HORO-SECTION] order=${orderId} label="${label}"`);

    const newContent = await regenerateHoroscopeSection({
      clientId,
      chartData:     hd.chart_data,
      systemPrompt,
      fixedInstructions: config.fixed_instructions || '',
      sectionKey:    label.trim(),
      sectionGuide,
      specialAnswers: hd.special_answers || [],
      otherSections:  hd.sections || null,
    });

    // Section labels are client-authored free text; interpolating one into the
    // jsonb path literal breaks on any '}' or ',' it contains. Pass it as a
    // parameterised text[] path instead.
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), ARRAY['sections', $1], $2::jsonb) WHERE order_id=$3`,
      [label.trim(), JSON.stringify(newContent), orderId]
    );

    console.log(`[REGEN-HORO-SECTION] Done order=${orderId} label="${label}"`);
    res.json({ ok: true, label: label.trim(), content: newContent });
  } catch (e) {
    console.error('[REGEN-HORO-SECTION] Error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function regenerateQuantumSection(req, res) {
  const { orderId } = req.params;
  const { label } = req.body;
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  if (!label?.trim()) return res.status(400).json({ error: 'label required' });

  try {
    const r = await db.pgQuery(
      'SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    if (!hd.quantum_data)  return res.status(400).json({ error: 'No quantum data found.' });
    if (!hd.aura_analysis) return res.status(400).json({ error: 'No aura analysis found.' });

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const sectionDef = Array.isArray(config.quantum_sections)
      ? config.quantum_sections.find(s => s.label === label.trim())
      : null;

    if (!sectionDef) return res.status(404).json({ error: `Section "${label}" not found in config.` });

    console.log(`[REGEN-SECTION] order=${orderId} label="${label}"`);

    const results = await generateQuantumSections(
      hd.quantum_data,
      hd.aura_analysis,
      [sectionDef],
      await getGeminiKey(clientId),
      config.quantum_system_prompt || '',
      hd.chart_data?.vimshottari_dasha || null
    );

    const newContent = results[0]?.content || '';

    // Update only this section in quantum_sections_data
    const existing = Array.isArray(hd.quantum_sections_data) ? hd.quantum_sections_data : [];
    const idx = existing.findIndex(s => s.label === label.trim());
    let updated;
    if (idx >= 0) {
      updated = existing.map((s, i) => i === idx ? { ...s, content: newContent } : s);
    } else {
      updated = [...existing, { label: label.trim(), content: newContent }];
    }

    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{quantum_sections_data}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(updated), orderId]
    );

    console.log(`[REGEN-SECTION] Done order=${orderId} label="${label}"`);
    res.json({ ok: true, label: label.trim(), content: newContent });
  } catch (e) {
    console.error('[REGEN-SECTION] Error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function saveWaMessageHandler(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { orderId } = req.params;
  const { wa_message } = req.body;
  if (typeof wa_message !== 'string') return res.status(400).json({ error: 'wa_message required' });

  try {
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{wa_message}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(wa_message), orderId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[WA-MESSAGE-SAVE] Error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function generateWaMessageHandler(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { orderId } = req.params;

  try {
    const r = await db.pgQuery('SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found' });
    const hd = (typeof r.rows[0].horoscope_data === 'string')
      ? JSON.parse(r.rows[0].horoscope_data || '{}')
      : (r.rows[0].horoscope_data || {});

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const waMessagePrompt = config.wa_message_prompt || '';
    if (!waMessagePrompt.trim()) return res.status(400).json({ error: 'wa_message_prompt not configured in plugin settings' });

    const waMessage = await generateWaMessage(clientId, orderId, hd, waMessagePrompt);
    res.json({ wa_message: waMessage });
  } catch (e) {
    console.error('[WA-MESSAGE] Error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}


/**
 * POST /api/plugins/horoscope/ai-prepare/:orderId
 * Uses Gemini to read the customer's chat + order details and return:
 *  - birth_time_24h  : normalized "HH:MM"
 *  - birth_place_query : best Nominatim search string
 *  - geocoded place   : { lat, lng, name } from Nominatim
 *  - special_questions : [{question, prompt, sections}] — `question` is the short customer-facing
 *    text shown on the PDF; `prompt` is the detailed Gemini-only input that drives the answer
 */
async function aiPrepareHoroscope(req, res) {
  const clientId = resolveClientId(req);
  const { orderId } = req.params;

  try {
    // 1. Fetch order
    const orderRes = await db.pgQuery(
      'SELECT * FROM orders WHERE order_id=$1',
      [orderId]
    );
    if (!orderRes.rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = orderRes.rows[0];
    const cf = (typeof order.custom_fields === 'string')
      ? JSON.parse(order.custom_fields || '{}')
      : (order.custom_fields || {});

    // 2. Fetch chat messages
    const messages = await db.getMessagesByPhone(order.phone_number, clientId);
    const chatLog = messages.map(m =>
      `[${m.sender_type === 'user' ? 'Customer' : 'Agent'}]: ${m.message_text || ''}`
    ).filter(l => l.length > 12).join('\n');

    // 3. Build the prompt — use the per-client editable template, or the built-in default.
    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const template = (config.ai_fill_prompt && config.ai_fill_prompt.trim())
      ? config.ai_fill_prompt
      : DEFAULT_AI_FILL_PROMPT;

    const prompt = template
      .replace(/\{\{customer_name\}\}/g, customerNameFrom(cf))
      .replace(/\{\{birth_date\}\}/g,    cf.birth_date || '')
      .replace(/\{\{birth_time\}\}/g,    cf.birth_time || '')
      .replace(/\{\{birth_place\}\}/g,   cf.birth_place || '')
      .replace(/\{\{lagna\}\}/g,         cf.lagnaya || cf.lagna || '')
      .replace(/\{\{problems\}\}/g,      cf.problems || cf.summary || '')
      .replace(/\{\{items\}\}/g,         JSON.stringify(cf.items || []))
      .replace(/\{\{chat_log\}\}/g,      chatLog || '(no messages found)');

    const geminiModel = (await getGenAI(clientId)).getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            birth_date_iso:  { type: 'string', nullable: true },
            birth_time_24h:  { type: 'string', nullable: true },
            birth_place_en:  { type: 'string' },
            lat:             { type: 'number' },
            lng:             { type: 'number' },
            special_questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  prompt:   { type: 'string' },
                  sections: { type: 'array', items: { type: 'string' } },
                },
                required: ['question', 'prompt', 'sections'],
              },
            },
          },
          required: ['birth_date_iso', 'birth_time_24h', 'birth_place_en', 'lat', 'lng', 'special_questions'],
        },
      },
    });
    const result = await geminiModel.generateContent(prompt);
    const raw = result.response.text().trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return res.status(500).json({ error: 'Gemini returned invalid JSON', raw }); }

    res.json({
      birth_date_iso:    parsed.birth_date_iso || null,
      birth_time_24h:    parsed.birth_time_24h || null,
      birth_place_en:    parsed.birth_place_en || null,
      lat:               parsed.lat || null,
      lng:               parsed.lng || null,
      special_questions: Array.isArray(parsed.special_questions) ? parsed.special_questions : [],
    });
  } catch (e) {
    console.error('[AI-PREPARE]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

const LAGNA_SINHALA = {
  Aries: 'මේෂ', Taurus: 'වෘෂභ', Gemini: 'මිථුන', Cancer: 'කටක',
  Leo: 'සිංහ', Virgo: 'කන්නියා', Libra: 'තුලා', Scorpio: 'වෘශ්චික',
  Sagittarius: 'ධනු', Capricorn: 'මකර', Aquarius: 'කුම්භ', Pisces: 'මීන',
};

/**
 * POST /api/plugins/horoscope/fetch-chart — call freeastroapi and save chart_data for an order.
 * Returns ascendant sign so the admin can verify lagnaya before generating the full reading.
 */
async function fetchChartData(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  // `target` routes the chart to one half of a match-making couple instead of the
  // order's own chart_data. Omitted → unchanged single-person behaviour.
  const { order_id, lat, lng, birth_place_name, birth_overrides, target, name } = req.body;
  if (!order_id || lat == null || lng == null) {
    return res.status(400).json({ error: 'order_id, lat, lng required' });
  }
  if (target && !['boy', 'girl'].includes(target)) {
    return res.status(400).json({ error: "target must be 'boy' or 'girl'" });
  }

  const overrides = birth_overrides || {};
  const dateInfo  = parseSinhalaDate(overrides.birth_date || '');
  const timeInfo  = parseSinhalaTime(overrides.birth_time || '');
  if (!dateInfo) return res.status(400).json({ error: `Cannot parse birth_date: "${overrides.birth_date}"` });
  if (!timeInfo) return res.status(400).json({ error: `Cannot parse birth_time: "${overrides.birth_time}"` });

  const { year, month, day } = dateInfo;
  const { hour, minute }     = timeInfo;

  try {
    const apiKey = await getFreeAstroKey(clientId);

    const { data: chartData } = await calculateVedicChart(
      { year, month, day, hour, minute, lat: parseFloat(lat), lng: parseFloat(lng) },
      apiKey
    );

    // v2 nests the base chart under `chart`; v1 (legacy) returned it flat.
    const sign = (chartData.chart ?? chartData).ascendant?.sign || null;

    if (target) {
      // Store the whole person (inputs + chart) under match_boy / match_girl so the
      // report generator has everything it needs without re-deriving it.
      const person = {
        name:             name || '',
        birth_date:       overrides.birth_date || '',
        birth_time:       overrides.birth_time || '',
        birth_place_name: birth_place_name || '',
        lat:              parseFloat(lat),
        lng:              parseFloat(lng),
        lagna:            sign,
        chart_data:       chartData,
      };
      // `target` is whitelisted to boy|girl above, so interpolating the path is safe.
      await db.pgQuery(
        `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{match_${target}}', $1::jsonb, true)
         WHERE order_id=$2`,
        [JSON.stringify(person), order_id]
      );
    } else {
      await db.pgQuery(
        `UPDATE orders SET horoscope_data = COALESCE(horoscope_data,'{}') ||
          jsonb_build_object(
            'chart_data', $1::jsonb,
            'lat', $2::float,
            'lng', $3::float,
            'birth_place_name', $4::text
          )
         WHERE order_id=$5`,
        [JSON.stringify(chartData), parseFloat(lat), parseFloat(lng), birth_place_name || '', order_id]
      );
    }

    res.json({ ok: true, target: target || null, sign, sign_si: LAGNA_SINHALA[sign] || sign });
  } catch (e) {
    console.error('[FETCH-CHART]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/follow-up — generate a follow-up message for a customer (addon-gated).
 */
async function generateFollowUpMessage(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const { phone, variant } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const addonCheckOk = await db.hasAddon(clientId, 'follow_up_generator');
  if (!addonCheckOk) return res.status(403).json({ error: 'follow_up_generator addon not enabled' });

  try {
    const text = await generateFollowUp(clientId, phone, variant === '2' ? '2' : '1');
    res.json({ text });
  } catch (e) {
    console.error('[FOLLOWUP] error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message || 'Failed to generate follow-up' });
  }
}

/**
 * GET /api/plugins/meta/recent-events — last 30 CAPI log entries for a client.
 */
async function recentMetaEvents(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const events = await getRecentEvents(clientId);
    res.json({ events });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/**
 * POST /api/plugins/meta/sync-audience — upload all paid customer phones to the Meta Custom Audience.
 */
async function syncMetaAudience(req, res) {
  const clientId = req.body.client_id || resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const result = await syncAudienceForClient(clientId);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[META-SYNC]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * GET /api/plugins/meta/events/:orderId — what Meta was told about this order.
 *
 * The stored payload rather than a guess: the value shown is what was actually
 * sent, which can differ from what the order says now if a price was corrected
 * afterwards. That difference is worth seeing, not hiding.
 */
async function metaEventsForOrder(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await db.pgQuery(
      `SELECT event_name, status, detail, dataset_id, action_source, created_at,
              (payload->'custom_data'->>'value')::numeric      AS value,
              (payload->'user_data' ? 'ctwa_clid')             AS has_click
         FROM meta_capi_log
        WHERE client_id = $1 AND order_id = $2
        ORDER BY created_at`,
      [clientId, req.params.orderId]
    );
    res.json({
      events: rows.map(r => ({
        event_name:   r.event_name,
        status:       r.status === 'test' ? 'ok' : r.status,
        test:         r.status === 'test',
        detail:       r.detail,
        value:        r.value == null ? 0 : Number(r.value),
        // Whether Meta can tie this sale to the ad click that started the chat.
        messaging:    r.action_source === 'business_messaging' && r.has_click,
        created_at:   r.created_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/plugins/meta/summary?phone=... — one answer for a whole customer.
 *
 * The point of a summary is to be seen without being looked for, so it sits on
 * the collapsed header rather than inside the list. It answers one question:
 * is there a sale here Meta was not told about?
 *
 * An order is failed only if its latest attempt failed. An event that failed at
 * three o'clock and succeeded on retry at four is not a problem, and showing it
 * as one teaches people to ignore the mark.
 */
async function metaSummaryForCustomer(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    const { rows } = await db.pgQuery(
      `SELECT DISTINCT ON (l.order_id, l.event_name)
              l.order_id, l.event_name, l.status
         FROM meta_capi_log l
         JOIN orders o ON o.order_id = l.order_id AND o.client_id = l.client_id
        WHERE l.client_id = $1 AND o.phone_number = $2 AND l.order_id IS NOT NULL
        ORDER BY l.order_id, l.event_name, l.created_at DESC`,
      [clientId, phone]
    );

    const failed = rows.filter(r => r.status === 'error');
    res.json({
      tracked: rows.length > 0,
      failed: failed.length,
      failed_orders: [...new Set(failed.map(r => r.order_id))],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/meta/retry/:orderId — send this order's conversions again.
 *
 * Which events to send is decided from the order, not from what failed: an
 * order that has been paid owes Meta both a Lead and a Purchase, whatever the
 * log says. That way a retry also repairs an event that was never attempted -
 * an order placed while the addon was switched off, say.
 *
 * Safe to press repeatedly. Every event carries event_id, so Meta counts one
 * sale once however many times it hears about it.
 */
async function retryMetaEvents(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  try {
    const { rows } = await db.pgQuery(
      `SELECT order_id, phone_number, status FROM orders WHERE order_id=$1 AND client_id=$2`,
      [req.params.orderId, clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });

    const order = rows[0];
    const { fireCAPIEvent } = require('../services/metaConversions');
    const PAID = ['payment_received', 'paid', 'delivered', 'done', 'complete'];

    const wanted = ['Lead'];
    if (PAID.includes(order.status)) wanted.push('Purchase');

    // Ask the send how it went rather than reading the log back. The log is
    // written asynchronously and the mirror's row lands a few seconds later, so
    // querying it here reported "nothing was sent" about conversions that had
    // in fact gone through.
    const sent = [];
    const failed = [];
    for (const eventName of wanted) {
      const r = await fireCAPIEvent(clientId, eventName, order.phone_number, { order_id: order.order_id })
        .catch(e => ({ ok: false, error: e.message }));
      if (r?.ok) sent.push({ event: eventName, value: r.value, messaging: r.messaging, test: r.test });
      else failed.push({ event: eventName, error: r?.error || 'unknown' });
    }

    const notConfigured = failed.length === wanted.length
      && failed.every(f => f.error === 'not configured');

    res.json({
      ok: failed.length === 0 && sent.length > 0,
      attempted: wanted,
      sent,
      failed,
      note: notConfigured
        ? 'Nothing was sent. The Meta Ads Tracking addon may be switched off, or its dataset and token unset.'
        : undefined,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/meta/create-audience — create a new Meta Custom Audience and save its ID.
 */
async function createMetaAudience(req, res) {
  const clientId = req.body.client_id || resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { audience_name } = req.body;
  try {
    const audienceId = await createAudienceForClient(clientId, audience_name);
    res.json({ ok: true, audience_id: audienceId });
  } catch (e) {
    console.error('[META-CREATE-AUDIENCE]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

// ─── Marriage reading ─────────────────────────────────────────────────────────

/**
 * Convert a .docx buffer to a PDF buffer via LibreOffice, stamping document metadata.
 */
async function docxBufferToPdf(docxBuffer, uid, meta = {}) {
  const brand = meta.brand || DEFAULT_BRAND;
  const tmpHome = path.join(os.tmpdir(), `lo-home-${uid}`);
  const tmpDocx = path.join(os.tmpdir(), `${uid}.docx`);
  const tmpPdf  = path.join(os.tmpdir(), `${uid}.pdf`);

  const fontSrc  = path.join(__dirname, '../assets/fonts');
  const fontDirs = [
    path.join(tmpHome, '.fonts'),
    path.join(tmpHome, '.local', 'share', 'fonts'),
    path.join(tmpHome, '.config', 'libreoffice', '4', 'user', 'fonts'),
  ];
  for (const dir of fontDirs) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(fontSrc)) {
      if (f.endsWith('.ttf')) fs.copyFileSync(path.join(fontSrc, f), path.join(dir, f));
    }
  }

  fs.writeFileSync(tmpDocx, docxBuffer);
  await convertDocxToPdf(tmpDocx, os.tmpdir(), tmpHome, fontDirs[0]);

  const { PDFDocument } = require('pdf-lib');
  const pdfDoc = await PDFDocument.load(fs.readFileSync(tmpPdf));
  pdfDoc.setTitle(meta.title || brand.pdf.title || '');
  pdfDoc.setAuthor(brand.pdf.author || '');
  pdfDoc.setCreator(brand.pdf.producer || '');
  pdfDoc.setProducer(brand.pdf.producer || '');
  pdfDoc.setSubject(meta.subject || brand.pdf.subject || '');
  pdfDoc.setKeywords([]);
  const buffer = Buffer.from(await pdfDoc.save());

  fs.rm(tmpHome, { recursive: true, force: true }, () => {});
  fs.unlink(tmpDocx, () => {});
  fs.unlink(tmpPdf, () => {});
  return buffer;
}

/** Load an order's horoscope_data + custom_fields, or null if the order doesn't exist. */
async function loadOrderReport(orderId) {
  const r = await db.pgQuery(
    'SELECT phone_number, custom_fields, horoscope_data FROM orders WHERE order_id=$1', [orderId]
  );
  if (!r.rows.length) return null;
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}));
  return {
    phone: r.rows[0].phone_number || '',
    cf:    parse(r.rows[0].custom_fields),
    hd:    parse(r.rows[0].horoscope_data),
  };
}

/**
 * POST /api/plugins/horoscope/generate-marriage/:orderId
 * Generates all configured marriage sections from the chart data already saved on the order.
 * Runs in the background; the UI polls `marriage_generating` on the order.
 */
async function generateMarriageHandler(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { orderId } = req.params;

  const addonCheckOk = await db.hasAddon(clientId, 'horoscope_reading');
  if (!addonCheckOk) return res.status(403).json({ error: 'horoscope_reading addon not enabled' });

  try {
    const order = await loadOrderReport(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.hd.chart_data) {
      return res.status(400).json({
        error: 'No birth chart for this order. Open the horoscope modal, fill the birth details and click "Check Lagna" to fetch the chart — you do not need to generate the horoscope itself.',
      });
    }

    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(jsonb_set(COALESCE(horoscope_data,'{}') - 'marriage_error', '{marriage_generating}', 'true'::jsonb), '{marriage_generating_at}', to_jsonb(NOW()::text)) WHERE order_id=$1`,
      [orderId]
    );

    res.json({ ok: true, generating: true });

    generateMarriageReading(clientId, orderId).catch(async (e) => {
      console.error('[MARRIAGE] generate error:', e.message);
      await db.pgQuery(
        `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}') - 'marriage_generating', '{marriage_error}', $1::jsonb) WHERE order_id=$2`,
        [JSON.stringify(e.message), orderId]
      ).catch(() => {});
    });
  } catch (e) {
    console.error('[MARRIAGE] Error:', e.message);
    if (!res.headersSent) res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/horoscope/regenerate-marriage-section/:orderId — regenerate one section.
 */
async function regenerateMarriageSectionHandler(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { orderId } = req.params;
  const { label } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'label required' });

  try {
    const order = await loadOrderReport(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.hd.chart_data) return res.status(400).json({ error: 'No chart data found.' });

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const { sections, systemPrompt, fixedInstructions } = resolveMarriageConfig(config);
    const sectionDef = sections.find(s => s.label === label.trim());
    if (!sectionDef) return res.status(404).json({ error: `Section "${label}" not found in config.` });

    const existing = Array.isArray(order.hd.marriage_sections_data) ? order.hd.marriage_sections_data : [];

    // No live session exists any more, so rebuild the conversation from the saved
    // sections (minus this one) — otherwise the regenerated text repeats its neighbours.
    const content = await generateMarriageSectionText({
      clientId,
      fixedInstructions,
      chartData:    order.hd.chart_data,
      systemPrompt,
      label:        sectionDef.label,
      guide:        sectionDef.guide || '',
      history:      historyFromSections(existing, label.trim()),
    });

    const idx = existing.findIndex(s => s.label === label.trim());
    const updated = idx >= 0
      ? existing.map((s, i) => (i === idx ? { ...s, content } : s))
      : [...existing, { label: label.trim(), content }];

    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{marriage_sections_data}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(updated), orderId]
    );

    res.json({ ok: true, label: label.trim(), content });
  } catch (e) {
    console.error('[MARRIAGE-REGEN-SECTION] Error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * PATCH /api/plugins/horoscope/marriage-sections/:orderId — save edited section text.
 */
async function updateMarriageSections(req, res) {
  const { orderId } = req.params;
  const { marriage_sections_data } = req.body;
  if (!Array.isArray(marriage_sections_data)) {
    return res.status(400).json({ error: 'marriage_sections_data array required' });
  }
  try {
    const order = await loadOrderReport(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{marriage_sections_data}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(marriage_sections_data), orderId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/** Build the marriage .docx buffer for an order, or throw a 404-ish error. */
async function marriageDocxFor(orderId, clientId) {
  const order = await loadOrderReport(orderId);
  if (!order) { const e = new Error('Order not found'); e.status = 404; throw e; }
  const data = order.hd.marriage_sections_data;
  if (!Array.isArray(data) || data.length === 0) {
    const e = new Error('No marriage reading generated yet'); e.status = 404; throw e;
  }
  const config = clientId ? await db.getPluginConfig(clientId, 'horoscope_reading') : {};
  const { sections, specialNote, reportTitle } = resolveMarriageConfig(config);

  const buffer = await buildMarriageDoc({
    reportTitle,
    customerName: order.cf.customer_name || '',
    sections:     data,
    specialNote,
    birthDate:    order.cf.birth_date || '',
    birthTime:    order.cf.birth_time || '',
    sectionOrder: sections,
    brand:        await getBrand(clientId),
  });
  return { buffer, order: { ...order, reportTitle } };
}

/** Filename stem: <phone>-<birthday>-marriage */
function marriageFilenameStem(order, orderId) {
  const phone  = (order.phone || orderId).replace(/\D/g, '');
  const parsed = parseSinhalaDate(order.cf.birth_date || '');
  const birthday = parsed
    ? `${parsed.year}${String(parsed.month).padStart(2, '0')}${String(parsed.day).padStart(2, '0')}`
    : (order.cf.birth_date || 'birthday').replace(/[^0-9]/g, '').slice(0, 8) || 'birthday';
  return `${phone}-${birthday}-marriage`;
}

/**
 * GET /api/plugins/horoscope/download-marriage-docx/:orderId — .docx (also used for preview).
 */
async function downloadMarriageDocx(req, res) {
  const { orderId } = req.params;
  try {
    const { buffer, order } = await marriageDocxFor(orderId, resolveClientId(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${marriageFilenameStem(order, orderId)}.docx"`);
    res.send(buffer);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download-marriage-pdf/:orderId — PDF.
 */
async function downloadMarriagePdf(req, res) {
  const { orderId } = req.params;
  try {
    const { buffer: docxBuffer, order } = await marriageDocxFor(orderId, resolveClientId(req));
    const pdf = await docxBufferToPdf(docxBuffer, `marriage-${orderId}-${Date.now()}`, {
      title:   order.reportTitle,
      subject: order.reportTitle,
      brand:   await getBrand(resolveClientId(req)),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${marriageFilenameStem(order, orderId)}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('[MARRIAGE-PDF] Error:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/horoscope/generate-marriage-wa/:orderId — WhatsApp summary message.
 */
async function generateMarriageWaHandler(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const { orderId } = req.params;

  try {
    const order = await loadOrderReport(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const data = order.hd.marriage_sections_data;
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Generate the marriage reading first.' });
    }

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const waPrompt = config.marriage_wa_prompt || '';
    if (!waPrompt.trim()) {
      return res.status(400).json({ error: 'marriage_wa_prompt not configured in plugin settings' });
    }

    const message = await generateMarriageWaMessage(clientId, orderId, data, waPrompt);
    res.json({ wa_message: message });
  } catch (e) {
    console.error('[MARRIAGE-WA] Error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * PATCH /api/plugins/horoscope/marriage-wa/:orderId — save an edited WhatsApp message.
 */
async function saveMarriageWaHandler(req, res) {
  const { orderId } = req.params;
  const { wa_message } = req.body;
  if (typeof wa_message !== 'string') return res.status(400).json({ error: 'wa_message required' });
  try {
    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{marriage_wa_message}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(wa_message), orderId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

// ─── Match Making (ගැළපීම) — couple compatibility report ─────────────────────

/**
 * Guard every match-making endpoint. This report is scoped to specific clients on top of
 * the usual horoscope addon check. Env-driven so the rollout can widen without a deploy.
 * @returns {Promise<string|null>} the resolved clientId, or null if the response was sent
 */
async function guardMatchRequest(req, res) {
  const clientId = resolveClientId(req);
  if (!clientId) { res.status(400).json({ error: 'client_id required' }); return null; }
  // Entitlement lives in client_addons, not in a hardcoded list of client IDs,
  // so a new client is enabled from the admin UI with no deploy.
  if (!await db.hasAddon(clientId, 'horoscope_reading')) {
    res.status(403).json({ error: 'horoscope_reading addon not enabled' });
    return null;
  }
  if (!await db.hasAddon(clientId, 'match_making')) {
    res.status(403).json({ error: 'match_making addon not enabled' });
    return null;
  }
  return clientId;
}

/**
 * POST /api/plugins/horoscope/ai-prepare-match/:orderId
 * Reads the WhatsApp thread and extracts BOTH partners' birth details in one pass.
 */
async function aiPrepareMatch(req, res) {
  const clientId = await guardMatchRequest(req, res);
  if (!clientId) return;
  const { orderId } = req.params;

  try {
    const orderRes = await db.pgQuery('SELECT * FROM orders WHERE order_id=$1', [orderId]);
    if (!orderRes.rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = orderRes.rows[0];

    const messages = await db.getMessagesByPhone(order.phone_number, clientId);
    const chatLog = messages.map(m =>
      `[${m.sender_type === 'user' ? 'Customer' : 'Agent'}]: ${m.message_text || ''}`
    ).filter(l => l.length > 12).join('\n');

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const template = (config.match_ai_fill_prompt && config.match_ai_fill_prompt.trim())
      ? config.match_ai_fill_prompt
      : DEFAULT_MATCH_AI_FILL_PROMPT;

    const prompt = template.replace(/\{\{chat_log\}\}/g, chatLog || '(no messages found)');

    const person = {
      type: 'object',
      nullable: true,
      properties: {
        name:            { type: 'string',  nullable: true },
        birth_date_iso:  { type: 'string',  nullable: true },
        birth_time_24h:  { type: 'string',  nullable: true },
        birth_place_en:  { type: 'string',  nullable: true },
        lat:             { type: 'number',  nullable: true },
        lng:             { type: 'number',  nullable: true },
      },
      required: ['name', 'birth_date_iso', 'birth_time_24h', 'birth_place_en', 'lat', 'lng'],
    };

    const geminiModel = (await getGenAI(clientId)).getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            boy:  person,
            girl: person,
            special_questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  prompt:   { type: 'string' },
                },
                required: ['question', 'prompt'],
              },
            },
          },
          required: ['boy', 'girl', 'special_questions'],
        },
      },
    });

    const result = await geminiModel.generateContent(prompt);
    const raw = result.response.text().trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return res.status(500).json({ error: 'Gemini returned invalid JSON', raw }); }

    // A person object whose date is missing is treated as "not found" rather than
    // half-filled — the operator must see an empty column, not a plausible guess.
    const clean = (p) => (p && p.birth_date_iso) ? {
      name:           p.name || '',
      birth_date_iso: p.birth_date_iso,
      birth_time_24h: p.birth_time_24h || null,
      birth_place_en: p.birth_place_en || null,
      lat:            p.lat ?? null,
      lng:            p.lng ?? null,
    } : null;

    res.json({
      boy:  clean(parsed.boy),
      girl: clean(parsed.girl),
      special_questions: Array.isArray(parsed.special_questions) ? parsed.special_questions : [],
    });
  } catch (e) {
    console.error('[AI-PREPARE-MATCH]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * PATCH /api/plugins/horoscope/match-people/:orderId
 * Saves the two partners' form values and the couple's custom questions. The charts
 * themselves are written by fetch-chart (the "Check Sign" buttons), so this merges
 * rather than overwrites.
 */
async function saveMatchPeople(req, res) {
  const clientId = await guardMatchRequest(req, res);
  if (!clientId) return;
  const { orderId } = req.params;
  const { match_boy, match_girl, match_special_questions } = req.body;

  try {
    const order = await loadOrderReport(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const merge = (existing, incoming) => (incoming ? { ...(existing || {}), ...incoming } : existing);
    const updated = {
      ...order.hd,
      match_boy:  merge(order.hd.match_boy,  match_boy),
      match_girl: merge(order.hd.match_girl, match_girl),
      ...(Array.isArray(match_special_questions) && { match_special_questions }),
    };

    await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(updated), orderId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[MATCH-PEOPLE]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/horoscope/generate-match/:orderId
 * Runs in the background; the UI polls `match_generating` on the order.
 */
async function generateMatchHandler(req, res) {
  const clientId = await guardMatchRequest(req, res);
  if (!clientId) return;
  const { orderId } = req.params;

  try {
    const order = await loadOrderReport(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const missing = [];
    if (!order.hd.match_boy?.chart_data)  missing.push('boy');
    if (!order.hd.match_girl?.chart_data) missing.push('girl');
    if (missing.length) {
      return res.status(400).json({
        error: `No birth chart for the ${missing.join(' and ')}. Open the Match Making tab, `
             + 'fill both sides and click "Check Sign" for each before generating.',
      });
    }

    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(jsonb_set(COALESCE(horoscope_data,'{}') - 'match_error', '{match_generating}', 'true'::jsonb), '{match_generating_at}', to_jsonb(NOW()::text)) WHERE order_id=$1`,
      [orderId]
    );

    res.json({ ok: true, generating: true });

    generateMatchReading(clientId, orderId).catch(async (e) => {
      console.error('[MATCH] generate error:', e.message);
      await db.pgQuery(
        `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}') - 'match_generating', '{match_error}', $1::jsonb) WHERE order_id=$2`,
        [JSON.stringify(e.message), orderId]
      ).catch(() => {});
    });
  } catch (e) {
    console.error('[MATCH] handler error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * POST /api/plugins/horoscope/regenerate-match-section/:orderId
 */
async function regenerateMatchSectionHandler(req, res) {
  const clientId = await guardMatchRequest(req, res);
  if (!clientId) return;
  const { orderId } = req.params;
  const { label } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'label required' });

  try {
    const order = await loadOrderReport(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.hd.match_boy?.chart_data || !order.hd.match_girl?.chart_data) {
      return res.status(400).json({ error: 'Both charts are required.' });
    }

    const config = await db.getPluginConfig(clientId, 'horoscope_reading');
    const { sections, systemPrompt, fixedInstructions } = resolveMatchConfig(config);
    const sectionDef = sections.find(s => s.label === label.trim());
    if (!sectionDef) return res.status(404).json({ error: `Section "${label}" not found in config.` });

    const existing = Array.isArray(order.hd.match_sections_data) ? order.hd.match_sections_data : [];

    // The run's session is long gone, so replay the other sections as history — without
    // it the rewrite has no idea what the rest of the report says.
    const content = await generateMatchSectionText({
      clientId,
      fixedInstructions,
      coupleContext: buildCoupleContext(order.hd),
      systemPrompt,
      label:   sectionDef.label,
      guide:   sectionDef.guide || '',
      history: matchHistoryFromSections(existing, label.trim()),
    });

    const idx = existing.findIndex(s => s.label === label.trim());
    const updated = idx >= 0
      ? existing.map((s, i) => (i === idx ? { ...s, content } : s))
      : [...existing, { label: label.trim(), content }];

    await db.pgQuery(
      `UPDATE orders SET horoscope_data = jsonb_set(COALESCE(horoscope_data,'{}'), '{match_sections_data}', $1::jsonb) WHERE order_id=$2`,
      [JSON.stringify(updated), orderId]
    );

    res.json({ ok: true, label: label.trim(), content });
  } catch (e) {
    console.error('[MATCH-REGEN-SECTION] Error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
}

/**
 * PATCH /api/plugins/horoscope/match-sections/:orderId — save edited section text.
 */
async function updateMatchSections(req, res) {
  const { orderId } = req.params;
  const { match_sections_data, match_special_answers } = req.body;
  if (!Array.isArray(match_sections_data)) {
    return res.status(400).json({ error: 'match_sections_data array required' });
  }
  try {
    const order = await loadOrderReport(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const updated = {
      ...order.hd,
      match_sections_data,
      ...(Array.isArray(match_special_answers) && { match_special_answers }),
    };
    await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(updated), orderId]);
    res.json({ ok: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
}

/** Build the match .docx buffer for an order, or throw a 404-ish error. */
async function matchDocxFor(orderId, clientId) {
  const order = await loadOrderReport(orderId);
  if (!order) { const e = new Error('Order not found'); e.status = 404; throw e; }
  const data = order.hd.match_sections_data;
  if (!Array.isArray(data) || data.length === 0) {
    const e = new Error('No match making reading generated yet'); e.status = 404; throw e;
  }
  const config = clientId ? await db.getPluginConfig(clientId, 'horoscope_reading') : {};
  const { sections, specialNote, reportTitle, questionsTitle } = resolveMatchConfig(config);

  const buffer = await buildMatchDoc({
    reportTitle,
    questionsTitle,
    hd:             order.hd,
    sections:       data,
    specialNote,
    sectionOrder:   sections,
    specialAnswers: order.hd.match_special_answers || [],
    brand:          await getBrand(clientId),
  });
  return { buffer, order: { ...order, reportTitle } };
}

/** Filename stem: <phone>-<boy birthday>-match */
function matchFilenameStem(order, orderId) {
  const phone  = (order.phone || orderId).replace(/\D/g, '');
  const raw    = order.hd.match_boy?.birth_date || '';
  const parsed = parseSinhalaDate(raw);
  const birthday = parsed
    ? `${parsed.year}${String(parsed.month).padStart(2, '0')}${String(parsed.day).padStart(2, '0')}`
    : raw.replace(/[^0-9]/g, '').slice(0, 8) || 'birthday';
  return `${phone}-${birthday}-match`;
}

/**
 * GET /api/plugins/horoscope/download-match-docx/:orderId — .docx (also used for preview).
 */
async function downloadMatchDocx(req, res) {
  const { orderId } = req.params;
  try {
    const { buffer, order } = await matchDocxFor(orderId, resolveClientId(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${matchFilenameStem(order, orderId)}.docx"`);
    res.send(buffer);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

/**
 * GET /api/plugins/horoscope/download-match-pdf/:orderId — PDF.
 */
async function downloadMatchPdf(req, res) {
  const { orderId } = req.params;
  try {
    const { buffer: docxBuffer, order } = await matchDocxFor(orderId, resolveClientId(req));
    const pdf = await docxBufferToPdf(docxBuffer, `match-${orderId}-${Date.now()}`, {
      title:   order.reportTitle,
      subject: order.reportTitle,
      brand:   await getBrand(resolveClientId(req)),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${matchFilenameStem(order, orderId)}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('[MATCH-PDF] Error:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
}

/**
 * Build the full 20-porondam .docx for an order.
 *
 * Unlike the match reading, this needs no generated AI sections — the porondam
 * result is deterministic, so the document can be produced the moment both
 * people's charts are saved on the order (which aiPrepareMatch/saveMatchPeople
 * already does, storing chart_data on match_boy / match_girl).
 */
async function porondamDocxFor(orderId, clientId) {
  const order = await loadOrderReport(orderId);
  if (!order) { const e = new Error('Order not found'); e.status = 404; throw e; }

  const boy  = order.hd.match_boy;
  const girl = order.hd.match_girl;
  const missing = [];
  if (!boy?.chart_data)  missing.push('මනාලයාගේ');
  if (!girl?.chart_data) missing.push('මනාලියගේ');
  if (missing.length) {
    const e = new Error(`${missing.join(' සහ ')} ග්‍රහ දත්ත නොමැත — පළමුව උපන් විස්තර සුරකින්න`);
    e.status = 400;
    throw e;
  }

  const config = clientId ? await db.getPluginConfig(clientId, 'horoscope_reading') : {};
  const porondamTitle = config?.porondam_report_title || '';
  const buffer = await buildPorondamDoc(
    boy, girl, boy.chart_data, girl.chart_data,
    config?.porondam_special_note || undefined,
    await getBrand(clientId),
    porondamTitle,
  );
  return { buffer, order: { ...order, reportTitle: porondamTitle } };
}

/** Filename stem: <phone>-<boy birthday>-porondam */
function porondamFilenameStem(order, orderId) {
  return matchFilenameStem(order, orderId).replace(/-match$/, '-porondam');
}

/**
 * GET /api/plugins/horoscope/download-porondam-docx/:orderId — .docx.
 */
async function downloadPorondamDocx(req, res) {
  const { orderId } = req.params;
  try {
    const { buffer, order } = await porondamDocxFor(orderId, resolveClientId(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${porondamFilenameStem(order, orderId)}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('[PORONDAM-DOCX] Error:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
}

/**
 * GET /api/plugins/horoscope/download-porondam-pdf/:orderId — PDF.
 */
async function downloadPorondamPdf(req, res) {
  const { orderId } = req.params;
  try {
    const { buffer: docxBuffer, order } = await porondamDocxFor(orderId, resolveClientId(req));
    const pdf = await docxBufferToPdf(docxBuffer, `porondam-${orderId}-${Date.now()}`, {
      title:   order.reportTitle,
      subject: order.reportTitle,
      brand:   await getBrand(resolveClientId(req)),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${porondamFilenameStem(order, orderId)}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('[PORONDAM-PDF] Error:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
}

module.exports = {
  metaEventsForOrder,
  metaSummaryForCustomer,
  retryMetaEvents,
  getPluginConfig, updatePluginConfig, getPluginCustomerData, generateAstroChart,
  analyzeAuraImage,
  aiPrepareHoroscope,
  fetchChartData,
  generateHoroscopeReading, horoscopeProgress, updateHoroscopeSections, updateQuantumSections,
  regenerateQuantumSections, regenerateQuantumSection, regenerateHoroscopeSectionHandler,
  saveWaMessageHandler,
  generateWaMessageHandler,
  downloadQuantumDocx,
  downloadHoroscope, downloadHoroscopePdf, downloadQuantumPdf,
  generateMarriageHandler, regenerateMarriageSectionHandler, updateMarriageSections,
  downloadMarriageDocx, downloadMarriagePdf,
  generateMarriageWaHandler, saveMarriageWaHandler,
  aiPrepareMatch, saveMatchPeople, generateMatchHandler, regenerateMatchSectionHandler,
  updateMatchSections, downloadMatchDocx, downloadMatchPdf,
  downloadPorondamDocx, downloadPorondamPdf,
  generateFollowUpMessage,
  syncMetaAudience,
  createMetaAudience,
  recentMetaEvents,
  DEFAULT_AI_FILL_PROMPT,
};
