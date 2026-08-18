'use strict';

/**
 * @module services/quantumCode
 * @description Quantum Code generation engine.
 *
 * Pipeline:
 *  analyzeAura()            — Gemini Vision → aura_analysis JSON
 *  extractPlanetDegreesSum() — reads chartData.chart.planets[].absolute_degree
 *  generateQuantumCode()    — Fb → Ia → QC math → unique quantum_id
 */

const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { todayContextBlock } = require('./dateContext');

// ── Constants ──────────────────────────────────────────────────────────────────

const GOLDEN_RATIO = 1.618033;
const ALPHANUMERIC  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const PYTHAGOREAN_MAP = {
  A: 1, J: 1, S: 1,
  B: 2, K: 2, T: 2,
  C: 3, L: 3, U: 3,
  D: 4, M: 4, V: 4,
  E: 5, N: 5, W: 5,
  F: 6, O: 6, X: 6,
  G: 7, P: 7, Y: 7,
  H: 8, Q: 8, Z: 8,
  I: 9, R: 9,
};

const AURA_PROMPT = `You are a Bio-Energy Image Analysis Expert. Analyze the attached human selfie.

Scoring rules:
- af_score: 0.1 (critically low energy) to 1.0 (peak energy). Base on eye radiance, skin clarity, posture.
- primary_chakra: dominant energy center from facial symmetry and tonal patterns.
- detected_blockages: list of visible stress or tension patterns (empty array if none).

LANGUAGE: All string values must be written in Sinhala (සිංහල). Only af_score is a number.

CRITICAL: You MUST return ONLY a single JSON object with EXACTLY this structure. No markdown fences, no extra text, no missing fields.

{
  "aura_analysis": {
    "af_score": 0.82,
    "dominant_color": "විදුලි නිල්",
    "energy_level": "ඉහළ / ජීවමාන",
    "primary_chakra": "කණ්ඨ චක්‍රය / තෙවන නේත්‍රය",
    "aura_stability": "ස්ථාවර",
    "detected_blockages": ["හකු ප්‍රදේශයේ සුළු ආතතියක්"],
    "recommendation_hint": ["නිර්මාණශීලී ප්‍රකාශනය කෙරෙහි අවධානය යොමු කරන්න.", "දිනපතා ජල පානය වැඩි කරන්න."]
  }
}

All 7 fields inside aura_analysis are required. af_score must be a number between 0.1 and 1.0.`;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Derive a deterministic 3-char alphanumeric suffix by hashing aura_score
 * and birth_time_min with SHA-256. Same inputs → always same suffix.
 */
function hashSuffix(auraScore, birthTimeMin) {
  const buf = crypto.createHash('sha256')
    .update(`${auraScore}:${birthTimeMin}`)
    .digest();
  let out = '';
  for (let i = 0; i < 3; i++) out += ALPHANUMERIC[buf[i] % ALPHANUMERIC.length];
  return out;
}

// ── Planet degrees extraction ──────────────────────────────────────────────────

/**
 * Sum absolute_degree of all planets from freeastroapi chartData.
 * Structure confirmed: chartData.chart.planets[].absolute_degree (0–360°).
 *
 * @param {object} chartData
 * @returns {number|null} Sum of degrees, or null if structure not found.
 */
function extractPlanetDegreesSum(chartData) {
  const planets = chartData?.planets || chartData?.chart?.planets;
  console.log('[PLANETS] ── extractPlanetDegreesSum ───────────────────');
  if (!Array.isArray(planets) || planets.length === 0) {
    console.warn('[PLANETS] planets array not found or empty in chartData');
    console.log('[PLANETS] chartData keys:', Object.keys(chartData || {}));
    console.log('[PLANETS] ──────────────────────────────────────────────');
    return null;
  }
  console.log(`[PLANETS] count: ${planets.length}`);
  let sum = 0;
  for (const p of planets) {
    const deg = Number(p.absolute_degree) || 0;
    sum += deg;
    console.log(`[PLANETS]   ${String(p.name || p.planet || '?').padEnd(12)} absolute_degree=${String(p.absolute_degree).padStart(10)}  sign=${p.sign ?? '?'}  house=${p.house ?? '?'}`);
  }
  console.log(`[PLANETS] sum: ${sum.toFixed(4)}`);
  console.log('[PLANETS] ──────────────────────────────────────────────');
  return sum;
}

