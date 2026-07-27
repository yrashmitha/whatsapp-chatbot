/**
 * @module services/deepMatchAnalysis
 * @description AI-assisted narrative layer over the deterministic 20-Porondam
 * + dosha-cancellation facts computed client-side (see the frontend's
 * deepMatchFacts.ts). IMPORTANT design boundary: every boolean/number here
 * (dosha active/cancelled, dasha lords, the final percentage) is computed in
 * CODE, not by Gemini — the model is used only to (a) classify each of the 20
 * Porondam into subha/madhyama/asuba given the real matched/critical data,
 * and (b) write natural-language Sinhala explanations for facts it is GIVEN,
 * never facts it invents. This keeps the output verifiable instead of a
 * plausible-sounding hallucination.
 *
 * Cached in match_deep_cache by the same match_hash used for the Ashtakoota
 * cache, so re-viewing the same pair of charts costs zero additional calls.
 */

'use strict';

const { IS_PG, pool, db } = require('../db/connection');
const clientRouter = require('./clientRouter');
const { genAI } = require('./gemini');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEEP_MATCH_SCHEMA = {
  type: 'object',
  properties: {
    porondam_analysis: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id:             { type: 'integer' },
          classification: { type: 'string', enum: ['subha', 'madhyama', 'asuba'] },
          note:           { type: 'string' },
        },
        required: ['id', 'classification', 'note'],
      },
    },
    kuja_explanation:        { type: 'string' },
    rahu_ketu_explanation:   { type: 'string' },
    shani_yoga_explanation:  { type: 'string' },
    dasha_sandhi_explanation:{ type: 'string' },
    final_summary:           { type: 'string' },
  },
  required: [
    'porondam_analysis', 'kuja_explanation', 'rahu_ketu_explanation',
    'shani_yoga_explanation', 'dasha_sandhi_explanation', 'final_summary',
  ],
};

const SYSTEM_INSTRUCTION = `You are the internal reading-matcher module of a Sri Lankan Vedic astrology system, writing a compatibility (porondam) analysis.

FRAMING: Both persons' planetary placements have already been entered into the system and the relevant classical checks (Kuja/Manglik dosha, Rahu-Ketu dosha, Shani yoga, dasha-lord relation) have already been CALCULATED. Your job is only to (1) classify each of the 20 Porondam factors, and (2) write clear Sinhala explanations for the calculation results you are given. You are NOT calculating anything yourself and must NEVER invent a fact, number, or dosha not present in the input.

Rules:
- For porondam_analysis: use ONLY the given id/matched/critical_dosha per factor. matched=true and critical_dosha=false → usually "subha". matched=false and critical_dosha=true → usually "asuba". Other combinations → judge "madhyama" or as appropriate, briefly justified in "note" (1 sentence, Sinhala).
- For each dosha explanation (kuja/rahu_ketu/shani_yoga/dasha_sandhi): write 1-2 Sinhala sentences explaining the GIVEN boolean/fact in plain terms for the couple. If a check is "not active"/"no conflict", say so reassuringly. Do not add remedies here.
- final_summary: 2-3 Sinhala sentences summarizing the overall picture, referencing the GIVEN final percentage and recommendation (do not compute or state a different number yourself).
- Write in the same impersonal, matter-of-fact register as a classical text — not a warm personal chat message. Never mention AI.
- Respond using the required JSON schema only.`;

async function getCached(matchHash) {
  if (IS_PG) {
    const r = await pool.query('SELECT response FROM match_deep_cache WHERE match_hash=$1', [matchHash]);
    return r.rows[0]?.response || null;
  }
  const row = db.prepare('SELECT response FROM match_deep_cache WHERE match_hash=?').get(matchHash);
  return row ? JSON.parse(row.response) : null;
}

async function saveCache(matchHash, response) {
  if (IS_PG) {
    await pool.query(
      `INSERT INTO match_deep_cache (match_hash, response) VALUES ($1, $2::jsonb)
       ON CONFLICT (match_hash) DO NOTHING`,
      [matchHash, JSON.stringify(response)],
    );
  } else {
    db.prepare('INSERT OR IGNORE INTO match_deep_cache (match_hash, response) VALUES (?, ?)')
      .run(matchHash, JSON.stringify(response));
  }
}

function resolveGenAI(client) {
  const apiKey = client?.gemini_api_key
    || (client?.use_system_gemini_key ? process.env.GEMINI_API_KEY : null)
    || process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return apiKey !== process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(apiKey) : genAI;
}

/**
 * @param {Array} porondamFactors - [{id, name_si, matched, critical_dosha}, ...]
 * @param {Object} facts - DeepMatchFacts from the frontend (kuja/rahuKetu/shaniYoga/dashaSandhi)
 * @param {{percent:number, recommend:boolean}} finalRecommendation - pre-computed in code
 * @param {string} matchHash - same hash as the Ashtakoota match cache
 * @param {string} clientId - client whose Gemini key to use
 */
async function generateDeepMatchAnalysis(porondamFactors, facts, finalRecommendation, matchHash, clientId) {
  const cached = await getCached(matchHash);
  if (cached) return cached;

  const client = clientId ? await clientRouter.getClientById(clientId) : null;
  const clientAI = resolveGenAI(client);
  if (!clientAI) return null;

  const prompt = JSON.stringify({
    porondam_factors: porondamFactors.map((f) => ({
      id: f.id, name_si: f.name_si, matched: f.matched, critical_dosha: f.critical_dosha,
    })),
    kuja_dosha: facts.kuja,
    rahu_ketu_dosha: facts.rahuKetu,
    shani_yoga: facts.shaniYoga,
    dasha_sandhi: facts.dashaSandhi,
    final_recommendation: finalRecommendation,
  }, null, 2);

  try {
    const model = clientAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.5,
        responseMimeType: 'application/json',
        responseSchema: DEEP_MATCH_SCHEMA,
      },
    });
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());

    await saveCache(matchHash, parsed);
    return parsed;
  } catch (e) {
    console.error('[DEEP-MATCH]', e.message);
    return null;
  }
}

module.exports = { generateDeepMatchAnalysis };
