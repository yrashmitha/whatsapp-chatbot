/**
 * @module services/imageAnalysis
 * @description Analyzes customer-uploaded images and PDFs using Gemini Vision.
 * Extracts payment slip data (amount, date, reference, bank) and returns
 * structured JSON for the AI to use in order verification.
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const EXTRACTION_PROMPT = `Analyze this document image.

IMPORTANT: Your entire response must be a single raw JSON object. Do NOT use markdown. Do NOT use code fences. Do NOT write any text before or after the JSON. Start your response with { and end with }.

Use exactly this structure:
{
  "document_type": "payment_slip",
  "is_payment_related": true,
  "payer_name": null,
  "recipient_name": null,
  "amount": null,
  "currency": null,
  "payment_date": null,
  "reference_number": null,
  "sender_bank": null,
  "recipient_bank": null,
  "sender_account": null,
  "recipient_account": null,
  "description": "one sentence describing what this image shows"
}

Field meanings:
- sender_bank: the bank the money was sent FROM (customer's bank)
- recipient_bank: the bank or account the money was sent TO (merchant/recipient's bank)
- sender_account: account number of the sender
- recipient_account: account number of the recipient

Valid values for document_type: payment_slip, bank_transfer, cheque, product_photo, id_document, screenshot, other
Rules:
- Set is_payment_related to true only for payment_slip, bank_transfer, cheque
- payment_date must be YYYY-MM-DD format or null
- amount must be numeric string only (no currency symbols) or null
- description is always required — one plain sentence about the image
- Start response with { and end with } — no other text`;

/**
 * Analyze an image or PDF buffer using Gemini Vision.
 * Works with: image/jpeg, image/png, image/webp, image/gif, application/pdf
 *
 * @param {Buffer} buffer    - Raw file bytes
 * @param {string} mimeType  - MIME type of the file
 * @param {string} [apiKey]  - Optional Gemini API key override
 * @returns {Promise<Object>} Parsed extraction result
 */
async function analyzePaymentDocument(buffer, mimeType, apiKey) {
  // Supplied by the caller from the client's own configuration.
  const key = apiKey;
  if (!key) throw new Error('No Gemini API key supplied for image analysis');

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  });

  const base64Data = buffer.toString('base64');

  const result = await model.generateContent([
    { inlineData: { data: base64Data, mimeType } },
    { text: EXTRACTION_PROMPT },
  ]);

  const raw = result.response.text().trim();
  console.log(`[IMAGE-ANALYZER] Raw Gemini response:\n${raw}`);

  // Extract JSON — handle code fences anywhere in the response, or bare JSON object
  let cleaned = raw;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    // Try to find the first { ... } block in the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0].trim();
  }
  console.log(`[IMAGE-ANALYZER] Cleaned for parsing:\n${cleaned}`);

  try {
    const parsed = JSON.parse(cleaned);
    console.log(`[IMAGE-ANALYZER] Parsed: type=${parsed.document_type} payment=${parsed.is_payment_related} amount=${parsed.amount} date=${parsed.payment_date} ref=${parsed.reference_number} sender_bank=${parsed.sender_bank} recipient_bank=${parsed.recipient_bank}`);
    return parsed;
  } catch (parseErr) {
    // If JSON parse fails, return a safe fallback (do NOT include raw broken JSON as description)
    console.warn(`[IMAGE-ANALYZER] Could not parse JSON (${parseErr.message}). Cleaned text was:\n${cleaned}`);
    return {
      document_type: 'other',
      is_payment_related: false,
      description: 'an image the team will review',
    };
  }
}

/**
 * Build the imageNote string to inject into the AI's message context.
 *
 * @param {Object}   analysis           - Result from analyzePaymentDocument()
 * @param {string}   caption            - Customer's caption on the image
 * @param {Array}    pendingOrders      - All pending orders for this customer
 * @param {string}   verificationPrompt - Client's custom instruction from plugin config
 * @returns {string}
 */
