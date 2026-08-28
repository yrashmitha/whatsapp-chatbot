import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import { useFeatureGate, LockBadge } from '../components/FeatureLock';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';



/**
 * Report labels and writing instructions that used to be hardcoded constants.
 * Declared once so adding a field is one entry here rather than a useState, a
 * loader line, a save line and a JSX block that can quietly drift apart.
 */
const HOROSCOPE_EXTRAS = [
  { key: 'fixed_instructions', label: 'Fixed Writing Instructions', rows: 8,
    hint: 'Appended to every horoscope section prompt \u2014 tone, structure, and what not to repeat.' },
  { key: 'vip_section_label', label: 'VIP Section Label', rows: 2,
    hint: 'Extra section added when an order is marked VIP.' },
  { key: 'remedies_section_label', label: 'Remedies Section Label', rows: 2,
    hint: 'Must exactly match one of your section labels \u2014 it marks where the remedies half of the document begins.' },
  { key: 'special_questions_title', label: 'Special Questions Heading', rows: 2,
    hint: 'Heading above the customer\u2019s own questions. Use {year} for the current year.' },
  { key: 'quantum_report_title', label: 'Quantum Report Title', rows: 2,
    hint: 'Cover title of the quantum / aura report.' },
  { key: 'porondam_report_title', label: 'Porondam Report Title', rows: 2,
    hint: 'Cover title of the 20-Porondam report.' },
  { key: 'porondam_special_note', label: 'Porondam Special Note', rows: 4,
    hint: 'Final page of the Porondam report.' },
  { key: 'marriage_report_title', label: 'Marriage Report Title', rows: 2,
    hint: 'Cover title of the marriage report.' },
  { key: 'marriage_fixed_instructions', label: 'Marriage Fixed Instructions', rows: 6,
    hint: 'Appended to every marriage section prompt.' },
  { key: 'marriage_questions_title', label: 'Marriage Questions Heading', rows: 2,
    hint: 'Heading above the customer’s own questions in the marriage report.' },
  { key: 'marriage_question_instructions', label: 'Marriage Question Instructions', rows: 6,
    hint: 'Appended when answering the customer’s own questions.' },
];

const MATCH_EXTRAS = [
  { key: 'match_report_title', label: 'Match Report Title', rows: 2,
    hint: 'Cover title of the compatibility report.' },
  { key: 'match_questions_title', label: 'Match Questions Heading', rows: 2,
    hint: 'Heading above the couple\u2019s own questions.' },
  { key: 'match_fixed_instructions', label: 'Match Fixed Instructions', rows: 6,
    hint: 'Appended to every match-making section prompt.' },
  { key: 'match_question_instructions', label: 'Match Question Instructions', rows: 6,
    hint: 'Appended when answering the couple\u2019s own questions.' },
];

const TAROT_EXTRAS = [
  { key: 'page1_heading', label: 'Page 1 Heading', rows: 2, hint: 'Heading of the first constant page.' },
  { key: 'page2_heading', label: 'Page 2 Heading', rows: 2, hint: 'Heading of the second constant page.' },
  { key: 'page4_heading', label: 'Page 4 Heading', rows: 2, hint: 'Heading of the closing disclaimer page.' },
];

const ALL_EXTRAS = [...HOROSCOPE_EXTRAS, ...MATCH_EXTRAS, ...TAROT_EXTRAS];

/** One labelled textarea backed by the `extras` bag. */
function ExtraField({ field, value, onChange }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500 block mb-1">{field.label}</label>
      {field.hint && <p className="text-xs text-slate-400 mb-1.5">{field.hint}</p>}
      <textarea
        value={value || ''}
        onChange={e => onChange(field.key, e.target.value)}
        rows={field.rows || 3}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
        placeholder="(not set \u2014 omitted from the report)"
      />
    </div>
  );
}

