'use strict';

/**
 * @module services/matchReport
 * @description Couple compatibility (ගැළපීම / match-making) reading generation service.
 *
 * Port of the standalone `app/breakup.py` script. Same shape as the marriage reading —
 * chart data as the Gemini system instruction, then one Gemini call per configurable
 * section — but it takes TWO charts (boy + girl) instead of one, and answers the
 * couple's custom questions at the end.
 *
 * Like breakup.py (and unlike the pre-existing Node readings, which used to start a
 * fresh chat per section), the whole run shares ONE chat session so each section can
 * see everything written before it. That is what makes the "do not repeat earlier
 * sections" rule in MATCH_FIXED_INSTRUCTIONS actually enforceable. The session is a
 * local variable — one per order per run, discarded when the run ends, so no couple's
 * chart data can ever leak into another order's report.
 *
 * Config lives under the existing `horoscope_reading` plugin:
 *   match_system_prompt   — Gemini system instruction (blank → built-in default)
 *   match_sections        — [{ label, guide }]        (blank → DEFAULT_MATCH_SECTIONS)
 *   match_special_note    — closing note appended to the document
 *
 * Results are saved on orders.horoscope_data:
 *   match_boy / match_girl   — { name, birth_date, birth_time, lat, lng, lagna, chart_data }
 *   match_sections_data      — [{ label, content }]
 *   match_special_answers    — [{ question, prompt, answer }]
 */

const db        = require('../db');
const { getGenAI } = require('./clientKeys');
const { buildSectionsDoc } = require('./horoscope');
const { todayContextBlock } = require('./dateContext');

const MATCH_REPORT_TITLE = 'ජන්ම පත්‍ර ගැළපීම පිළිබඳ විශේෂ ශාස්ත්‍රීය වාර්තාව';
const MATCH_QUESTIONS_TITLE = 'විශේෂ උපදේශනය සහ විසඳුම් සේවාව';

