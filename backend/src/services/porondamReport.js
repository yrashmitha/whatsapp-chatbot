'use strict';

/**
 * @module services/porondamReport
 * @description Full 20-Porondam (විසි පොරොන්දම්) report document builder.
 *
 * Everything is computed in-process: the porondam calculation is a pure
 * function over four integers (see services/porondam.js), and both people's
 * charts are already stored on the order by the time a report is requested.
 * No network call is involved — this service is itself the origin of the chart
 * data the website consumes, so asking the website to compute this would mean
 * calling out only to be called straight back for the charts.
 *
 * The document includes both birth charts as native docx tables (see
 * services/chartTable.js), matching what the website's PDF shows.
 *
 * All 20 factors are always included. The 8-free/12-paid split exists only to
 * gate the website's free preview; every order reaching this code is paid.
 */

const { buildSectionsDoc } = require('./horoscope');
const { calculate20Porondam, getNakshatraIndex, getRashiIndex, POROONDAM_DESCRIPTIONS } = require('./porondam');
const { buildChartTable } = require('./chartTable');

const PORONDAM_REPORT_TITLE = 'විසි පොරොන්දම් සම්පූර්ණ වාර්තාව';

/** Sanskrit rashi names by index — the Sinhala map is keyed on these. */
const RASHIS_EN = [
  'Mesha', 'Vrishabha', 'Mithuna', 'Kataka', 'Simha', 'Kanya',
  'Tula', 'Vrischika', 'Dhanu', 'Makara', 'Kumbha', 'Meena',
];

const RASHI_SI = {
  Mesha: 'මේෂ', Vrishabha: 'වෘෂභ', Mithuna: 'මිථුන', Kataka: 'කටක',
  Simha: 'සිංහ', Kanya: 'කන්‍යා', Tula: 'තුලා', Vrischika: 'වෘශ්චික',
  Dhanu: 'ධනු', Makara: 'මකර', Kumbha: 'කුම්භ', Meena: 'මීන',
};

/** Western sign name -> Sinhala, since the chart API reports Western names. */
const WESTERN_TO_RASHI = {
  Aries: 'Mesha', Taurus: 'Vrishabha', Gemini: 'Mithuna', Cancer: 'Kataka',
  Leo: 'Simha', Virgo: 'Kanya', Libra: 'Tula', Scorpio: 'Vrischika',
  Sagittarius: 'Dhanu', Capricorn: 'Makara', Aquarius: 'Kumbha', Pisces: 'Meena',
};

/** Unwrap the base chart — v2 nests it under `.chart`, v1 returned it flat. */
function baseChart(chartData) {
  if (!chartData) return {};
  return chartData.chart || chartData;
}

/** Moon's absolute ecliptic longitude from a stored chart, or null. */
function moonLongitude(chartData) {
  const planets = baseChart(chartData).planets;
  const moon = Array.isArray(planets) ? planets.find((p) => p.name === 'Moon') : null;
  const deg = moon && moon.absolute_degree;
  return typeof deg === 'number' ? deg : null;
}

/**
 * Ascendant as a Sinhala rashi name. Resolved from sign_id where available
 * (most reliable), falling back to translating the Western sign name.
 */
function lagnaSinhala(chartData) {
  const asc = baseChart(chartData).ascendant;
  if (!asc) return null;
  const signId = Number(asc.sign_id);
  if (Number.isFinite(signId) && signId >= 1 && signId <= 12) {
    return RASHI_SI[RASHIS_EN[(signId - 1) % 12]] || null;
  }
  const sanskrit = WESTERN_TO_RASHI[asc.sign];
  return sanskrit ? RASHI_SI[sanskrit] : null;
}

/** One person's identifying line for the document subtitle. */
function personLine(person, chartData) {
  const bits = [person && person.name].filter(Boolean);
  const lagna = lagnaSinhala(chartData);
  if (lagna) bits.push(`${lagna} ලග්නය`);
  return bits.join(' · ');
}

/**
 * Compute the full porondam result for a couple from their stored charts.
 *
 * @param {Object} boyChart  - match_boy.chart_data
 * @param {Object} girlChart - match_girl.chart_data
 * @returns {Object} calculate20Porondam result, with description_si per factor
 */
