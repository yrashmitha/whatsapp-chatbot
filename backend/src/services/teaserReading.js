/**
 * @module services/teaserReading
 * @description Generates a short, persuasive Sinhala "teaser reading" for the
 * free web chart — one real, specific observation from the customer's own
 * chart (lagna, moon, current dasha, or a dosha flag), written to build
 * curiosity/urgency toward the paid report, but WITHOUT giving the remedy.
 *
 * Cost control: exactly one Gemini call per unique birth chart. The result is
 * cached in astro_cache.teaser_si (same birth_hash as the chart itself), so
 * every repeat view/refresh of the same chart costs zero additional AI calls.
 */

'use strict';

const { pool, db, IS_PG } = require('../db/connection');
const { genAI } = require('./gemini');

// Western sign name (as returned by freeastroapi) → Sinhala rashi name.
const RASHI_SI_BY_WESTERN = {
  Aries: 'මේෂ', Taurus: 'වෘෂභ', Gemini: 'මිථුන', Cancer: 'කටක',
  Leo: 'සිංහ', Virgo: 'කන්‍යා', Libra: 'තුලා', Scorpio: 'වෘශ්චික',
  Sagittarius: 'ධනු', Capricorn: 'මකර', Aquarius: 'කුම්භ', Pisces: 'මීන',
};

const PLANET_SI = {
  Sun: 'සූර්ය', Moon: 'චන්ද්‍ර', Mars: 'කුජ', Mercury: 'බුධ', Jupiter: 'ගුරු',
  Venus: 'ශුක්‍ර', Saturn: 'ශනි', Rahu: 'රාහු', Ketu: 'කේතු',
};

const NAKSHATRA_SI = {
  Ashwini: 'අස්විද', Bharani: 'බෙරණ', Krittika: 'කැති', Rohini: 'රෙහෙන',
  Mrigashira: 'මුවසිරස', Ardra: 'අද', Punarvasu: 'පුනාවස', Pushya: 'පුස',
  Ashlesha: 'අස්ලිය', Magha: 'මා', 'Purva Phalguni': 'පුවපල්', 'Uttara Phalguni': 'උත්තරපල්',
  Hasta: 'හත', Chitra: 'සිත', Swati: 'ස්වාති', Vishakha: 'විසා', Anuradha: 'අනුර',
  Jyeshtha: 'දෙට', Mula: 'මුල', 'Purva Ashadha': 'පුවසල', 'Uttara Ashadha': 'උත්තරසල',
  Shravana: 'සවණ', Dhanishtha: 'දෙනට', Shatabhisha: 'සියාවස',
  'Purva Bhadrapada': 'පුවපුටුප', 'Uttara Bhadrapada': 'උත්තරපුටුප', Revati: 'රේවතී',
};

async function getCachedTeaser(birthHash) {
  if (IS_PG) {
    const r = await pool.query('SELECT teaser_si FROM astro_cache WHERE birth_hash=$1', [birthHash]);
    return r.rows[0]?.teaser_si || null;
  }
  const row = db.prepare('SELECT teaser_si FROM astro_cache WHERE birth_hash=?').get(birthHash);
  return row?.teaser_si || null;
}

async function saveTeaser(birthHash, text) {
  if (IS_PG) {
    await pool.query('UPDATE astro_cache SET teaser_si=$1 WHERE birth_hash=$2', [text, birthHash]);
  } else {
    db.prepare('UPDATE astro_cache SET teaser_si=? WHERE birth_hash=?').run(text, birthHash);
  }
}

/** Find today's active Mahadasha/Antardasha lord from the API's vimshottari_dasha object. */
function findCurrentDasha(vimshottariDasha) {
  if (!vimshottariDasha) return null;
  const today = new Date().toISOString().slice(0, 10);
  const entries = Object.values(vimshottariDasha).filter(e => e && e.level === 'Mahadasha');
  const maha = entries.find(e => e.start <= today && today <= e.end);
  if (!maha) return null;
  const antar = (maha.sub_periods || []).find(s => s.start <= today && today <= s.end);
  return { mahadasha: maha.lord, antardasha: antar?.lord || null };
}