const DEFAULT_MATCH_SYSTEM_PROMPT = `ඔබ ඉතාමත් දක්ෂ සහ වෘත්තීය මට්ටමේ ජ්‍යොතිෂ විශ්ලේෂකයෙකු ලෙස ක්‍රියා කරන්න. ලබා දී ඇති යුවලගේ ජන්ම පත්‍ර දත්ත පදනම් කරගෙන ප්‍රශ්නය අසන ක්ශේස්ත්‍රයට අදාලව පමනක් පිලිතුරු දෙන්න.
ඔබ ලබා දෙන පිළිතුර කිසිවිටෙකත් යන්ත්‍රයකින් හෝ මෘදුකාංගයකින් ජනනය කළ එකක් සේ නොපෙනිය යුතුය. එය ප්‍රවීණ ඇදුරුතුමෙකු විසින් තම සේවාදායකයාට අසල හිඳගෙන පහදා දෙන ආකාරයේ ඉතා ගෞරවනීය, සන්සුන් සහ ගලාගෙන යන කථන ශෛලියකින් (Narrative flow) යුක්ත විය යුතුය.


විශේෂ වෘත්තීය උපදෙස්:
1 - ස්වයං-හැඳින්වීම් තහනම: ඔබ කවුරුන්ද යන්න හෝ ඔබේ පළපුරුද්ද පිළිබඳව කිසිදු සඳහනක් නොතබන්න. 'AI', 'පද්ධතිය', 'දත්ත' වැනි වචන කිසිසේත් භාවිතා නොකරන්න.
2 - භාෂා විලාසය: පාරිභෝගිකයා ඇමතීමේදී "ඔබ" ලෙස පමණක් අමතන්න. "දේවීනි", "ගෞරවනීය" වැනි අතිශය භක්තිමත් වචන අනවශ්‍යයි. ඉතා මිත්‍රශීලී, පැහැදිලි සිංහල භාෂාවක් භාවිතා කරන්න.
3 - සෘජු ප්‍රවේශය: ස්තුති කිරීම්, ආශිර්වාද නොමැතිව කෙලින්ම විෂය කරුණ විග්‍රහ කිරීම අරඹන්න.
4 - ඡේද රටාව (Crucial): වාර්තාව රොබෝ කෙනෙකුගේ සේ නොපෙනීම සඳහා, සෑම දෙයක්ම සුබ පල / අසුබ පල ලෙස තදින් මාතෘකා වලට නොකඩන්න. ලග්න කේන්ද්‍රය සහ නවාංශකය එකිනෙකට මිශ්‍ර කරමින්, එකම කතාවක් සේ ඡේද වශයෙන් ගලාගෙන යාමට ඉඩ හරින්න.
5 - වර්තමාන කාලය: වාර්තාව සකස් කරන මොහොතේ පවතින සැබෑ වර්තමාන වර්ෂය පදනම් කරගන්න.


විශේෂ ශාස්ත්‍රීය උපදෙස්:
1 - සත්‍යවාදී බව: ව්‍යාජ සහන නොදෙන්න. කටුක සත්‍යයන් මනෝවිද්‍යාත්මකව සමනය කර පවසන්න. (උදා: "ඔබ විනාශ වේ" වෙනුවට "මෙය උපරිම අවධානය සහ ප්‍රවේශම් සහගත බව අවශ්‍ය කාලසීමාවකි" ලෙස පවසන්න).
2 - මානසික ශක්තිය: බාධාවන් පෙර කර්ම ශක්තීන් ලෙස පෙන්වා දී, වර්තමාන වීර්යයෙන් ඒවා වෙනස් කළ හැකි බව පවසා දිරිමත් කරන්න.
3 - පුනරාවර්තනයෙන් වළකින්න: වාර්තාව දිගු කිරීමට එකම කරුණ නැවත නැවත නොලියන්න. ඒ වෙනුවට ග්‍රහ දෘෂ්ටි, යෝග සහ අංශක පිළිබඳ ගැඹුරු ශාස්ත්‍රීය කරුණු අලුතින් එක් කරන්න.
4 - පිළියම් ලබා දීම: පිළියම් (Remedies) ලබා දිය යුත්තේ ඒ සඳහා ඔබෙන් විශේෂයෙන් ඉල්ලා සිටියහොත් පමණි. සාමාන්‍ය ඡේද ඇතුළත බෝධි පූජා ආදිය ලිවීමෙන් වළකින්න.
5- මේ ආකාරයට පුද්ගලයාගේ සැඟවුණු හැඟීම්, තනිවීම් සහ කැපකිරීම් "අවබෝධ කරගත් කෙනෙකු ලෙස" (As an empathetic observer) විවිධ වාක්‍ය රටා වලින් පවසන්න.
6 - සමබර සහ සත්‍යවාදී විග්‍රහයක් (Balanced & Honest Analysis): කේන්ද්‍රයේ ඇති සුබ පල මෙන්ම අසුබ පල (අදාළ මාතෘකාවට අදාල ඒවා පමණක්) කිසිවක් වසන් නොකර සෘජුව සහ පැහැදිලිව සඳහන් කරන්න. පාරිභෝගිකයාව සතුටු කිරීමට පමණක් කරුණු මවාපෑමෙන් හෝ අසුබ කරුණු මඟහැරීමෙන් සම්පූර්ණයෙන්ම වළකින්න. 100% ක් යථාර්ථවාදී සහ සමබර ශාස්ත්‍රීය වාර්තාවක් සකසන්න.
7 - මාතෘකා යටතේ කරුණු නොබෙදන්න. (Criticl) ඒ වෙනුවට එම සියලු දත්ත එකට මුසු කර, කියවීමට පහසු, ගලාගෙන යන ඡේද කිහිපයක් ලෙස ගැඹුරු විග්‍රහයක් කරන්න. 

ආකෘතිය සහ තාක්ෂණික නීති:

කිසිදු ආරම්භක ආමන්ත්‍රණයක් (උදා: ආයුබෝවන්) හෝ සමාප්ති වාක්‍යයක් (උදා: ස්තූතියි) භාවිතා නොකරන්න.

ඔබ කවුරුන්ද යන්න හෝ ඔබේ පළපුරුද්ද ගැන සඳහන් කිරීමෙන් සම්පූර්ණයෙන්ම වළකින්න.

ප්‍රධාන අනු-මාතෘකා සඳහා '###' සලකුණ යොදන්න.

වැදගත් කරුණු පෙන්වීමට '**' (Double Asterisks) දෙපසටම යොදන්න. (උදා: ධන ලක්ෂ්මී යෝගය).

පාරිභෝගිකයා ඇමතීමේදී "ඔබ" ලෙස පමණක් අමතන්න.`;

