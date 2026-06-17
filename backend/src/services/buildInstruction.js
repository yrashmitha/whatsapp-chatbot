/**
 * @module services/buildInstruction
 * @description Shared system instruction builder.
 * Reads products.json and generates the AI system prompt string.
 * Moved from backend/buildInstruction.js — path updated for products.json.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../../public', 'templates');

/**
 * Appended to EVERY client's system instruction. Stops the model from emitting
 * reasoning / tool syntax as visible text — the leak class where chain-of-thought
 * lands in a normal answer part (no p.thought flag), which response-side filters
 * cannot catch. Ported from wwjs-service.
 */
const CLEAN_OUTPUT_RULE = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEVER LEAK YOUR THINKING — ABSOLUTE RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your reasoning, planning, and analysis are PRIVATE. They must NEVER appear in the message the customer receives.

The customer sees ONLY your final message to them — never the thinking that produced it.

NEVER write your thought process as the reply. Forbidden — these are how you THINK, never what you SEND:
- "The user is asking..." / "The customer wants..." / "The customer has..."
- "I should..." / "I need to..." / "I need to make sure..." / "I have to..." / "I will start by..."
- "Since this is the first message..." / "Because the knowledge base says..." / "Therefore, I should..."
- "Let me..." / "First, I'll... then I'll..." / "My plan is..." / "The rule says..."
- Any sentence ABOUT the conversation, the rules, or what to do next — instead of a sentence TO the customer.

Speak TO the customer in second person ("you"), never ABOUT them in third person ("the user", "the customer").
If a sentence describes your own decision-making, DELETE it. Only the customer-facing message survives.

NEVER output any of the following as text in your reply:
- Tool call syntax, print(...), default_api.*, function_call, <tool_use>
- Code blocks: \`\`\`python, tool_code, or any similar block
- Internal reasoning, chain-of-thought, scratchpad steps, or planning of any kind
- Headers like "Thinking:", "Thought:", "Reasoning:", "Plan:", or "<think>" / "</think>" tags

The customer must ONLY ever see natural conversational text — nothing else.
If you find yourself writing a code block, a function name, or a sentence about what you should do — stop and delete it. Send only the message meant for the customer.`;

/**
 * Build the template images section that informs the AI which images are available.
 *
 * @returns {string} Instruction block, or empty string if no templates exist
 */
function buildTemplateSection() {
  let files = [];
  try {
    files = fs.readdirSync(TEMPLATES_DIR)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  } catch (_) {
    return ''; // templates folder doesn't exist yet
  }
  if (files.length === 0) return '';

  const horoscopeFiles = files.filter(f => /^horoscope/i.test(f));
  const reviewFiles    = files.filter(f => /^review/i.test(f));
  const fileList       = files.map(f => `[[SEND_IMAGE:${f}]]`).join('\n');

  let rules = '';
  if (horoscopeFiles.length > 0) {
    rules += `
1. HOROSCOPE EXAMPLE (${horoscopeFiles.map(f => `[[SEND_IMAGE:${f}]]`).join(', ')}):
   - Send WHENEVER a customer says they have their own horoscope chart (ලිත/කේන්ද්‍රය) and will send it, OR when you ask them to send their chart photo.
   - The system attaches the caption automatically — just place the marker on its own line.`;
  }
  if (reviewFiles.length > 0) {
    rules += `
2. REVIEW SCREENSHOTS (${reviewFiles.map(f => `[[SEND_IMAGE:${f}]]`).join(', ')}):
   - Send ALL review images when a customer expresses doubt, asks for proof, asks if this is trustworthy, or hesitates to buy.
   - Place each marker on a separate line to send all of them.`;
  }

  return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEMPLATE IMAGES — send automatically using markers
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Send images by placing markers on their own line. The system handles delivery — do not describe the image.

AVAILABLE FILES:
${fileList}
${rules}

RULES:
- Do NOT invent filenames. Only use the exact filenames listed above.
- Multiple markers allowed — one per line, placed at the END of your text.`;
}

/**
 * Build the default (hardcoded) astrology system instruction from products.json.
 *
 * @returns {string} System instruction string
 */
function buildSystemInstruction() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../../products.json'), 'utf8'));

  const packages = data['සේවා_පැකේජ'];
  const basic   = packages[0];
  const detail  = packages[1];
  const vip     = packages[2];

  const pay  = data['ගෙවීම්_විස්තර'];
  const spec = data['විශේෂ_කොන්දේසි_සහ_තොරතුරු'];
  const flow = spec['හඳහන_නැති_customer_flow'];
  const faqs = data['නිතර_අසන_ප්‍රශ්න'];

  return ``.trim();
}

/**
 * Client-aware wrapper.
 * All clients use custom_prompt from DB.
 * Falls back to hardcoded astrology prompt only if no custom_prompt is set.
 *
 * @param {Object|null} client - Client config object from DB
 * @returns {string} System instruction string
 */
function buildSystemInstructionForClient(client) {
  if (client && client.custom_prompt && client.custom_prompt.trim()) {
    let prompt = client.custom_prompt.trim();
    const isMultilingual = prompt.startsWith('[[MULTILINGUAL]]');
    if (isMultilingual) {
      prompt = prompt.slice('[[MULTILINGUAL]]'.length).trimStart();
    }
    console.log(`[buildInstruction] client=${client?.id} multilingual=${isMultilingual} promptLen=${prompt.length}`);
    const languageRule = isMultilingual
      ? `LANGUAGE RULE — HIGHEST PRIORITY:\nThe customer's current message is always wrapped between [CURRENT_MESSAGE_START] and [CURRENT_MESSAGE_END] markers. Detect the language of the text inside those markers and reply accordingly:\n- If the message is in English → reply in English\n- If the message is in Sinhala script (Unicode) → reply in Sinhala script\n- If the message is in Singlish (Sinhala written using Latin/English letters) → reply in proper Sinhala script (Unicode), NOT in Singlish. Singlish uses common Sinhala words romanized, such as: mama, mata, eka, denna, ganna, kohomada, api, oya, danne, inne, hadanna, puluwan, kiyanna, karana, thibba, awilla, yanna, wage, wenna, karanna, wisthara, hari, nehe, ow, mokakda, kawda, koheda, kiyala, danna, gatta, aawa, giyaa, hitiye, hitiye, pennanna, oyata, oyage\n- For any other language → reply in that same language\nIgnore the language of all previous messages in the conversation history.\n\n`
      : '';
    return languageRule + prompt + '\n' + CLEAN_OUTPUT_RULE;
  }
  // No prompt in DB yet — fall back to hardcoded astrology prompt
  console.warn(`[buildInstruction] No custom_prompt set for client ${client?.id} — using hardcoded fallback`);
  return buildSystemInstruction();
}