/** Simple, deterministic Kuja/Manglik dosha check: Mars in house 1, 4, 7, 8, or 12. */
function checkKujaDosha(marsHouse) {
  return [1, 4, 7, 8, 12].includes(Number(marsHouse));
}

/**
 * Extract a short list of grounded, real facts from the freeastroapi response
 * to hand to Gemini — the model must not invent anything beyond these.
 */
function buildFacts(chartData) {
  const root = chartData?.chart ?? chartData ?? {};
  const asc = root.ascendant ?? {};
  const planets = root.planets ?? [];
  const moon = planets.find(p => p.name === 'Moon');
  const mars = planets.find(p => p.name === 'Mars');
  const dasha = findCurrentDasha(chartData?.vimshottari_dasha);
  const kujaDosha = mars ? checkKujaDosha(mars.house) : false;

  const facts = [];
  if (asc.sign) facts.push(`Lagna (ascendant) rashi: ${RASHI_SI_BY_WESTERN[asc.sign] || asc.sign}`);
  if (moon?.sign) facts.push(`Moon rashi: ${RASHI_SI_BY_WESTERN[moon.sign] || moon.sign}`);
  if (moon?.nakshatra) facts.push(`Moon nakshatra: ${NAKSHATRA_SI[moon.nakshatra] || moon.nakshatra}`);
  if (dasha?.mahadasha) facts.push(`Current Mahadasha lord: ${PLANET_SI[dasha.mahadasha] || dasha.mahadasha}`);
  if (dasha?.antardasha) facts.push(`Current Antardasha lord: ${PLANET_SI[dasha.antardasha] || dasha.antardasha}`);
  if (kujaDosha) facts.push(`Kuja (Mars) dosha is present — Mars is placed in house ${mars.house} from the lagna.`);
  if (chartData?.sade_sati?.active) facts.push(`Sade Sati is currently active (phase: ${chartData.sade_sati.phase || 'unknown'}).`);

  return facts;
}

const PROMPT_TEMPLATE = `You are a respected, warm Sri Lankan Vedic astrologer speaking to a website visitor who just generated their free birth chart. Write a SHORT teaser (3-4 sentences, in Sinhala) that:
- References exactly 1-2 of the specific real facts listed below (do not invent anything not listed).
- Sounds personal and specific to this exact chart, not generic.
- Builds genuine curiosity or gentle concern about what this placement means for their life (career, marriage, finances, or obstacles — pick whichever fact is most striking).
- Explicitly does NOT explain the full meaning or give any remedy/solution — end with a line that creates a natural reason to get the full paid report for the complete analysis and remedy.
- Never mentions AI, computers, or that this was automatically generated.
- Do not use placeholder brackets or labels. Reply with ONLY the Sinhala teaser text, nothing else.

Real facts from this customer's chart:
{facts}`;

/**
 * Return a cached or freshly-generated teaser reading for this chart.
 * Costs one Gemini call the first time a birth_hash is seen; free after that.
 *
 * @param {Object} chartData - Full freeastroapi response (as returned by calculateVedicChart)
 * @param {string} birthHash - Same hash used by vedicChart's astro_cache row
 * @returns {Promise<string|null>} Teaser text, or null if generation isn't possible
 */
async function generateTeaserReading(chartData, birthHash) {
  const cached = await getCachedTeaser(birthHash);
  if (cached) return cached;

  const facts = buildFacts(chartData);
  if (!facts.length) return null;
  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const prompt = PROMPT_TEMPLATE.replace('{facts}', facts.map(f => `- ${f}`).join('\n'));
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (text) await saveTeaser(birthHash, text);
    return text || null;
  } catch (e) {
    console.error('[TEASER]', e.message);
    return null;
  }
}

module.exports = { generateTeaserReading };
