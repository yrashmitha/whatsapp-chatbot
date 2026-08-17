'use strict';

/**
 * @module services/chartTable
 * @description Renders a Sri Lankan birth chart (කේන්දර සටහන) as a native docx
 * table — a 4x4 grid with the middle 2x2 merged, matching the website's
 * SriLankanChartSVG component house-for-house.
 *
 * Why a table and not an image: docx's ImageRun requires a raster buffer (its
 * SVG mode still needs a PNG fallback), which would mean adding a native
 * rasteriser like sharp/canvas to this service purely to draw squares and
 * text. A table needs no new dependency, renders the Sinhala planet
 * abbreviations through the same bundled fonts LibreOffice already uses for
 * the rest of the document, and stays crisp and selectable in the final PDF
 * instead of being a flattened bitmap.
 */

let Table, TableRow, TableCell, Paragraph, TextRun, WidthType, AlignmentType, VerticalAlign, BorderStyle;
function ensureDocx() {
  if (!Table) {
    ({ Table, TableRow, TableCell, Paragraph, TextRun, WidthType, AlignmentType, VerticalAlign, BorderStyle } = require('docx'));
  }
}

/** Sinhala planet abbreviations — mirrors PLANET_ABBR_SI on the website. */
const PLANET_ABBR_SI = {
  Sun: 'සූ', Moon: 'චං', Mars: 'කු', Mercury: 'බු', Jupiter: 'ගු',
  Venus: 'ශු', Saturn: 'ශ', Rahu: 'රා', Ketu: 'කේ',
};

/**
 * House number -> [row, col] in the 4x4 grid, anti-clockwise.
 * Copied from SriLankanChartSVG's HOUSE_POSITIONS so both renderings agree.
 */
const HOUSE_POSITIONS = {
  1: [0, 2], 2: [0, 1], 3: [0, 0], 4: [1, 0],
  5: [2, 0], 6: [3, 0], 7: [3, 1], 8: [3, 2],
  9: [3, 3], 10: [2, 3], 11: [1, 3], 12: [0, 3],
};

const FONT = 'Abhaya Libre';
const CELL_PCT = 25;

/** Group a chart's planets by house number. */
function planetsByHouse(planets) {
  const byHouse = {};
  for (let i = 1; i <= 12; i++) byHouse[i] = [];
  if (!Array.isArray(planets)) return byHouse;
  for (const p of planets) {
    const house = Number(p?.house);
    if (!byHouse[house]) continue;
    const abbr = PLANET_ABBR_SI[p.name] || String(p.name || '').slice(0, 2);
    byHouse[house].push(p.is_retrograde ? `${abbr}(වක්‍ර)` : abbr);
  }
  return byHouse;
}

function textPara(text, opts = {}) {
  return new Paragraph({
    alignment: opts.alignment || AlignmentType.CENTER,
    spacing: { before: 20, after: 20 },
    children: [new TextRun({
      text,
      font: FONT,
      size: opts.size || 20,
      bold: !!opts.bold,
      color: opts.color,
    })],
  });
}

/** One house cell: small house number, then its planets. */
function houseCell(houseNum, planets, lagnaHouse) {
  const children = [
    textPara(String(houseNum) + (houseNum === lagnaHouse ? ' ල' : ''), {
      size: 14, color: '888888', alignment: AlignmentType.LEFT,
    }),
  ];
  children.push(textPara(planets.length ? planets.join('  ') : '', { size: 22, bold: true }));
  return new TableCell({
    width: { size: CELL_PCT, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    children,
  });
}

/** The merged 2x2 centre cell carrying the lagna label. */
function centreCell(label, subLabel) {
  const children = [textPara(label || '', { size: 24, bold: true })];
  if (subLabel) children.push(textPara(subLabel, { size: 16, color: '666666' }));
  return new TableCell({
    width: { size: CELL_PCT * 2, type: WidthType.PERCENTAGE },
    columnSpan: 2,
    rowSpan: 2,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    children,
  });
}

/**
 * Build the birth-chart table.
 *
 * @param {Object} chartData - the stored chart payload (v2 nests under .chart)
 * @param {string} [label]    - centre label, e.g. the lagna rashi in Sinhala
 * @param {string} [subLabel] - small line under the centre label
 * @returns {import('docx').Table}
 */
function buildChartTable(chartData, label, subLabel) {
  ensureDocx();
  const base = (chartData && chartData.chart) ? chartData.chart : (chartData || {});
  const byHouse = planetsByHouse(base.planets);
  // Ascendant always sits in house 1 in a whole-sign chart; marked with "ල".
  const lagnaHouse = 1;

  /** House number occupying a given grid position. */
  const at = (row, col) => {
    for (const [num, pos] of Object.entries(HOUSE_POSITIONS)) {
      if (pos[0] === row && pos[1] === col) return Number(num);
    }
    return null;
  };
  const cellAt = (row, col) => {
    const h = at(row, col);
    return houseCell(h, byHouse[h] || [], lagnaHouse);
  };

  const rows = [
    // Top row: houses 3, 2, 1, 12
    new TableRow({ children: [cellAt(0, 0), cellAt(0, 1), cellAt(0, 2), cellAt(0, 3)] }),
    // Second row: house 4, merged centre (spans 2x2), house 11
    new TableRow({ children: [cellAt(1, 0), centreCell(label, subLabel), cellAt(1, 3)] }),
    // Third row: house 5, (centre continues via rowSpan), house 10
    new TableRow({ children: [cellAt(2, 0), cellAt(2, 3)] }),
    // Bottom row: houses 6, 7, 8, 9
    new TableRow({ children: [cellAt(3, 0), cellAt(3, 1), cellAt(3, 2), cellAt(3, 3)] }),
  ];

  const border = { style: BorderStyle.SINGLE, size: 6, color: 'B8853A' };
  return new Table({
    width: { size: 80, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
    borders: {
      top: border, bottom: border, left: border, right: border,
      insideHorizontal: border, insideVertical: border,
    },
    rows,
  });
}

module.exports = { buildChartTable, planetsByHouse, HOUSE_POSITIONS, PLANET_ABBR_SI };