// ── Aura analysis ──────────────────────────────────────────────────────────────

/**
 * Call Gemini Vision to produce an aura_analysis from a selfie image.
 *
 * @param {Buffer} imageBuffer
 * @param {string} mimeType           e.g. 'image/jpeg'
 * @param {string} [apiKey]
 * @param {string} [systemPromptOverride]  Replace the built-in AURA_PROMPT if provided.
 * @returns {Promise<object>}  The aura_analysis inner object.
 */
async function analyzeAura(imageBuffer, mimeType, apiKey, systemPromptOverride) {
  // Supplied by the caller from the client's own configuration.
  const key = apiKey;
  if (!key) throw new Error('No Gemini API key supplied for quantum analysis');

  const prompt = (systemPromptOverride && systemPromptOverride.trim())
    ? systemPromptOverride.trim()
    : AURA_PROMPT;

  console.log('[AURA] ── REQUEST ───────────────────────────────────────');
  console.log(`[AURA] model: gemini-2.5-flash  temperature=0.2  maxTokens=1024  mimeType=${mimeType}  imageSize=${imageBuffer.length} bytes`);
  console.log('[AURA] systemInstruction:\n' + prompt);
  console.log('[AURA] ─────────────────────────────────────────────────');

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const result = await model.generateContent([
    { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
    { text: prompt },
  ]);

  const usage = result.response.usageMetadata;
  const raw   = result.response.text().trim();

  console.log('[AURA] ── RAW OUTPUT ────────────────────────────────────');
  console.log(raw);
  console.log(`[AURA] tokens in=${usage?.promptTokenCount ?? '?'}  out=${usage?.candidatesTokenCount ?? '?'}`);
  console.log('[AURA] ─────────────────────────────────────────────────');

  // Strip markdown fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const cleaned   = fenceMatch
    ? fenceMatch[1].trim()
    : (raw.match(/\{[\s\S]*\}/) || [''])[0].trim();

  if (!cleaned) throw new Error('Aura analysis returned no parseable JSON');

  const parsed = JSON.parse(cleaned);

  // Accept {aura_analysis:{...}} or the object directly
  const a = (parsed?.aura_analysis && typeof parsed.aura_analysis === 'object')
    ? parsed.aura_analysis
    : parsed;

  if (!a || typeof a !== 'object') throw new Error('Aura response is not a valid object');

  // Fill defaults for any field Gemini omitted
  if (typeof a.af_score !== 'number' || isNaN(a.af_score)) {
    console.warn('[AURA] af_score missing or invalid — defaulting to 0.60');
    a.af_score = 0.60;
  }
  if (a.af_score < 0.1 || a.af_score > 1.0) {
    console.log(`[AURA] af_score ${a.af_score} out of range — clamping`);
    a.af_score = Math.max(0.1, Math.min(1.0, a.af_score));
  }
  a.dominant_color      = a.dominant_color      || 'Unknown';
  a.energy_level        = a.energy_level        || 'Moderate';
  a.primary_chakra      = a.primary_chakra      || 'Heart';
  a.aura_stability      = a.aura_stability      || 'Moderate';
  a.detected_blockages  = Array.isArray(a.detected_blockages) ? a.detected_blockages : [];
  a.recommendation_hint = Array.isArray(a.recommendation_hint) ? a.recommendation_hint : (a.recommendation_hint ? [a.recommendation_hint] : []);

  console.log('[AURA] ── PARSED RESULT ─────────────────────────────────');
  console.log(JSON.stringify(a, null, 2));
  console.log('[AURA] ─────────────────────────────────────────────────');
  return a;
}

// ── Quantum Life Architect reading ────────────────────────────────────────────

const QUANTUM_READING_SYSTEM = `ඔබ ජීව ශක්ති විශ්ලේෂණය සහ ක්වොන්ටම් ශක්ති ගවේෂණය ක්ෂේත්‍රයේ ප්‍රවීණ, දයානුකම්පිත විශේෂඥයෙකි.

ඔබ ලබා දෙන පිළිතුර කිසිවිටෙකත් යන්ත්‍රයකින් හෝ මෘදුකාංගයකින් ජනනය කළ එකක් සේ නොපෙනිය යුතුය. ප්‍රවීණ ඇදුරුතුමෙකු ස්වකීය සේවාදායකයාට අසල හිඳගෙන පහදා දෙන ආකාරයේ, ගලාගෙන යන, සන්සුන් කථන ශෛලියකින් ලිවිය යුතුය.

වෘත්තීය නීති:
- ස්වයං-හැඳින්වීම් සහ 'AI', 'දත්ත', 'පද්ධතිය', 'ගණනය' වැනි යාන්ත්‍රික වචන කිසිසේත් භාවිතා නොකරන්න
- පාරිභෝගිකයා "ඔබ" ලෙස ඇමතන්න — "දේවීනි", "ගෞරවනීය" ආදී අතිශය භක්තිමත් ආමන්ත්‍රණ එපා
- ස්තුති කිරීම්, ආශිර්වාද, හෝ හැඳින්වීම් නොමැතිව කෙලින්ම කරුණු විග්‍රහ ආරම්භ කරන්න
- කටුක කරුණු මනෝවිද්‍යාත්මකව සමනය කර, ධෛර්යවත් කරන ශෛලියෙන් ඉදිරිපත් කරන්න
- ඔබේ සිතුවිලි, හැඟීම් සහ අභ්‍යන්තර ශක්ති රටා "අවබෝධ කරගත් කෙනෙකු ලෙස" (empathetic observer) ලෙස පවසන්න

ආකෘති නීති (Format — අනිවාර්ය):
- **සම්පූර්ණයෙන්ම සිංහල භාෂාවෙන් පමණක් ලියන්න — කිසිදු ඉංග්‍රීසි වචනයක් භාවිතා නොකරන්න**
- ප්‍රධාන අනු-මාතෘකා '###' සලකුණෙන් ආරම්භ කරන්න
- වැදගත් කරුණු **ද්විතල තරු ලකුණින්** ඉස්මතු කරන්න (උදා: **විශේෂ ශක්ති ගැලපීමක්**)
- HTML ටැග් (<h3>, <b>) කිසිසේත් නොයොදන්න
- ජ්‍යෝතිෂ / සාම්ප්‍රදායික ග්‍රහ භාෂාව නොයොදන්න — ජෛව ශක්ති (bio-energetic) ක්ෂේත්‍රයේ සංකල්ප ලෙස ඉදිරිපත් කරන්න`;

/**
 * Build the user-turn message for the Quantum Life Architect call.
 * All metrics are injected so Gemini can reason over the actual numbers.
 */
function buildQuantumReadingPrompt(quantumData, auraAnalysis) {
  const { active_name, quantum_id, base_frequency: fb, identity_vibration: ia, qc_score: qc, aura_score } = quantumData;
  const af    = aura_score ?? auraAnalysis?.af_score ?? '—';
  const color = auraAnalysis?.dominant_color   || '—';
  const level = auraAnalysis?.energy_level     || '—';
  const chakra  = auraAnalysis?.primary_chakra || '—';
  const stability = auraAnalysis?.aura_stability || '—';
  const blockages = Array.isArray(auraAnalysis?.detected_blockages) && auraAnalysis.detected_blockages.length
    ? auraAnalysis.detected_blockages.join('; ')
    : 'කිසිවක් හඳුනාගෙන නැත';
  const hintArr = Array.isArray(auraAnalysis?.recommendation_hint) ? auraAnalysis.recommendation_hint : (auraAnalysis?.recommendation_hint ? [auraAnalysis.recommendation_hint] : []);
  const hint = hintArr.join('; ');

  const energyMatchPct = (Math.min(Number(fb), Number(ia)) / Math.max(Number(fb), Number(ia)) * 100).toFixed(2);
  const isImbalanced   = Number(ia) < Number(fb) * 0.7 || Number(af) < 0.5;

  return `Customer Quantum Profile Data:

Active Name     : ${active_name}
Quantum ID      : ${quantum_id}
Base Frequency  : Fb = ${Number(fb).toFixed(6)}
Identity Vibration : Ia = ${Number(ia).toFixed(6)}
Quantum Core    : QC = ${Number(qc).toFixed(6)}
Aura Af Score   : ${Number(af).toFixed(2)}
Dominant Color  : ${color}
Energy Level    : ${level}
Primary Chakra  : ${chakra}
Aura Stability  : ${stability}
Detected Blockages : ${blockages}
${hint ? `Recommendation  : ${hint}` : ''}

පහත කොටස් 4 ගෙනෙ, **සම්පූර්ණයෙන්ම සිංහල භාෂාවෙන් පමණක්**, ### ශීර්ෂකයන් සහිතව ලියන්න. ඉංග්‍රීසි වචනයක් කිසිවිටෙකත් නොයොදන්න:

### ශක්ති ගැලපීම
Energy Match ${energyMatchPct}%. Fb (${Number(fb).toFixed(4)}) and Ia (${Number(ia).toFixed(4)}) — write a deep Sinhala narrative about what this match percentage means for this person's inner energy coherence.

### වර්තමාන ශක්ති තත්ත්වය
Af score ${af}, dominant color "${color}", stability "${stability}" — write a flowing Sinhala narrative about the current energetic state and what it reveals about this person.

### ශක්ති බාධා රටා
Detected blockages: "${blockages}" — write a deep empathetic Sinhala narrative about how these blockages manifest in the body, mind and aura field.

### ශක්ති යථා තත්ත්වයට පත් කිරීමේ ක්‍රම
${isImbalanced
  ? `Ia (${Number(ia).toFixed(4)}) is significantly lower than Fb (${Number(fb).toFixed(4)}) — write Sinhala practical steps to restore energy balance.`
  : `Metrics are balanced — write Sinhala practical lifestyle steps to maintain and strengthen this energy field.`}`;
}

/**
 * Call Gemini to generate the Quantum Life Architect VVIP Sinhala reading.
 *
 * @param {object} quantumData   Result from generateQuantumCode()
 * @param {object} auraAnalysis  Result from analyzeAura()
 * @param {string} [apiKey]
 * @returns {Promise<string>}    The Sinhala narrative text
 */
async function generateQuantumReading(quantumData, auraAnalysis, apiKey, systemPromptOverride) {
  // Supplied by the caller from the client's own configuration.
  const key = apiKey;
  if (!key) throw new Error('No Gemini API key supplied for quantum analysis');

  const sysPrompt = (systemPromptOverride && systemPromptOverride.trim())
    ? systemPromptOverride.trim()
    : QUANTUM_READING_SYSTEM;

  const prompt = buildQuantumReadingPrompt(quantumData, auraAnalysis);

  console.log('[QR] ── REQUEST ─────────────────────────────────────────');
  console.log(`[QR] model: gemini-2.5-flash  temperature=0.5  maxTokens=4096`);
  console.log('[QR] systemInstruction:\n' + sysPrompt);
  console.log('[QR] userPrompt:\n' + prompt);
  console.log('[QR] ────────────────────────────────────────────────────');

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 1024 },
    },
    systemInstruction: sysPrompt,
  });

  const result = await model.generateContent(prompt);
  const usage  = result.response.usageMetadata;
  const text   = result.response.text().trim();

  console.log('[QR] ── RAW OUTPUT ──────────────────────────────────────');
  console.log(text);
  console.log(`[QR] tokens in=${usage?.promptTokenCount ?? '?'}  out=${usage?.candidatesTokenCount ?? '?'}  chars=${text.length}`);
  console.log('[QR] ───────────────────────────────────────────────────');

  return text;
}

