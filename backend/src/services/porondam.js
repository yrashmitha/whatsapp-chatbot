'use strict';

/**
 * @module services/porondam
 * @description Sri Lankan 20-Porondam calculator — a direct port of the
 * website's `frontend/src/lib/astro/porondam.ts` (plus its Sinhala
 * descriptions from `porondamDescriptions.ts`), kept here so a paid porondam
 * report can be produced entirely in-process.
 *
 * Why a port and not an HTTP call to the site: this backend is already the
 * source of the chart data the site itself uses (it serves /public/chart), and
 * every order already has both people's chart_data stored on it. Calling the
 * website would mean this service asking the site to ask this service back for
 * the charts, purely to run a pure function over four integers.
 *
 * KEEP IN SYNC with frontend/src/lib/astro/porondam.ts in the pahantharu_web
 * repo. The logic is classical and effectively fixed, but if either side is
 * ever corrected the other must be updated or the same couple will get two
 * different scores. There is a fixture test for this in
 * scripts/verify-porondam.js.
 */

/**
 * Sri Lankan 20 Porondam Calculator - Logic Corrected
 *
 * Each Porondam scores exactly 0 or 1 (binary match/no-match).
 * Total maximum = 20 points.
 *
 * Inputs: Boy's and Girl's Nakshatra index (0–26) and Rashi index (0–11).
 */

// ─── Interfaces (Exactly as original) ─────────────────────────────────────────



// ─── Core Data Arrays (Corrected for Sri Lankan Logic) ────────────────────────

// Gana: 0=Deva, 1=Manushya, 2=Rakshasa
const GANA = [
  0, 1, 2, 1, 0, 1, 0, 0, 2,  // Ashwini → Ashlesha
  2, 1, 1, 0, 1, 2, 2, 0, 2,  // Magha → Jyeshtha
  2, 1, 1, 0, 2, 2, 1, 1, 0,  // Mula → Revati
];

// Rajju: 0=Pada, 1=Kati, 2=Nabhi, 3=Kantha, 4=Sira
const RAJJU = [
  0, 1, 2, 3, 4, 3, 2, 1, 0,
  0, 1, 2, 3, 4, 3, 2, 1, 0,
  0, 1, 2, 3, 4, 3, 2, 1, 0,
];

// Nadi: 0=Aadi, 1=Madhya, 2=Antya (Corrected snake pattern)
const NADI = [
  0, 1, 2, 2, 1, 0, 0, 1, 2,
  2, 1, 0, 0, 1, 2, 2, 1, 0,
  0, 1, 2, 2, 1, 0, 0, 1, 2,
];

// Vruksha (Tree type): 1=Kiri (Milky), 0=Niri (Non-Milky)
const VRUKSHA = [
  1, 1, 0, 1, 0, 0, 1, 1, 0,  
  0, 1, 1, 0, 0, 0, 1, 1, 1,  
  0, 0, 1, 1, 0, 0, 0, 1, 1,  
];

// Corrected Vedha Pairs (Sri Lankan standard)
const VEDHA_PAIRS = [
  [0, 26], [1, 25], [2, 24], [3, 23],
  [4, 22], [5, 21], [6, 20], [7, 19],
  [8, 18], [10, 16], [11, 15], [12, 14]
];

// Yoni enemy pairs
const YONI_ENEMY_PAIRS = [
  [0, 24], [1, 25], [2, 26],
  [3, 15], [4, 16], [5, 17], [6, 18],
];

// Rashi lord mapping
const RASHI_LORD = [0, 1, 2, 3, 4, 2, 1, 0, 5, 6, 6, 5];


const VASIYA = {
  0:  [3, 7],    1:  [3, 5],    2:  [5, 8],    3:  [10, 11],
  4:  [0, 7],    5:  [5, 10],   6:  [5, 9],    7:  [3, 11],
  8:  [0, 9],    9:  [0, 6],    10: [0, 8],    11: [3, 9],
};

// Yoni, Bhootha, Varna added for actual 20 porondam logic
const YONI = [
  0, 1, 2, 3, 3, 4, 5, 2, 5, 6, 6, 7, 8, 9, 9, 9, 10, 10, 4, 11, 12, 11, 13, 0, 13, 7, 1
];
const BHOOTHA = [
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4
];
const VARNA = [1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0];

// Display Labels
const GANA_SI   = ['දේව', 'මනුෂ්‍ය', 'රාක්ෂ'];
const RAJJU_SI  = ['පාද', 'කටි', 'නාභි', 'කණ්ඨ', 'සිරස'];
const NADI_SI   = ['ආදි', 'මධ්‍ය', 'අන්ත'];

// ─── Helpers (Exactly as original) ───────────────────────────────────────────

function getNakshatraIndex(moonLon) {
  moonLon = ((moonLon % 360) + 360) % 360;
  return Math.floor((moonLon * 27) / 360) % 27;
}