const DEFAULT_MATCH_SPECIAL_NOTE = `විශේෂ ශාස්ත්‍රීය සටහන සහ ප්‍රකාශය

නිරවද්‍යතාවය සහ තාක්ෂණය
මෙම පලාපල විග්‍රහය සඳහා අදාළ ග්‍රහ පිහිටීම් ගණනය කර ඇත්තේ, ඔබ ලබා දුන් උපන් දත්ත පදනම් කරගෙන ඇමරිකානු නාසා (NASA) ආයතනයේ 'Horizons' තාරකා විද්‍යාත්මක දත්ත පද්ධතිය භාවිතයෙනි. පාරිභෝගිකයාගේ උපරිම නිරවද්‍යතාවය වෙනුවෙන් අප මෙම අති නවීන සහ සූක්ෂ්ම ක්‍රමවේදය අනුගමනය කර ඇත. එම නිසා ඔබගේ සාම්ප්‍රදායික කේන්දර සටහනේ දත්ත වලට වඩා මෙහි අංශකමය වශයෙන් ඉතා නිවැරදි වෙනස්කම් පැවතිය හැකිය.

කර්මය සහ වීර්යය
ජ්‍යොතිෂය යනු පෙර කර්මයෙන් රැගෙන ආ 'ශක්‍යතාවය' සහ 'ප්‍රවණතාවයන්' පෙන්වා දෙන මඟ සලකුණක් පමණි. බුදු දහමට අනුව ඔබේ "වීර්යය" සහ "ප්‍රඥාව" මඟින් අකුසල කර්මයන්ගේ බලපෑම යටපත් කිරීමටත්, සුබ කර්මයන්ගේ ඵල වර්ධනය කර ගැනීමටත් ඔබට පූර්ණ හැකියාව පවතී.

එබැවින් මෙම වාර්තාව කිසිදා වෙනස් කළ නොහැකි ඉරණමක් ලෙස නොව, ඔබේ ජීවන ගමන සාර්ථක කර ගැනීමට සහ නිවැරදි තීරණ ගැනීමට උපකාරී වන ප්‍රබල "මාර්ගෝපදේශනයක්" ලෙස පමණක් සලකන්න. දෛවය වෙනස් කළ හැක්කේ එය නිවැරදිව තේරුම් ගන්නා බුද්ධිමත් ජන්මියාට පමණි.

තෙරුවන් සරණින්, දීර්ඝායුෂ සහ අතිමහත් ජයග්‍රහණ පතමු!`;

