import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const login    = useAuthStore(s => s.login);
  const navigate = useNavigate();
  const { theme, toggle } = useThemeStore();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.post('/login', { username: username.trim(), password });
      login(res.data.token, res.data.user);
      navigate('/chat', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    outline: 'none',
    background: 'var(--bg-base)',
    color: 'var(--text-1)',
    transition: 'border-color 0.15s',
  };

  return (
    <div
      className="h-app overflow-y-auto flex items-center justify-center p-4"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="w-full max-w-sm">

        {/* Logo + brand */}
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl font-black text-white"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #38bdf8)',
              boxShadow: '0 0 32px rgba(99,102,241,0.35)',
            }}
          >N</div>
          <h1
            className="text-2xl font-bold"
            style={{
              background: 'linear-gradient(135deg,#818cf8,#38bdf8)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >Agent Nova</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
            AI-Powered WhatsApp Automation
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-2)' }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Client ID or superadmin"
                required
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck="false"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-2)' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="current-password"
                spellCheck="false"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            {error && (
              <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 font-medium rounded-lg text-sm text-white border-0 cursor-pointer transition-opacity disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#6366f1,#38bdf8)' }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Theme toggle */}
        <div className="text-center mt-4">
          <button
            onClick={toggle}
            className="text-xs border-0 bg-transparent cursor-pointer transition-colors"
            style={{ color: 'var(--text-3)' }}
          >
            {theme === 'dark' ? '☀ Switch to Light mode' : '☽ Switch to Dark mode'}
          </button>
        </div>
      </div>
    </div>
  );
}