function getRashiIndex(moonLon) {
  moonLon = ((moonLon % 360) + 360) % 360;
  return Math.floor(moonLon / 30);
}

function getGanaSinhala(moonLon) {
  const idx = getNakshatraIndex(moonLon);
  return GANA_SI[GANA[idx]];
}

function hasVedha(nak1, nak2) {
  return VEDHA_PAIRS.some(
    ([a, b]) => (nak1 === a && nak2 === b) || (nak1 === b && nak2 === a)
  );
}

function hasYoniEnemy(nak1, nak2) {
  return YONI_ENEMY_PAIRS.some(
    ([a, b]) => (nak1 === a && nak2 === b) || (nak1 === b && nak2 === a)
  );
}

// ─── Main Calculator (Signature Kept Intact) ─────────────────────────────────

function calculate20Porondam(
  boyNak,
  girlNak,
  boyRashi,
  girlRashi,
) {

  const factors = [];
  const criticalDosha = [];

  const nak_count = (boyNak - girlNak + 27) % 27 + 1;
  const nak_dist  = (boyNak - girlNak + 27) % 27;
  const rashi_count = (boyRashi - girlRashi + 12) % 12 + 1;

  // 1. Nakshatra
  const dinam_match = [0, 2, 4, 6, 8].includes(nak_count % 9);
  factors.push({ id: 1, name_en: 'Nakshatra', name_si: 'නකත', score: dinam_match ? 1 : 0, max_score: 1, matched: dinam_match, explanation: `නකත් දුර: ${nak_count}`, critical_dosha: false });

  // 2. Gana
  const gana_match = GANA[boyNak] === GANA[girlNak] || (GANA[boyNak] === 0 && GANA[girlNak] === 1);
  factors.push({ id: 2, name_en: 'Gana', name_si: 'ගණ', score: gana_match ? 1 : 0, max_score: 1, matched: gana_match, explanation: `පිරිමි: ${GANA_SI[GANA[boyNak]]}, ගැහැනු: ${GANA_SI[GANA[girlNak]]}`, critical_dosha: false });

  // 3. Mahendra
  const mahendra_match = [4, 7, 10, 13, 16, 19, 22, 25].includes(nak_count);
  factors.push({ id: 3, name_en: 'Mahendra', name_si: 'මහේන්ද්‍ර', score: mahendra_match ? 1 : 0, max_score: 1, matched: mahendra_match, explanation: `නකත් දුර: ${nak_count}`, critical_dosha: false });

  // 4. Stree Deergha
  const stree_match = nak_dist > 13;
  factors.push({ id: 4, name_en: 'Stree Deergha', name_si: 'ස්ත්‍රී දීර්ඝ', score: stree_match ? 1 : 0, max_score: 1, matched: stree_match, explanation: `දුර: ${nak_dist}`, critical_dosha: false });

  // 5. Yoni
  const yoni_enemy = hasYoniEnemy(boyNak, girlNak);
  const yoni_match = YONI[boyNak] === YONI[girlNak] || !yoni_enemy;
  factors.push({ id: 5, name_en: 'Yoni', name_si: 'යෝනි', score: yoni_match ? 1 : 0, max_score: 1, matched: yoni_match, explanation: yoni_match ? 'යෝනි සංගත' : 'සතුරු යෝනි', critical_dosha: false });

  // 6. Rashi
  const rashi_match = ![2, 3, 4, 5, 6].includes(rashi_count);
  factors.push({ id: 6, name_en: 'Rashi', name_si: 'රාශි', score: rashi_match ? 1 : 0, max_score: 1, matched: rashi_match, explanation: `රාශි දුර: ${rashi_count}`, critical_dosha: false });

  // 7. Rashi Adhipathi (Replaced with genuine porondam logic mapping)
  const lord_match = RASHI_LORD[boyRashi] === RASHI_LORD[girlRashi];
  factors.push({ id: 7, name_en: 'Rashi Adhipathi', name_si: 'රාශ්‍යාධිපති', score: lord_match ? 1 : 0, max_score: 1, matched: lord_match, explanation: lord_match ? 'මිත්‍ර' : 'අමිත්‍ර', critical_dosha: false });

  // 8. Vashya
  const vasiya_match = (VASIYA[boyRashi] ?? []).includes(girlRashi);
  factors.push({ id: 8, name_en: 'Vasiyam', name_si: 'වශ්‍ය', score: vasiya_match ? 1 : 0, max_score: 1, matched: vasiya_match, explanation: vasiya_match ? 'වශී' : 'වශ්‍ය නොමැත', critical_dosha: false });

  // 9. Rajju
  const rajju_match = RAJJU[boyNak] !== RAJJU[girlNak];
  if (!rajju_match) criticalDosha.push(`රජ්ජු දොෂය: දෙදෙනාම ${RAJJU_SI[RAJJU[boyNak]]}`);
  factors.push({ id: 9, name_en: 'Rajju', name_si: 'රජ්ජු', score: rajju_match ? 1 : 0, max_score: 1, matched: rajju_match, explanation: rajju_match ? 'සංගත' : 'රජ්ජු දොෂය', critical_dosha: !rajju_match });

  // 10. Vedha
  const vedha_present = hasVedha(boyNak, girlNak);
  if (vedha_present) criticalDosha.push('වේධ දොෂය');
  factors.push({ id: 10, name_en: 'Vedha', name_si: 'වේධ', score: vedha_present ? 0 : 1, max_score: 1, matched: !vedha_present, explanation: vedha_present ? 'වේධ දොෂය' : 'වේධ නොමැත', critical_dosha: vedha_present });

  // 11. Vruksha
  const vruksha_match = !(VRUKSHA[girlNak] === 0 && VRUKSHA[boyNak] === 1);
  factors.push({ id: 11, name_en: 'Vruksha', name_si: 'වෘක්ෂ', score: vruksha_match ? 1 : 0, max_score: 1, matched: vruksha_match, explanation: vruksha_match ? 'සංගත' : 'නොගැළපේ', critical_dosha: false });

  // 12. Ayusha
  const ayul_match = [4, 7, 10, 13, 16, 19, 22, 25].includes(nak_dist + 1);
  factors.push({ id: 12, name_en: 'Ayusha', name_si: 'ආයුෂ', score: ayul_match ? 1 : 0, max_score: 1, matched: ayul_match, explanation: ayul_match ? 'සංගත' : 'ආයුෂ හීන', critical_dosha: false });

  // 13. Pakshi
  const pakshi_match = (boyNak % 5) === (girlNak % 5);
  factors.push({ id: 13, name_en: 'Pakshi', name_si: 'පක්ෂි', score: pakshi_match ? 1 : 0, max_score: 1, matched: pakshi_match, explanation: pakshi_match ? 'සංගත' : 'නොගැළපේ', critical_dosha: false });

  // 14. Bhootha
  const bhootha_match = BHOOTHA[boyNak] === BHOOTHA[girlNak];
  factors.push({ id: 14, name_en: 'Bhootha', name_si: 'භූත', score: bhootha_match ? 1 : 0, max_score: 1, matched: bhootha_match, explanation: bhootha_match ? 'සංගත' : 'නොගැළපේ', critical_dosha: false });

  // 15. Gothra
  const gothra_match = boyNak % 4 !== girlNak % 4;
  factors.push({ id: 15, name_en: 'Gothra', name_si: 'ගෝත්‍ර', score: gothra_match ? 1 : 0, max_score: 1, matched: gothra_match, explanation: gothra_match ? 'සංගත' : 'නොගැළපේ', critical_dosha: false });

  // 16. Varna
  const varna_match = VARNA[boyRashi] <= VARNA[girlRashi];
  factors.push({ id: 16, name_en: 'Varna', name_si: 'වර්ණ', score: varna_match ? 1 : 0, max_score: 1, matched: varna_match, explanation: varna_match ? 'සංගත' : 'නොගැළපේ', critical_dosha: false });

  // 17. Nadi
  const nadi_match = NADI[boyNak] !== NADI[girlNak];
  if (!nadi_match) criticalDosha.push(`නාඩි දොෂය: දෙදෙනාම ${NADI_SI[NADI[boyNak]]}`);
  factors.push({ id: 17, name_en: 'Nadi', name_si: 'නාඩි', score: nadi_match ? 1 : 0, max_score: 1, matched: nadi_match, explanation: nadi_match ? 'සංගත' : 'නාඩි දොෂය', critical_dosha: !nadi_match });

  // 18. Linga
  const linga_match = boyNak % 2 !== girlNak % 2;
  factors.push({ id: 18, name_en: 'Linga', name_si: 'ලිංග', score: linga_match ? 1 : 0, max_score: 1, matched: linga_match, explanation: linga_match ? 'සංගත' : 'නොගැළපේ', critical_dosha: false });

  // 19. Varga
  const varga_match = Math.abs(boyNak - girlNak) > 2;
  factors.push({ id: 19, name_en: 'Varga', name_si: 'වර්ග', score: varga_match ? 1 : 0, max_score: 1, matched: varga_match, explanation: varga_match ? 'සංගත' : 'නොගැළපේ', critical_dosha: false });

  // 20. Dina
  const dina_match = [0, 2, 4, 6, 8].includes(nak_dist % 9);
  factors.push({ id: 20, name_en: 'Dina', name_si: 'දින', score: dina_match ? 1 : 0, max_score: 1, matched: dina_match, explanation: dina_match ? 'සංගත' : 'නොගැළපේ', critical_dosha: false });

  // Totals
  const total_score = factors.reduce((sum, f) => sum + f.score, 0);

  return {
    factors,
    total_score,
    max_score: 20,
    compatibility_percent: Math.round((total_score / 20) * 100),
    critical_dosha: criticalDosha,
  };
}
const POROONDAM_DESCRIPTIONS = {
  Nakshatra: 'දෙදෙනාගේ ආයුෂ, සෞඛ්‍යය, ශරීර සුවතාව සහ සිතුම් පැතුම්වල ගැලපීම පරීක්ෂා කරයි.',
  Gana: 'දෙදෙනාගේ ගතිපැවතුම්, චරිත ස්වභාවය සහ කෝපය පාලනය (දේව, මනුෂ්‍ය, රාක්ෂ) ගැලපේදැයි බලයි.',
  Mahendra: 'දරු සම්පත් ලැබීම, සෞභාග්‍යය සහ විවාහයේ දීර්ඝකාලීන පැවැත්ම තීරණය කරයි.',
  'Stree Deergha': 'සැමියාගෙන් බිරිඳට ලැබෙන ආදරය, සෙනෙහස, සැලකිල්ල සහ ආරක්ෂාව පෙන්වයි.',
  Yoni: 'ලිංගික ගැලපීම, ශාරීරික ආකර්ෂණය සහ එකිනෙකා කෙරෙහි ඇති වෙන සරාගී බැඳීම තීරණය කරයි.',
  Rashi: 'මානසික එකඟතාව, එකිනෙකා තේරුම් ගැනීම සහ පවුල් ජීවිතයේ සමගිය/සතුට පරීක්ෂා කරයි.',
  'Rashi Adhipathi': 'ලග්නාධිපතියන් අතර මිත්‍රත්වය මඟින් දීර්ඝකාලීන හිතවත්කම සහ සහයෝගය බලයි.',
  Vasiyam: 'එකිනෙකා කෙරෙහි ඇති වෙන ආකර්ෂණය, නම්‍යශීලී බව සහ අවනත වීමේ ස්වභාවය පෙන්වයි.',
  Rajju: 'අඹු-සැමි සබඳතාවයේ පැවැත්ම, වැන්දඹු නොවීම සහ සැමියාගේ ආයු බලය පිළිබඳව කියවේ.',
  Vedha: 'විවාහ ජීවිතයට එන බාධා, දුක් කරදර, අකරතැබ්බ සහ ගැටුම් මඟහැරීම පරීක්ෂා කරයි.',
  Vruksha: 'පරම්පරාවේ පැවැත්ම, දරු මුනුබුරන් සම්පත සහ වංශයේ සශ්‍රීකත්වය පිළිබඳ ඇඟවීමකි.',
  Ayusha: 'දෙදෙනාගේ ආයුෂ ප්‍රමාණය සහ ආයු බලයේ පවතින සමබරතාව බලයි.',
  Pakshi: 'දෙදෙනාගේ උද්‍යෝගය, ක්‍රියාශීලී බව සහ එකට එකතුව වැඩ කිරීමේ හැකියාව පෙන්වයි.',
  Bhootha: 'මහා භූත (පඨවි, ආපෝ, තේජෝ, වායෝ, ආකාශ) ගැලපීම මඟින් මානසික හා ශාරීරික ස්වභාවය බලයි.',
  Gothra: 'දෙදෙනාගේ පෙළපත් (ගෝත්‍ර) සමානත්වය පරීක්ෂා කර, අති සමීප ගෝත්‍ර ගැලපීමකින් ඇතිවිය හැකි පාරම්පරික අවාසි මඟහරවා ගැනීමට උපකාරී වේ.',
  Varna: 'සිතිවිලි මට්ටම, බුද්ධිමය ගැලපීම සහ සමාජීය චින්තනයේ සමානතාව පෙන්වයි.',
  Nadi: 'ජානමය/ලෙයින් එන ගැලපීම සහ ලැබෙන දරුවන්ගේ නිරෝගීභාවය තීරණය කරයි.',
  Linga: 'ස්ත්‍රී/පුරුෂ ස්වාභාවික ගැලපීම සහ අඹුසැමි සබඳතාවයේ ප්‍රේමනීය සමබරතාව පරීක්ෂා කරයි.',
  Varga: 'දෙදෙනාගේ පවුල් පසුබිම, පරිසරය සහ සමාජීය තත්ත්වයේ ගැලපීම පරීක්ෂා කරයි.',
  Dina: 'උපන් දින හෝ දින නැකැත් ගැලපීමෙන් එදිනෙදා ජීවිතයේ සතුට, වාසනාව හා සුබතාව බලයි.',
};

module.exports = { calculate20Porondam, getNakshatraIndex, getRashiIndex, getGanaSinhala, POROONDAM_DESCRIPTIONS };