const DEFAULT_MATCH_SECTIONS = [
  {
    label: `දෙදෙනාගේ ජන්ම පත්‍රයන්හි ග්‍රහ ගැළපීම පිළිබඳ මූලික විග්‍රහය`,
    guide: `මෙය ආරම්භක හැඳින්වීමයි. දෙදෙනාගේ ලග්න, රාශි සහ මූලික ග්‍රහ පිහිටීම් අනුව පොදුවේ කොතරම් දුරට ගැළපීමක් ඇත්දැයි මිත්‍රශීලීව පවසන්න. දෙදෙනාගේ එකතුවීම පිටුපස ඇති දෛවෝපගත ස්වභාවය (Karmic connection) ගැන කෙටියෙන් අදහස් දක්වන්න.`,
  },
  {
    label: `පෞරුෂත්වයන්ගේ සමානකම්, දුර්වලතා සහ එකිනෙකාට අනුපූරක වන චරිත ලක්ෂණ`,
    guide: `දෙදෙනාගේ චරිත වල ඇති සමානකම් සහ වෙනස්කම් විස්තර කරන්න. එක් අයෙකුගේ දුර්වලතාවයක් (උදා: ඉක්මන් කේන්තිය) අනෙක් කෙනාගේ ශක්තියකින් (උදා: ඉවසීම) පියවෙන ආකාරය (Complementary traits) ඉතා පැහැදිලිව පෙන්වා දෙන්න.`,
  },
  {
    label: `අදහස් හුවමාරුවේ ගුණාත්මක බව සහ බුද්ධිමය මට්ටමින් ඇති අවබෝධය`,
    guide: `දෙදෙනා අතර කතාබහ සහ අදහස් හුවමාරු වන ආකාරය විස්තර කරන්න. ප්‍රශ්නයක් ආ විට සාකච්ඡා කර විසඳාගන්නවාද නැතිනම් තර්ක කරනවාද යන්න පවසන්න. වචන නොමැතිව වුවද එකිනෙකාගේ සිතුම් පැතුම් තේරුම් ගැනීමේ මානසික බැඳීමක් ඇත්දැයි බුධ සහ සඳු ග්‍රහයින්ට අනුව විස්තර කරන්න.`,
  },
  {
    label: `ආදරය, සෙනෙහස සහ දෙදෙනා අතර ඇතිවන චිත්තවේගීය බැඳීමේ ස්වභාවය`,
    guide: `සිකුරු සහ කුජ ග්‍රහයින්ගේ පිහිටීම අනුව දෙදෙනා අතර ඇති ආකර්ෂණය, ආදරය ප්‍රකාශ කරන ආකාරය සහ චිත්තවේගීය ආරක්ෂාව (Emotional security) ගැන කතා කරන්න. සහකරුවාගෙන්/සහකාරියගෙන් බලාපොරොත්තු වන ආදරයේ ස්වභාවය එකිනෙකාට ගැලපේදැයි පෙන්වා දෙන්න.`,
  },
  {
    label: `ශාරීරික ආකර්ෂණය, ලිංගික ගැළපීම සහ රහස්‍ය බැඳීම්වල ස්වභාවය`,
    guide: `සිකුරු සහ කුජ ග්‍රහයින්ගේ සංයෝග, අටවැන්න සහ දොළොස්වැන්න (ශයන සුඛය) යන ස්ථාන පදනම් කරගනිමින් දෙදෙනා අතර පවතින ශාරීරික ආකර්ෂණය සහ ලිංගික ගැළපීම පිළිබඳව විද්‍යාත්මකව සහ ශාස්ත්‍රීයව විග්‍රහ කරන්න. දෙදෙනාගේ ලිංගික අවශ්‍යතා, ආශාවන් සහ එම බැඳීමේ තෘප්තිමත්භාවය එකිනෙකාට කොතරම් දුරට ගැළපේද යන්න මෙන්ම, යම් දුර්වලතාවක් ඇත්නම් එයද කිසිවක් වසන් නොකර ඉතා සංවේදීව සහ පැහැදිලිව විස්තර කරන්න.`,
  },
  {
    label: `මතභේද ඇතිවීමට ඇති ප්‍රවණතාවය සහ ඒවා ආදරයෙන් සමනය කරගැනීමේ මනෝවිද්‍යාත්මක මඟපෙන්වීම`,
    guide: `කිසිදු සම්බන්ධයක් 100% ක් පරිපූර්ණ නොවන බව පවසමින්, මොවුන් දෙදෙනා අතර ගැටලු ඇතිවිය හැක්කේ කුමන කාරණා මුල්කරගෙනද (උදා: මුදල්, ඥාතීන්, ඊර්ෂ්‍යාව, හෝ කාර්යබහුල බව) යන්න පෙන්වා දෙන්න. එම තත්ත්වයන් වළක්වා ගැනීමට දෙදෙනාටම වෙන වෙනම මනෝවිද්‍යාත්මක උපදෙස් ලබා දෙන්න.`,
  },
  {
    label: `වර්තමාන දශා කාලයන් සහ ග්‍රහ ගෝචරය (2026) සබඳතාවයට බලපාන අයුරු`,
    guide: `දැනට වර්තමාන කාලයේ (2026 වර්ෂය) දෙදෙනාටම ගතවන දශා සහ ගෝචර ග්‍රහයන් අනුව ඔවුන්ගේ මානසිකත්වය පවතින ආකාරය විස්තර කරන්න. රැකියාවේ හෝ ආර්ථිකයේ පීඩනයන් සබඳතාවයට බලපාන්නේ නම්, මේ කාලය තුළ එකිනෙකාට සහයෝගය දැක්විය යුතු ආකාරය ගැන සෘජුව උපදෙස් දෙන්න.`,
  },
  {
    label: `දරු පල වාසනාව සහ පරම්පරාවේ පැවැත්ම පිළිබඳ සෘජු විග්‍රහය`,
    guide: `දෙදෙනාගේම ජන්ම පත්‍රවල 5 වැන්න (පුත්‍රස්ථානය), 5 අධිපති ග්‍රහයා සහ දරු පල පිළිබඳ ප්‍රධාන කාරක ග්‍රහයා වන ගුරු (බ්‍රහස්පති) සිටින ආකාරය අනුව දරු පල ලැබීමේ නියත සම්භාවිතාව පරීක්ෂා කරන්න. මෙහිදී දරු පල ප්‍රමාද වීම්, දරු පල අහිමි වීම් හෝ පුත්‍ර දෝෂ වැනි තත්ත්වයන් පවතී නම්, ඒවා කිසිවක් වසන් නොකර සෘජුව ප්‍රකාශ කරන්න. විශේෂයෙන්ම කාන්තා කේන්ද්‍රයේ ගැබ්ගෙල සහ ගර්භාෂය නියෝජනය වන ස්ථානවල ග්‍රහ පීඩිත වීම් පවතීද යන්නත්, පිරිමි කේන්ද්‍රයේ ජීව ශක්තිය පිළිබඳ පවතින ග්‍රහ බලපෑමත් අනුව දරු පල වාසනාව පිළිබඳ අවසන් තීන්දුව ශාස්ත්‍රීයව ඉදිරිපත් කරන්න.`,
  },
  {
    label: `සබඳතාවයේ අනාගත පැවැත්ම සහ අර්බුදකාරී අවස්ථාවකදී නොබිඳී ඉදිරියට යාමේ සම්භාවිතාව`,
    guide: `අනාගතයේදී පැමිණිය හැකි බාධක හමුවේ මෙම සබඳතාවය බිඳවැටේද නැතිනම් දෙදෙනා එක්ව එය ජයගනීද යන්න කේන්ද්‍රයේ 7 සහ 8 භාවයන්ට අනුව පැහැදිලි කරන්න. විවාහයකට එළඹීමට තරම් ස්ථාවරත්වයක් ඇත්දැයි පවසන්න.`,
  },
  {
    label: `ප්‍රබල ග්‍රහ දෝෂ, ඒවායේ බලපෑම සහ දෙදෙනාගේ කේන්ද්‍ර මඟින් දෝෂ භංග වීම`,
    guide: `කුජ දෝෂය, ශනි මංගල දෝෂය, සර්ප දෝෂ වැනි ප්‍රබල විවාහ දෝෂ එක් අයෙකුගේ ජන්ම පත්‍රයේ පවතී නම්, ඒවා අනෙක් ජන්ම පත්‍රයේ ග්‍රහ පිහිටීම් මඟින් සමනය වී (භංග වී) ඇත්දැයි ගැඹුරින් විශ්ලේෂණය කරන්න. දෝෂ භංග වී ඇත්නම් එය විවාහයට සුබදායක වන අයුරුත්, භංග වී නොමැති නම් අනාගතයේදී ඇතිවිය හැකි බාධාත් ඉතා පැහැදිලිව සහ සෘජුව දක්වන්න.`,
  },
  {
    label: `සබඳතාවයේ බාධා අවම කරගැනීම සඳහා වූ ප්‍රායෝගික සහ බෞද්ධ පිළියම්`,
    guide: `මෙම සබඳතාවය තවත් ශක්තිමත් කරගැනීමට සහ පවතින ග්‍රහ අපල (ඇත්නම්) මඟහරවා ගැනීමට දෙදෙනාටම එක්ව කළ හැකි ප්‍රායෝගික පුරුදු, සන්නිවේදන පිළියම් සහ සරල බෞද්ධ වත්පිළිවෙත් (උදා: මෙත්තා භාවනාව, එකට පන්සල් යාම වැනි දේ) පෙළගස්වන්න.`,
  },
  {
    label: `ජීවන ගමනේ ඉදිරි පියවර පිළිබඳ සමස්ත සාරාංශය සහ අවසන් නිගමනය`,
    guide: `ඉහත සියලු කරුණු කැටි කර, මෙම සම්බන්ධතාවය ශාස්ත්‍රීය වශයෙන් අනුමත කළ හැකිද නැද්ද යන්න සෘජුව සහ ඉතා පැහැදිලිව ප්‍රකාශ කරන්න. අනුමත කරන්නේ නම් ඊට හේතු වන ප්‍රබලම ග්‍රහ ගැළපීම් මොනවාද යන්නත්, අනුමත කළ නොහැකි නම් හෝ ඉදිරියට යාම දුෂ්කර නම් ඊට හේතු වන ප්‍රධානතම ග්‍රහ දෝෂ සහ නොගැළපීම් මොනවාද යන්නත් තර්කානුකූලව හේතු දක්වමින් විස්තර කරන්න. යම් හෙයකින් අනුමත කළ නොහැකි මට්ටමේ නොගැළපීමක් ඇත්නම් එය ඉතා කාරුණිකව පෙන්වා දෙන්න. අවසන් තීරණය ගැනීමේ පූර්ණ අයිතිය ඔවුන් සතු බව මතක් කරමින්, දෙදෙනාගේම අනාගතය වෙනුවෙන් සුබ පැතුමක් ද එක් කරන්න.`,
  },
];