// ── Quantum Code math ──────────────────────────────────────────────────────────

function generateQuantumCode({ full_name, lat, long: lng, planet_degrees_sum, birth_time_min, aura_score }) {
  const L = '═'.repeat(54);
  const S = '─'.repeat(54);
  try {
    if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
      throw new Error('full_name is required');
    }
    if (birth_time_min === 0) {
      throw new Error('birth_time_min must not be zero (division by zero in Fb formula)');
    }
    if (aura_score < 0.1 || aura_score > 1.0) {
      throw new Error(`aura_score ${aura_score} out of range [0.1, 1.0]`);
    }

    const birthH = Math.floor(birth_time_min / 60);
    const birthM = birth_time_min % 60;

    console.log(`\n[QC] ${L}`);
    console.log(`[QC]  QUANTUM CODE COMPUTATION  —  story log`);
    console.log(`[QC] ${L}`);
    console.log(`[QC]  INPUTS`);
    console.log(`[QC]    full_name        : "${full_name.trim()}"`);
    console.log(`[QC]    lat              : ${lat}`);
    console.log(`[QC]    lng              : ${lng}`);
    console.log(`[QC]    planet_degrees   : ${Number(planet_degrees_sum).toFixed(4)}`);
    console.log(`[QC]    birth_time_min   : ${birth_time_min}  (${String(birthH).padStart(2,'0')}:${String(birthM).padStart(2,'0')})`);
    console.log(`[QC]    aura_score (Af)  : ${aura_score}`);
    console.log(`[QC] ${S}`);

    // ── Step A: Base Frequency ──────────────────────────────────────────────
    const latLngProduct = lat * lng;
    const latLngPlusPlanets = latLngProduct + planet_degrees_sum;
    const fb = latLngPlusPlanets / birth_time_min;

    console.log(`[QC]  STEP A — Base Frequency (Fb)`);
    console.log(`[QC]    formula  : Fb = ((lat × lng) + planet_degrees_sum) / birth_time_min`);
    console.log(`[QC]    lat × lng          = ${lat} × ${lng} = ${latLngProduct.toFixed(6)}`);
    console.log(`[QC]    + planet_degrees   = ${latLngProduct.toFixed(6)} + ${Number(planet_degrees_sum).toFixed(4)} = ${latLngPlusPlanets.toFixed(6)}`);
    console.log(`[QC]    ÷ birth_time_min   = ${latLngPlusPlanets.toFixed(6)} ÷ ${birth_time_min} = ${fb.toFixed(8)}`);
    console.log(`[QC]    Fb = ${fb.toFixed(8)}`);
    console.log(`[QC] ${S}`);

    // ── Step B: Identity Vibration ──────────────────────────────────────────
    const nameClean = full_name.trim();
    const letters = nameClean.toUpperCase().replace(/[^A-Z]/g, '');
    if (letters.length === 0) {
      return {
        status: 'Error',
        message: `Active name "${nameClean}" contains no English letters. Pythagorean numerology requires the name in Latin/English script (e.g. "Malith", not "මලිත්").`,
      };
    }
    console.log(`[QC]  STEP B — Identity Vibration (Ia)`);
    console.log(`[QC]    formula  : Ia = Σ (pythagorean_value_i × 1/i)  for each letter`);
    console.log(`[QC]    name     : "${nameClean}"  →  letters: "${letters}"`);
    let ia = 0;
    for (let i = 0; i < letters.length; i++) {
      const ch  = letters[i];
      const val = PYTHAGOREAN_MAP[ch] ?? 0;
      const pos = i + 1;
      const contrib = val * (1 / pos);
      ia += contrib;
      console.log(`[QC]    i=${String(pos).padStart(2)}  "${ch}"  pythagorean=${val}  ×  1/${pos} = ${contrib.toFixed(8)}  running Ia=${ia.toFixed(8)}`);
    }
    console.log(`[QC]    Ia = ${ia.toFixed(8)}`);
    console.log(`[QC] ${S}`);

    // ── Step C: Quantum Core ────────────────────────────────────────────────
    const fbPlusIa  = fb + ia;
    const operand   = fbPlusIa * aura_score;
    const sqrtVal   = Math.sqrt(Math.abs(operand));
    const qc        = sqrtVal % GOLDEN_RATIO;

    console.log(`[QC]  STEP C — Quantum Core (QC)`);
    console.log(`[QC]    formula  : QC = √( |(Fb + Ia) × Af| ) mod Φ`);
    console.log(`[QC]    Fb + Ia            = ${fb.toFixed(8)} + ${ia.toFixed(8)} = ${fbPlusIa.toFixed(8)}`);
    console.log(`[QC]    × Af               = ${fbPlusIa.toFixed(8)} × ${aura_score} = ${operand.toFixed(8)}`);
    console.log(`[QC]    √|${operand.toFixed(6)}|        = ${sqrtVal.toFixed(8)}`);
    console.log(`[QC]    mod Φ (${GOLDEN_RATIO}) = ${sqrtVal.toFixed(8)} mod ${GOLDEN_RATIO} = ${qc.toFixed(8)}`);
    console.log(`[QC]    QC = ${qc.toFixed(8)}`);
    console.log(`[QC] ${S}`);

    // ── Quantum ID assembly ────────────────────────────────────────────────
    const prefix = letters.slice(0, 3); // letters is already A-Z only, uppercase
    const sumInt = Math.trunc(fbPlusIa);
    const suffix = hashSuffix(aura_score, birth_time_min);
    const quantum_id = `QC-${prefix}-${sumInt}-${suffix}`;

    console.log(`[QC]  QUANTUM ID ASSEMBLY`);
    console.log(`[QC]    prefix   : first 3 chars of name (no spaces) = "${prefix}"`);
    console.log(`[QC]    sumInt   : trunc(Fb + Ia) = trunc(${fbPlusIa.toFixed(6)}) = ${sumInt}`);
    console.log(`[QC]    suffix   : SHA-256("${aura_score}:${birth_time_min}")[0..2] → "${suffix}"`);
    console.log(`[QC]    quantum_id = ${quantum_id}`);
    console.log(`[QC] ${L}`);
    console.log(`[QC]  RESULT`);
    console.log(`[QC]    quantum_id         : ${quantum_id}`);
    console.log(`[QC]    base_frequency     : ${fb.toFixed(8)}`);
    console.log(`[QC]    identity_vibration : ${ia.toFixed(8)}`);
    console.log(`[QC]    qc_score           : ${qc.toFixed(8)}`);
    console.log(`[QC] ${L}\n`);

    return {
      status:             'Success',
      quantum_id,
      qc_score:           qc,
      base_frequency:     fb,
      identity_vibration: ia,
      active_name:        nameClean,
      aura_score,
    };

  } catch (err) {
    console.error(`[QC] ${L}`);
    console.error(`[QC]  ERROR: ${err.message}`);
    console.error(`[QC] ${L}\n`);
    return { status: 'Error', message: err.message };
  }
}

