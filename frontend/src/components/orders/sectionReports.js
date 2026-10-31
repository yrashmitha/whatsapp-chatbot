/**
 * Shared definitions for the reports that are built like the marriage report:
 * one person's chart, configurable sections, the customer's own questions, a
 * Word/PDF document and a WhatsApp message. Abroad and pregnancy today.
 *
 * The backend counterpart is services/sectionReport.js. A new kind needs an
 * entry there and one here; every screen reads this file.
 */

export const SECTION_KINDS = {
  abroad: {
    key: 'abroad',
    emoji: '✈️',
    name: 'Abroad',
    tabLabel: '✈️ Abroad',
    heading: 'Generate Abroad Report',
    editorTitle: 'Abroad Report',
    accent: '#0284c7',
    accentSoft: '#e0f2fe',
    accentBorder: '#bae6fd',
    accentText: '#075985',
    // Product names that suggest an order is for this report, so its row shows
    // in the order drawer before anything has been generated.
    productHint: /විදේශ|abroad|foreign/i,
    questionHint: 'Reads the birth details and the customer\'s own questions about going abroad out of the WhatsApp thread. Always check them before Check Lagna.',
    questionsIntro: 'The customer\'s own questions about going abroad. Each gets its own answer after the main sections.',
    suggestedSections: [
      { label: 'විදේශගත වීමේ යෝගය',
        guide: 'ජන්ම කේන්ද්‍රයේ තුන්වන, හතරවන, නවවන සහ දොළොස්වන භාව සහ ඒවායේ අධිපතීන් පරීක්ෂා කර, විදේශගත වීමේ සම්භාවිතාව පැහැදිලිව පවසන්න. රාහු සහ කේතු බලපෑම ද සඳහන් කරන්න.' },
      { label: 'ගැලපෙන රටවල් සහ දිශාවන්',
        guide: 'දෙවන, නවවන සහ දොළොස්වන භාවාධිපතීන්ගේ රාශි අනුව ගැලපෙන දිශාව සහ රටවල් වර්ග සඳහන් කරන්න. නිශ්චිත රටක් පවසන විට කේන්ද්‍ර සාක්ෂි දක්වන්න.' },
      { label: 'ගමන් කාලය (දශා සහ ගෝචර)',
        guide: 'වත්මන් සහ ඉදිරි දශා, අන්තර්දශා සහ ගෝචර අනුව විදෙස් ගමනට හිතකර වසර සහ කාල වකවානු පැහැදිලිව ලබා දෙන්න.' },
      { label: 'රැකියා, අධ්‍යාපන සහ ව්‍යාපාර අවස්ථා',
        guide: 'විදෙස් රැකියාව, උසස් අධ්‍යාපනය හෝ ව්‍යාපාරය යන කුමන මාර්ගය වඩාත් ගැලපේදැයි කේන්ද්‍රයෙන් පෙන්වා දෙන්න.' },
      { label: 'බාධක සහ වීසා ගැටලු',
        guide: 'ගමනට බාධා කළ හැකි ග්‍රහ බලපෑම්, ප්‍රමාද සහ ප්‍රතික්ෂේප වීම් ඇතිවිය හැකි කාලවකවානු සහ ඒවා මඟහරවා ගන්නා ආකාරය පවසන්න.' },
      { label: 'විදෙස් ජීවිතය, මුදල් සහ ආරක්ෂාව',
        guide: 'විදේශයේ ජීවිතයේ සුවය, මුදල් ඉපැයීම, සෞඛ්‍යය සහ ආරක්ෂාව පිළිබඳ කේන්ද්‍ර දර්ශනය ලබා දෙන්න.' },
      { label: 'ස්ථිර පදිංචිය හෝ නැවත පැමිණීම',
        guide: 'විදේශයේ ස්ථිරව පදිංචි වීමට හෝ නැවත මව්බිමට පැමිණීමට ඇති ඉඩකඩ සහ කාලය පවසන්න.' },
      { label: 'පිළියම් සහ ශාන්තිකර්ම',
        guide: 'විදෙස් ගමනට උපකාර වන සරල, ප්‍රායෝගික පිළියම් සහ ශාන්තිකර්ම දක්වන්න.' },
    ],
  },
  pregnancy: {
    key: 'pregnancy',
    emoji: '🤰',
    name: 'Pregnancy',
    tabLabel: '🤰 Pregnancy',
    heading: 'Generate Pregnancy Report',
    editorTitle: 'Pregnancy Report',
    accent: '#a21caf',
    accentSoft: '#fae8ff',
    accentBorder: '#f0abfc',
    accentText: '#86198f',
    productHint: /දරු|ගර්භ|pregnan|child/i,
    questionHint: 'Reads the birth details of the woman and the customer\'s own questions about children out of the WhatsApp thread. Always check them before Check Lagna.',
    questionsIntro: 'The customer\'s own questions about conceiving and pregnancy. Each gets its own answer after the main sections.',
    suggestedSections: [
      { label: 'දරු සම්භවය පිළිබඳ සාමාන්‍ය දර්ශනය',
        guide: 'පස්වන භාවය, එහි අධිපතියා සහ පුත්‍රකාරක බ්‍රහස්පතිගේ බල අබලතා අනුව දරුවන් ලැබීමේ සම්භාවිතාව පැහැදිලිව පවසන්න.' },
      { label: 'දරුවෙකු ලැබීමේ කාලය',
        guide: 'වත්මන් සහ ඉදිරි දශා, අන්තර්දශා සහ ගෝචර අනුව දරුවෙකු ලැබීමට හිතකර වසර සහ කාල වකවානු දක්වන්න.' },
      { label: 'ගර්භණී කාලයේ සෞඛ්‍යය සහ ප්‍රවේශම් විය යුතු කාල',
        guide: 'ගර්භණී කාලයේ ප්‍රවේශම් විය යුතු ග්‍රහ කාල සඳහන් කරන්න. මෙය වෛද්‍ය උපදෙස් වෙනුවට නොවන බව සඳහන් කර, වෛද්‍යවරයාගේ උපදෙස් පිළිපැදීමට දිරිගන්වන්න.' },
      { label: 'ප්‍රමාදයට හෝ බාධාවලට හේතු',
        guide: 'දරු සම්භවය ප්‍රමාද කළ හැකි ග්‍රහ බලපෑම් සහ දෝෂ පැහැදිලි කර, ඒවා සමනය වන කාලය පවසන්න.' },
      { label: 'දරුවාගේ ස්වභාවය සහ අනාගතය',
        guide: 'ලැබෙන දරුවාගේ සාමාන්‍ය ස්වභාවය සහ පවුලට ගෙන දෙන සෙත පිළිබඳ පොදු විග්‍රහයක් දෙන්න. ස්ත්‍රී පුරුෂ භාවය පිළිබඳ කිසිවක් නොපවසන්න.' },
      { label: 'පවුල් සහ මානසික සුවය',
        guide: 'යුවළගේ මානසික සුවය, පවුල් සහයෝගය සහ මෙම කාලයේ අවධානය යොමු කළ යුතු කරුණු පවසන්න.' },
      { label: 'පිළියම් සහ ශාන්තිකර්ම',
        guide: 'දරු සම්භවයට උපකාර වන සරල, ප්‍රායෝගික පිළියම් සහ ශාන්තිකර්ම දක්වන්න.' },
      { label: 'සාරාංශය සහ අවසන් උපදෙස්',
        guide: 'වාර්තාවේ ප්‍රධාන කරුණු කෙටියෙන් සාරාංශ කර, දිරිගන්වන අවසන් උපදෙසක් ලබා දෙන්න.' },
    ],
  },
};

