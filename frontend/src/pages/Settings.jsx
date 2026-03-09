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
      await api.put('/settings/prompt', { prompt, error_message: errorMsg }, { params });
      qc.invalidateQueries({ queryKey: ['settings', clientId] });
      toast.success('AI prompt saved');
    } catch {
      toast.error('Failed to save prompt');
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

          {/* AI System Prompt (all users, superadmin needs a client selected) */}
          {card(superAdmin ? `AI System Prompt${clientId ? ` — ${clientId}` : ''}` : 'AI System Prompt', (
            <>
              {superAdmin && !clientId ? (
                <p className="text-sm text-slate-400">Select a client from the sidebar to edit their AI prompt.</p>
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
                      placeholder="We're experiencing a short technical issue. We'll get back to you in a few minutes — sorry for the inconvenience! 🙏"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y"
                    />
                    <p className="text-xs text-slate-400 mt-1">Sent instantly to customers when the AI service is temporarily down. Leave blank to use the default message.</p>
                  </div>
                  <div><Button type="submit" disabled={promptLoading}>{promptLoading ? 'Saving…' : 'Save'}</Button></div>
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