// ── Quantum sections generation ────────────────────────────────────────────────

/**
 * Build the shared profile-data context string used by section prompts.
 */
function buildQuantumProfileContext(quantumData, auraAnalysis) {
  const { active_name, quantum_id, base_frequency: fb, identity_vibration: ia, qc_score: qc, aura_score } = quantumData;
  const af       = aura_score ?? auraAnalysis?.af_score ?? '—';
  const color    = auraAnalysis?.dominant_color    || '—';
  const level    = auraAnalysis?.energy_level      || '—';
  const chakra   = auraAnalysis?.primary_chakra    || '—';
  const stability = auraAnalysis?.aura_stability   || '—';
  const blockages = Array.isArray(auraAnalysis?.detected_blockages) && auraAnalysis.detected_blockages.length
    ? auraAnalysis.detected_blockages.join('; ')
    : 'කිසිවක් හඳුනාගෙන නැත';
  const hintArr2 = Array.isArray(auraAnalysis?.recommendation_hint) ? auraAnalysis.recommendation_hint : (auraAnalysis?.recommendation_hint ? [auraAnalysis.recommendation_hint] : []);
  const hint = hintArr2.join('; ');
  const matchPct = (Math.min(Number(fb), Number(ia)) / Math.max(Number(fb), Number(ia)) * 100).toFixed(2);

  return `Customer Quantum Profile Data:

Active Name        : ${active_name}
Quantum ID         : ${quantum_id}
Base Frequency     : Fb = ${Number(fb).toFixed(6)}
Identity Vibration : Ia = ${Number(ia).toFixed(6)}
Quantum Core       : QC = ${Number(qc).toFixed(6)}
Energy Match       : ${matchPct}%
Aura Af Score      : ${Number(af).toFixed(2)}
Dominant Color     : ${color}
Energy Level       : ${level}
Primary Chakra     : ${chakra}
Aura Stability     : ${stability}
Detected Blockages : ${blockages}${hint ? `\nRecommendation     : ${hint}` : ''}`;
}