// The 5 fixed rules appended to every section prompt (breakup.py task_prompt).
const MATCH_FIXED_INSTRUCTIONS = `කරුණාකර පහත උපදෙස් දැඩිව පිළිපදින්න:
1. කතාවක් මෙන් ලියන්න (Narrative Flow): 'ලග්න කේන්ද්‍රය අනුව', 'නවාංශකය අනුව', 'සුබ පල', 'අසුබ පල' ලෙස දැඩි මාතෘකා යටතේ කරුණු නොබෙදන්න. ඒ වෙනුවට එම සියලු දත්ත එකට මුසු කර, කියවීමට පහසු, ගලාගෙන යන ඡේද කිහිපයක් ලෙස ගැඹුරු විග්‍රහයක් කරන්න. දෙදෙනාගේ කේන්ද්‍රවල ඇති සුබ පල මෙන්ම අසුබ පල (අදාළ මාතෘකාවට අදාල ඒවා පමණක්) කිසිවක් වසන් නොකර සෘජුව සහ පැහැදිලිව සඳහන් කරන්න.
2. කිසිදු ශාන්තිකර්මයක් හෝ පිළියමක් මෙහි ඇතුළත් නොකරන්න (ඒවා වෙනම කොටසකින් ලබා දෙනු ඇත). මෙහිදී කළ යුත්තේ ශාස්ත්‍රීය විග්‍රහය පමණි.
3. සෘජුවම කරුණට පිවිසෙන්න. හැඳින්වීම් අනවශ්‍යයි.
4. අතිශය වැදගත්: මීට පෙර අංශ (Sections) විස්තර කිරීමේදී ඔබ භාවිතා කළ වාක්‍ය, වාක්‍ය ඛණ්ඩ හෝ අදහස් ඒ ආකාරයෙන්ම නැවත භාවිතා කිරීමෙන් සම්පූර්ණයෙන්ම වළකින්න. අදාළ මාතෘකාවට පමණක් සුවිශේෂී වූ නව කරුණු ඉදිරිපත් කරන්න.
5. අසුබ පල සඟවන්න එපා, නමුත් මනුෂ්‍යවාදීව පවසන්න (Honest but Empathetic): කේන්ද්‍රවල පාප, නීච, අස්ත ග්‍රහයන් හෝ 6, 8, 12 ස්ථානවල බලපෑම් ඇත්නම්, එයින් සිදුවිය හැකි විවාහ බාධා, ගැටුම් හෝ වෙන්වීම් වැනි අසුබ පල අනිවාර්යයෙන්ම පැහැදිලිව සඳහන් කරන්න (අදාළ මාතෘකාවට අදාල ඒවා පමණක්). ඒවා කිසිසේත් වසන් නොකරන්න. **නමුත්**, එම අසුබ පල පැවසූ වහාම, දෙදෙනාගේ හිත නොකැඩෙන පරිදි කේන්ද්‍රවල ඇති වෙනත් සුබ ග්‍රහ බලයන් පෙන්වා දී, 'මෙම අභියෝග සහ පෙර කර්ම බාධක ඔබ දෙදෙනාගේ නොපසුබට උත්සාහයෙන්, බුද්ධියෙන් සහ ඉවසීමෙන් සාර්ථකව මඟහරවා ගත හැකියි' යනුවෙන් සිත සනසන සහ ධෛර්යවත් කරන වචන අනිවාර්යයෙන් භාවිතා කරන්න.`;

