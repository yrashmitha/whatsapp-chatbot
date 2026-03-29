import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

const api = axios.create({ baseURL: '/consult' });

const BUSINESS_TYPES = [
  { label: 'Retail / Shop', emoji: '🛍️' },
  { label: 'Food & Beverage', emoji: '🍽️' },
  { label: 'Fashion & Clothing', emoji: '👗' },
  { label: 'IT / Tech Services', emoji: '💻' },
  { label: 'Professional Services', emoji: '💼' },
  { label: 'Beauty & Wellness', emoji: '💆' },
  { label: 'Agriculture', emoji: '🌾' },
  { label: 'Manufacturing', emoji: '🏭' },
  { label: 'Import / Export', emoji: '🚢' },
  { label: 'Other', emoji: '✨' },
];

function parseMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

export default function Consult() {
  const stored = (() => {
    try { return localStorage.getItem('consult_token') || null; } catch { return null; }
  })();

  const [phase, setPhase] = useState(stored ? 'chat_loading' : 'code');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', business_name: '', business_type: '', phone: '' });
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeShake, setCodeShake] = useState(false);
  const [sessionToken, setSessionToken] = useState(stored);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [slideDir, setSlideDir] = useState('right');
  const messagesEndRef = useRef(null);

  // Resume existing session
  useEffect(() => {
    if (phase !== 'chat_loading') return;
    api.get(`/session/${stored}`)
      .then(r => {
        const msgs = (r.data.messages || []).map(m => ({ role: m.role, text: m.text }));
        setMessages(msgs);
        setPhase('chat');
      })
      .catch(() => {
        // Session gone — restart
        localStorage.removeItem('consult_token');
        setSessionToken(null);
        setPhase('code');
      });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Invite code ────────────────────────────────────────────────────────────

  async function handleCodeSubmit(e) {
    e.preventDefault();
    setCodeError('');
    try {
      const { data } = await api.post('/start', { code: codeInput });
      localStorage.setItem('consult_token', data.session_token);
      setSessionToken(data.session_token);
      setPhase('onboarding');
    } catch (err) {
      setCodeError(err.response?.data?.error || 'Invalid code. Check the post and try again.');
      setCodeShake(true);
      setTimeout(() => setCodeShake(false), 600);
    }
  }

  // ── Onboarding steps ───────────────────────────────────────────────────────

  function nextStep() {
    setSlideDir('left');
    if (step < 3) {
      setStep(s => s + 1);
    } else {
      handleOnboard();
    }
  }

  function prevStep() {
    if (step === 0) return;
    setSlideDir('right');
    setStep(s => s - 1);
  }

  function canProceed() {
    if (step === 0) return form.name.trim().length > 0;
    if (step === 1) return form.business_name.trim().length > 0;
    if (step === 2) return form.business_type.length > 0;
    if (step === 3) return form.phone.trim().length >= 9;
    return false;
  }

  async function handleOnboard() {
    setLoading(true);
    setPhase('onboarding_loading');
    try {
      const { data } = await api.post('/onboard', {
        session_token: sessionToken,
        name: form.name,
        business_name: form.business_name,
        business_type: form.business_type,
        phone: form.phone,
      });
      const parts = data.parts || (data.reply ? [data.reply] : []);
      setMessages(parts.map(text => ({ role: 'model', text })));
      setPhase('chat');
    } catch (err) {
      console.error(err);
      setPhase('onboarding');
    } finally {
      setLoading(false);
    }
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  async function handleSend(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading || limitReached) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);
    try {
      const { data } = await api.post('/chat', { session_token: sessionToken, message: text });
      const parts = data.parts || (data.reply ? [data.reply] : []);
      for (let i = 0; i < parts.length; i++) {
        setMessages(prev => [...prev, { role: 'model', text: parts[i] }]);
        if (i < parts.length - 1) await new Promise(r => setTimeout(r, 600));
      }
      if (data.limit_reached) setLimitReached(true);
    } catch {
      setMessages(prev => [...prev, { role: 'model', text: "Sorry, I hit a snag. Please try again in a moment." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const pageStyle = {
    minHeight: '100dvh',
    background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1030 50%, #0f1a2a 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Space Grotesk', sans-serif",
    padding: '16px',
  };

  // ── Code screen ────────────────────────────────────────────────────────────
  if (phase === 'code') {
    return (
      <div style={pageStyle}>
        <div style={{
          width: '100%', maxWidth: '420px',
          background: 'rgba(255,255,255,0.05)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '24px',
          padding: '40px 32px',
          color: '#fff',
        }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '20px', margin: '0 auto 16px',
              background: 'linear-gradient(135deg,#6366f1,#38bdf8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '28px', fontWeight: 800, color: '#fff',
            }}>N</div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Nova — Business Consultant</h1>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: '6px' }}>
              Free strategy audit for Sri Lankan entrepreneurs
            </p>
          </div>

          <form onSubmit={handleCodeSubmit}>
            <label style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '8px' }}>
              Enter your access code
            </label>
            <input
              value={codeInput}
              onChange={e => setCodeInput(e.target.value)}
              placeholder="e.g. NOVA2025"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '14px 16px',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '12px', color: '#fff',
                fontSize: '18px', fontWeight: 600, letterSpacing: '2px',
                outline: 'none', textAlign: 'center',
                animation: codeShake ? 'shake 0.5s ease' : 'none',
              }}
            />
            {codeError && (
              <p style={{ fontSize: '13px', color: '#f87171', marginTop: '8px', textAlign: 'center' }}>
                {codeError}
              </p>
            )}
            <button
              type="submit"
              style={{
                marginTop: '20px', width: '100%', padding: '14px',
                background: 'linear-gradient(135deg,#6366f1,#38bdf8)',
                border: 'none', borderRadius: '12px',
                color: '#fff', fontSize: '15px', fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Unlock →
            </button>
          </form>
        </div>
        <style>{`
          @keyframes shake {
            0%,100%{transform:translateX(0)}
            20%{transform:translateX(-8px)}
            40%{transform:translateX(8px)}
            60%{transform:translateX(-6px)}
            80%{transform:translateX(6px)}
          }
        `}</style>
      </div>
    );
  }

  // ── Onboarding loading ─────────────────────────────────────────────────────
  if (phase === 'onboarding_loading' || phase === 'chat_loading') {
    return (
      <div style={{ ...pageStyle, gap: '16px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {[0,1,2].map(i => (
            <div key={i} style={{
              width: '10px', height: '10px', borderRadius: '50%',
              background: 'linear-gradient(135deg,#6366f1,#38bdf8)',
              animation: `bounce 1.2s ease ${i*0.2}s infinite`,
            }} />
          ))}
        </div>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>
          {phase === 'chat_loading' ? 'Resuming your session...' : 'Nova is preparing your consultation...'}
        </p>
        <style>{`
          @keyframes bounce {
            0%,80%,100%{transform:scale(0.8);opacity:0.5}
            40%{transform:scale(1.2);opacity:1}
          }
        `}</style>
      </div>
    );
  }

  // ── Onboarding steps ───────────────────────────────────────────────────────
  if (phase === 'onboarding') {
    const steps = [
      {
        emoji: '👋',
        question: "What's your name?",
        input: (
          <input
            autoFocus
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && canProceed() && nextStep()}
            placeholder="Your name"
            style={inputStyle}
          />
        ),
      },
      {
        emoji: '🏢',
        question: `Nice to meet you, ${form.name || 'there'}! What's your business called?`,
        input: (
          <input
            autoFocus
            value={form.business_name}
            onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && canProceed() && nextStep()}
            placeholder="Business name"
            style={inputStyle}
          />
        ),
      },
      {
        emoji: '🎯',
        question: 'What type of business is it?',
        input: (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '8px',
          }}>
            {BUSINESS_TYPES.map(bt => (
              <button
                key={bt.label}
                onClick={() => setForm(f => ({ ...f, business_type: bt.label }))}
                style={{
                  padding: '12px 8px', borderRadius: '12px', border: '1px solid',
                  borderColor: form.business_type === bt.label ? '#6366f1' : 'rgba(255,255,255,0.12)',
                  background: form.business_type === bt.label ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
                  color: '#fff', fontSize: '13px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '8px',
                  transition: 'all 0.15s',
                }}
              >
                <span>{bt.emoji}</span>
                <span style={{ textAlign: 'left', lineHeight: '1.3' }}>{bt.label}</span>
              </button>
            ))}
          </div>
        ),
      },
      {
        emoji: '📱',
        question: 'Your WhatsApp number?',
        input: (
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{
              ...inputStyle, width: '80px', flexShrink: 0, textAlign: 'center',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>+94</div>
            <input
              autoFocus
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g,'') }))}
              onKeyDown={e => e.key === 'Enter' && canProceed() && nextStep()}
              placeholder="7X XXX XXXX"
              type="tel"
              maxLength={9}
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
        ),
      },
    ];

    const current = steps[step];

    return (
      <div style={pageStyle}>
        <div style={{
          width: '100%', maxWidth: '480px',
          background: 'rgba(255,255,255,0.05)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '24px',
          padding: '40px 32px',
          color: '#fff',
        }}>
          {/* Progress dots */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '32px' }}>
            {steps.map((_, i) => (
              <div key={i} style={{
                height: '3px', flex: 1, borderRadius: '2px',
                background: i <= step ? 'linear-gradient(90deg,#6366f1,#38bdf8)' : 'rgba(255,255,255,0.15)',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>

          {/* Question */}
          <div style={{ fontSize: '40px', marginBottom: '12px', textAlign: 'center' }}>{current.emoji}</div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '24px', lineHeight: '1.4', textAlign: 'center' }}>
            {current.question}
          </h2>

          {current.input}

          {/* Nav buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '28px' }}>
            {step > 0 && (
              <button onClick={prevStep} style={{
                flex: 1, padding: '13px',
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '12px', color: 'rgba(255,255,255,0.7)',
                fontSize: '15px', cursor: 'pointer',
              }}>← Back</button>
            )}
            <button
              onClick={nextStep}
              disabled={!canProceed() || loading}
              style={{
                flex: 2, padding: '13px',
                background: canProceed() ? 'linear-gradient(135deg,#6366f1,#38bdf8)' : 'rgba(255,255,255,0.1)',
                border: 'none', borderRadius: '12px', color: '#fff',
                fontSize: '15px', fontWeight: 600, cursor: canProceed() ? 'pointer' : 'not-allowed',
                opacity: canProceed() ? 1 : 0.5,
                transition: 'all 0.2s',
              }}
            >
              {step < 3 ? 'Next →' : loading ? 'Starting...' : "Let's Go 🚀"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Chat view ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1030 50%, #0f1a2a 100%)',
      fontFamily: "'Space Grotesk', sans-serif",
      color: '#fff',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0,
      }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '12px',
          background: 'linear-gradient(135deg,#6366f1,#38bdf8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: '16px',
        }}>N</div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>Nova — Business Consultant</div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{
              display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
              background: '#22c55e',
            }} />
            Online
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', marginTop: '40px', fontSize: '14px' }}>
            Loading your consultation...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%', padding: '12px 16px', borderRadius: '18px',
              ...(msg.role === 'user'
                ? { background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', borderBottomRightRadius: '4px' }
                : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.9)', borderBottomLeftRadius: '4px' }
              ),
              fontSize: '14px', lineHeight: '1.6',
            }}
              dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.text) }}
            />
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: '5px', paddingLeft: '4px' }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: 'rgba(255,255,255,0.4)',
                animation: `bounce 1.2s ease ${i*0.2}s infinite`,
              }} />
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)', flexShrink: 0,
      }}>
        {limitReached ? (
          <div style={{ textAlign: 'center', fontSize: '13px', color: 'rgba(255,255,255,0.4)', padding: '8px 0' }}>
            This session has ended. Thank you for chatting with Nova.
          </div>
        ) : (
        <form onSubmit={handleSend} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            rows={1}
            style={{
              flex: 1, padding: '12px 14px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '14px', color: '#fff', fontSize: '14px',
              resize: 'none', outline: 'none',
              maxHeight: '120px', overflowY: 'auto',
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            style={{
              width: '44px', height: '44px', borderRadius: '12px', border: 'none',
              background: input.trim() && !loading ? 'linear-gradient(135deg,#6366f1,#38bdf8)' : 'rgba(255,255,255,0.1)',
              color: '#fff', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              transition: 'all 0.2s',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
        )}
      </div>

      <style>{`
        @keyframes bounce {
          0%,80%,100%{transform:scale(0.7);opacity:0.4}
          40%{transform:scale(1.1);opacity:1}
        }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '14px 16px',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '12px', color: '#fff',
  fontSize: '16px', outline: 'none',
};
