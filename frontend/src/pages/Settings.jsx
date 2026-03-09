import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Button from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import api, { authApi } from '../lib/api';

export default function Settings() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const toast = useToast();
  const qc = useQueryClient();

  const clientId = superAdmin ? selectedClientId : user?.clientId;

  // Password form (client only)
  const [pwd, setPwd] = useState({ current: '', newPwd: '', confirm: '' });
  const [pwdLoading, setPwdLoading] = useState(false);

  // Prompt + error message form
  const [prompt, setPrompt] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);

  // Order fields
  const [orderFields, setOrderFields] = useState([]);
  const [newField, setNewField] = useState({ key: '', label: '', description: '', required: true });

  // Set password for a client (superadmin)
  const [clientPwd, setClientPwd] = useState({ clientId: selectedClientId || '', newPwd: '' });
  const [clientPwdLoading, setClientPwdLoading] = useState(false);

  const params = clientId ? { client_id: clientId } : {};

  const { data: settingsData } = useQuery({
    queryKey: ['settings', clientId],
    queryFn: () => api.get('/settings', { params }).then(r => r.data),
    enabled: !!clientId,
  });

  useEffect(() => {
    if (settingsData) {
      setPrompt(settingsData.custom_prompt || '');
      setErrorMsg(settingsData.error_message || '');
      setOrderFields(settingsData.order_fields || []);
    }
  }, [settingsData]);

  // Sync clientPwd.clientId when selectedClientId changes
  useEffect(() => {
    if (superAdmin && selectedClientId) {
      setClientPwd(p => ({ ...p, clientId: selectedClientId }));
    }
  }, [selectedClientId, superAdmin]);

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
    } finally {
      setPwdLoading(false);
    }
  };

  const handleSavePrompt = async (e) => {
    e.preventDefault();
    if (!clientId) { toast.error('Select a client first'); return; }
    setPromptLoading(true);
    try {
      await api.put('/settings/prompt', { prompt, error_message: errorMsg, order_fields: orderFields }, { params });
      qc.invalidateQueries({ queryKey: ['settings', clientId] });
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setPromptLoading(false);
    }
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
    } finally {
      setClientPwdLoading(false);
    }
  };

  // Order fields helpers
  const labelToKey = (s) => s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

  const handleAddField = () => {
    const key = newField.key || labelToKey(newField.label);
    const label = newField.label.trim();
    if (!key || !label) { toast.error('Label is required'); return; }
    if (orderFields.some(f => f.key === key)) { toast.error(`Key "${key}" already exists`); return; }
    setOrderFields(p => [...p, { key, label, description: newField.description.trim(), required: newField.required }]);
    setNewField({ key: '', label: '', description: '', required: true });
  };
  const removeField = (key) => setOrderFields(p => p.filter(f => f.key !== key));
  const toggleRequired = (key) => setOrderFields(p => p.map(f => f.key === key ? { ...f, required: !f.required } : f));

  const card = (title, content) => (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-sm font-semibold text-slate-700 mb-4">{title}</h2>
      {content}
    </div>
  );

  const field = (label, input) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
      {input}
    </div>
  );

  const inp = (type, value, onChange, placeholder) => (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
  );

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <h1 className="text-lg font-semibold text-slate-800 mb-6">Settings</h1>

        <div className="max-w-2xl flex flex-col gap-6">
          {/* Change password (non-superadmin only) */}
          {!superAdmin && card('Change Password', (
            <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
              {field('Current Password', inp('password', pwd.current, e => setPwd(p => ({ ...p, current: e.target.value })), '••••••••'))}
              {field('New Password', inp('password', pwd.newPwd, e => setPwd(p => ({ ...p, newPwd: e.target.value })), '••••••••'))}
              {field('Confirm New Password', inp('password', pwd.confirm, e => setPwd(p => ({ ...p, confirm: e.target.value })), '••••••••'))}
              <div className="mt-2"><Button type="submit" disabled={pwdLoading}>{pwdLoading ? 'Saving…' : 'Change Password'}</Button></div>
            </form>
          ))}

          {/* AI System Prompt + Order Fields */}
          {card(superAdmin ? `AI System Prompt${clientId ? ` — ${clientId}` : ''}` : 'AI System Prompt', (
            <>
              {superAdmin && !clientId ? (
                <p className="text-sm text-slate-400">Select a client from the sidebar to edit their settings.</p>
              ) : (
                <form onSubmit={handleSavePrompt} className="flex flex-col gap-3">
                  <p className="text-xs text-slate-500">This prompt customizes the AI assistant's behavior for this client.</p>
                  <textarea
                    rows={8}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="You are a helpful assistant for [business name]…"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
                  />

                  <div className="border-t border-slate-100 pt-3 mt-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">AI Unavailable Message</label>
                    <textarea
                      rows={3}
                      value={errorMsg}
                      onChange={e => setErrorMsg(e.target.value)}
                      placeholder="We're experiencing a short technical issue. We'll get back to you in a few minutes - sorry for the inconvenience! 🙏"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y"
                    />
                    <p className="text-xs text-slate-400 mt-1">Sent instantly to customers when the AI service is temporarily down. Leave blank to use the default message.</p>
                  </div>

                  {/* Order Fields */}
                  <div className="border-t border-slate-100 pt-3 mt-1">
                    <p className="text-xs font-medium text-slate-600 mb-1">Order Fields</p>
                    <p className="text-xs text-slate-400 mb-3">Define what data the AI must collect before confirming an order. The AI will embed these values directly in the order confirmation.</p>

                    {orderFields.length > 0 && (
                      <div className="flex flex-col gap-2 mb-3">
                        {orderFields.map(f => (
                          <div key={f.key} className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-slate-800">{f.label}</span>
                              <span className="ml-1.5 text-xs font-mono text-slate-400">({f.key})</span>
                              {f.description && <div className="text-xs text-slate-500 mt-0.5 truncate">{f.description}</div>}
                            </div>
                            <label className="flex items-center gap-1 text-xs text-slate-600 shrink-0 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={f.required}
                                onChange={() => toggleRequired(f.key)}
                                className="accent-violet-500"
                              />
                              Required
                            </label>
                            <button
                              type="button"
                              onClick={() => removeField(f.key)}
                              className="text-slate-400 hover:text-red-500 text-xs px-1 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-col gap-2 border border-dashed border-slate-300 rounded-lg p-3">
                      <div className="flex gap-2 flex-wrap">
                        <input
                          type="text"
                          placeholder="Label (e.g. Delivery Address)"
                          value={newField.label}
                          onChange={e => setNewField(p => ({ ...p, label: e.target.value, key: p.key || labelToKey(e.target.value) }))}
                          className="flex-1 min-w-[140px] text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
                        />
                        <input
                          type="text"
                          placeholder="Key (auto)"
                          value={newField.key}
                          onChange={e => setNewField(p => ({ ...p, key: e.target.value.toLowerCase().replace(/\s/g, '_') }))}
                          className="w-28 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 font-mono"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Description / hint for AI (optional, e.g. format: DD/MM/YYYY)"
                        value={newField.description}
                        onChange={e => setNewField(p => ({ ...p, description: e.target.value }))}
                        className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
                      />
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={newField.required}
                            onChange={e => setNewField(p => ({ ...p, required: e.target.checked }))}
                            className="accent-violet-500"
                          />
                          Required field
                        </label>
                        <button
                          type="button"
                          onClick={handleAddField}
                          className="text-sm bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg px-3 py-1 transition-colors"
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-1"><Button type="submit" disabled={promptLoading}>{promptLoading ? 'Saving…' : 'Save'}</Button></div>
                </form>
              )}
            </>
          ))}

          {/* Superadmin: set client password */}
          {superAdmin && card('Set Client Password', (
            <form onSubmit={handleSetClientPassword} className="flex flex-col gap-3">
              <p className="text-xs text-slate-500">Set or reset a CRM login password for any client.</p>
              {field('Client ID', inp('text', clientPwd.clientId, e => setClientPwd(p => ({ ...p, clientId: e.target.value })), 'e.g. royal_note'))}
              {field('New Password', inp('password', clientPwd.newPwd, e => setClientPwd(p => ({ ...p, newPwd: e.target.value })), '••••••••'))}
              <div className="mt-2"><Button type="submit" disabled={clientPwdLoading}>{clientPwdLoading ? 'Setting…' : 'Set Password'}</Button></div>
            </form>
          ))}
        </div>
      </div>
    </Layout>
  );
}