export const SECTION_KIND_LIST = Object.values(SECTION_KINDS);

/** The horoscope_data key for a kind, e.g. hdKey('abroad', 'sections_data'). */
export const hdKey = (kind, name) => `${kind}_${name}`;

/** A run that has said "generating" for longer than this has stopped (a restart, a hung call), not still working. */
const STALE_RUN_MS = 20 * 60 * 1000;

/** True while a run is genuinely in progress: flagged, and started recently enough to be believed. */
export function isGenerating(hd, kind) {
  if (hd?.[hdKey(kind, 'generating')] !== true) return false;
  const at = Date.parse(String(hd?.[hdKey(kind, 'generating_at')] || '').replace(' ', 'T'));
  return Number.isNaN(at) ? true : Date.now() - at < STALE_RUN_MS;
}

/** State of one kind on one order, from its parsed horoscope_data. */
export function sectionReportState(hd, kind) {
  const data = hd?.[hdKey(kind, 'sections_data')];
  return {
    generating: isGenerating(hd, kind),
    // 0 to 100 while a run reports progress, otherwise null
    percent: (() => {
      const p = hd?.[hdKey(kind, 'progress')];
      return isGenerating(hd, kind) && p && p.total > 0 ? Math.min(99, Math.round((p.done / p.total) * 100)) : null;
    })(),
    stale: hd?.[hdKey(kind, 'generating')] === true && !isGenerating(hd, kind),
    error: hd?.[hdKey(kind, 'error')] || null,
    done: Array.isArray(data) && data.length > 0,
  };
}