function buildAnalysisNote(analysis, caption, pendingOrders, verificationPrompt) {
  const lines = [];

  if (analysis.is_payment_related) {
    lines.push(`[Customer sent a payment document. Vision analysis result:`);
    lines.push(`  Document type: ${analysis.document_type}`);
    if (analysis.payer_name)       lines.push(`  Payer name: ${analysis.payer_name}`);
    if (analysis.recipient_name)   lines.push(`  Recipient name: ${analysis.recipient_name}`);
    if (analysis.amount)           lines.push(`  Amount: ${(analysis.currency || '').trim()} ${analysis.amount}`.trim());
    if (analysis.payment_date)     lines.push(`  Payment date: ${analysis.payment_date}`);
    if (analysis.reference_number) lines.push(`  Reference: ${analysis.reference_number}`);
    if (analysis.sender_bank)      lines.push(`  Customer's bank (sent from): ${analysis.sender_bank}`);
    if (analysis.sender_account)   lines.push(`  Customer's account: ${analysis.sender_account}`);
    if (analysis.recipient_bank)   lines.push(`  Recipient bank (sent to): ${analysis.recipient_bank}`);
    if (analysis.recipient_account) lines.push(`  Recipient account: ${analysis.recipient_account}`);
    if (caption)                   lines.push(`  Caption from customer: "${caption}"`);

    // Scam detection: date check against ALL pending orders
    const scamFlags = [];
    if (analysis.payment_date && pendingOrders.length > 0) {
      const payDate = new Date(analysis.payment_date);
      payDate.setHours(0, 0, 0, 0);
      for (const order of pendingOrders) {
        if (!order.created_at) continue;
        const orderDate = new Date(order.created_at);
        orderDate.setHours(0, 0, 0, 0);
        if (payDate < orderDate) {
          const orderDateStr = orderDate.toISOString().slice(0, 10);
          scamFlags.push(
            `⚠️ SUSPICIOUS: Payment date on slip (${analysis.payment_date}) is BEFORE order #${order.order_id} was placed (${orderDateStr}). This customer may be reusing an old payment slip.`
          );
        }
      }
    }

    if (scamFlags.length) {
      lines.push(`\n  FRAUD CHECK:`);
      for (const flag of scamFlags) lines.push(`  ${flag}`);
    }

    // All pending orders — AI checks the amount against each one
    if (pendingOrders.length > 0) {
      lines.push(`\n  Customer's pending orders (${pendingOrders.length}):`);
      for (const order of pendingOrders) {
        const cf = order.custom_fields || {};
        const orderPrice = cf.price || cf.amount || cf.total || null;
        const product = cf.product || cf.product_name || '';
        lines.push(`  - #${order.order_id} | status: ${order.status} | placed: ${order.created_at ? new Date(order.created_at).toISOString().slice(0, 10) : 'unknown'}${orderPrice ? ` | expected amount: ${orderPrice}` : ''}${product ? ` | product: ${product}` : ''}`);
      }
    } else {
      lines.push(`\n  No pending orders found for this customer.`);
    }

    if (verificationPrompt) {
      lines.push(`\n  Instructions: ${verificationPrompt}`);
    }

    lines.push(`]`);
  } else {
    // Non-payment image — give AI a description so it can respond sensibly
    const desc = analysis.description || `a ${analysis.document_type || 'photo'}`;
    if (caption) {
      lines.push(`[Customer sent an image with caption: "${caption}". Vision analysis: ${desc}. Respond appropriately based on what the image shows.]`);
    } else {
      lines.push(`[Customer sent an image. Vision analysis: ${desc}. Respond appropriately based on what the image shows.]`);
    }
  }

  const note = lines.join('\n');
  console.log(`[IMAGE-ANALYZER] Note injected into AI:\n${note}`);
  return note;
}

module.exports = { analyzePaymentDocument, buildAnalysisNote };
