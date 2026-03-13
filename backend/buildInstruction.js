// Shared system instruction builder — reads products.json and returns the prompt string
const fs   = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'public', 'templates');

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

function buildSystemInstruction() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8'));

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
 */
function buildSystemInstructionForClient(client) {
  if (client && client.custom_prompt && client.custom_prompt.trim()) {
    return client.custom_prompt.trim();
  }
  // No prompt in DB yet — fall back to hardcoded astrology prompt
  console.warn(`[buildInstruction] No custom_prompt set for client ${client?.id} — using hardcoded fallback`);
  return buildSystemInstruction();
}

/**
 * Builds the order fields instruction block appended to any system prompt.
 * Tells the AI what fields to collect and the exact JSON structure to embed in the marker.
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
 */
function buildContactInstruction(contactNumber) {
  if (!contactNumber) return '';
  return `\n\n## Escalation Rule — STRICT\nYou MUST follow this rule without exception:\n- If a customer asks something you cannot confidently answer using the knowledge and information provided to you, do NOT guess or make up an answer.\n- Instead, politely apologise and direct them to a human agent.\n- Always say something like: "I'm sorry, I'm not able to help with that right now. Please contact our team directly at *${contactNumber}* and they'll be happy to assist you."\n- This applies to: complaints, issues outside your knowledge, account problems, special requests, or anything you are uncertain about.\n- Never pretend to know something you don't. Honesty and directing to a human is always the right choice.`;
}

module.exports = buildSystemInstruction;
module.exports.forClient = buildSystemInstructionForClient;
module.exports.buildOrderFieldsInstruction = buildOrderFieldsInstruction;
module.exports.buildContactInstruction = buildContactInstruction;