function PluginCard({ pluginMeta, clientId, superAdmin, enabledAddons = [] }) {
  const toast = useToast();
  const isHoroscope       = pluginMeta.id === 'horoscope_reading';
  const isCallAnswering   = pluginMeta.id === 'ai_call_answering';
  const isImageAnalyzer   = pluginMeta.id === 'image_analyzer';
  const isTarot           = pluginMeta.id === 'tarot_reading';
  const isMetaConversions = pluginMeta.id === 'meta_conversions';

  const [config, setConfig] = useState(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [prompt2, setPrompt2] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt]               = useState('');
  const [quantumSystemPrompt, setQuantumSystemPrompt] = useState('');
  const [auraSystemPrompt, setAuraSystemPrompt]       = useState('');
  const [waMessagePrompt, setWaMessagePrompt]         = useState('');
  const [aiFillPrompt, setAiFillPrompt]               = useState('');
  const [horoscopeSections, setHoroscopeSections]     = useState([]);
  const [quantumSections, setQuantumSections]         = useState([]);
  const [quantumEnabled, setQuantumEnabled]           = useState(true);
  const [sectionGuides, setSectionGuides]             = useState({});
  const [specialNote, setSpecialNote]                 = useState('');
  // One bag for the declarative fields above, instead of 16 more useState hooks.
  const [extras, setExtras] = useState({});
  const setExtra = (key, val) => setExtras(p => ({ ...p, [key]: val }));
  const [marriageSystemPrompt, setMarriageSystemPrompt] = useState('');
  const [marriageSections, setMarriageSections]         = useState([]);
  const [marriageSpecialNote, setMarriageSpecialNote]   = useState('');
  const [marriageWaPrompt, setMarriageWaPrompt]         = useState('');
  const [matchSystemPrompt, setMatchSystemPrompt]       = useState('');
  const [matchSections, setMatchSections]               = useState([]);
  const [matchSpecialNote, setMatchSpecialNote]         = useState('');
  const [matchAiFillPrompt, setMatchAiFillPrompt]       = useState('');
  // Entitlement, not identity: the backend enforces the same addon check.
  const showMatch = enabledAddons.includes('match_making');
  const [greeting, setGreeting]         = useState('');
  const [ttsVoice, setTtsVoice]                   = useState('');
  const [sttLanguage, setSttLanguage]             = useState('');
  const [verificationPrompt, setVerificationPrompt] = useState('');
  const [extractionPrompt, setExtractionPrompt]     = useState('');
  const [expectedAccount, setExpectedAccount]       = useState('');
  const [expectedBank, setExpectedBank]             = useState('');
  const [expectedNames, setExpectedNames]           = useState('');
  const [page1Body, setPage1Body] = useState('');
  const [page2Body, setPage2Body] = useState('');
  const [page4Body, setPage4Body] = useState('');
  const [saving, setSaving] = useState(false);
  const [pixelId, setPixelId]           = useState('');
  const [adAccountId, setAdAccountId]   = useState('');
  const [audienceId, setAudienceId]     = useState('');
  const [testEventCode, setTestEventCode] = useState('');
  const [syncing, setSyncing]                     = useState(false);
  const [creatingAudience, setCreatingAudience]   = useState(false);
  const [audienceName, setAudienceName]           = useState('WhatsApp Bot Customers');
  const [capiEvents, setCapiEvents]               = useState(null);
  const [loadingEvents, setLoadingEvents]         = useState(false);

  useEffect(() => {
    if (!clientId) return;
    setConfig(null);
    api.get(`/plugins/${pluginMeta.id}/config`, { params: { client_id: clientId } })
      .then(r => {
        setConfig(r.data);
        setName(r.data.name || pluginMeta.name);
        setPrompt(r.data.prompt || '');
        setPrompt2(r.data.prompt2 || '');
        setApiKey(r.data.api_key || '');
        setSystemPrompt(r.data.system_prompt || '');
        setQuantumSystemPrompt(r.data.quantum_system_prompt || '');
        setAuraSystemPrompt(r.data.aura_system_prompt || '');
        setWaMessagePrompt(r.data.wa_message_prompt || '');
        setAiFillPrompt(r.data.ai_fill_prompt || '');
        setHoroscopeSections(Array.isArray(r.data.horoscope_sections) ? r.data.horoscope_sections : []);
        setQuantumSections(Array.isArray(r.data.quantum_sections) ? r.data.quantum_sections : []);
        setQuantumEnabled(r.data.quantum_enabled !== false);
        setSectionGuides(r.data.section_guides && typeof r.data.section_guides === 'object' ? r.data.section_guides : {});
        setSpecialNote(r.data.special_note || '');
        setExtras(Object.fromEntries(ALL_EXTRAS.map(f => [f.key, r.data[f.key] || ''])));
        setMarriageSystemPrompt(r.data.marriage_system_prompt || '');
        setMarriageSections(Array.isArray(r.data.marriage_sections) ? r.data.marriage_sections : []);
        setMarriageSpecialNote(r.data.marriage_special_note || '');
        setMarriageWaPrompt(r.data.marriage_wa_prompt || '');
        setMatchSystemPrompt(r.data.match_system_prompt || '');
        setMatchSections(Array.isArray(r.data.match_sections) ? r.data.match_sections : []);
        setMatchSpecialNote(r.data.match_special_note || '');
        setMatchAiFillPrompt(r.data.match_ai_fill_prompt || '');
        setGreeting(r.data.greeting || '');
        const TTS_VOICES = ['achernar','achird','algenib','algieba','alnilam','aoede','autonoe','callirrhoe','charon','despina','enceladus','erinome','fenrir','gacrux','iapetus','kore','laomedeia','leda','orus','puck','pulcherrima','rasalgethi','sadachbia','sadaltager','schedar','sulafat','umbriel','vindemiatrix','zephyr','zubenelgenubi'];
        const savedVoice = (r.data.tts_voice || '').toLowerCase();
        setTtsVoice(TTS_VOICES.includes(savedVoice) ? r.data.tts_voice : 'Kore');
        setSttLanguage(r.data.stt_language || 'en-US');
        setVerificationPrompt(r.data.verification_prompt || '');
        setExtractionPrompt(r.data.extraction_prompt || '');
        setExpectedAccount(r.data.expected_account || '');
        setExpectedBank(r.data.expected_bank || '');
        setExpectedNames(r.data.expected_names || '');
        setPage1Body(r.data.page1_body || '');
        setPage2Body(r.data.page2_body || '');
        setPage4Body(r.data.page4_body || '');
        setPixelId(r.data.pixel_id || '');
        setAdAccountId(r.data.ad_account_id || '');
        setAudienceId(r.data.audience_id || '');
        setTestEventCode(r.data.test_event_code || '');
      })
      .catch(() => {
        setConfig({});
        setName(pluginMeta.name);
        setPrompt('');
        setApiKey('');
        setSystemPrompt('');
        setQuantumSystemPrompt('');
        setAuraSystemPrompt('');
        setWaMessagePrompt('');
        setAiFillPrompt('');
        setHoroscopeSections([]);
        setQuantumSections([]);
        setQuantumEnabled(true);
        setSectionGuides({});
        setSpecialNote('');
        setExtras({});
        setMarriageSystemPrompt('');
        setMarriageSections([]);
        setMarriageSpecialNote('');
        setMarriageWaPrompt('');
        setGreeting('');
        setTtsVoice('Kore');
        setSttLanguage('en-US');
        setVerificationPrompt('');
        setPage1Body('');
        setPage2Body('');
        setPage4Body('');
        setPixelId('');
        setAdAccountId('');
        setAudienceId('');
        setTestEventCode('');
      });
  }, [pluginMeta.id, clientId]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { client_id: clientId, api_key: apiKey };
      if (superAdmin) body.name = name;
      if (isHoroscope) {
        body.system_prompt         = systemPrompt;
        body.quantum_system_prompt = quantumSystemPrompt;
        body.aura_system_prompt    = auraSystemPrompt;
        body.horoscope_sections    = horoscopeSections;
        body.quantum_sections      = quantumSections;
        body.quantum_enabled       = quantumEnabled;
        body.section_guides        = sectionGuides;
        body.special_note          = specialNote;
        for (const f of HOROSCOPE_EXTRAS) body[f.key] = extras[f.key] || '';
        body.wa_message_prompt     = waMessagePrompt;
        body.ai_fill_prompt        = aiFillPrompt;
        body.marriage_system_prompt = marriageSystemPrompt;
        body.marriage_sections      = marriageSections;
        body.marriage_special_note  = marriageSpecialNote;
        body.marriage_wa_prompt     = marriageWaPrompt;
        if (showMatch) {
          body.match_system_prompt  = matchSystemPrompt;
          body.match_sections       = matchSections;
          body.match_special_note   = matchSpecialNote;
          body.match_ai_fill_prompt = matchAiFillPrompt;
          for (const f of MATCH_EXTRAS) body[f.key] = extras[f.key] || '';
        }
      } else if (isCallAnswering) {
        body.system_prompt = systemPrompt;
        body.greeting      = greeting;
        body.tts_voice     = ttsVoice;
        body.stt_language  = sttLanguage;
      } else if (isImageAnalyzer) {
        body.verification_prompt = verificationPrompt;
        body.extraction_prompt   = extractionPrompt;
        body.expected_account    = expectedAccount;
        body.expected_bank       = expectedBank;
        body.expected_names      = expectedNames;
      } else if (isTarot) {
        body.prompt     = prompt;
        body.page1_body = page1Body;
        body.page2_body = page2Body;
        body.page4_body = page4Body;
        for (const f of TAROT_EXTRAS) body[f.key] = extras[f.key] || '';
      } else if (isMetaConversions) {
        body.pixel_id        = pixelId;
        body.ad_account_id   = adAccountId;
        body.audience_id     = audienceId;
        body.test_event_code = testEventCode.trim();
      } else {
        body.prompt = prompt; // covers astro_vedic_chart and any generic plugin
        if (pluginMeta.id === 'follow_up_generator') body.prompt2 = prompt2;
      }
      await api.put(`/plugins/${pluginMeta.id}/config`, body);
      toast.success('Plugin config saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className="p-4 bg-white border border-slate-200 rounded-xl text-sm text-slate-400">Loading…</div>
    );
  }

  return (
    <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold text-slate-800 mb-0.5">{name || pluginMeta.name}</div>
        <p className="text-xs text-slate-500">{pluginMeta.description}</p>
        {superAdmin && (
          <p className="text-xs text-slate-400 mt-0.5">Plugin ID: <code className="font-mono">{pluginMeta.id}</code></p>
        )}
      </div>

      {superAdmin && (
        <div>
          <label className="text-xs font-medium text-slate-500 block mb-1">Display Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
        </div>
      )}

      {pluginMeta.id === 'astro_vedic_chart' && (
      <div>
        <label className="text-xs font-medium text-slate-500 block mb-1">FreeAstro API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="Enter your FreeAstro API key…"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 font-mono"
        />
        <p className="text-xs text-slate-400 mt-1">Get your key at freeastroapi.com</p>
      </div>
      )}

      {isCallAnswering && (
        <>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Greeting</label>
            <p className="text-xs text-slate-400 mb-1.5">First thing said when the call is answered.</p>
            <input
              type="text"
              value={greeting}
              onChange={e => setGreeting(e.target.value)}
              placeholder="Hello! How can I help you today?"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">System Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">Personality and instructions for handling calls.</p>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={6}
              placeholder="You are a helpful phone receptionist. Keep responses short and conversational..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Voice</label>
            <p className="text-xs text-slate-400 mb-1.5">Choose the speaking voice. Supports Sinhala and 100+ languages automatically.</p>
            <select
              value={ttsVoice}
              onChange={e => setTtsVoice(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              {['Kore','Leda','Puck','Charon','Zephyr','Fenrir','Enceladus','Aoede','Algieba','Despina','Sulafat','Orus','Gacrux','Iapetus','Schedar','Achernar','Achird','Algenib','Alnilam','Autonoe','Callirrhoe','Erinome','Laomedeia','Pulcherrima','Rasalgethi','Sadachbia','Sadaltager','Umbriel','Vindemiatrix','Zubenelgenubi'].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">Voice is language-agnostic. It speaks whatever language the text is in.</p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">STT Language (Caller speech)</label>
            <p className="text-xs text-slate-400 mb-1.5">Language Twilio uses to transcribe the caller's speech.</p>
            <select
              value={sttLanguage}
              onChange={e => setSttLanguage(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="en-US">English (en-US)</option>
              <option value="si-LK">Sinhala (si-LK)</option>
              <option value="en-GB">English UK (en-GB)</option>
              <option value="hi-IN">Hindi (hi-IN)</option>
              <option value="ta-LK">Tamil Sri Lanka (ta-LK)</option>
            </select>
          </div>
        </>
      )}

      {isImageAnalyzer && (
        <div>
          <label className="text-xs font-medium text-slate-500 block mb-1">Verification Instructions</label>
          <p className="text-xs text-slate-400 mb-1.5">
            How payment slips should be handled: when to confirm, when to flag mismatches, and how to respond to customers.
          </p>
          <textarea
            value={verificationPrompt}
            onChange={e => setVerificationPrompt(e.target.value)}
            rows={8}
            placeholder="When a customer sends a payment slip, check if the amount matches their pending order..."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y"
          />
          <p className="text-xs text-slate-400 mt-1">Supports images (JPG, PNG) and PDFs.</p>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <label className="text-xs font-medium text-slate-500 block mb-1">Your receiving account</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Used to check that the money actually reached you. Leave these blank and slips are
              still read, but nobody checks who was paid, and no slip is ever reported as verified.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={expectedAccount}
                onChange={e => setExpectedAccount(e.target.value)}
                placeholder="Account number"
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400"
              />
              <input
                value={expectedBank}
                onChange={e => setExpectedBank(e.target.value)}
                placeholder="Bank"
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400"
              />
            </div>
            <input
              value={expectedNames}
              onChange={e => setExpectedNames(e.target.value)}
              placeholder="Account name, and any spellings a slip might show"
              className="w-full mt-2 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400"
            />
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <label className="text-xs font-medium text-slate-500 block mb-1">Reading instructions (advanced)</label>
            <p className="text-xs text-slate-400 mb-1.5">
              What the vision pass looks for and how it reports back. Leave blank to use the
              built-in one, which reads the slip and runs the fraud checks against the account
              above. Write your own only if you need different fields or rules, and keep it
              returning a single JSON object. Write <code className="font-mono">{'{today}'}</code>
              {' '}wherever you need today's date.
            </p>
            <textarea
              value={extractionPrompt}
              onChange={e => setExtractionPrompt(e.target.value)}
              rows={10}
              placeholder="Leave blank to use the built-in reading instructions…"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 resize-y font-mono"
            />
          </div>
        </div>
      )}

      {!isHoroscope && !isCallAnswering && !isImageAnalyzer && !isTarot && !isMetaConversions && (
        <div>
          <label className="text-xs font-medium text-slate-500 block mb-1">Reading Instructions</label>
          {pluginMeta.id === 'astro_vedic_chart' && (
            <p className="text-xs text-slate-400 mb-1.5">
              Use <code className="font-mono bg-slate-100 px-1 rounded">{'{chart_json}'}</code> where chart data will be inserted.
            </p>
          )}
          {pluginMeta.id === 'media_extractor' && (
            <p className="text-xs text-slate-400 mb-1.5">
              Instructions used when reading customer-sent media — what to pull out and how to summarise it.
            </p>
          )}
          {pluginMeta.id === 'follow_up_generator' && (
            <p className="text-xs text-slate-400 mb-1.5">
              Message 1 — the ✨1 button in the chat. The conversation transcript is appended automatically.
            </p>
          )}
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={8}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
          />
          {pluginMeta.id === 'follow_up_generator' && (
            <div className="mt-4">
              <label className="text-xs font-medium text-slate-500 block mb-1">Second Follow-up</label>
              <p className="text-xs text-slate-400 mb-1.5">
                Message 2 — the ✨2 button, for a different angle on the same conversation
                (an offer, say). Leave blank and that button reuses message 1.
              </p>
              <textarea
                value={prompt2}
                onChange={e => setPrompt2(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
                placeholder="(not set — the ✨2 button will reuse message 1)"
              />
            </div>
          )}
        </div>
      )}

      {isTarot && (
        <>
          {TAROT_EXTRAS.map(f => (
            <ExtraField key={f.key} field={f} value={extras[f.key]} onChange={setExtra} />
          ))}
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Reading Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">
              How the cards should be interpreted. Available placeholders:{' '}
              <code className="font-mono bg-slate-100 px-1 rounded">{'{question}'}</code> (customer's situation) and{' '}
              <code className="font-mono bg-slate-100 px-1 rounded">{'{spread}'}</code> (the 3 drawn cards with meanings).
            </p>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="You are a warm, insightful tarot reader. A customer has come to you with the following question or situation:&#10;&#10;&quot;{question}&quot;&#10;&#10;You have drawn the following 3-card spread:&#10;&#10;{spread}"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Page 1 — ටැරෝ කාඩ්පත් යනු කුමක්ද? (What is Tarot?)</label>
            <p className="text-xs text-slate-400 mb-1.5">
              First page of every Word document. One paragraph per line. Leave blank to use the default Sinhala text.
            </p>
            <textarea
              value={page1Body}
              onChange={e => setPage1Body(e.target.value)}
              rows={7}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="ටැරෝ කාඩ්පත් යනු…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Page 2 — ටැරෝ කාඩ්පත් ක්‍රියා කරන්නේ කෙසේද? (How does Tarot work?)</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Second page of every Word document. One paragraph per line. Leave blank to use the default Sinhala text.
            </p>
            <textarea
              value={page2Body}
              onChange={e => setPage2Body(e.target.value)}
              rows={7}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="ටැරෝ කාඩ්පත් ක්‍රියා කරන්නේ…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Final Page — ආධ්‍යාත්මික වගකීම් ප්‍රකාශය (Spiritual Disclaimer)</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Last page of every Word document. One paragraph per line. Leave blank to use the default Sinhala text.
            </p>
            <textarea
              value={page4Body}
              onChange={e => setPage4Body(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="මෙම ටැරෝ කාඩ්පත් කියවීම…"
            />
          </div>
        </>
      )}

      {isMetaConversions && (
        <>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Meta Pixel / Dataset ID</label>
            <p className="text-xs text-slate-400 mb-1.5">Found in Events Manager → your Pixel → Settings. Used for Conversions API (CAPI) events.</p>
            <input
              type="text"
              value={pixelId}
              onChange={e => setPixelId(e.target.value)}
              placeholder="123456789012345"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Meta Ads Access Token</label>
            <p className="text-xs text-slate-400 mb-1.5">A system user token with <code className="font-mono bg-slate-100 px-1 rounded">ads_management</code> and <code className="font-mono bg-slate-100 px-1 rounded">ads_read</code> permissions. Different from your WhatsApp token.</p>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="EAAxxxxxxxx…"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Ad Account ID</label>
            <p className="text-xs text-slate-400 mb-1.5">Your ad account ID (e.g. <code className="font-mono bg-slate-100 px-1 rounded">act_123456789</code> — the <code className="font-mono bg-slate-100 px-1 rounded">act_</code> prefix is optional).</p>
            <input
              type="text"
              value={adAccountId}
              onChange={e => setAdAccountId(e.target.value)}
              placeholder="act_123456789"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Test Event Code</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Only while checking the setup. Events sent with a code appear in Events Manager under
              <strong> Test Events</strong> and are kept out of attribution and optimisation, so a test cannot
              teach your campaign about a sale that did not happen.
            </p>
            <input
              type="text"
              value={testEventCode}
              onChange={e => setTestEventCode(e.target.value)}
              placeholder="TEST12345"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 font-mono"
            />
            {testEventCode.trim() && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2 mt-1.5">
                Test mode is on. Real payments are being reported as tests and will not count towards
                optimisation. Clear this field when you have finished checking.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Custom Audience ID</label>
            <p className="text-xs text-slate-400 mb-1.5">The audience to sync paid customers into. Create one below if you don't have one yet.</p>
            <input
              type="text"
              value={audienceId}
              onChange={e => setAudienceId(e.target.value)}
              placeholder="Will be filled automatically after creating an audience"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 font-mono"
            />
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-2">
            <p className="text-xs font-medium text-slate-600">Create Audience</p>
            <p className="text-xs text-slate-400">Creates a new Custom Audience in your ad account and saves its ID above. Only needed once.</p>
            <input
              type="text"
              value={audienceName}
              onChange={e => setAudienceName(e.target.value)}
              placeholder="WhatsApp Bot Customers"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            <button
              type="button"
              disabled={creatingAudience}
              onClick={async () => {
                setCreatingAudience(true);
                try {
                  const r = await api.post('/plugins/meta/create-audience', { client_id: clientId, audience_name: audienceName });
                  setAudienceId(r.data.audience_id);
                  toast.success(`Audience created: ${r.data.audience_id}`);
                } catch (e) {
                  toast.error(e?.response?.data?.error || 'Failed to create audience');
                } finally {
                  setCreatingAudience(false);
                }
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 disabled:opacity-50 self-start"
            >
              {creatingAudience ? 'Creating…' : 'Create Audience'}
            </button>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-2">
            <p className="text-xs font-medium text-slate-600">Sync Audience Now</p>
            <p className="text-xs text-slate-400">
              Uploads hashed phone numbers of all paid and delivered customers to your Custom Audience.
              Includes existing orders with status <code className="font-mono bg-slate-100 px-1 rounded">payment_received</code>, <code className="font-mono bg-slate-100 px-1 rounded">paid</code>, <code className="font-mono bg-slate-100 px-1 rounded">delivered</code>, <code className="font-mono bg-slate-100 px-1 rounded">done</code>, or <code className="font-mono bg-slate-100 px-1 rounded">complete</code> — including old orders.
            </p>
            <button
              type="button"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  const r = await api.post('/plugins/meta/sync-audience', { client_id: clientId });
                  toast.success(`Synced ${r.data.synced} of ${r.data.total} customers to Meta`);
                } catch (e) {
                  toast.error(e?.response?.data?.error || 'Sync failed');
                } finally {
                  setSyncing(false);
                }
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 disabled:opacity-50 self-start"
            >
              {syncing ? 'Syncing…' : 'Sync Audience Now'}
            </button>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-600">Recent CAPI Events</p>
              <button
                type="button"
                disabled={loadingEvents}
                onClick={async () => {
                  setLoadingEvents(true);
                  try {
                    const r = await api.get('/plugins/meta/recent-events', { params: { client_id: clientId } });
                    setCapiEvents(r.data.events);
                  } catch { setCapiEvents([]); }
                  finally { setLoadingEvents(false); }
                }}
                className="text-xs text-violet-600 hover:underline disabled:opacity-50"
              >
                {loadingEvents ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {capiEvents === null ? (
              <p className="text-xs text-slate-400">Click Refresh to load recent events.</p>
            ) : capiEvents.length === 0 ? (
              <p className="text-xs text-slate-400">No events logged yet.</p>
            ) : (
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {capiEvents.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
                    <span className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${ev.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="font-medium text-slate-700 shrink-0">{ev.event_name}</span>
                    <span className="text-slate-400 shrink-0">···{ev.phone_last4}</span>
                    <span className={`truncate ${ev.status === 'ok' ? 'text-slate-500' : 'text-red-500'}`}>{ev.detail}</span>
                    <span className="text-slate-300 shrink-0 ml-auto">{new Date(ev.created_at).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {isHoroscope && (
        <>
          <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div>
              <p className="text-sm font-medium text-slate-700">Aura &amp; Quantum Feature</p>
              <p className="text-xs text-slate-400 mt-0.5">When off, the Full report option is hidden and no Aura/Quantum analysis is run.</p>
            </div>
            <button
              type="button"
              onClick={() => setQuantumEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border-0 ${quantumEnabled ? 'bg-violet-600' : 'bg-slate-300'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${quantumEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">System Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">
              The house style for every section — your astrologer persona, tone and language guidelines.
            </p>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="ඔබ දක්ෂ වෛදික ජ්‍යෝතිෂ විශේෂඥයෙකි…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Quantum Reading System Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">
              House style for the Quantum Code reading (Aura + numerology section).
            </p>
            <textarea
              value={quantumSystemPrompt}
              onChange={e => setQuantumSystemPrompt(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="Leave blank to use built-in default…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Aura Analysis Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">
              How aura selfies should be read and what to report back.
            </p>
            <textarea
              value={auraSystemPrompt}
              onChange={e => setAuraSystemPrompt(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="Leave blank to use built-in default…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">WhatsApp Message Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Once the report is ready, this decides how the accompanying WhatsApp message is written. Leave blank to skip it.
            </p>
            <textarea
              value={waMessagePrompt}
              onChange={e => setWaMessagePrompt(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="e.g. ඔබ දක්ෂ ජ්‍යෝතිෂ විශේෂඥයෙකි. ලබාදෙන හදහන් වාර්තාව පදනම් කරගෙන කෙටි WhatsApp message එකක් ලියන්න…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Auto Fill Instructions</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Used when an agent clicks <strong>Auto Fill</strong> on an order — it reads the customer's chat and order details to extract birth date/time/place, coordinates, and special questions. Available placeholders, substituted at runtime:{' '}
              <code className="font-mono">{'{{customer_name}}'}</code>, <code className="font-mono">{'{{birth_date}}'}</code>, <code className="font-mono">{'{{birth_time}}'}</code>, <code className="font-mono">{'{{birth_place}}'}</code>, <code className="font-mono">{'{{lagna}}'}</code>, <code className="font-mono">{'{{problems}}'}</code>, <code className="font-mono">{'{{items}}'}</code>, <code className="font-mono">{'{{chat_log}}'}</code>. Clear the box to restore the built-in default.
            </p>
            <textarea
              value={aiFillPrompt}
              onChange={e => setAiFillPrompt(e.target.value)}
              rows={16}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="Leave blank to use built-in default…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Quantum Sections</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Each section is written separately using the Quantum Reading house style, with the full horoscope as context.
            </p>
            {quantumSections.map((sec, i) => (
              <div key={i} className="flex gap-2 mb-2 items-start">
                <div className="flex flex-col gap-1 shrink-0 mt-1">
                  <button
                    onClick={() => { if (i === 0) return; const u = [...quantumSections]; [u[i-1], u[i]] = [u[i], u[i-1]]; setQuantumSections(u); }}
                    disabled={i === 0}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                  >▲</button>
                  <button
                    onClick={() => { if (i === quantumSections.length - 1) return; const u = [...quantumSections]; [u[i], u[i+1]] = [u[i+1], u[i]]; setQuantumSections(u); }}
                    disabled={i === quantumSections.length - 1}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                  >▼</button>
                </div>
                <input
                  type="text"
                  value={sec.label}
                  onChange={e => { const u = [...quantumSections]; u[i] = { ...u[i], label: e.target.value }; setQuantumSections(u); }}
                  placeholder="Section label…"
                  className="w-40 shrink-0 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
                <textarea
                  value={sec.guide}
                  onChange={e => { const u = [...quantumSections]; u[i] = { ...u[i], guide: e.target.value }; setQuantumSections(u); }}
                  placeholder="Writing guide for this section…"
                  rows={3}
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
                />
                <button
                  onClick={() => setQuantumSections(quantumSections.filter((_, j) => j !== i))}
                  className="mt-1 w-7 h-7 shrink-0 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-300 cursor-pointer bg-white text-xs font-bold"
                >×</button>
              </div>
            ))}
            <button
              onClick={() => setQuantumSections([...quantumSections, { label: '', guide: '' }])}
              className="mt-1 px-3 py-1.5 text-xs border border-dashed border-violet-300 text-violet-600 rounded-xl hover:bg-violet-50 cursor-pointer bg-white"
            >+ Add Section</button>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Horoscope Sections</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Which sections the report contains, and in what order. Each has a heading and a writing guide.
            </p>
            {horoscopeSections.map((sec, i) => (
              <div key={i} className="flex gap-2 mb-2 items-start">
                <div className="flex flex-col gap-1 shrink-0 mt-1">
                  <button
                    onClick={() => { if (i === 0) return; const u = [...horoscopeSections]; [u[i-1], u[i]] = [u[i], u[i-1]]; setHoroscopeSections(u); }}
                    disabled={i === 0}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                  >▲</button>
                  <button
                    onClick={() => { if (i === horoscopeSections.length - 1) return; const u = [...horoscopeSections]; [u[i], u[i+1]] = [u[i+1], u[i]]; setHoroscopeSections(u); }}
                    disabled={i === horoscopeSections.length - 1}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                  >▼</button>
                </div>
                <input
                  type="text"
                  value={sec.label}
                  onChange={e => { const u = [...horoscopeSections]; u[i] = { ...u[i], label: e.target.value }; setHoroscopeSections(u); }}
                  placeholder="Section label (heading)…"
                  className="w-48 shrink-0 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
                <textarea
                  value={sec.guide}
                  onChange={e => { const u = [...horoscopeSections]; u[i] = { ...u[i], guide: e.target.value }; setHoroscopeSections(u); }}
                  placeholder="Writing guide for this section…"
                  rows={3}
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
                />
                <button
                  onClick={() => setHoroscopeSections(horoscopeSections.filter((_, j) => j !== i))}
                  className="mt-1 w-7 h-7 shrink-0 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-300 cursor-pointer bg-white text-xs font-bold"
                >×</button>
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setHoroscopeSections([...horoscopeSections, { label: '', guide: '' }])}
                className="px-3 py-1.5 text-xs border border-dashed border-violet-300 text-violet-600 rounded-xl hover:bg-violet-50 cursor-pointer bg-white"
              >+ Add Section</button>
              {horoscopeSections.length === 0 && Object.keys(sectionGuides).length > 0 && (
                <button
                  onClick={() => setHoroscopeSections(Object.entries(sectionGuides).map(([label, guide]) => ({ label, guide })))}
                  className="px-3 py-1.5 text-xs border border-dashed border-slate-300 text-slate-500 rounded-xl hover:bg-slate-50 cursor-pointer bg-white"
                >↺ Load defaults</button>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Special Note (Final Page)</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Static text added as the last page of every Word document (e.g. disclaimer, contact info).
            </p>
            <textarea
              value={specialNote}
              onChange={e => setSpecialNote(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              placeholder="විශේෂ ශාස්ත්‍රීය සටහන…"
            />
          </div>

          {/* Report labels and writing instructions. Nothing here is inherited from
              another client — a blank field simply means the text is omitted. */}
          <div className="mt-2 pt-4 border-t border-slate-200 flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Report Labels &amp; Instructions</p>
              <p className="text-xs text-slate-400 mt-0.5">
                These have no built-in defaults. A blank field is omitted from the report;
                a blank system prompt stops generation rather than producing an unbranded one.
              </p>
            </div>
            {HOROSCOPE_EXTRAS.map(f => (
              <ExtraField key={f.key} field={f} value={extras[f.key]} onChange={setExtra} />
            ))}
            {showMatch && MATCH_EXTRAS.map(f => (
              <ExtraField key={f.key} field={f} value={extras[f.key]} onChange={setExtra} />
            ))}
          </div>

          {/* ── Marriage Reading (💍) ─────────────────────────────────────── */}
          <div className="mt-2 pt-4 border-t border-slate-200">
            <p className="text-sm font-semibold text-slate-800">💍 Marriage Reading</p>
            <p className="text-xs text-slate-400 mt-0.5">
              A separate report generated from the same chart data as the horoscope. Admins run it from the 💍 button on an order (the horoscope chart must exist first). It has its own system prompt, sections, PDF and WhatsApp message.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Marriage System Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">
              House style for every marriage section. The chart data is added automatically.
            </p>
            <textarea
              value={marriageSystemPrompt}
              onChange={e => setMarriageSystemPrompt(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100 resize-y font-mono"
              placeholder="Leave blank to use built-in default…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Marriage Sections</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Each entry is one heading in the marriage report, in this order.
            </p>
            {marriageSections.map((sec, i) => (
              <div key={i} className="flex gap-2 mb-2 items-start">
                <div className="flex flex-col gap-1 shrink-0 mt-1">
                  <button
                    onClick={() => { if (i === 0) return; const u = [...marriageSections]; [u[i-1], u[i]] = [u[i], u[i-1]]; setMarriageSections(u); }}
                    disabled={i === 0}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                  >▲</button>
                  <button
                    onClick={() => { if (i === marriageSections.length - 1) return; const u = [...marriageSections]; [u[i], u[i+1]] = [u[i+1], u[i]]; setMarriageSections(u); }}
                    disabled={i === marriageSections.length - 1}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                  >▼</button>
                </div>
                <input
                  type="text"
                  value={sec.label}
                  onChange={e => { const u = [...marriageSections]; u[i] = { ...u[i], label: e.target.value }; setMarriageSections(u); }}
                  placeholder="Section label (heading)…"
                  className="w-48 shrink-0 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
                />
                <textarea
                  value={sec.guide}
                  onChange={e => { const u = [...marriageSections]; u[i] = { ...u[i], guide: e.target.value }; setMarriageSections(u); }}
                  placeholder="Writing guide for this section…"
                  rows={3}
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100 resize-y font-mono"
                />
                <button
                  onClick={() => setMarriageSections(marriageSections.filter((_, j) => j !== i))}
                  className="mt-1 w-7 h-7 shrink-0 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-300 cursor-pointer bg-white text-xs font-bold"
                >×</button>
              </div>
            ))}
            <button
              onClick={() => setMarriageSections([...marriageSections, { label: '', guide: '' }])}
              className="mt-1 px-3 py-1.5 text-xs border border-dashed border-pink-300 text-pink-600 rounded-xl hover:bg-pink-50 cursor-pointer bg-white"
            >+ Add Section</button>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Marriage WhatsApp Message Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">
              System prompt used to turn the finished marriage report into a WhatsApp message. Leave blank to disable the message.
            </p>
            <textarea
              value={marriageWaPrompt}
              onChange={e => setMarriageWaPrompt(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100 resize-y font-mono"
              placeholder="e.g. ලබාදෙන විවාහ පලාපල වාර්තාව පදනම් කරගෙන කෙටි WhatsApp පණිවිඩයක් ලියන්න…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Marriage Special Note (Final Page)</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Static text added as the last page of every marriage document.
            </p>
            <textarea
              value={marriageSpecialNote}
              onChange={e => setMarriageSpecialNote(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100 resize-y font-mono"
              placeholder="විශේෂ සටහන…"
            />
          </div>

          {/* ── Match Making (💑) ─────────────────────────────────────────── */}
          {showMatch && (
          <>
          <div className="mt-2 pt-4 border-t border-slate-200">
            <p className="text-sm font-semibold text-slate-800">💑 Match Making (ගැළපීම)</p>
            <p className="text-xs text-slate-400 mt-0.5">
              A couple compatibility report built from TWO charts. Admins run it from the 💑 button on an order — the Match Making tab collects both partners&apos; birth details and a &ldquo;Check Sign&rdquo; per person. It has its own house style, sections, Auto Fill instructions and PDF.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Match Making System Prompt</label>
            <p className="text-xs text-slate-400 mb-1.5">
              House style for every section. Both charts are added automatically, each labelled පිරිමි / ගැහැනු.
            </p>
            <textarea
              value={matchSystemPrompt}
              onChange={e => setMatchSystemPrompt(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 resize-y font-mono"
              placeholder="Leave blank to use built-in default…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Match Making Sections</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Each entry is one heading in the compatibility report, in this order.
            </p>
            {matchSections.map((sec, i) => (
              <div key={i} className="flex gap-2 mb-2 items-start">
                <div className="flex flex-col gap-1 shrink-0 mt-1">
                  <button
                    onClick={() => { if (i === 0) return; const u = [...matchSections]; [u[i-1], u[i]] = [u[i], u[i-1]]; setMatchSections(u); }}
                    disabled={i === 0}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                  >▲</button>
                  <button
                    onClick={() => { if (i === matchSections.length - 1) return; const u = [...matchSections]; [u[i], u[i+1]] = [u[i+1], u[i]]; setMatchSections(u); }}
                    disabled={i === matchSections.length - 1}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-white text-xs"
                  >▼</button>
                </div>
                <input
                  type="text"
                  value={sec.label}
                  onChange={e => { const u = [...matchSections]; u[i] = { ...u[i], label: e.target.value }; setMatchSections(u); }}
                  placeholder="Section label (heading)…"
                  className="w-48 shrink-0 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
                <textarea
                  value={sec.guide}
                  onChange={e => { const u = [...matchSections]; u[i] = { ...u[i], guide: e.target.value }; setMatchSections(u); }}
                  placeholder="Writing guide for this section…"
                  rows={3}
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 resize-y font-mono"
                />
                <button
                  onClick={() => setMatchSections(matchSections.filter((_, j) => j !== i))}
                  className="mt-1 w-7 h-7 shrink-0 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-300 cursor-pointer bg-white text-xs font-bold"
                >×</button>
              </div>
            ))}
            <button
              onClick={() => setMatchSections([...matchSections, { label: '', guide: '' }])}
              className="mt-1 px-3 py-1.5 text-xs border border-dashed border-teal-300 text-teal-600 rounded-xl hover:bg-teal-50 cursor-pointer bg-white"
            >+ Add Section</button>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Match Making Auto Fill Instructions</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Separate from the horoscope Auto Fill because a compatibility chat contains TWO people. It must say how to decide which details belong to the boy and which to the girl. Placeholder: <code className="text-teal-600">{'{{chat_log}}'}</code>
            </p>
            <textarea
              value={matchAiFillPrompt}
              onChange={e => setMatchAiFillPrompt(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 resize-y font-mono"
              placeholder="Leave blank to use built-in default…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Match Making Special Note (Final Page)</label>
            <p className="text-xs text-slate-400 mb-1.5">
              Static text added as the last page of every match making document.
            </p>
            <textarea
              value={matchSpecialNote}
              onChange={e => setMatchSpecialNote(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 resize-y font-mono"
              placeholder="විශේෂ සටහන…"
            />
          </div>
          </>
          )}
        </>
      )}

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl cursor-pointer border-0 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}


/**
 * Placeholder card for a plugin the client has not bought.
 *
 * Deliberately shows the real name and description rather than an empty slot:
 * the point is for the client to want it, then ask for it.
 */
function LockedPluginCard({ pluginMeta, onOpen }) {
  return (
    <button
      onClick={() => onOpen(pluginMeta.id)}
      className="text-left w-full bg-white border border-dashed border-slate-300 rounded-2xl p-4 cursor-pointer hover:border-violet-300 hover:bg-violet-50/30 transition-colors"
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-sm font-semibold text-slate-500">{pluginMeta.name}</span>
        <LockBadge />
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">{pluginMeta.description}</p>
      <span className="inline-block mt-2 text-xs font-medium text-violet-500">
        Learn more &rarr;
      </span>
    </button>
  );
}

export default function Plugins() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? selectedClientId : user?.clientId;

  // The catalog comes from the backend so there is one definition of what each
  // addon is, rather than a copy here that drifts out of sync.
  const { isEnabled, showLocked, catalog, enabledAddons, lockModal } = useFeatureGate(clientId, superAdmin);

  // Every configurable plugin is listed. Ones the client has not bought render
  // as a teaser rather than being hidden, so they can discover and ask for them.
  // Only configurable addons get an editor card, but *every* addon the client
  // lacks is advertised — including ones with no settings of their own, which
  // would otherwise be invisible and so never asked for.
  const unlocked = (catalog || []).filter(p => p.configurable && isEnabled(p.id));
  const locked   = (catalog || []).filter(p => !isEnabled(p.id));

  return (
    <Layout>
      {lockModal}
      <div className="p-6 overflow-y-auto h-full">
        <h1 className="text-lg font-bold text-slate-800 mb-1">Plugins</h1>
        <p className="text-sm text-slate-500 mb-6">
          Configure plugin settings and custom prompts.
          {!clientId && <span className="text-amber-600 font-medium"> Select a client from the sidebar first.</span>}
        </p>

        {clientId && unlocked.length > 0 && (
          <div className="flex flex-col gap-4">
            {unlocked.map(p => (
              <PluginCard key={p.id} pluginMeta={p} clientId={clientId} superAdmin={superAdmin} enabledAddons={enabledAddons} />
            ))}
          </div>
        )}

        {clientId && locked.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-slate-600 mb-1">Available add-ons</h2>
            <p className="text-xs text-slate-400 mb-3">
              {superAdmin
                ? 'Not enabled for this client. Turn them on from the Addons page.'
                : 'Not enabled on your account yet \u2014 tap one to see what it does.'}
            </p>
            <div className="flex flex-col gap-3">
              {locked.map(p => (
                <LockedPluginCard key={p.id} pluginMeta={p} onOpen={showLocked} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
