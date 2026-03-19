/**
 * @module services/imageAnalysis
 * @description Analyzes customer-uploaded images and PDFs using Gemini Vision.
 * Extracts payment slip data (amount, date, reference, bank) and returns
 * structured JSON for the AI to use in order verification.
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const EXTRACTION_PROMPT = `Analyze this document image. Return ONLY a JSON object — no markdown, no explanation.

Identify the document type and extract any payment-related information.

Return this exact JSON structure:
{
  "document_type": "payment_slip" | "bank_transfer" | "cheque" | "product_photo" | "id_document" | "screenshot" | "other",
  "is_payment_related": true | false,
  "payer_name": "full name or null",
  "recipient_name": "recipient name or null",
  "amount": "numeric string like 5500.00 or null",
  "currency": "LKR or USD or null",
  "payment_date": "YYYY-MM-DD or null",
  "reference_number": "transaction/reference ID or null",
  "bank_name": "bank name or null",
  "account_number": "account number or null",
  "description": "1–2 sentence plain text description of what this image shows"
}

Rules:
- If not payment-related, set is_payment_related to false and leave payment fields as null
- For payment_date, convert any date format to YYYY-MM-DD
- For amount, return only the numeric value as a string (no currency symbols)
- Return ONLY the JSON object, nothing else`;

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
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
  });

  const base64Data = buffer.toString('base64');

  const result = await model.generateContent([
    { inlineData: { data: base64Data, mimeType } },
    { text: EXTRACTION_PROMPT },
  ]);

  const raw = result.response.text().trim();
  console.log(`[IMAGE-ANALYZER] Raw response: ${raw.slice(0, 300)}`);

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // If JSON parse fails, return a generic description
    console.warn('[IMAGE-ANALYZER] Could not parse JSON, using fallback');
    return {
      document_type: 'other',
      is_payment_related: false,
      description: cleaned.slice(0, 300),
    };
  }
}

/**
 * Build the imageNote string to inject into the AI's message context.
 *
 * @param {Object}      analysis           - Result from analyzePaymentDocument()
 * @param {string}      caption            - Customer's caption on the image
 * @param {Object|null} latestPendingOrder - Most recent pending order for this customer
 * @param {string}      verificationPrompt - Client's custom instruction from plugin config
 * @returns {string}
 */
function buildAnalysisNote(analysis, caption, latestPendingOrder, verificationPrompt) {
  const lines = [];

  if (analysis.is_payment_related) {
    lines.push(`[Customer sent a payment document. Vision analysis result:`);
    lines.push(`  Document type: ${analysis.document_type}`);
    if (analysis.payer_name)      lines.push(`  Payer name: ${analysis.payer_name}`);
    if (analysis.recipient_name)  lines.push(`  Recipient: ${analysis.recipient_name}`);
    if (analysis.amount)          lines.push(`  Amount: ${analysis.currency || ''} ${analysis.amount}`.trim());
    if (analysis.payment_date)    lines.push(`  Payment date: ${analysis.payment_date}`);
    if (analysis.reference_number) lines.push(`  Reference: ${analysis.reference_number}`);
    if (analysis.bank_name)       lines.push(`  Bank: ${analysis.bank_name}`);
    if (analysis.account_number)  lines.push(`  Account: ${analysis.account_number}`);
    if (caption)                  lines.push(`  Caption from customer: "${caption}"`);

    // Scam detection: date check (objective — done in code, not AI)
    const scamFlags = [];
    if (analysis.payment_date && latestPendingOrder?.created_at) {
      const payDate   = new Date(analysis.payment_date);
      const orderDate = new Date(latestPendingOrder.created_at);
      payDate.setHours(0, 0, 0, 0);
      orderDate.setHours(0, 0, 0, 0);
      if (payDate < orderDate) {
        const orderDateStr = orderDate.toISOString().slice(0, 10);
        scamFlags.push(
          `⚠️ SUSPICIOUS: Payment date on slip (${analysis.payment_date}) is BEFORE the order was placed (${orderDateStr}). This customer may be reusing an old payment slip to claim a payment they did not make for this order.`
        );
      }
    }

    if (scamFlags.length) {
      lines.push(`\n  FRAUD CHECK:`);
      for (const flag of scamFlags) lines.push(`  ${flag}`);
    }

    // Pending order context for amount matching
    if (latestPendingOrder) {
      const cf = latestPendingOrder.custom_fields || {};
      const orderPrice = cf.price || cf.amount || cf.total || null;
      lines.push(`\n  Customer's pending order: #${latestPendingOrder.order_id}`);
      if (orderPrice) lines.push(`  Expected payment amount: ${orderPrice}`);
      lines.push(`  Order placed: ${new Date(latestPendingOrder.created_at).toISOString().slice(0, 10)}`);
      lines.push(`  Order status: ${latestPendingOrder.status}`);
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

  return lines.join('\n');
}

module.exports = { analyzePaymentDocument, buildAnalysisNote };
