import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import MenusPanel from '../components/MenusPanel';
import Button from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import api, { authApi } from '../lib/api';

const TABS = ['Assistant', 'Menus', 'API Keys', 'Password', 'Quick Replies'];
const ADMIN_TABS = ['Assistant', 'Menus', 'API Keys', 'Password', 'Quick Replies', 'Consultation'];

function TokenInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2 items-center">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="shrink-0 px-3 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer bg-white text-slate-500 hover:bg-slate-50"
      >{show ? 'Hide' : 'Show'}</button>
    </div>
  );
}

export default function Settings() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const toast = useToast();
  const qc = useQueryClient();

  const clientId = superAdmin ? selectedClientId : user?.clientId;
  const params   = clientId ? { client_id: clientId } : {};

  const [activeTab, setActiveTab] = useState('Assistant');

  // ── Password ──────────────────────────────────────────────────────────────
  const [pwd, setPwd]             = useState({ current: '', newPwd: '', confirm: '' });
  const [pwdLoading, setPwdLoading] = useState(false);
  const [clientPwd, setClientPwd] = useState({ clientId: selectedClientId || '', newPwd: '' });
  const [clientPwdLoading, setClientPwdLoading] = useState(false);

  // ── AI Details ────────────────────────────────────────────────────────────
  const [prompt, setPrompt]                           = useState('');
  const [errorMsg, setErrorMsg]                       = useState('');
  const [contactNumber, setContactNumber]             = useState('');
  const [ownerPhone, setOwnerPhone]                   = useState('');
  const [thinkingBudget, setThinkingBudget]           = useState('');
  const [knowledgeBaseEnabled, setKnowledgeBaseEnabled] = useState(false);
  const [productCatalogEnabled, setProductCatalogEnabled] = useState(false);
  const [pluginEnabled, setPluginEnabled]             = useState(false);
  const [orderFields, setOrderFields]                 = useState([]);
  const [newField, setNewField]                       = useState({ key: '', label: '', description: '', required: true });
  const [editingField, setEditingField]               = useState(null); // key of field being edited
  const [editingFieldData, setEditingFieldData]       = useState({});   // { label, description, required }
  const [promptLoading, setPromptLoading]             = useState(false);

  // ── API Keys ──────────────────────────────────────────────────────────────
  const [waToken, setWaToken]           = useState('');
  const [geminiKey, setGeminiKey]       = useState('');
  const [tokenSaving, setTokenSaving]   = useState(false);
  const [waTokenSet, setWaTokenSet]     = useState(false);
  const [geminiKeySet, setGeminiKeySet] = useState(false);
  const [freeAstroKey, setFreeAstroKey]       = useState('');
  const [freeAstroKeySet, setFreeAstroKeySet] = useState(false);
  const [useSystemGemini, setUseSystemGemini]       = useState(false);
  const [useSystemFreeAstro, setUseSystemFreeAstro] = useState(false);

  // ── Consultation config (superadmin only) ─────────────────────────────────
  const [consultPrompt, setConsultPrompt]     = useState('');
  const [consultMax, setConsultMax]           = useState(10);
  const [consultMsgLimit, setConsultMsgLimit] = useState(50);
  const [consultCode, setConsultCode]         = useState('');
  const [consultCodeSet, setConsultCodeSet]   = useState(false);
  const [consultSaving, setConsultSaving]     = useState(false);

  const { data: consultConfig, refetch: refetchConsultConfig } = useQuery({
    queryKey: ['consult-config'],
    queryFn: () => api.get('/consult/config').then(r => r.data),
    enabled: superAdmin && activeTab === 'Consultation',
  });
  useEffect(() => {
    if (consultConfig) {
      setConsultPrompt(consultConfig.system_prompt || '');
      setConsultMax(consultConfig.max_sessions ?? 10);
      setConsultMsgLimit(consultConfig.max_messages ?? 50);
      setConsultCodeSet(!!consultConfig.access_code_set);
    }
  }, [consultConfig]);

  const handleSaveConsult = async (e) => {
    e.preventDefault();
    setConsultSaving(true);
    try {
      const body = { system_prompt: consultPrompt, max_sessions: consultMax, max_messages: consultMsgLimit };
      if (consultCode.trim()) body.access_code = consultCode.trim();
      await api.patch('/consult/config', body);
      toast.success('Consultation settings saved');
      setConsultCode('');
      refetchConsultConfig();
    } catch { toast.error('Failed to save'); }
    finally { setConsultSaving(false); }
  };

  // ── Quick Replies ─────────────────────────────────────────────────────────
  const [replies, setReplies]     = useState([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formText, setFormText]   = useState('');
  const [qrSaving, setQrSaving]  = useState(false);

  // ── Sync clientPwd clientId ───────────────────────────────────────────────
  useEffect(() => {
    if (superAdmin && selectedClientId) setClientPwd(p => ({ ...p, clientId: selectedClientId }));
  }, [selectedClientId, superAdmin]);

  // ── Load AI settings ──────────────────────────────────────────────────────
  const { data: settingsData } = useQuery({
    queryKey: ['settings', clientId],
    queryFn: () => api.get('/settings', { params }).then(r => r.data),
    enabled: !!clientId,
  });

  // null until edited, so an untouched field never overwrites what is stored.
  const [awayDraft, setAwayDraft] = useState(null);

  const aiMode = useMutation({
    mutationFn: (arg) => api.put('/settings/ai-mode',
      typeof arg === 'boolean' ? { enabled: arg } : arg, { params }),
    onSuccess: (r) => {
      toast.success(r.data.ai_enabled ? 'The bot is answering again' : 'The bot has stopped replying to everyone');
      setAwayDraft(null);
      qc.invalidateQueries({ queryKey: ['settings', clientId] });
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not change that'),
  });

  useEffect(() => {
    if (settingsData) {
      setPrompt(settingsData.custom_prompt || '');
      setErrorMsg(settingsData.error_message || '');
      setContactNumber(settingsData.contact_number || '');
      setOwnerPhone(settingsData.owner_phone || '');
      setThinkingBudget(settingsData.thinking_budget ?? '');
      setKnowledgeBaseEnabled(!!settingsData.knowledge_base_enabled);
      setProductCatalogEnabled(!!settingsData.product_catalog_enabled);
      setPluginEnabled(!!settingsData.plugin_enabled);
      setOrderFields(settingsData.order_fields || []);
      setWaTokenSet(!!settingsData.wa_token_set);
      setGeminiKeySet(!!settingsData.gemini_api_key_set);
      setFreeAstroKeySet(!!settingsData.freeastro_api_key_set);
      setUseSystemGemini(!!settingsData.use_system_gemini_key);
      setUseSystemFreeAstro(!!settingsData.use_system_freeastro_key);
    }
  }, [settingsData]);

  // ── Load quick replies when tab opens ────────────────────────────────────
  const loadQR = () => {
    setQrLoading(true);
    api.get('/quick-replies', { params })
      .then(r => setReplies(r.data))
      .catch(() => toast.error('Failed to load quick replies'))
      .finally(() => setQrLoading(false));
  };

  useEffect(() => { if (activeTab === 'Quick Replies') loadQR(); }, [activeTab, clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Password handlers ─────────────────────────────────────────────────────
  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pwd.newPwd !== pwd.confirm) { toast.error('Passwords do not match'); return; }
    setPwdLoading(true);
    try {
      await api.put('/settings/password', { currentPassword: pwd.current, newPassword: pwd.newPwd });
      toast.success('Password changed');
      setPwd({ current: '', newPwd: '', confirm: '' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to change password');
    } finally { setPwdLoading(false); }
  };

  const handleSetClientPassword = async (e) => {
    e.preventDefault();
    if (!clientPwd.clientId || !clientPwd.newPwd) { toast.error('Fill all fields'); return; }
    setClientPwdLoading(true);
    try {
      await authApi.post('/set-password', { clientId: clientPwd.clientId, password: clientPwd.newPwd });
      toast.success(`Password set for ${clientPwd.clientId}`);
      setClientPwd(p => ({ ...p, newPwd: '' }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally { setClientPwdLoading(false); }
  };

  // ── AI Details handler ────────────────────────────────────────────────────
  const handleSavePrompt = async (e) => {
    e.preventDefault();
    if (!clientId) { toast.error('Select a client first'); return; }
    setPromptLoading(true);
    try {
      await api.put('/settings/prompt', { prompt, error_message: errorMsg, contact_number: contactNumber, owner_phone: ownerPhone, thinking_budget: thinkingBudget, knowledge_base_enabled: knowledgeBaseEnabled, product_catalog_enabled: productCatalogEnabled, order_fields: orderFields, plugin_enabled: pluginEnabled }, { params });
      qc.invalidateQueries({ queryKey: ['settings', clientId] });
      toast.success('Settings saved');
    } catch { toast.error('Failed to save settings'); }
    finally { setPromptLoading(false); }
  };

  // ── API Keys handler ─────────────────────────────────────────────────────
  const handleSaveTokens = async (e) => {
    e.preventDefault();
    if (!clientId) { toast.error('Select a client first'); return; }
    if (!waToken.trim() && !geminiKey.trim() && !freeAstroKey.trim()) { toast.error('Enter at least one key to update'); return; }
    setTokenSaving(true);
    try {
      const body = {};
      if (waToken.trim())    body.wa_token = waToken.trim();
      if (geminiKey.trim())  body.gemini_api_key = geminiKey.trim();
      if (freeAstroKey.trim()) body.freeastro_api_key = freeAstroKey.trim();
      await api.put('/settings/tokens', body, { params });
      qc.invalidateQueries({ queryKey: ['settings', clientId] });
      toast.success('API keys saved');
      setWaToken('');
      setGeminiKey('');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setTokenSaving(false); }
  };

  // ── Order fields helpers ──────────────────────────────────────────────────
  const labelToKey = (s) => s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const handleAddField = () => {
    const key   = newField.key || labelToKey(newField.label);
    const label = newField.label.trim();
    if (!key || !label) { toast.error('Label is required'); return; }
    if (orderFields.some(f => f.key === key)) { toast.error(`Key "${key}" already exists`); return; }
    setOrderFields(p => [...p, { key, label, description: newField.description.trim(), required: newField.required }]);
    setNewField({ key: '', label: '', description: '', required: true });
  };
  const removeField    = (key) => { setOrderFields(p => p.filter(f => f.key !== key)); if (editingField === key) setEditingField(null); };
  const toggleRequired = (key) => setOrderFields(p => p.map(f => f.key === key ? { ...f, required: !f.required } : f));
  const startEditField = (f) => { setEditingField(f.key); setEditingFieldData({ label: f.label, description: f.description || '', required: f.required }); };
  const saveEditField  = (key) => {
    const label = editingFieldData.label.trim();
    if (!label) { toast.error('Label is required'); return; }
    setOrderFields(p => p.map(f => f.key === key ? { ...f, label, description: editingFieldData.description.trim(), required: editingFieldData.required } : f));
    setEditingField(null);
  };

  // ── Quick replies handlers ────────────────────────────────────────────────
  const openNew  = () => { setEditingId('new'); setFormTitle(''); setFormText(''); };
  const openEdit = (r)  => { setEditingId(r.id); setFormTitle(r.title); setFormText(r.text); };
  const cancelEdit = () => setEditingId(null);

  const handleQRSave = async () => {
    if (!formTitle.trim() || !formText.trim()) return toast.error('Title and message are required');
    setQrSaving(true);
    try {
      if (editingId === 'new') {
        await api.post('/quick-replies', { title: formTitle.trim(), text: formText.trim(), ...params });
        toast.success('Added');
      } else {
        await api.put(`/quick-replies/${editingId}`, { title: formTitle.trim(), text: formText.trim(), ...params });
        toast.success('Updated');
      }
      setEditingId(null);
      loadQR();
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to save'); }
    finally { setQrSaving(false); }
  };

  const handleQRDelete = async (id) => {
    if (!window.confirm('Delete this quick reply?')) return;
    try {
      await api.delete(`/quick-replies/${id}`, { params });
      toast.success('Deleted');
      loadQR();
    } catch { toast.error('Failed to delete'); }
  };

  // ── Shared styles ─────────────────────────────────────────────────────────
  const inpCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

  const tabCls = (t) => ({
    padding: '8px 16px', fontSize: 13, fontWeight: activeTab === t ? 600 : 400, cursor: 'pointer',
    background: 'none', border: 'none', borderBottom: activeTab === t ? '2px solid #6366f1' : '2px solid transparent',
    color: activeTab === t ? '#6366f1' : '#64748b', userSelect: 'none',
  });

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <h1 className="text-lg font-semibold text-slate-800">Settings</h1>
          {/* The bot's master switch. Above the tabs on purpose: this is the
              thing you reach for in a hurry, and it should not be behind one. */}
          {settingsData && (
            <button
              onClick={() => aiMode.mutate(!(settingsData.ai_enabled !== false))}
              disabled={aiMode.isPending}
              title={settingsData.ai_enabled !== false
                ? 'The bot is answering customers. Turn it off to stop all automatic replies.'
                : 'The bot is not answering anyone. Customers still reach you; nothing is lost.'}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                settingsData.ai_enabled !== false
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
              }`}
            >
              {settingsData.ai_enabled !== false ? '🤖 Bot is ON' : '⏸ Bot is OFF for everyone'}
            </button>
          )}
        </div>
        {settingsData?.ai_enabled === false && (
          <div className="mb-4 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 max-w-2xl">
            <div className="text-red-700 font-medium mb-1.5">
              The bot is not replying to anyone. Messages still arrive in Chats for someone to answer by hand.
            </div>
            <label className="block text-slate-600 mb-1">
              Optional: send this once to anyone who writes in, at most once every six hours.
              Leave it empty and nothing is sent, which is usually what you want while
              someone is answering manually.
            </label>
            <div className="flex gap-2">
              <input
                value={awayDraft ?? (settingsData.away_message || '')}
                onChange={e => setAwayDraft(e.target.value)}
                placeholder="e.g. අද දවසේ පිළිතුරු දෙන්න ටිකක් වෙලා යයි 🙏"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
              />
              <button
                onClick={() => aiMode.mutate({ enabled: false, away_message: awayDraft ?? '' })}
                disabled={awayDraft === null || aiMode.isPending}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: 24 }}>
          {(superAdmin ? ADMIN_TABS : TABS).map(t => <button key={t} style={tabCls(t)} onClick={() => setActiveTab(t)}>{t}</button>)}
        </div>

        <div className="max-w-2xl flex flex-col gap-6">

          {/* ── Assistant tab ── */}
          {activeTab === 'Assistant' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">
                {superAdmin ? `Assistant Instructions${clientId ? `: ${clientId}` : ''}` : 'Assistant Instructions'}
              </h2>
              {superAdmin && !clientId ? (
                <p className="text-sm text-slate-400">Select a client from the top bar to edit their settings.</p>
              ) : (
                <form onSubmit={handleSavePrompt} className="flex flex-col gap-3">
                  <p className="text-xs text-slate-500">These instructions shape how your assistant replies to customers.</p>
                  <textarea rows={8} value={prompt} onChange={e => setPrompt(e.target.value)}
                    placeholder="You are a helpful assistant for [business name]…"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono" />

                  <div className="border-t border-slate-100 pt-3 mt-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Service Unavailable Message</label>
                    <textarea rows={3} value={errorMsg} onChange={e => setErrorMsg(e.target.value)}
                      placeholder="We're experiencing a short technical issue…"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y" />
                    <p className="text-xs text-slate-400 mt-1">Sent when the assistant is temporarily unavailable. Leave blank to use the default.</p>
                  </div>

                  <div className="border-t border-slate-100 pt-3 mt-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Emergency Contact Number</label>
                    <input type="text" value={contactNumber} onChange={e => setContactNumber(e.target.value)}
                      placeholder="e.g. +94771234567" className={inpCls} />
                    <p className="text-xs text-slate-400 mt-1">When the assistant cannot answer, it will share this number. Leave blank to disable.</p>
                  </div>

                  <div className="border-t border-slate-100 pt-3 mt-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Owner Notification Number</label>
                    <input type="text" value={ownerPhone} onChange={e => setOwnerPhone(e.target.value)}
                      placeholder="e.g. +94771234567" className={inpCls} />
                    <p className="text-xs text-slate-400 mt-1">When the bot falls back to the generic error reply, you will get a WhatsApp alert at this number. Leave blank to disable.</p>
                  </div>

                  <div className="border-t border-slate-100 pt-3 mt-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Reply Planning</label>
                    <select
                      value={thinkingBudget === '' ? '' : String(thinkingBudget)}
                      onChange={e => setThinkingBudget(e.target.value)}
                      className={inpCls}
                    >
                      <option value="">Standard — let the assistant plan its reply</option>
                      <option value="0">Off — follow the prompt exactly (recommended)</option>
                      <option value="2048">Light</option>
                      <option value="8192">Deep — for open-ended conversations</option>
                    </select>
                    <p className="text-xs text-slate-400 mt-1">
                      When your prompt already spells out what to say at each step, turning planning
                      off makes replies faster, cheaper, and keeps the assistant on script. Choose a
                      higher setting only if it has to work things out on its own.
                    </p>
                  </div>

                  <div className="border-t border-slate-100 pt-3 mt-1 flex flex-col gap-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={productCatalogEnabled} onChange={e => setProductCatalogEnabled(e.target.checked)} className="w-4 h-4 accent-violet-600" />
                      <div>
                        <p className="text-xs font-medium text-slate-600">Enable Product Catalog</p>
                        <p className="text-xs text-slate-400">Let your assistant search and recommend products from your catalog.</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={knowledgeBaseEnabled} onChange={e => setKnowledgeBaseEnabled(e.target.checked)} className="w-4 h-4 accent-violet-600" />
                      <div>
                        <p className="text-xs font-medium text-slate-600">Enable Knowledge Base</p>
                        <p className="text-xs text-slate-400">Let your assistant search your knowledge base to answer questions.</p>
                      </div>
                    </label>
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full shrink-0 ${pluginEnabled ? 'bg-green-500' : 'bg-slate-300'}`} />
                      <div className="flex-1">
                        <p className="text-xs font-medium text-slate-600">Custom Module</p>
                        <p className="text-xs text-slate-400">{pluginEnabled ? 'Active. Custom logic is running.' : 'Inactive.'}</p>
                      </div>
                      {superAdmin ? (
                        <input type="checkbox" checked={pluginEnabled} onChange={e => setPluginEnabled(e.target.checked)} className="w-4 h-4 accent-violet-600 cursor-pointer" />
                      ) : pluginEnabled ? (
                        <button type="button" onClick={() => setPluginEnabled(false)} className="text-xs text-red-500 underline">Disable</button>
                      ) : null}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3 mt-1">
                    <p className="text-xs font-medium text-slate-600 mb-1">Order Fields</p>
                    <p className="text-xs text-slate-400 mb-3">Define what your assistant must collect before confirming an order.</p>
                    {orderFields.length > 0 && (
                      <div className="flex flex-col gap-2 mb-3">
                        {orderFields.map(f => (
                          editingField === f.key ? (
                            <div key={f.key} className="flex flex-col gap-2 px-3 py-2.5 bg-violet-50 border border-violet-200 rounded-lg">
                              <div className="flex gap-2 flex-wrap">
                                <input
                                  type="text"
                                  value={editingFieldData.label}
                                  onChange={e => setEditingFieldData(p => ({ ...p, label: e.target.value }))}
                                  placeholder="Label"
                                  className="flex-1 min-w-[140px] text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
                                  autoFocus
                                />
                                <span className="text-xs font-mono text-slate-400 self-center px-1">key: {f.key}</span>
                              </div>
                              <input
                                type="text"
                                value={editingFieldData.description}
                                onChange={e => setEditingFieldData(p => ({ ...p, description: e.target.value }))}
                                placeholder="Description / hint (optional)"
                                className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
                              />
                              <div className="flex items-center justify-between">
                                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                                  <input type="checkbox" checked={editingFieldData.required} onChange={e => setEditingFieldData(p => ({ ...p, required: e.target.checked }))} className="accent-violet-500" />
                                  Required field
                                </label>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => setEditingField(null)} className="text-xs text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                                  <button type="button" onClick={() => saveEditField(f.key)} className="text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-1 transition-colors">Save</button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div key={f.key} className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-slate-800">{f.label}</span>
                                <span className="ml-1.5 text-xs font-mono text-slate-400">({f.key})</span>
                                {f.description && <div className="text-xs text-slate-500 mt-0.5 truncate">{f.description}</div>}
                              </div>
                              <label className="flex items-center gap-1 text-xs text-slate-600 shrink-0 cursor-pointer select-none">
                                <input type="checkbox" checked={f.required} onChange={() => toggleRequired(f.key)} className="accent-violet-500" />
                                Required
                              </label>
                              <button type="button" onClick={() => startEditField(f)} className="text-slate-400 hover:text-violet-600 text-xs px-1 transition-colors">Edit</button>
                              <button type="button" onClick={() => removeField(f.key)} className="text-slate-400 hover:text-red-500 text-xs px-1 transition-colors">Remove</button>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                    <div className="flex flex-col gap-2 border border-dashed border-slate-300 rounded-lg p-3">
                      <div className="flex gap-2 flex-wrap">
                        <input type="text" placeholder="Label (e.g. Delivery Address)" value={newField.label}
                          onChange={e => setNewField(p => ({ ...p, label: e.target.value, key: p.key || labelToKey(e.target.value) }))}
                          className="flex-1 min-w-[140px] text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400" />
                        <input type="text" placeholder="Key (auto)" value={newField.key}
                          onChange={e => setNewField(p => ({ ...p, key: e.target.value.toLowerCase().replace(/\s/g, '_') }))}
                          className="w-28 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 font-mono" />
                      </div>
                      <input type="text" placeholder="Description / hint (optional)" value={newField.description}
                        onChange={e => setNewField(p => ({ ...p, description: e.target.value }))}
                        className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400" />
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                          <input type="checkbox" checked={newField.required} onChange={e => setNewField(p => ({ ...p, required: e.target.checked }))} className="accent-violet-500" />
                          Required field
                        </label>
                        <button type="button" onClick={handleAddField} className="text-sm bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg px-3 py-1 transition-colors">+ Add</button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-1"><Button type="submit" disabled={promptLoading}>{promptLoading ? 'Saving…' : 'Save'}</Button></div>
                </form>
              )}
            </div>
          )}

          {/* ── API Keys tab ── */}
          {activeTab === 'Menus' && <MenusPanel clientId={clientId} />}

          {activeTab === 'API Keys' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-1">API Keys</h2>
              <p className="text-xs text-slate-400 mb-4">
                Your own service keys. Reports and customer replies are billed to whichever key is set here,
                so usage lands on your account. Leave a field blank to keep the existing value.
              </p>
              {!clientId ? (
                <p className="text-sm text-slate-400">Select a client from the top bar to edit their API keys.</p>
              ) : (
                <form onSubmit={handleSaveTokens} className="flex flex-col gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="block text-xs font-medium text-slate-600">WhatsApp Access Token</label>
                      {waTokenSet && <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ Set</span>}
                    </div>
                    <TokenInput value={waToken} onChange={setWaToken} placeholder={waTokenSet ? '(leave blank to keep current)' : 'EAAxxxxx...'} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="block text-xs font-medium text-slate-600">Gemini API Key</label>
                      {geminiKeySet
                        ? <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ Set</span>
                        : useSystemGemini
                          ? <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Using provider's key</span>
                          : <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Not set</span>}
                    </div>
                    <p className="text-xs text-slate-400 mb-1.5">
                      Powers customer replies and report writing. Create a key at aistudio.google.com.
                    </p>
                    <TokenInput value={geminiKey} onChange={setGeminiKey} placeholder={geminiKeySet ? '(leave blank to keep current)' : 'AIzaSy...'} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="block text-xs font-medium text-slate-600">freeastroapi Key</label>
                      {freeAstroKeySet
                        ? <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ Set</span>
                        : useSystemFreeAstro
                          ? <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Using provider's key</span>
                          : <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Not set</span>}
                    </div>
                    <p className="text-xs text-slate-400 mb-1.5">
                      Used for birth-chart and compatibility lookups from freeastroapi.com.
                    </p>
                    <TokenInput value={freeAstroKey} onChange={setFreeAstroKey} placeholder={freeAstroKeySet ? '(leave blank to keep current)' : 'your freeastroapi key'} />
                  </div>
                  {(useSystemGemini || useSystemFreeAstro) && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Some usage is currently billed to your provider's shared key. Adding your own key
                      above moves that usage onto your account. Switching back is an administrator action.
                    </p>
                  )}
                  <div className="mt-1"><Button type="submit" disabled={tokenSaving}>{tokenSaving ? 'Saving…' : 'Save API Keys'}</Button></div>
                </form>
              )}
            </div>
          )}

          {/* ── Password tab ── */}
          {activeTab === 'Password' && (
            <>
              {!superAdmin && (
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <h2 className="text-sm font-semibold text-slate-700 mb-4">Change Password</h2>
                  <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Current Password</label>
                      <input type="password" value={pwd.current} onChange={e => setPwd(p => ({ ...p, current: e.target.value }))} placeholder="••••••••" className={inpCls} /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">New Password</label>
                      <input type="password" value={pwd.newPwd} onChange={e => setPwd(p => ({ ...p, newPwd: e.target.value }))} placeholder="••••••••" className={inpCls} /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Confirm New Password</label>
                      <input type="password" value={pwd.confirm} onChange={e => setPwd(p => ({ ...p, confirm: e.target.value }))} placeholder="••••••••" className={inpCls} /></div>
                    <div className="mt-2"><Button type="submit" disabled={pwdLoading}>{pwdLoading ? 'Saving…' : 'Change Password'}</Button></div>
                  </form>
                </div>
              )}
              {superAdmin && (
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <h2 className="text-sm font-semibold text-slate-700 mb-4">Set Client Password</h2>
                  <form onSubmit={handleSetClientPassword} className="flex flex-col gap-3">
                    <p className="text-xs text-slate-500">Set or reset a CRM login password for any client.</p>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Client ID</label>
                      <input type="text" value={clientPwd.clientId} onChange={e => setClientPwd(p => ({ ...p, clientId: e.target.value }))} placeholder="e.g. royal_note" className={inpCls} /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">New Password</label>
                      <input type="password" value={clientPwd.newPwd} onChange={e => setClientPwd(p => ({ ...p, newPwd: e.target.value }))} placeholder="••••••••" className={inpCls} /></div>
                    <div className="mt-2"><Button type="submit" disabled={clientPwdLoading}>{clientPwdLoading ? 'Setting…' : 'Set Password'}</Button></div>
                  </form>
                </div>
              )}
            </>
          )}

          {/* ── Quick Replies tab ── */}
          {activeTab === 'Quick Replies' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-700">Quick Replies</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Type <span className="font-mono bg-slate-100 px-1 rounded">/</span> in chat to use these templates</p>
                </div>
                {editingId !== 'new' && (
                  <button onClick={openNew} className="px-3 py-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg border-0 cursor-pointer transition-colors">+ Add</button>
                )}
              </div>

              {editingId !== null && (
                <div className="mb-4 p-4 bg-violet-50 border border-violet-200 rounded-xl">
                  <p className="text-xs font-semibold text-violet-700 mb-3">{editingId === 'new' ? 'New Quick Reply' : 'Edit Quick Reply'}</p>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label className="text-xs font-medium text-slate-500 block mb-1">Title <span className="text-slate-400 font-normal">(e.g. "greeting")</span></label>
                      <input className={inpCls} placeholder="greeting" value={formTitle} onChange={e => setFormTitle(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 block mb-1">Message</label>
                      <textarea className={inpCls} rows={4} placeholder="Hello! How can I help you today?" value={formText} onChange={e => setFormText(e.target.value)} style={{ resize: 'vertical' }} />
                    </div>
                    <div className="flex gap-2 justify-end mt-1">
                      <button onClick={cancelEdit} className="px-4 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">Cancel</button>
                      <button onClick={handleQRSave} disabled={qrSaving} className="px-4 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 rounded-lg border-0 cursor-pointer">{qrSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                </div>
              )}

              {qrLoading ? (
                <div className="flex justify-center py-10">
                  <span className="w-5 h-5 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin inline-block" />
                </div>
              ) : replies.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No quick replies yet. Click <strong>+ Add</strong> to create one.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {replies.map(r => (
                    <li key={r.id} className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-violet-600">/{r.title}</span>
                        <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{r.text}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEdit(r)} className="px-2.5 py-1 text-xs text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer">Edit</button>
                        <button onClick={() => handleQRDelete(r.id)} className="px-2.5 py-1 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-lg border-0 cursor-pointer">Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Consultation tab (superadmin only) ── */}
          {activeTab === 'Consultation' && superAdmin && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-1">Consultation Settings</h2>
              <p className="text-xs text-slate-400 mb-4">Configure the public Nova Business Consultant chat at <code className="bg-slate-100 px-1 rounded">/consult</code>.</p>
              <form onSubmit={handleSaveConsult} className="flex flex-col gap-4">

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Max Sessions</label>
                  <input
                    type="number" min={1} max={1000}
                    value={consultMax}
                    onChange={e => setConsultMax(parseInt(e.target.value) || 1)}
                    className={inpCls}
                    style={{ maxWidth: '120px' }}
                  />
                  <p className="text-xs text-slate-400 mt-1">Maximum number of people that can start a consultation. New sessions are blocked once this limit is reached.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Max Messages per Session</label>
                  <input
                    type="number" min={1} max={500}
                    value={consultMsgLimit}
                    onChange={e => setConsultMsgLimit(parseInt(e.target.value) || 1)}
                    className={inpCls}
                    style={{ maxWidth: '120px' }}
                  />
                  <p className="text-xs text-slate-400 mt-1">Number of Nova replies allowed per session before the session ends.</p>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <label className="block text-xs font-medium text-slate-600">Access Code</label>
                    {consultCodeSet && <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ Set</span>}
                  </div>
                  <input
                    type="text"
                    value={consultCode}
                    onChange={e => setConsultCode(e.target.value)}
                    placeholder={consultCodeSet ? '(leave blank to keep current)' : 'e.g. NOVA2025'}
                    className={inpCls}
                  />
                  <p className="text-xs text-slate-400 mt-1">The invite code users must enter to access the consultation. Share it in your Facebook post.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">System Prompt</label>
                  <textarea
                    rows={14}
                    value={consultPrompt}
                    onChange={e => setConsultPrompt(e.target.value)}
                    placeholder="Leave blank to use the default CENTS framework prompt…"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
                  />
                  <p className="text-xs text-slate-400 mt-1">The persona and instructions for the business consultant. Leave blank to use the default built-in prompt.</p>
                </div>

                <div className="mt-1"><Button type="submit" disabled={consultSaving}>{consultSaving ? 'Saving…' : 'Save'}</Button></div>
              </form>
            </div>
          )}

        </div>
      </div>
    </Layout>
  );
}
