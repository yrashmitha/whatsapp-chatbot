/**
 * @module services/geminiModels
 * @description The Gemini models a client can be set to, with their prices.
 *
 * `client_configs.ai_model` picks the model for that client's chat replies and
 * for every report generated on their behalf (see clientKeys.getGenAI). Prices
 * live here, and nowhere else, so the Clients select box, the per-order cost
 * tracking and the chat cost line can never disagree about what a model costs.
 *
 * Prices are USD per 1M tokens from https://ai.google.dev/gemini-api/docs/pricing
 * (standard paid tier, text/image/video input; output includes thinking tokens).
 * Last checked 2026-10-29. A model whose price changes on a known date carries
 * one entry per period in `prices`, newest `from` last.
 *
 * `limited: true` models still work for keys that used them before, but Google
 * answers 404 "no longer available to new users" for a key from a newer project.
 */

'use strict';

const DEFAULT_MODEL = 'gemini-2.5-flash';

/** @type {{id:string,label:string,status:'stable'|'preview'|'limited',prices:{from:string,input:number,output:number}[],note?:string}[]} */
const MODELS = [
  { id: 'gemini-3.8-flash',      label: 'Gemini 3.8 Flash',      status: 'stable',
    prices: [{ from: '1970-01-01', input: 0.75, output: 3.75 }, { from: '2027-01-01', input: 1.50, output: 7.50 }],
    note: 'Recommended by Google for new projects. Price doubles on 2027-01-01.' },
  { id: 'gemini-3.6-flash',      label: 'Gemini 3.6 Flash',      status: 'stable',
    prices: [{ from: '1970-01-01', input: 0.75, output: 3.75 }, { from: '2027-01-01', input: 1.50, output: 7.50 }] },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', status: 'stable',
    prices: [{ from: '1970-01-01', input: 0.30, output: 2.50 }],
    note: 'Recommended by Google for new projects. Cheapest current model.' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', status: 'stable',
    prices: [{ from: '1970-01-01', input: 0.25, output: 1.50 }] },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (preview)', status: 'preview',
    prices: [{ from: '1970-01-01', input: 0.50, output: 3.00 }] },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)', status: 'preview',
    prices: [{ from: '1970-01-01', input: 2.00, output: 12.00 }],
    note: 'Price shown is for prompts up to 200k tokens.' },
  { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      status: 'limited',
    prices: [{ from: '1970-01-01', input: 0.30, output: 2.50 }] },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', status: 'limited',
    prices: [{ from: '1970-01-01', input: 0.10, output: 0.40 }] },
  { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',        status: 'limited',
    prices: [{ from: '1970-01-01', input: 1.25, output: 10.00 }],
    note: 'Price shown is for prompts up to 200k tokens.' },
];

const BY_ID = new Map(MODELS.map(m => [m.id, m]));

/** True when `id` is a model we know and can price. */
function isKnownModel(id) { return BY_ID.has(id); }

/**
 * The model to actually call for a stored `ai_model`. A value we no longer list
 * (a retired model, a typo) falls back to the default instead of 404-ing every
 * reply and report for that client.
 */
function resolveModelId(id) { return BY_ID.has(id) ? id : DEFAULT_MODEL; }

/**
 * Price per token for a model on a given day.
 * @param {string} id
 * @param {Date} [at]
 * @returns {{input:number, output:number}} USD per single token
 */
function pricePerToken(id, at = new Date()) {
  const m = BY_ID.get(resolveModelId(id));
  const day = at.toISOString().slice(0, 10);
  let p = m.prices[0];
  for (const x of m.prices) if (x.from <= day) p = x;
  return { input: p.input / 1_000_000, output: p.output / 1_000_000 };
}

/** The catalog for the Clients select box, with today's price on each entry. */
function listModels(at = new Date()) {
  const day = at.toISOString().slice(0, 10);
  return MODELS.map(m => {
    let p = m.prices[0];
    for (const x of m.prices) if (x.from <= day) p = x;
    return { id: m.id, label: m.label, status: m.status, note: m.note || null,
             input_per_1m: p.input, output_per_1m: p.output };
  });
}

module.exports = { DEFAULT_MODEL, MODELS, isKnownModel, resolveModelId, pricePerToken, listModels };