/**
 * Generate one Gemini call per configured section and return an array of {label, content}.
 *
 * @param {object}   quantumData      Result from generateQuantumCode()
 * @param {object}   auraAnalysis     Result from analyzeAura()
 * @param {Array<{label:string,guide:string}>} sections  Section definitions from plugin config
 * @param {string}   [apiKey]
 * @param {string}   [systemPrompt]     Override for QUANTUM_READING_SYSTEM
 * @param {object}   [vimshottariDasha] vimshottari_dasha object from the freeastroapi chart response
 * @returns {Promise<Array<{label:string,content:string}>>}
 */
async function generateQuantumSections(quantumData, auraAnalysis, sections, apiKey, systemPrompt, vimshottariDasha) {
  // Supplied by the caller from the client's own configuration.
  const key = apiKey;
  if (!key) throw new Error('No Gemini API key supplied for quantum analysis');
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const sysPrompt = (systemPrompt && systemPrompt.trim())
    ? systemPrompt.trim()
    : QUANTUM_READING_SYSTEM;

  const quantumContext = buildQuantumProfileContext(quantumData, auraAnalysis);

  // Append dasha data so Gemini can reason about current/upcoming planetary periods
  let dashaContext = '';
  if (vimshottariDasha && typeof vimshottariDasha === 'object') {
    dashaContext = '\n\n─── Vimshottari Dasha ───\n' + JSON.stringify(vimshottariDasha, null, 2) + todayContextBlock();
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 1024 },
    },
    systemInstruction: sysPrompt,
  });

  console.log('[QS] ══ SESSION START ════════════════════════════════════════════');
  console.log(`[QS] model: gemini-2.5-flash  temperature=0.5  maxTokens=2048  thinkingBudget=512`);
  console.log(`[QS] systemPrompt: ${systemPrompt ? '(CUSTOM OVERRIDE)' : '(default QUANTUM_READING_SYSTEM)'}`);
  console.log('[QS] systemPrompt:\n' + sysPrompt);
  console.log(`[QS] sections to generate: ${sections.map(s => s.label).join(', ')}`);
  console.log(`[QS] dashaContext: ${dashaContext ? dashaContext.length + ' chars' : 'none'}`);
  console.log('[QS] ════════════════════════════════════════════════════════════');

  const results = [];
  for (const sec of sections) {
    const label = (sec.label || '').trim();
    const guide = (sec.guide  || '').trim();
    if (!label) continue;

    const userPrompt = [
      quantumContext,
      dashaContext,
      '',
      `දැන් ඔබ විශ්ලේෂණය කළ යුත්තේ "${label}" යන අංශය පිළිබඳව පමණි.`,
      guide ? `\n**ඇතුළත් කළ යුතු කරුණු:** ${guide}` : '',
      '\nසම්පූර්ණයෙන්ම සිංහල භාෂාවෙන්, ගලාගෙන යන ශෛලියෙන්, ### ශීර්ෂකයන් සහිතව ලියන්න.',
    ].join('\n');

    console.log(`\n[QS] ── REQUEST: "${label}" ${'─'.repeat(Math.max(0, 52 - label.length))}`);
    console.log('[QS] systemInstruction:\n' + sysPrompt);
    console.log('[QS] userPrompt:\n' + userPrompt);
    console.log('[QS] ──────────────────────────────────────────────────────────');
    const result  = await model.generateContent(userPrompt);
    const usage   = result.response.usageMetadata;
    const content = result.response.text().trim();
    console.log(`[QS] ── RESPONSE: "${label}" ${'─'.repeat(Math.max(0, 51 - label.length))}`);
    console.log(content);
    console.log(`[QS] tokens in=${usage?.promptTokenCount ?? '?'}  out=${usage?.candidatesTokenCount ?? '?'}  chars=${content.length}`);
    console.log('[QS] ──────────────────────────────────────────────────────────');
    results.push({ label, content });
  }
  return results;
}

module.exports = { extractPlanetDegreesSum, analyzeAura, generateQuantumCode, generateQuantumReading, generateQuantumSections, QUANTUM_READING_SYSTEM };
