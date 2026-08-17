'use strict';

/**
 * Fixture check for services/porondam.js — the port of the pahantharu_web
 * website's 20-Porondam calculator.
 *
 * The two implementations must stay in lockstep: if they drift, the same
 * couple gets one score on the website and a different one in their paid PDF.
 * The fixture below was captured from the website's own calculation, so a
 * failure here means the port and the site no longer agree.
 *
 * Run: node scripts/verify-porondam.js
 */

const assert = require('assert');
const { calculate20Porondam, getNakshatraIndex, getRashiIndex } = require('../src/services/porondam');

/**
 * Captured from the live website for:
 *   boy  1990-05-15 08:30 Colombo — Moon: Uttara Ashadha (20) in Dhanu (8)
 *   girl 1992-11-02 14:10 Kandy   — Moon: Shravana (21) in Makara (9)
 */
const FIXTURE = {
  input: { boyNak: 20, girlNak: 21, boyRashi: 8, girlRashi: 9 },
  total_score: 13,
  max_score: 20,
  compatibility_percent: 65,
  critical_dosha: ['නාඩි දොෂය: දෙදෙනාම අන්ත'],
  // id -> [score, matched, critical_dosha]
  factors: {
    1: [1, true, false],   2: [0, false, false],  3: [0, false, false],  4: [1, true, false],
    5: [1, true, false],   6: [1, true, false],   7: [0, false, false],  8: [1, true, false],
    9: [1, true, false],  10: [1, true, false],  11: [1, true, false],  12: [0, false, false],
    13: [0, false, false], 14: [1, true, false], 15: [1, true, false],  16: [1, true, false],
    17: [0, false, true],  18: [1, true, false], 19: [0, false, false], 20: [1, true, false],
  },
};

const { boyNak, girlNak, boyRashi, girlRashi } = FIXTURE.input;
const result = calculate20Porondam(boyNak, girlNak, boyRashi, girlRashi);

assert.strictEqual(result.factors.length, 20, 'expected exactly 20 factors');
assert.strictEqual(result.total_score, FIXTURE.total_score, 'total_score drifted from the website');
assert.strictEqual(result.max_score, FIXTURE.max_score, 'max_score drifted');
assert.strictEqual(result.compatibility_percent, FIXTURE.compatibility_percent, 'percentage drifted');
assert.deepStrictEqual(result.critical_dosha, FIXTURE.critical_dosha, 'critical dosha list drifted');

for (const f of result.factors) {
  const expected = FIXTURE.factors[f.id];
  assert.ok(expected, `unexpected factor id ${f.id}`);
  const [score, matched, critical] = expected;
  assert.strictEqual(f.score, score, `factor ${f.id} (${f.name_en}) score drifted`);
  assert.strictEqual(f.matched, matched, `factor ${f.id} (${f.name_en}) matched drifted`);
  assert.strictEqual(f.critical_dosha, critical, `factor ${f.id} (${f.name_en}) critical_dosha drifted`);
}

// Index helpers: longitude -> nakshatra/rashi, including wrap-around.
assert.strictEqual(getNakshatraIndex(0), 0);
assert.strictEqual(getRashiIndex(0), 0);
assert.strictEqual(getRashiIndex(359.99), 11);
assert.strictEqual(getRashiIndex(-30), 11, 'negative longitudes must normalise');
assert.strictEqual(getNakshatraIndex(360), 0, 'longitudes >= 360 must wrap');

// Score can never fall outside 0..20 for any valid input pair.
for (let bn = 0; bn < 27; bn += 4) {
  for (let gn = 0; gn < 27; gn += 4) {
    for (let br = 0; br < 12; br += 3) {
      for (let gr = 0; gr < 12; gr += 3) {
        const r = calculate20Porondam(bn, gn, br, gr);
        assert.ok(r.total_score >= 0 && r.total_score <= 20, `total out of range for ${bn},${gn},${br},${gr}`);
        assert.strictEqual(r.factors.length, 20, `factor count wrong for ${bn},${gn},${br},${gr}`);
      }
    }
  }
}

console.log('verify-porondam: OK — matches the website fixture, all 20 factors.');