// Rules for the couple's own questions, answered after the sections (breakup.py q_prompt).
const MATCH_QUESTION_INSTRUCTIONS = `අනිවාර්ය නීති:
1. අතිශය වැදගත්: පාරිභෝගිකයා අසා ඇති ගැටලුවට පමණක් සෘජුවම පිළිතුරු දෙන්න. ගැටලුවට අදාළ නැති අනෙකුත් ග්‍රහයන් (1 සිට 12 භාවයන්), පෞරුෂය හෝ අනවශ්‍ය දෑ කිසිසේත් විස්තර නොකරන්න.
2. වර්තමාන කාලයට අදාළ දශා කාලයන් පමණක් දක්වමින් ප්‍රශ්නයට අදාළ පිළිතුර පවසන්න.
3. ඡේද සැකසුම: සෑම ප්‍රධාන උප-මාතෘකාවක්ම '###' සලකුණෙන් ආරම්භ කරන්න.
4. පිළියම් ඉදිරිපත් කිරීම: පිළියම් හෝ වත්පිළිවෙත් ඉදිරිපත් කිරීමේදී ඒවා එකම ඡේදයක ලියනවා වෙනුවට, එක් එක් පිළියම අලුත් පේළියකින් ආරම්භ කර ඉදිරියෙන් '-' සලකුණ යොදන්න. බෞද්ධානුකූල පිළිවෙත් පමණක් ලබා දෙන්න.
5. කතා කරන මිත්‍රශීලී භාෂාවෙන් පිළිතුරු ලියන්න. කිසිදු විටෙක වාක්‍ය අගට 'නේද?' යන්න නොයොදන්න.
6. සෑම ඡේදයක් අවසානයේදීම අනිවාර්යයෙන්ම හිස් පේළි දෙකක් (Double Enter) තබන්න.
7. වචන 300-600 අතර පිළිතුරක් සිංහලෙන් පමණක් ලබා දෙන්න.`;

/**
 * Per-section user prompt. Summary/conclusion sections get a tighter word limit, matching
 * the `සාරාංශය`/`නිගමනය` special case in breakup.py.
 */
function buildMatchSectionPrompt(label, guide) {
  const isSummary = label.includes('සාරාංශය') || label.includes('නිගමනය');
  const limitText = isSummary
    ? 'වචන 600කට වඩා අඩු, ඉතා සංක්ෂිප්ත සහ සෘජු විග්‍රහයක් ලබා දෙන්න.'
    : 'වෘත්තීය මට්ටමේ සවිස්තරාත්මක විග්‍රහයක් ලබා දෙන්න (වචන 300-500 පමණ).';
  const guideText = guide
    ? `මෙම මාතෘකාව ලිවීම සඳහා විශේෂ උපදෙස්: ${guide}\n\n`
    : '';
  return (
    `මාතෘකාව: [${label}]\n` +
    `${guideText}` +
    `${limitText}\n\n` +
    MATCH_FIXED_INSTRUCTIONS
  );
}

