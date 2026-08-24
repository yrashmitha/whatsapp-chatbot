'use strict';

/**
 * Full Quantum Code pipeline test.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx FREEASTRO_API_KEY=yyy node test-quantum-full.js [/path/to/selfie.jpg]
 *
 * If no selfie path is given, a tiny placeholder JPEG is used so the aura
 * Gemini call still fires (results will be low-quality — for pipe testing only).
 */

require('dotenv').config();

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const { extractPlanetDegreesSum, analyzeAura, generateQuantumCode, generateQuantumReading } = require('./src/services/quantumCode');

// ── Test inputs — edit these ──────────────────────────────────────────────────
const TEST = {
  full_name:   'Yohan',
  birth_date:  { year: 1997, month: 7, day: 17 },
  birth_time:  { hour: 23, minute: 34 },
  lat:         7.025148,
  lng:         79.909742,
  tz_str:      'Asia/Colombo',
  aura_score_override: null,
};

const GEMINI_KEY    = process.env.GEMINI_API_KEY;
const FREEASTRO_KEY = process.env.FREEASTRO_API_KEY;
const SELFIE_PATH   = process.argv[2] || null;

// ── Tiny placeholder JPEG (1×1 white pixel) used when no selfie is given ─────
const PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA' +
  'Ax8A/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEA' +
  'AT8AVf/Z',
  'base64'
);

const SEP  = '═'.repeat(60);
const STEP = '─'.repeat(60);

function banner(title) {
  console.log(`\n${SEP}`);
  console.log(`  ${title}`);
  console.log(`${SEP}`);
}