// ─── Plugin settings, one set of fields per kind ─────────────────────────────

/** The plugin config fields a kind owns, without the `<kind>_` prefix. */
export const SECTION_CONFIG_FIELDS = ['system_prompt', 'sections', 'special_note', 'wa_prompt',
  'report_title', 'fixed_instructions', 'questions_title', 'question_instructions', 'ai_fill_prompt', 'spec'];

/** Settings state for every kind, read from a plugin config response (or empty). */
export function sectionConfigFromApi(data = {}) {
  return Object.fromEntries(SECTION_KIND_LIST.map(k => [
    k.key,
    Object.fromEntries(SECTION_CONFIG_FIELDS.map(f => {
      const v = data[hdKey(k.key, f)];
      return [f, f === 'sections' ? (Array.isArray(v) ? v : []) : (v || '')];
    })),
  ]));
}

/** Flatten settings state into the `<kind>_<field>` keys the save endpoint takes. */
export function sectionConfigToBody(cfg = {}) {
  const body = {};
  for (const k of SECTION_KIND_LIST) {
    for (const f of SECTION_CONFIG_FIELDS) {
      if (cfg[k.key] && cfg[k.key][f] !== undefined) body[hdKey(k.key, f)] = cfg[k.key][f];
    }
  }
  return body;
}

// ─── Birth form helpers, same behaviour as the marriage panel ────────────────

export const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
export const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export const LAGNA_SI = {
  Aries: 'මේෂ', Taurus: 'වෘෂභ', Gemini: 'මිථුන', Cancer: 'කටක',
  Leo: 'සිංහ', Virgo: 'කන්නියා', Libra: 'තුලා', Scorpio: 'වෘශ්චික',
  Sagittarius: 'ධනු', Capricorn: 'මකර', Aquarius: 'කුම්භ', Pisces: 'මීන',
};

export const ZODIAC_SYMBOL = {
  Aries: '♈', Taurus: '♉', Gemini: '♊', Cancer: '♋',
  Leo: '♌', Virgo: '♍', Libra: '♎', Scorpio: '♏',
  Sagittarius: '♐', Capricorn: '♑', Aquarius: '♒', Pisces: '♓',
};

const SINHALA_MONTHS = {
  'ජනවාරි': 1, 'පෙබරවාරි': 2, 'මාර්තු': 3, 'අප්‍රේල්': 4,
  'මැයි': 5, 'ජූනි': 6, 'ජූලි': 7, 'අගෝස්තු': 8,
  'සැප්තැම්බර්': 9, 'ඔක්තෝබර්': 10, 'නොවැම්බර්': 11, 'දෙසැම්බර්': 12,
};

/** "2000 මැයි 5" or "2000-05-05" to "2000-05-05"; '' when it cannot be read. */
export function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split(/\s+/);
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = SINHALA_MONTHS[parts[1]] || parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return '';
}

/** Parse a stored JSON column that may arrive as a string or an object. */
export function parseJsonField(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}
