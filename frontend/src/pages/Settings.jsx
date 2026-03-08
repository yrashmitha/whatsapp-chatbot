import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Button from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

export default function Settings() {
  const { user } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const toast = useToast();

  // Password form
  const [pwd, setPwd] = useState({ current: '', newPwd: '', confirm: '' });
  const [pwdLoading, setPwdLoading] = useState(false);

  // Prompt form
  const [prompt, setPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);

  // Set password for a client (superadmin)
  const [clientPwd, setClientPwd] = useState({ clientId: '', newPwd: '' });
  const [clientPwdLoading, setClientPwdLoading] = useState(false);

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  });

  useEffect(() => { if (settingsData?.prompt) setPrompt(settingsData.prompt); }, [settingsData]);

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
    setPromptLoading(true);
    try {
      await api.put('/settings/prompt', { prompt });
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
      await api.post('/auth/set-password', { clientId: clientPwd.clientId, password: clientPwd.newPwd });
      toast.success(`Password set for ${clientPwd.clientId}`);
      setClientPwd({ clientId: '', newPwd: '' });
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
          {/* Change password (non-superadmin, or prompt section for superadmin) */}
          {!superAdmin && card('Change Password', (
            <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
              {field('Current Password', inp('password', pwd.current, e => setPwd(p => ({ ...p, current: e.target.value })), '••••••••'))}
              {field('New Password', inp('password', pwd.newPwd, e => setPwd(p => ({ ...p, newPwd: e.target.value })), '••••••••'))}
              {field('Confirm New Password', inp('password', pwd.confirm, e => setPwd(p => ({ ...p, confirm: e.target.value })), '••••••••'))}
              <div className="mt-2"><Button type="submit" disabled={pwdLoading}>{pwdLoading ? 'Saving…' : 'Change Password'}</Button></div>
            </form>
          ))}

          {/* AI System Prompt */}
          {!superAdmin && card('AI System Prompt', (
            <form onSubmit={handleSavePrompt} className="flex flex-col gap-3">
              <p className="text-xs text-slate-500">This prompt is used to customize your AI assistant's behavior.</p>
              <textarea
                rows={8}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="You are a helpful assistant for [business name]…"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y font-mono"
              />
              <div><Button type="submit" disabled={promptLoading}>{promptLoading ? 'Saving…' : 'Save Prompt'}</Button></div>
            </form>
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

          {/* Superadmin: also show prompt editor per client */}
          {superAdmin && card('Note', (
            <p className="text-sm text-slate-500">As super admin, use the client selector on each page to manage individual client data. To edit a client's AI prompt, select the client, then use their settings via the client portal.</p>
          ))}
        </div>
      </div>
    </Layout>
  );
}