function buildMatchQuestionPrompt(questionText) {
  return (
    `මෙම විශේෂ ප්‍රශ්නයට සෘජු සහ සවිස්තරාත්මක පිළිතුරක් ලබා දෙන්න: '${questionText}'\n\n` +
    MATCH_QUESTION_INSTRUCTIONS
  );
}

/**
 * Resolve the effective match-making config for a client (falling back to built-in defaults).
 */
function resolveMatchConfig(config) {
  const sections = (Array.isArray(config.match_sections) && config.match_sections.length > 0)
    ? config.match_sections.filter(s => s && s.label)
    : DEFAULT_MATCH_SECTIONS;
  const systemPrompt = (config.match_system_prompt && config.match_system_prompt.trim())
    ? config.match_system_prompt
    : DEFAULT_MATCH_SYSTEM_PROMPT;
  const specialNote = (config.match_special_note && config.match_special_note.trim())
    ? config.match_special_note
    : DEFAULT_MATCH_SPECIAL_NOTE;
  return { sections, systemPrompt, specialNote };
}

/**
 * Serialise both charts into one clearly-labelled block. The role labels are explicit and
 * in Sinhala so the model can never mix up whose placement is whose — the single biggest
 * failure mode for a two-chart reading.
 */
function buildCoupleContext(hd) {
  const couple = [
    {
      role:  'පිරිමි (Male / Boy)',
      name:  hd.match_boy?.name || '',
      birth: [hd.match_boy?.birth_date, hd.match_boy?.birth_time, hd.match_boy?.birth_place_name].filter(Boolean).join(' · '),
      chart: hd.match_boy?.chart_data,
    },
    {
      role:  'ගැහැනු (Female / Girl)',
      name:  hd.match_girl?.name || '',
      birth: [hd.match_girl?.birth_date, hd.match_girl?.birth_time, hd.match_girl?.birth_place_name].filter(Boolean).join(' · '),
      chart: hd.match_girl?.chart_data,
    },
  ];
  return JSON.stringify(couple, null, 2) + todayContextBlock();
}

/**
 * Build the Gemini model for a match run. The couple context is constant across every
 * section, so it lives in the systemInstruction and the model is built once per run.
 */
async function buildMatchModel({ clientId, coupleContext, systemPrompt }) {
  const sysInstruction = systemPrompt
    + '\n\nමෙම යුවලගේ කේන්ද්‍ර දත්ත සම්පූර්ණ වාර්තාව සඳහා පදනම වේ:\n\n'
    + coupleContext;
  return (await getGenAI(clientId)).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, topP: 0.8, topK: 40 },
    systemInstruction: sysInstruction,
  });
}

/**
 * Rebuild a chat history from already-saved sections, for the regenerate-one-section path
 * where the run's live session no longer exists. The section being redone is excluded so
 * the model rewrites it instead of echoing it back.
 */
function historyFromSections(sectionsData, excludeLabel) {
  return (sectionsData || [])
    .filter(s => s && s.label && s.content && s.label !== excludeLabel)
    .flatMap(s => [
      { role: 'user',  parts: [{ text: `මාතෘකාව: [${s.label}]` }] },
      { role: 'model', parts: [{ text: s.content }] },
    ]);
}

/**
 * Generate one match-making section.
 * Pass an existing `chat` to stay inside the run's shared session (preferred); omit it and
 * a one-off session is built from `coupleContext` + optional `history`.
 * @returns {Promise<string>} the section text
 */
async function generateMatchSectionText({ clientId, coupleContext, systemPrompt, label, guide, chat, history }) {
  const prompt = buildMatchSectionPrompt(label, guide);

  console.log(`[MATCH] ── REQUEST: "${label}"`);
  console.log('[MATCH] userPrompt:\n' + prompt);

  const activeChat = chat
    || (await buildMatchModel({ clientId, coupleContext, systemPrompt })).startChat({ history: history || [] });
  const result = await activeChat.sendMessage(prompt);
  const text   = result.response.text();
  const usage  = result.response.usageMetadata;
  console.log(`[MATCH] ── RESPONSE: "${label}" tokens in=${usage?.promptTokenCount ?? '?'} out=${usage?.candidatesTokenCount ?? '?'} chars=${text.length}`);
  return text;
}

/**
 * Generate every configured section (and every custom question) for an order, then save.
 * Requires BOTH partners' chart_data to already exist — the modal's two "Check Sign"
 * buttons are what put them there.
 *
 * @param {string} clientId
 * @param {string} orderId
 * @returns {Promise<Array<{label: string, content: string}>>}
 */