/**
 * Builds the order fields instruction block appended to any system prompt.
 * Tells the AI what fields to collect and the exact JSON structure to embed in the marker.
 *
 * @param {Array<{key: string, label: string, description: string, required: boolean}>} orderFields - Field definitions
 * @returns {string} Instruction block, or empty string if no fields defined
 */
function buildOrderFieldsInstruction(orderFields) {
  if (!orderFields || orderFields.length === 0) {
    return '';
  }

  const template = { customer_name: "<customer's full name>", product: "<comma-separated product names and prices for ALL items ordered, e.g. Azzaro Chrome 5ml — Rs 1400, Burberry Brit 5ml — Rs 1200>", product_id: "<comma-separated product_id values from search results for ALL items ordered, e.g. 42,57>" };
  for (const f of orderFields) {
    template[f.key] = f.description ? `<${f.description}>` : `<${f.label}>`;
  }

  const requiredFields = orderFields.filter(f => f.required);
  const optionalFields = orderFields.filter(f => !f.required);

  const fieldList = orderFields
    .map((f, i) => {
      const req = f.required ? '(REQUIRED)' : '(optional)';
      const desc = f.description ? ` — ${f.description}` : '';
      return `${i + 1}. ${f.label} ${req}${desc}`;
    }).join('\n');

  const requiredKeys = requiredFields.map(f => `"${f.label}"`).join(', ');
  const optionalNote = optionalFields.length > 0
    ? `\n- Optional fields (${optionalFields.map(f => `"${f.label}"`).join(', ')}): collect if customer provides them, but do NOT block the order if they skip these.`
    : '';

  return `\n\n## Order Information Required\nWhen a customer wants to place an order, collect the following information:\n${fieldList}\n\n### STRICT RULES:\n- You MUST collect ALL REQUIRED fields (${requiredKeys}) before emitting [[ORDER_COMPLETE]].\n- Do NOT emit [[ORDER_COMPLETE]] until every REQUIRED field has been explicitly provided by the customer.${optionalNote}\n- If a required field is missing, ask for it. Do not proceed without it.\n- For optional fields left blank, use null in the JSON.\n\nOnce ALL required fields are confirmed, emit EXACTLY this on its own line (fill real values, no extra text around the marker):\n[[ORDER_COMPLETE:${JSON.stringify(template)}]]\n\nIf a customer asks to change any detail of an existing order, confirm the new value with them, then emit EXACTLY this on its own line:\n[[ORDER_UPDATE:{"order_id":"<their order ID>","updates":{"<field_key>":"<new value>"}}]]`;
}

/**
 * Builds the emergency contact instruction block.
 * Appended to every system prompt when a contact_number is configured.
 *
 * @param {string|null} contactNumber - Human agent contact number, or null
 * @returns {string} Instruction block, or empty string if no contact number
 */
function buildContactInstruction(contactNumber) {
  if (!contactNumber) return '';
  return `\n\n## Escalation Rule — STRICT\nYou MUST follow this rule without exception:\n- If a customer asks something you cannot confidently answer, FIRST use any available tools (search_products, search_knowledge) to find the answer before escalating.\n- Only if the tools return no useful results AND you still cannot answer, then politely apologise and direct them to a human agent.\n- Always say something like: "I'm sorry, I'm not able to help with that right now. Please contact our team directly at *${contactNumber}* and they'll be happy to assist you."\n- This applies to: complaints, issues outside your knowledge, account problems, special requests, or anything you are uncertain about even after searching.\n- Never pretend to know something you don't. Honesty and directing to a human is always the right choice.`;
}

module.exports = buildSystemInstruction;
module.exports.forClient = buildSystemInstructionForClient;
module.exports.buildOrderFieldsInstruction = buildOrderFieldsInstruction;
module.exports.buildContactInstruction = buildContactInstruction;
