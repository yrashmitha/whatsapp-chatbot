'use strict';

/**
 * @module services/dateContext
 * @description Shared "today's date" block injected into every Gemini prompt that
 * reasons about dasha/transit timing (horoscope sections, special questions,
 * marriage sections, quantum sections). Without this, Gemini has no reliable way
 * to know which dasha period is "current" vs past/future.
 */

function todayContextBlock() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD (Gregorian)
  return (
    '\n\n─── අද දිනය (Today\'s Date) ───\n' +
    `${dateStr}\n` +
    'ඉහත දිනය පදනම් කර ගෙන, විංශෝත්තරී දශා (Mahadasha/Antardasha) ලැයිස්තුවේ start/end දිනයන් ' +
    'සමඟ සංසන්දනය කර, දැනට ක්‍රියාත්මක වන දශාව/අන්තර් දශාව, එය අවසන් වන දිනය සහ ඉන් අනතුරුව එළඹෙන ' +
    'දශාව හඳුනාගෙන ඊට අනුරූපව නිවැරදි කාල සීමා සහිතව පලාපල දක්වන්න.'
  );
}

module.exports = { todayContextBlock };