async function generateMatchReading(clientId, orderId) {
  const r = await db.pgQuery('SELECT horoscope_data FROM orders WHERE order_id=$1', [orderId]);
  if (!r.rows.length) throw new Error('Order not found');

  const hd = (typeof r.rows[0].horoscope_data === 'string')
    ? JSON.parse(r.rows[0].horoscope_data || '{}')
    : (r.rows[0].horoscope_data || {});

  const missing = [];
  if (!hd.match_boy?.chart_data)  missing.push('පිරිමි (boy)');
  if (!hd.match_girl?.chart_data) missing.push('ගැහැනු (girl)');
  if (missing.length) {
    throw new Error(
      `No chart data for ${missing.join(' and ')}. Open the order, go to the Match Making tab, `
      + 'fill both sides and press "Check Sign" for each before generating.'
    );
  }

  const config = await db.getPluginConfig(clientId, 'horoscope_reading');
  const { sections, systemPrompt } = resolveMatchConfig(config);
  const coupleContext = buildCoupleContext(hd);

  console.log(`[MATCH] Generating ${sections.length} sections for order ${orderId}`);
  console.log(`[MATCH] systemPrompt (${systemPrompt.length} chars):\n` + systemPrompt);
  console.log(`[MATCH] coupleContext: ${coupleContext.length} chars`);

  // ONE session for the whole run (see module docstring).
  const chat = (await buildMatchModel({ clientId, coupleContext, systemPrompt })).startChat({});

  const out = [];
  for (const sec of sections) {
    const content = await generateMatchSectionText({
      clientId,
      label: sec.label,
      guide: sec.guide || '',
      chat,
    });
    out.push({ label: sec.label, content });
  }

  // The couple's own questions, answered in the same session so answers do not
  // restate what the sections already covered.
  const questions = Array.isArray(hd.match_special_questions) ? hd.match_special_questions : [];
  const answers = [];
  for (const q of questions) {
    const questionText = (q.prompt && q.prompt.trim()) ? q.prompt : (q.question || '');
    if (!questionText.trim()) continue;
    console.log(`[MATCH-Q] ── REQUEST: "${q.question || questionText}"`);
    const result = await chat.sendMessage(buildMatchQuestionPrompt(questionText));
    const answer = result.response.text();
    console.log(`[MATCH-Q] ── RESPONSE: chars=${answer.length}`);
    answers.push({ question: q.question || questionText, prompt: q.prompt || '', answer });
  }

  const updated = {
    ...hd,
    match_sections_data:   out,
    match_special_answers: answers,
    match_generated_at:    new Date().toISOString(),
  };
  delete updated.match_generating;
  delete updated.match_error;

  await db.pgQuery('UPDATE orders SET horoscope_data=$1 WHERE order_id=$2', [JSON.stringify(updated), orderId]);
  console.log(`[MATCH] Saved ${out.length} sections + ${answers.length} answers for order ${orderId}`);

  return out;
}

/**
 * Build the match-making Word document.
 */
async function buildMatchDoc({ hd, sections, specialNote, sectionOrder, specialAnswers }) {
  // Order by plugin config if provided; saved data may predate a reorder.
  let ordered = Array.isArray(sections) ? sections.map(s => ({ ...s })) : [];
  if (Array.isArray(sectionOrder) && sectionOrder.length > 0) {
    const byLabel  = Object.fromEntries(ordered.map(s => [s.label, s]));
    const sorted   = sectionOrder.map(o => byLabel[o.label]).filter(Boolean);
    const inConfig = new Set(sectionOrder.map(o => o.label));
    ordered.filter(s => !inConfig.has(s.label)).forEach(s => sorted.push(s));
    ordered = sorted;
  }

  const boy  = hd.match_boy  || {};
  const girl = hd.match_girl || {};
  const personLine = (p) => [p.name, p.birth_date, p.birth_time].filter(Boolean).join('  ·  ');

  return await buildSectionsDoc({
    customerName: [boy.name, girl.name].filter(Boolean).join('  ⚭  '),
    reportTitle:  MATCH_REPORT_TITLE,
    sections:     ordered,
    specialNote,
    specialAnswers,
    specialQuestionsTitle: MATCH_QUESTIONS_TITLE,
    subtitleLines: [personLine(boy), '⚭', personLine(girl)].filter(Boolean),
  });
}

module.exports = {
  generateMatchReading,
  generateMatchSectionText,
  buildMatchDoc,
  buildCoupleContext,
  resolveMatchConfig,
  historyFromSections,
  MATCH_REPORT_TITLE,
  DEFAULT_MATCH_SECTIONS,
  DEFAULT_MATCH_SYSTEM_PROMPT,
  DEFAULT_MATCH_SPECIAL_NOTE,
};