function computePorondam(boyChart, girlChart) {
  const boyLon = moonLongitude(boyChart);
  const girlLon = moonLongitude(girlChart);
  if (boyLon == null || girlLon == null) {
    const e = new Error('චන්ද්‍රයාගේ පිහිටීම ග්‍රහ දත්තවල නොමැත');
    e.status = 400;
    throw e;
  }
  const result = calculate20Porondam(
    getNakshatraIndex(boyLon),
    getNakshatraIndex(girlLon),
    getRashiIndex(boyLon),
    getRashiIndex(girlLon),
  );
  return {
    ...result,
    factors: result.factors.map((f) => ({
      ...f,
      description_si: POROONDAM_DESCRIPTIONS[f.name_en] || f.explanation,
    })),
  };
}

/**
 * Turn a porondam result into buildSectionsDoc sections.
 * Pure, so the formatting can be checked without docx or LibreOffice.
 */
function buildPorondamSections(porondam, boy, girl, boyChart, girlChart) {
  const sections = [];

  sections.push({
    label: 'සාරාංශය',
    content: [
      `${(boy && boy.name) || 'මනාලයා'} සහ ${(girl && girl.name) || 'මනාලිය'} යන දෙදෙනාගේ විසි පොරොන්දම් සම්පූර්ණයෙන් පරීක්ෂා කර ඇත.`,
      '',
      `මනාලයා: ${personLine(boy, boyChart) || '-'}`,
      `මනාලිය: ${personLine(girl, girlChart) || '-'}`,
      '',
      `සමස්ත ලකුණු: ${porondam.total_score} / ${porondam.max_score} (${porondam.compatibility_percent}%)`,
    ].join('\n'),
  });

  sections.push({
    label: 'පොරොන්දම් 20 හි සම්පූර්ණ විස්තරය',
    content: porondam.factors.map((f) => {
      const verdict = f.matched ? 'ගැලපේ' : 'නොගැලපේ';
      const dosha = f.critical_dosha ? ' (දෝෂය)' : '';
      return `${f.id}. ${f.name_si} — ${f.score}/${f.max_score} — ${verdict}${dosha}\n${f.description_si || ''}`;
    }).join('\n\n'),
  });

  // Only shown when there is something to warn about, so a clean chart
  // doesn't get an alarming empty heading.
  if (Array.isArray(porondam.critical_dosha) && porondam.critical_dosha.length) {
    sections.push({
      label: 'විශේෂයෙන් සැලකිය යුතු දෝෂ',
      content: porondam.critical_dosha.map((d) => `• ${d}`).join('\n'),
    });
  }

  return sections;
}

/**
 * Build the porondam .docx for a couple.
 *
 * @param {Object} boy       - { name, ... } from match_boy
 * @param {Object} girl      - { name, ... } from match_girl
 * @param {Object} boyChart  - match_boy.chart_data
 * @param {Object} girlChart - match_girl.chart_data
 * @param {string} [specialNote]
 * @returns {Promise<Buffer>} docx buffer
 */
async function buildPorondamDoc(boy, girl, boyChart, girlChart, specialNote, brand) {
  const porondam = computePorondam(boyChart, girlChart);
  const sections = buildPorondamSections(porondam, boy, girl, boyChart, girlChart);

  // Both birth charts, rendered as native docx tables and appended after the
  // written sections (same content the website's PDF shows).
  const extraBlocks = [
    { heading: `${(boy && boy.name) || 'මනාලයා'} — ලග්න කේන්දරය`, table: buildChartTable(boyChart, lagnaSinhala(boyChart), 'ලග්නය', brand?.font) },
    { heading: `${(girl && girl.name) || 'මනාලිය'} — ලග්න කේන්දරය`, table: buildChartTable(girlChart, lagnaSinhala(girlChart), 'ලග්නය', brand?.font) },
  ];

  return buildSectionsDoc({
    brand,
    customerName: [boy && boy.name, girl && girl.name].filter(Boolean).join(' ⚭ ') || 'ගැළපීම',
    reportTitle: PORONDAM_REPORT_TITLE,
    sections,
    specialNote: specialNote || undefined,
    subtitleLines: [personLine(boy, boyChart), '⚭', personLine(girl, girlChart)].filter(Boolean),
    extraBlocks,
  });
}

module.exports = {
  computePorondam,
  buildPorondamSections,
  buildPorondamDoc,
  lagnaSinhala,
  moonLongitude,
  PORONDAM_REPORT_TITLE,
};
