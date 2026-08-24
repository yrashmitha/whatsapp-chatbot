'use strict';

require('dotenv').config({ path: __dirname + '/.env' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Real order PJ2026-0345 — customer 94767725499
const cf = {
  customer_name: 'Tharindu Indrajith Bandara Weerakoon',
  birth_date: '1995 මාර්තු 06',
  birth_time: 'රාත්‍රී 11.35',
  birth_place: 'කහටගස්දිගිලිය',
  problems: 'ජීවිතයේ දියුණුව, දරුඵල, විවාහය ඇතුළු සියලුම දේවල්',
};

const chatLog = `[Customer]: Mage lagnaya praiksha karaganna puluwan da
[Agent]: ආයුබෝවන්! ඔයාගේ ලග්නය පරීක්ෂා කරගන්න පුලුවන්ද කියලා ඔයා අහලා තියෙනවා.
[Customer]: Ow
[Customer]: මට මගේ ඉදිරිය දැනගන්නයි ඕනෙ
[Customer]: 3500
[Customer]: Tharindu indrajith bandara weerakoon\n1995.3.6\nRathri 11.35\nKahatagasdigiliya
[Customer]: විශේෂ දෙයක් නම් නෑ
[Customer]: දරුපල විවාහය ඔක්කොම
[Customer]: දියුණු ව තමා
[Customer]: mage wife geth oya mudalatama balaganna puluwan da
[Customer]: Mage witharak balamu ehenum`;


async function test() {
  const prompt = `You are an expert Vedic astrology assistant and Sinhala language expert helping prepare a horoscope reading request.

## Order Details
- Customer name: ${cf.customer_name}
- Birth date (raw): ${cf.birth_date}
- Birth time (raw): ${cf.birth_time}
- Birth place (raw): ${cf.birth_place}
- Problem / concern: ${cf.problems}

## Full Customer Chat Conversation
${chatLog}

## Your Task — return the exact JSON schema below, nothing else.

### birth_date_iso
Normalize the raw birth date to exactly "YYYY-MM-DD" format (e.g. "1990-03-15").
Sinhala month names: ජනවාරි=01 පෙබරවාරි=02 මාර්තු=03 අප්‍රේල්=04 මැයි=05 ජූනි=06 ජූලි=07 අගෝස්තු=08 සැප්තැම්බර්=09 ඔක්තෝබර්=10 නොවැම්බර්=11 දෙසැම්බර්=12
Return null if genuinely unknown.

### birth_time_24h
Normalize the raw birth time to exactly "HH:MM" 24-hour format.
CRITICAL: "ප.ව" means afternoon/PM. Add 12 to hours 1–11 for PM. Examples: "ප.ව 3.30" → "15:30", "ප.ව 9.00" → "21:00", "ප.ව 12.00" → "12:00".
"පෙ.ව" or "උදෑසන" or "උදේ" = AM (do NOT add 12). Examples: "පෙ.ව 6.30" → "06:30", "උදේ 3.30" → "03:30".
"සවස" or "රාත්‍රී" or "රාත්රී" or "දහවල්" = PM.
Midnight = "00:00". Noon = "12:00". Return null if genuinely unknown.

### birth_place_en
The English name of the birth place (translated from Sinhala if needed). Just the place name, no country suffix needed.

### lat
The latitude (decimal degrees) of the birth place. Use your geographic knowledge to return precise coordinates with minimum 4 decimal places for this specific town/city in Sri Lanka (or abroad if applicable). Return a number, not a string. Example: 8.4983 not 8.5

### lng
The longitude (decimal degrees) of the birth place. SAME requirement — minimum 4 decimal places of precision. Return a number, not a string. Example: 80.6015 not 80.6

### special_questions
Read the customer's chat conversation carefully and identify SPECIFIC personal situations, fears, or concerns the customer mentioned — things beyond generic topics.

The following sections are ALREADY generated for every customer automatically. Do NOT create questions that duplicate what these sections already cover:
- පෞරුෂය — general personality analysis
- අධ්‍යාපනය — general education analysis
- වෘත්තීය ජීවිතය සහ ආර්ථික ශක්තිය — general career and financial analysis
- ප්‍රේමය සහ විවාහ ජීවිතය — general love and marriage analysis
- දේපළ, භූමිය, නිවාස සහ වාහන භාග්‍යය — general property analysis
- ශාරීරික සෞඛ්‍යය, මාරක අපල, හදිසි අනතුරු — general health analysis
- දරු පල — general children analysis
- මෙතෙක් දැක්වූ කරුණු අනුව ජීවන ගමනේ සමස්ත සාරාංශය — overall life summary
- වර්තමාන දශාව අනුව පලාපල — current dasha period analysis
- ජීවිතයේ අභියෝග ජයගැනීම සඳහා වූ පොදු ශාස්ත්‍රීය සහ බෞද්ධ පිළියම් — remedies

So a question like "දරුඵල ගැන බලන්න" or "විවාහය ගැන කියන්න" is USELESS — those sections already do that for everyone.

A special question is ONLY valid if it targets something SPECIFIC this customer personally mentioned in the chat — a specific struggle, fear, decision, or life situation that the generic sections won't address.

Before writing each question ask yourself: "What is the best angle to frame this so Gemini gives the most honest, direct, and valuable answer — something that gives THIS customer real clarity on their specific situation and makes them feel understood?"

IMPORTANT: If the customer's chat has NO specific personal concerns beyond the generic topics — return only the mandatory question below. Do not invent extra questions. Quality over quantity.

MANDATORY: Always include these two questions for every customer (add them LAST in the array, after any specific questions):
1. question: "ඉදිරි අවුරුදු 5 තුල විශේෂයෙන් සැලකිලිමත් විය යුතු කරුණු සහ කල යුතු, නොකල යුතු දේවල්"
   sections: ["මෙතෙක් දැක්වූ කරුණු අනුව ජීවන ගමනේ සමස්ත සාරාංශය", "වර්තමාන දශාව අනුව පලාපල"]
2. question: "හදහනට අනුව ගැලපෙන ව්‍යාපාර සහ ඒවා ආරම්බ කිරීමට ගැලපෙන සුබ කාලය? දැනට ව්‍යාපාරයක් කරගෙන යන්නේ නම් එහි ඇතිවිය හැකි ගැටළු, බාදා සහ සාර්ථකත්වය වෙනුවෙන් කල යුතු දේවල්"
   sections: ["වෘත්තීය ජීවිතය සහ ආර්ථික ශක්තිය", "වර්තමාන දශාව අනුව පලාපල"]

Each question MUST:
- Be written in Sinhala
- Be about something SPECIFIC the customer mentioned — not a topic the generic sections already cover
- Be framed to get a direct, honest answer that gives real clarity to this specific person
- NOT be about remedies, pirith, or Buddhist practices

Example of BAD: "දරුඵල සම්බන්ධයෙන් හදහනේ දැක්වෙන්නේ කුමක්ද" — this is what the දරු පල section already does
Example of GOOD: "මෙම පුද්ගලයා දැනටමත් විවාහ වී ඇති නමුත් දරුවෙකු ලැබීම වසර 3ක් තිස්සේ ප්‍රමාද වෙමින් පවතී — හදහන අනුව ඊට සත්‍ය හේතුව කුමක්ද සහ ඒ තත්ත්වය වෙනස් වන්නේ කවදාද?"

The "sections" array must use the exact Sinhala section keys from this list:
- "පෞරුෂය"
- "අධ්‍යාපනය"
- "වෘත්තීය ජීවිතය සහ ආර්ථික ශක්තිය"
- "ප්‍රේමය සහ විවාහ ජීවිතය"
- "දේපළ, භූමිය, නිවාස සහ වාහන භාග්‍යය"
- "ශාරීරික සෞඛ්‍යය, මාරක අපල, හදිසි අනතුරු"
- "දරු පල"
- "මෙතෙක් දැක්වූ කරුණු අනුව ජීවන ගමනේ සමස්ත සාරාංශය"
- "වර්තමාන දශාව අනුව පලාපල"
- "ජීවිතයේ අභියෝග ජයගැනීම සඳහා වූ පොදු ශාස්ත්‍රීය සහ බෞද්ධ පිළියම්"`;

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          birth_date_iso:  { type: 'string', nullable: true },
          birth_time_24h:  { type: 'string', nullable: true },
          birth_place_en:  { type: 'string' },
          lat:             { type: 'number' },
          lng:             { type: 'number' },
          special_questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                sections: { type: 'array', items: { type: 'string' } },
              },
              required: ['question', 'sections'],
            },
          },
        },
        required: ['birth_date_iso', 'birth_time_24h', 'birth_place_en', 'lat', 'lng', 'special_questions'],
      },
    },
  });

  console.log('Calling Gemini...\n');
  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();
  const parsed = JSON.parse(raw);
  console.log(JSON.stringify(parsed, null, 2));
}

test().catch(console.error);