async function run() {
  banner('QUANTUM CODE — FULL PIPELINE TEST');

  // ── Validate keys ─────────────────────────────────────────────────────────
  if (!FREEASTRO_KEY) {
    console.error('[FATAL] FREEASTRO_API_KEY not set. Run:\n  GEMINI_API_KEY=xxx FREEASTRO_API_KEY=yyy node test-quantum-full.js');
    process.exit(1);
  }
  if (!GEMINI_KEY && TEST.aura_score_override === null) {
    console.error('[FATAL] GEMINI_API_KEY not set and no aura_score_override given.');
    process.exit(1);
  }

  console.log(`\n[CONFIG] full_name        : "${TEST.full_name}"`);
  console.log(`[CONFIG] birth_date        : ${TEST.birth_date.year}-${TEST.birth_date.month}-${TEST.birth_date.day}`);
  console.log(`[CONFIG] birth_time        : ${String(TEST.birth_time.hour).padStart(2,'0')}:${String(TEST.birth_time.minute).padStart(2,'0')}`);
  console.log(`[CONFIG] lat / lng         : ${TEST.lat} / ${TEST.lng}`);
  console.log(`[CONFIG] selfie            : ${SELFIE_PATH || '(placeholder — Gemini Vision accuracy low)'}`);
  console.log(`[CONFIG] FREEASTRO_KEY     : ${FREEASTRO_KEY.slice(0,6)}...`);
  console.log(`[CONFIG] GEMINI_KEY        : ${GEMINI_KEY ? GEMINI_KEY.slice(0,6)+'...' : '(not set — using override)'}`);

  // ── STEP 1: freeastroapi chart ────────────────────────────────────────────
  banner('STEP 1 — freeastroapi chart');

  const astroPayload = {
    year:         TEST.birth_date.year,
    month:        TEST.birth_date.month,
    day:          TEST.birth_date.day,
    hour:         TEST.birth_time.hour,
    minute:       TEST.birth_time.minute,
    lat:          TEST.lat,
    lng:          TEST.lng,
    tz_str:       TEST.tz_str,
    ayanamsha:    'lahiri',
    house_system: 'whole_sign',
    node_type:    'mean',
    vargas:       [1, 9, 7],
    dasha_levels: 2,
  };

  console.log('\n[ASTRO] Request payload:');
  console.log(JSON.stringify(astroPayload, null, 2));

  let chartData;
  try {
    const resp = await axios.post(
      'https://api.freeastroapi.com/api/v1/vedic/calculate',
      astroPayload,
      { headers: { 'x-api-key': FREEASTRO_KEY, 'Content-Type': 'application/json' } }
    );
    chartData = resp.data;
    console.log('\n[ASTRO] Response status:', resp.status);
    console.log('[ASTRO] Response keys   :', Object.keys(chartData));
    console.log('[ASTRO] Full response   :');
    console.log(JSON.stringify(chartData, null, 2));
  } catch (err) {
    console.error('[ASTRO] API call failed:', err.response?.status, err.response?.data || err.message);
    process.exit(1);
  }

  // ── STEP 2: extract planet degrees ───────────────────────────────────────
  banner('STEP 2 — planet degrees extraction');

  const planetSum = extractPlanetDegreesSum(chartData);
  if (planetSum === null) {
    console.error('[FATAL] Could not extract planet degrees — check chart structure above.');
    process.exit(1);
  }

  const birthTimeMin = TEST.birth_time.hour * 60 + TEST.birth_time.minute;

  // ── STEP 3: aura analysis ─────────────────────────────────────────────────
  banner('STEP 3 — Gemini Vision aura analysis');

  let auraAnalysis;
  if (TEST.aura_score_override !== null) {
    auraAnalysis = {
      af_score:           TEST.aura_score_override,
      dominant_color:     'Electric Blue (override)',
      energy_level:       'High (override)',
      primary_chakra:     'Throat (override)',
      aura_stability:     'Stable (override)',
      detected_blockages: ['override — no real image used'],
      recommendation_hint:'Test override active.',
    };
    console.log('[AURA] Skipping Gemini Vision — using override:', JSON.stringify(auraAnalysis, null, 2));
  } else {
    let imageBuffer, mimeType;
    if (SELFIE_PATH && fs.existsSync(SELFIE_PATH)) {
      imageBuffer = fs.readFileSync(SELFIE_PATH);
      const ext  = path.extname(SELFIE_PATH).toLowerCase();
      mimeType   = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      console.log(`[AURA] Using selfie: ${SELFIE_PATH} (${imageBuffer.length} bytes, ${mimeType})`);
    } else {
      imageBuffer = PLACEHOLDER_JPEG;
      mimeType    = 'image/jpeg';
      console.log('[AURA] No selfie path given — using 1×1 placeholder JPEG');
    }

    try {
      auraAnalysis = await analyzeAura(imageBuffer, mimeType, GEMINI_KEY);
    } catch (err) {
      console.error('[AURA] Failed:', err.message);
      process.exit(1);
    }
  }

  // ── STEP 4: quantum code computation ─────────────────────────────────────
  banner('STEP 4 — Quantum Code computation');

  const qcResult = generateQuantumCode({
    full_name:          TEST.full_name,
    lat:                TEST.lat,
    long:               TEST.lng,
    planet_degrees_sum: planetSum,
    birth_time_min:     birthTimeMin,
    aura_score:         auraAnalysis.af_score,
  });

  if (qcResult.status === 'Error') {
    console.error('[QC] Failed:', qcResult.message);
    process.exit(1);
  }

  // ── STEP 5: Quantum Life Architect reading ────────────────────────────────
  banner('STEP 5 — Gemini Quantum Life Architect reading');

  let reading;
  try {
    reading = await generateQuantumReading(qcResult, auraAnalysis, GEMINI_KEY);
  } catch (err) {
    console.error('[QR] Failed:', err.message);
    process.exit(1);
  }

  // ── FINAL SUMMARY ─────────────────────────────────────────────────────────
  banner('PIPELINE COMPLETE — FINAL SUMMARY');
  console.log('\n  quantum_id         :', qcResult.quantum_id);
  console.log('  base_frequency     :', qcResult.base_frequency.toFixed(8));
  console.log('  identity_vibration :', qcResult.identity_vibration.toFixed(8));
  console.log('  qc_score           :', qcResult.qc_score.toFixed(8));
  console.log('  aura af_score      :', auraAnalysis.af_score);
  console.log('  aura color         :', auraAnalysis.dominant_color);
  console.log('  reading length     :', reading.length, 'chars');
  console.log(`\n${SEP}\n`);
}

run().catch(err => {
  console.error('[UNHANDLED]', err);
  process.exit(1);
});
