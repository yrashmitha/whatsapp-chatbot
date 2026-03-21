import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';

const NOVA_WA      = 'https://wa.me/94776891125';
const NOVA_WA_DEMO = 'https://wa.me/94771784821?text=Hey%20Nova%2C%20I%20need%20a%20favor%20from%20you';

/* ── Inline SVG icons, no emojis ── */
const IconCheck = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="9" cy="9" r="9" fill="rgba(0,212,255,0.12)"/>
    <path d="M5 9l3 3 5-5" stroke="#00d4ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconArrow = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconWA = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
    <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.413A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z" fillRule="evenodd" clipRule="evenodd"/>
  </svg>
);

/* ── Scenario slider data ── */
const SCENARIOS = [
  {
    tag: 'Upsell',
    color: '#7c3aed',
    messages: [
      { from: 'customer', text: 'Basic package eka ganna one, LKR 2,500 eka.' },
      { from: 'nova',     text: 'Sure! Basic eka 2,500, a uata godak aya ganne (3,500) mokda eke priority support + 2 extra sessions thiyenawane. Oya mokada hithanne me gana? Eka try karanawada me wenuwata? 👀' },
      { from: 'customer', text: 'hm ok standard eka denna' },
      { from: 'nova',     text: 'Done! Standard package add karagatta 🎉 Oyage me wisthara harida kiyala confirm karanna.' },
    ],
  },
  {
    tag: 'Cross-sell',
    color: '#0891b2',
    messages: [
      { from: 'customer', text: 'yoga mat ekak order karanna one' },
      { from: 'nova',     text: 'Great choice! Oyage cart ekata yoga mat add karagatta ✅\n\nQuick one: water bottle ekak combo deal thibba, LKR 500 off. Add karannada? Godak aya dekama gaththa 🙂' },
      { from: 'customer', text: 'haa add karanna' },
      { from: 'nova',     text: 'Added! Oyage total: LKR 3,200. Delivery address eka kiyanna puluwanda?' },
    ],
  },
  {
    tag: 'Angry customer',
    color: '#dc2626',
    messages: [
      { from: 'customer', text: 'දවස් 3ක් පහු උනා, තාම ඕඩර් එක ආවෙ නෑ. අපිව රවට්ටනවද ???😡' },
      { from: 'nova',     text: 'ඔයාගෙ කලකිරීම සහ ගැටලුව මට තේරෙනවා. සමාවෙන්න 🙏 Order #PJ2026-0042 චෙක් කලා. අද තමා කුරියර් එකට දීල තියෙන්නෙ, හෙට උදේට ඔයාට ලැබේවි.' },
      { from: 'customer', text: 'ok' },
      { from: 'nova',     text: 'ඔයාගෙ ඉවසිමට ස්තූතියි. හෙට අනිවර්යෙන්ම එයි 🙏' },
    ],
  },
  {
    tag: 'Review request',
    color: '#f59e0b',
    messages: [
      { from: 'nova',     text: 'Oyage order eka complete! Hope you loved it 🎉' },
      { from: 'customer', text: 'yes thank you, very nice' },
      { from: 'nova',     text: 'Ahannath sathutui 😊 ! minute dila apita Google review ekak denna puluanda? Oyage feedback eka apita godak prayojanawath 🙏' },
      { from: 'customer', text: 'sure, link eka denna' },
      { from: 'nova',     text: 'Thank you so much! 🌟 → g.page/r/nova-review' },
    ],
  },
  {
    tag: 'Payment slip',
    color: '#059669',
    messages: [
      { from: 'customer', text: '[image: payment_slip.jpg]', isImg: true },
      { from: 'nova',     text: 'Slip eka baluwa ✅\n\nAmount: LKR 5,500 · BOC · March 19\nOyage order #PJ2026-0089 confirmed! We\'ll process it now.' },
      { from: 'customer', text: 'thank you!' },
      { from: 'nova',     text: 'Our pleasure! Order eka dispatch wenna 24h gannawa. Update karannam 📦' },
    ],
  },
];

/* ── Animated Nova character ── */
function NovaCharacter() {
  return (
    <div className="nova-char-wrap">
      <div className="nova-ring nova-ring-1" />
      <div className="nova-ring nova-ring-2" />
      <div className="nova-dot nova-dot-1" />
      <div className="nova-dot nova-dot-2" />
      <div className="nova-char-inner">
        <img src="/nova-robot.png" alt="Nova" style={{ width: 130, height: 130, objectFit: 'contain', display: 'block' }} />
      </div>
    </div>
  );
}

function NovaCharacterSVGUnused() {
  return (
    <div className="nova-char-wrap">
      <div className="nova-char-inner">
        <svg width="120" height="142" viewBox="0 0 120 142" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="nvShell" cx="36%" cy="26%" r="74%">
              <stop offset="0%" stopColor="#edf3fa"/>
              <stop offset="100%" stopColor="#b4c4d6"/>
            </radialGradient>
            <radialGradient id="nvVisor" cx="34%" cy="26%" r="68%">
              <stop offset="0%" stopColor="#0d1d2e"/>
              <stop offset="100%" stopColor="#03060e"/>
            </radialGradient>
            <radialGradient id="nvBody" cx="32%" cy="20%" r="78%">
              <stop offset="0%" stopColor="#e2ecf6"/>
              <stop offset="100%" stopColor="#aebfd2"/>
            </radialGradient>
            <radialGradient id="nvEye" cx="36%" cy="30%" r="68%">
              <stop offset="0%" stopColor="#70eeff"/>
              <stop offset="100%" stopColor="#0080bb"/>
            </radialGradient>
            <radialGradient id="nvEarInner" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#5a70b8"/>
              <stop offset="100%" stopColor="#3448a0"/>
            </radialGradient>
            <filter id="nvGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="nvSmGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.8" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          {/* Headphone band */}
          <path d="M30 46 Q60 10 90 46" stroke="#8292a6" strokeWidth="6" fill="none" strokeLinecap="round"/>

          {/* Left ear cup */}
          <ellipse cx="24" cy="53" rx="13" ry="12" fill="#7888a2"/>
          <ellipse cx="24" cy="53" rx="9" ry="8" fill="url(#nvEarInner)"/>
          <ellipse cx="24" cy="53" rx="4.5" ry="4" fill="#2a3c88" opacity="0.9"/>

          {/* Right ear cup */}
          <ellipse cx="96" cy="53" rx="13" ry="12" fill="#7888a2"/>
          <ellipse cx="96" cy="53" rx="9" ry="8" fill="url(#nvEarInner)"/>
          <ellipse cx="96" cy="53" rx="4.5" ry="4" fill="#2a3c88" opacity="0.9"/>

          {/* Mic arm on right cup */}
          <path d="M96 60 L101 67" stroke="#8292a6" strokeWidth="2.2" strokeLinecap="round"/>
          <circle cx="101.5" cy="68" r="2.8" fill="url(#nvEarInner)"/>

          {/* Head outer shell */}
          <ellipse cx="60" cy="52" rx="38" ry="40" fill="url(#nvShell)"/>

          {/* Dark visor */}
          <ellipse cx="60" cy="54" rx="30" ry="32" fill="url(#nvVisor)"/>

          {/* Visor gloss highlight */}
          <ellipse cx="50" cy="38" rx="9" ry="4.5" fill="rgba(255,255,255,0.06)" transform="rotate(-18 50 38)"/>

          {/* Left eye — dark bg ring */}
          <ellipse cx="45" cy="50" rx="10" ry="9.5" fill="#001525"/>
          {/* Left eye — iris glow */}
          <ellipse cx="45" cy="50" rx="7.5" ry="7" fill="url(#nvEye)" filter="url(#nvGlow)"/>
          {/* Left eye — pupil */}
          <ellipse cx="45" cy="50" rx="4" ry="3.8" fill="#002244"/>
          {/* Left eye — reflection */}
          <ellipse cx="42.5" cy="47.2" rx="2" ry="1.5" fill="rgba(255,255,255,0.82)"/>

          {/* Right eye — dark bg ring */}
          <ellipse cx="75" cy="50" rx="10" ry="9.5" fill="#001525"/>
          {/* Right eye — iris glow */}
          <ellipse cx="75" cy="50" rx="7.5" ry="7" fill="url(#nvEye)" filter="url(#nvGlow)"/>
          {/* Right eye — pupil */}
          <ellipse cx="75" cy="50" rx="4" ry="3.8" fill="#002244"/>
          {/* Right eye — reflection */}
          <ellipse cx="72.5" cy="47.2" rx="2" ry="1.5" fill="rgba(255,255,255,0.82)"/>

          {/* Smile */}
          <path d="M49 67 Q60 77 71 67" stroke="#00d4ff" strokeWidth="2.8" fill="none" strokeLinecap="round" filter="url(#nvSmGlow)"/>

          {/* Left arm */}
          <ellipse cx="17" cy="101" rx="12" ry="17" fill="url(#nvBody)" transform="rotate(-10 17 101)"/>
          {/* Right arm */}
          <ellipse cx="103" cy="101" rx="12" ry="17" fill="url(#nvBody)" transform="rotate(10 103 101)"/>

          {/* Main body */}
          <ellipse cx="60" cy="108" rx="40" ry="31" fill="url(#nvBody)"/>

          {/* Blue cuffs */}
          <ellipse cx="17" cy="114" rx="10" ry="5.5" fill="#3a78cc" opacity="0.72"/>
          <ellipse cx="103" cy="114" rx="10" ry="5.5" fill="#3a78cc" opacity="0.72"/>

          {/* Feet */}
          <ellipse cx="44" cy="134" rx="15" ry="9" fill="url(#nvBody)"/>
          <ellipse cx="76" cy="134" rx="15" ry="9" fill="url(#nvBody)"/>

          {/* Chest logo circle */}
          <circle cx="60" cy="106" r="18" fill="rgba(0,212,255,0.07)" stroke="rgba(0,212,255,0.28)" strokeWidth="1.3"/>
          {/* Chest logo inner ring */}
          <circle cx="60" cy="106" r="13" fill="none" stroke="rgba(0,212,255,0.1)" strokeWidth="0.8"/>

          {/* N letter on chest */}
          <path d="M52 97 L52 115 L68 97 L68 115" stroke="#00d4ff" strokeWidth="3.2" fill="none"
            strokeLinecap="round" strokeLinejoin="round" filter="url(#nvSmGlow)"/>
        </svg>
      </div>
    </div>
  );
}

/* ── Animated phone mockup with scenario slider ── */
function PhoneMockup() {
  const [scene, setScene]   = useState(0);
  const [step, setStep]     = useState(0);
  const [fading, setFading] = useState(false);
  const timerRef            = useRef(null);
  const autoRef             = useRef(null);

  const msgs = SCENARIOS[scene].messages;

  /* Advance bubbles */
  useEffect(() => {
    if (step >= msgs.length) return;
    timerRef.current = setTimeout(() => setStep(s => s + 1), step === 0 ? 500 : 1500);
    return () => clearTimeout(timerRef.current);
  }, [step, msgs.length]);

  /* Auto-advance scenario every 8 s after all bubbles shown */
  useEffect(() => {
    if (step < msgs.length) return;
    autoRef.current = setTimeout(() => switchScene((scene + 1) % SCENARIOS.length), 2800);
    return () => clearTimeout(autoRef.current);
  }, [step, msgs.length, scene]);

  const switchScene = useCallback((idx) => {
    clearTimeout(timerRef.current);
    clearTimeout(autoRef.current);
    setFading(true);
    setTimeout(() => {
      setScene(idx);
      setStep(0);
      setFading(false);
    }, 260);
  }, []);

  const accentColor = SCENARIOS[scene].color;

  return (
    <div className="phone-outer">
      {/* scenario tabs */}
      <div className="scenario-tabs">
        {SCENARIOS.map((s, i) => (
          <button
            key={i}
            className={`scenario-tab ${i === scene ? 'active' : ''}`}
            style={i === scene ? { borderColor: s.color, color: s.color, background: `${s.color}18` } : {}}
            onClick={() => switchScene(i)}
          >
            {s.tag}
          </button>
        ))}
      </div>

      {/* phone */}
      <div className="phone-wrap">
        <div className="phone-wrap-glow" style={{ background: `radial-gradient(circle, ${accentColor}22 0%, transparent 65%)` }} />
        <div className="phone-shell" style={{ borderColor: `${accentColor}28` }}>
          <div className="phone-bar">
            <span style={{ fontSize: 11, fontWeight: 600 }}>9:41</span>
            <span style={{ fontSize: 11, opacity: 0.5 }}>●●●</span>
          </div>
          <div className="phone-header">
            <div className="phone-avatar" style={{ background: `linear-gradient(135deg, ${accentColor}, #001a33)` }}>N</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>Nova</div>
              <div style={{ fontSize: 11, color: '#4ade80', marginTop: 2 }}>online</div>
            </div>
            <div className="phone-scenario-tag" style={{ background: `${accentColor}22`, color: accentColor }}>
              {SCENARIOS[scene].tag}
            </div>
          </div>
          <div className={`phone-body ${fading ? 'fading' : ''}`}>
            {msgs.slice(0, step).map((m, i) => (
              <div key={i} className={`bubble ${m.from}`} style={m.from === 'nova' ? { background: `${accentColor}28`, borderLeft: `2px solid ${accentColor}55` } : {}}>
                {m.isImg
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                      Payment slip sent
                    </span>
                  : m.text.split('\n').map((line, j) => <span key={j}>{line}{j < m.text.split('\n').length - 1 && <br/>}</span>)
                }
              </div>
            ))}
            {step < msgs.length && step > 0 && (
              <div className={`typing-dots ${msgs[step]?.from === 'nova' ? 'nova-typing' : ''}`}>
                <span/><span/><span/>
              </div>
            )}
          </div>
          <div className="phone-input"><span>Message…</span></div>
        </div>
      </div>

      {/* progress dots */}
      <div className="scene-dots">
        {SCENARIOS.map((s, i) => (
          <button key={i} className={`scene-dot ${i === scene ? 'active' : ''}`}
            style={i === scene ? { background: s.color, width: 20 } : {}}
            onClick={() => switchScene(i)} />
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  useEffect(() => { document.title = 'Agent Nova: Your Business, Always On'; }, []);

  return (
    <div className="ln-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ln-root {
          font-family: 'Space Grotesk', sans-serif;
          background: #06080f;
          color: #f0f0f0;
          min-height: 100vh;
          overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
        }

        /* ─ Nav ─ */
        .ln-nav {
          position: sticky; top: 0; z-index: 100;
          background: rgba(6,8,15,0.9); backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding: 0 24px;
        }
        .ln-nav-inner {
          max-width: 1080px; margin: 0 auto;
          display: flex; align-items: center; justify-content: space-between; height: 58px;
        }
        .ln-logo {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 800; font-size: 17px; letter-spacing: -0.5px;
          display: flex; align-items: center; gap: 8px; color: #fff;
          text-decoration: none;
        }
        .ln-logo img { width: 30px; height: 30px; border-radius: 8px; object-fit: cover; }
        .ln-logo-fallback {
          width: 30px; height: 30px; border-radius: 8px;
          background: linear-gradient(135deg, #00d4ff, #0066cc);
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; font-weight: 800; color: #000;
        }
        .ln-accent { color: #00d4ff; }

        /* ─ Buttons ─ */
        .btn-cta {
          display: inline-flex; align-items: center; gap: 8px;
          background: #00d4ff; color: #000;
          font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px;
          border: none; border-radius: 10px; padding: 12px 24px;
          cursor: pointer; text-decoration: none;
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .btn-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(0,212,255,0.35); }
        .btn-cta.lg { font-size: 16px; padding: 15px 30px; border-radius: 12px; }
        .btn-ghost {
          display: inline-flex; align-items: center; gap: 8px;
          background: transparent; color: rgba(255,255,255,0.75);
          font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 15px;
          border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 12px 24px;
          cursor: pointer; text-decoration: none;
          transition: border-color 0.15s, color 0.15s, transform 0.15s;
        }
        .btn-ghost:hover { border-color: rgba(255,255,255,0.35); color: #fff; transform: translateY(-2px); }
        .btn-ghost.lg { font-size: 16px; padding: 15px 30px; border-radius: 12px; }

        /* ─ Hero ─ */
        .hero {
          max-width: 1080px; margin: 0 auto;
          padding: 72px 24px 80px;
          display: grid; grid-template-columns: 1fr;
          gap: 56px; align-items: center;
        }
        @media (min-width: 860px) {
          .hero { grid-template-columns: 1fr 1fr; padding: 96px 24px 100px; }
        }
        .hero-label {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
          color: rgba(255,255,255,0.6); margin-bottom: 20px;
          font-family: 'Space Grotesk', sans-serif;
          text-transform: uppercase;
        }
        .hero-label::before { content: ''; display: block; width: 6px; height: 6px; border-radius: 50%; background: #00d4ff; }
        .hero h1 {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 800; font-size: clamp(34px, 5vw, 58px);
          line-height: 1.08; letter-spacing: -0.03em;
          color: #fff; margin-bottom: 22px;
        }
        .hero h1 em { font-style: normal; color: #00d4ff; }
        .hero-sub {
          font-size: 17px; line-height: 1.75;
          color: rgba(255,255,255,0.7); max-width: 480px;
          margin-bottom: 36px;
        }
        .hero-ctas { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 36px; }
        .hero-trust {
          display: flex; flex-direction: column; gap: 10px;
        }
        .trust-item {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; color: rgba(255,255,255,0.65);
        }

        /* ─ Phone mockup & slider ─ */
        .phone-outer { display: flex; flex-direction: column; align-items: center; gap: 16px; }

        .scenario-tabs {
          display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
          max-width: 320px;
        }
        .scenario-tab {
          font-family: 'Space Grotesk', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.5px; padding: 5px 12px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.6);
          background: transparent; cursor: pointer;
          transition: all 0.18s;
        }
        .scenario-tab:hover { color: rgba(255,255,255,0.7); border-color: rgba(255,255,255,0.25); }
        .scenario-tab.active { font-weight: 700; }

        .phone-scenario-tag {
          margin-left: auto; font-size: 10px; font-weight: 700;
          font-family: 'Space Grotesk', sans-serif; letter-spacing: 0.5px;
          padding: 3px 8px; border-radius: 5px; text-transform: uppercase;
        }

        .scene-dots { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
        .scene-dot {
          height: 5px; width: 5px; border-radius: 999px;
          background: rgba(255,255,255,0.2); border: none; cursor: pointer;
          padding: 0; transition: all 0.25s;
        }
        .scene-dot.active { width: 20px; }

        .phone-wrap {
          display: flex; justify-content: center; align-items: center;
          position: relative;
        }
        .phone-wrap-glow {
          position: absolute; width: 300px; height: 300px; border-radius: 50%;
          pointer-events: none; transition: background 0.4s;
        }
        .phone-shell {
          width: 268px;
          background: #111827;
          border-radius: 28px;
          border: 1.5px solid rgba(255,255,255,0.1);
          overflow: hidden;
          box-shadow: 0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,212,255,0.08);
          position: relative;
        }
        .phone-bar {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 16px 6px;
          font-size: 11px; color: rgba(255,255,255,0.5);
        }
        .phone-header {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 14px 10px;
          background: #1a2234;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .phone-avatar {
          width: 32px; height: 32px; border-radius: 50%;
          background: linear-gradient(135deg, #00d4ff, #0066cc);
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 800; color: #000;
          font-family: 'Space Grotesk', sans-serif;
          flex-shrink: 0;
        }
        .phone-body {
          padding: 14px 12px;
          height: 248px;
          overflow: hidden;
          display: flex; flex-direction: column; gap: 8px;
          background: #0d1117;
          justify-content: flex-end;
        }
        .bubble {
          max-width: 85%; padding: 9px 12px;
          font-size: 12px; line-height: 1.55;
          border-radius: 14px; animation: bubbleIn 0.25s ease;
        }
        .bubble.customer {
          background: #1e2d42; color: rgba(255,255,255,0.85);
          border-bottom-left-radius: 4px; align-self: flex-start;
        }
        .bubble.nova {
          background: #004d6b; color: #e0f7ff;
          border-bottom-right-radius: 4px; align-self: flex-end;
        }
        @keyframes bubbleIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .phone-body.fading { opacity: 0; transition: opacity 0.22s; }
        .phone-body { transition: opacity 0.22s; }
        .nova-typing { align-self: flex-end; background: rgba(0,212,255,0.15) !important; }
        .typing-dots {
          display: flex; gap: 4px; align-items: center;
          padding: 10px 12px; background: #1e2d42;
          border-radius: 14px; border-bottom-left-radius: 4px;
          width: fit-content; align-self: flex-start;
        }
        .typing-dots span {
          width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.4);
          animation: dot 1.2s infinite;
        }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dot { 0%,60%,100%{transform:translateY(0);opacity:0.4} 30%{transform:translateY(-4px);opacity:1} }
        .phone-input {
          padding: 10px 14px;
          background: #1a2234;
          border-top: 1px solid rgba(255,255,255,0.06);
          font-size: 12px; color: rgba(255,255,255,0.25);
        }

        /* ─ Nova character ─ */
        .nova-char-wrap {
          position: relative; width: 140px; height: 140px;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 4px;
        }
        .nova-char-inner {
          position: relative; z-index: 2;
          animation: nova-float 3.8s ease-in-out infinite;
          filter: drop-shadow(0 10px 28px rgba(0,212,255,0.4));
        }
        .nova-char-inner svg { display: block; }
        .nova-ring {
          position: absolute; border-radius: 50%; pointer-events: none;
        }
        .nova-ring-1 {
          width: 132px; height: 132px;
          border: 1.5px solid transparent;
          border-top-color: rgba(0,212,255,0.7);
          border-right-color: rgba(0,212,255,0.15);
          animation: nova-spin 2.8s linear infinite;
        }
        .nova-ring-2 {
          width: 152px; height: 152px;
          border: 1px solid transparent;
          border-bottom-color: rgba(0,150,255,0.5);
          border-left-color: rgba(0,150,255,0.1);
          animation: nova-spin 5s linear infinite reverse;
        }
        .nova-dot {
          position: absolute; width: 7px; height: 7px;
          border-radius: 50%; background: #00d4ff;
          box-shadow: 0 0 8px #00d4ff; z-index: 1;
        }
        .nova-dot-1 { animation: nova-orbit 2.8s linear infinite; }
        .nova-dot-2 {
          width: 5px; height: 5px; background: #4db8ff;
          animation: nova-orbit2 5s linear infinite reverse;
        }
        @keyframes nova-float {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-11px); }
        }
        @keyframes nova-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes nova-orbit {
          from { transform: rotate(0deg) translateX(66px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(66px) rotate(-360deg); }
        }
        @keyframes nova-orbit2 {
          from { transform: rotate(0deg) translateX(76px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(76px) rotate(-360deg); }
        }

        /* ─ Section base ─ */
        .section { padding: 88px 24px; }
        .section.alt { background: rgba(255,255,255,0.015); border-top: 1px solid rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.05); }
        .container { max-width: 1080px; margin: 0 auto; }

        /* ─ Section label ─ */
        .section-label {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 11px; font-weight: 700;
          letter-spacing: 2px; text-transform: uppercase;
          color: #00d4ff; margin-bottom: 16px;
        }

        /* ─ Stats bar ─ */
        .stats-bar {
          border-top: 1px solid rgba(255,255,255,0.07);
          border-bottom: 1px solid rgba(255,255,255,0.07);
          padding: 0 24px;
        }
        .stats-inner {
          max-width: 1080px; margin: 0 auto;
          display: grid; grid-template-columns: repeat(2, 1fr);
          gap: 0;
        }
        @media (min-width: 600px) { .stats-inner { grid-template-columns: repeat(4, 1fr); } }
        .stat {
          padding: 32px 20px 28px;
          border-right: 1px solid rgba(255,255,255,0.07);
          text-align: center;
          display: flex; flex-direction: column; align-items: center; gap: 10px;
        }
        .stat:last-child { border-right: none; }
        .stat-icon {
          width: 44px; height: 44px;
          display: flex; align-items: center; justify-content: center;
          border-radius: 12px;
          position: relative;
        }
        .stat-num {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 32px; font-weight: 800; color: #fff;
          letter-spacing: -0.04em; line-height: 1;
        }
        .stat-num span { color: #00d4ff; }
        .stat-label { font-size: 12px; color: rgba(255,255,255,0.62); }

        /* Stat icon animations */
        @keyframes bolt-pulse {
          0%, 100% { filter: drop-shadow(0 0 4px #00d4ff88); opacity: 1; }
          50% { filter: drop-shadow(0 0 12px #00d4ffcc); opacity: 0.7; }
        }
        @keyframes hand-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes inf-flow {
          from { stroke-dashoffset: 200; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes bubble-bounce {
          0%, 100% { transform: translateY(0); }
          40%      { transform: translateY(-4px); }
        }
        @keyframes bubble-bounce2 {
          0%, 100% { transform: translateY(0); }
          60%      { transform: translateY(-4px); }
        }
        .stat-bolt { animation: bolt-pulse 1.8s ease-in-out infinite; }
        .stat-clock-hand { transform-origin: 12px 12px; animation: hand-spin 4s linear infinite; }
        .stat-clock-hand-slow { transform-origin: 12px 12px; animation: hand-spin 24s linear infinite; }
        .stat-inf { stroke-dasharray: 200; animation: inf-flow 2.5s ease-in-out infinite alternate; }
        .stat-bub1 { animation: bubble-bounce 2s ease-in-out infinite; }
        .stat-bub2 { animation: bubble-bounce2 2s ease-in-out infinite; }

        /* ─ Problems ─ */
        .problems-grid {
          display: grid; grid-template-columns: 1fr;
          gap: 1px; background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 16px; overflow: hidden; margin-top: 40px;
        }
        @media (min-width: 640px) { .problems-grid { grid-template-columns: 1fr 1fr; } }
        .problem-cell {
          background: #06080f; padding: 28px 24px;
          transition: background 0.2s;
        }
        .problem-cell:hover { background: rgba(0,212,255,0.04); }
        .problem-time {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 11px; font-weight: 700; letter-spacing: 1px;
          color: #00d4ff; text-transform: uppercase; margin-bottom: 12px;
        }
        .problem-msg {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 15px; font-weight: 700; color: #fff;
          line-height: 1.4; margin-bottom: 8px;
        }
        .problem-sub { font-size: 13px; color: rgba(255,255,255,0.65); line-height: 1.6; }

        /* ─ Feature list ─ */
        .feature-split {
          display: grid; grid-template-columns: 1fr;
          gap: 64px; align-items: start; margin-top: 16px;
        }
        @media (min-width: 780px) { .feature-split { grid-template-columns: 1fr 1fr; } }
        .feature-list { display: flex; flex-direction: column; gap: 20px; }
        .feature-item { display: flex; gap: 14px; align-items: flex-start; }
        .feature-icon { flex-shrink: 0; margin-top: 2px; }
        .feature-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 15px; font-weight: 700; color: #fff;
          margin-bottom: 4px;
        }
        .feature-desc { font-size: 13px; color: rgba(255,255,255,0.68); line-height: 1.65; }
        .feature-highlight {
          background: rgba(0,212,255,0.05);
          border: 1px solid rgba(0,212,255,0.12);
          border-radius: 16px; padding: 28px;
          display: flex; flex-direction: column; gap: 20px;
        }
        .feature-highlight .badge {
          display: inline-block; font-size: 11px; font-weight: 700;
          font-family: 'Space Grotesk', sans-serif; letter-spacing: 1px;
          text-transform: uppercase; color: #00d4ff;
          background: rgba(0,212,255,0.1); border-radius: 6px; padding: 4px 10px;
          width: fit-content;
        }
        .feature-highlight h3 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 20px; font-weight: 800; color: #fff; line-height: 1.3;
          letter-spacing: -0.02em;
        }
        .feature-highlight p { font-size: 14px; color: rgba(255,255,255,0.68); line-height: 1.7; }

        /* ─ More grid ─ */
        .more-grid {
          display: grid; grid-template-columns: 1fr; gap: 16px;
        }
        @media (min-width: 600px) { .more-grid { grid-template-columns: 1fr 1fr; } }
        .more-card {
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 16px; padding: 28px 24px;
          display: flex; flex-direction: column; gap: 12px;
          transition: border-color 0.2s, transform 0.2s;
        }
        .more-card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.14); }
        .more-card-tag {
          display: inline-block; font-size: 11px; font-weight: 700;
          font-family: 'Space Grotesk', sans-serif; letter-spacing: 1px;
          text-transform: uppercase; padding: 4px 10px; border-radius: 6px; width: fit-content;
        }
        .more-card-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 17px; font-weight: 700; color: #fff; line-height: 1.3;
        }
        .more-card-desc { font-size: 14px; color: rgba(255,255,255,0.68); line-height: 1.7; }
        .more-card-stat {
          font-size: 12px; font-weight: 600;
          font-family: 'Space Grotesk', sans-serif;
          border-left: 2px solid; padding-left: 10px; margin-top: 4px;
          opacity: 0.85;
        }

        /* ─ Steps ─ */
        .steps { display: flex; flex-direction: column; margin-top: 40px; }
        .step {
          display: flex; gap: 24px;
          padding: 32px 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          position: relative;
        }
        .step:last-child { border-bottom: none; }
        .step-num {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 48px; font-weight: 800;
          color: rgba(255,255,255,0.22); line-height: 1;
          flex-shrink: 0; width: 60px; letter-spacing: -0.04em;
          user-select: none;
        }
        .step-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 700; color: #fff;
          margin-bottom: 6px;
        }
        .step-desc { font-size: 14px; color: rgba(255,255,255,0.68); line-height: 1.7; }

        /* ─ Testimonial ─ */
        .testimonial-grid {
          display: grid; grid-template-columns: 1fr;
          gap: 16px; margin-top: 40px;
        }
        @media (min-width: 640px) { .testimonial-grid { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 960px) { .testimonial-grid { grid-template-columns: 1fr 1fr 1fr; } }
        .testimonial {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px; padding: 24px;
        }
        .testimonial-quote {
          font-size: 14px; color: rgba(255,255,255,0.65);
          line-height: 1.7; margin-bottom: 18px;
          font-style: italic;
        }
        .testimonial-author { display: flex; align-items: center; gap: 10px; }
        .testimonial-avatar {
          width: 36px; height: 36px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 800; font-size: 13px; color: #000; flex-shrink: 0;
        }
        .testimonial-name {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 2px;
        }
        .testimonial-biz { font-size: 11px; color: rgba(255,255,255,0.55); }
        .stars { color: #f59e0b; font-size: 12px; margin-bottom: 14px; letter-spacing: 1px; }

        /* ─ Coming soon ─ */
        .roadmap {
          display: grid; grid-template-columns: 1fr; gap: 16px;
          margin-top: 40px;
        }
        @media (min-width: 640px) { .roadmap { grid-template-columns: 1fr 1fr; } }
        .roadmap-item {
          padding: 28px 24px;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          display: flex; flex-direction: column; gap: 10px;
          position: relative; overflow: hidden;
        }
        .roadmap-item::before {
          content: 'SOON'; position: absolute; top: 16px; right: 16px;
          font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
          color: rgba(255,255,255,0.2); font-family: 'Space Grotesk', sans-serif;
        }
        .roadmap-item h3 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 700; color: #fff;
        }
        .roadmap-item p { font-size: 13px; color: rgba(255,255,255,0.65); line-height: 1.65; }

        /* ─ CTA strip ─ */
        .cta-strip {
          background: linear-gradient(135deg, rgba(0,212,255,0.08) 0%, rgba(0,100,200,0.06) 100%);
          border-top: 1px solid rgba(0,212,255,0.12);
          border-bottom: 1px solid rgba(0,212,255,0.12);
          padding: 80px 24px;
          text-align: center;
        }
        .cta-strip h2 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: clamp(28px, 5vw, 48px);
          font-weight: 800; letter-spacing: -0.03em;
          color: #fff; margin-bottom: 16px; line-height: 1.1;
        }
        .cta-strip h2 em { font-style: normal; color: #00d4ff; }
        .cta-strip p { font-size: 16px; color: rgba(255,255,255,0.68); max-width: 480px; margin: 0 auto 36px; line-height: 1.7; }
        .cta-row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
        .cta-note { margin-top: 16px; font-size: 12px; color: rgba(255,255,255,0.45); }

        /* ─ Footer ─ */
        .footer { padding: 60px 24px 36px; }
        .footer-top {
          max-width: 1080px; margin: 0 auto;
          display: grid; grid-template-columns: 1fr;
          gap: 40px; padding-bottom: 48px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        @media (min-width: 640px) { .footer-top { grid-template-columns: 2fr 1fr 1fr; } }
        .footer-brand-desc {
          font-size: 13px; color: rgba(255,255,255,0.62);
          line-height: 1.7; margin-top: 12px; max-width: 260px;
        }
        .footer-col-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 11px; font-weight: 700;
          letter-spacing: 1.5px; text-transform: uppercase;
          color: rgba(255,255,255,0.55); margin-bottom: 18px;
        }
        .footer-col a {
          display: block; font-size: 14px;
          color: rgba(255,255,255,0.55); text-decoration: none;
          margin-bottom: 12px; transition: color 0.15s;
        }
        .footer-col a:hover { color: #fff; }
        .footer-bottom {
          max-width: 1080px; margin: 0 auto;
          display: flex; flex-direction: column; gap: 8px;
          align-items: center; text-align: center; padding-top: 28px;
        }
        @media (min-width: 600px) { .footer-bottom { flex-direction: row; justify-content: space-between; } }
        .footer-bottom span { font-size: 12px; color: rgba(255,255,255,0.45); }
        .footer-flag { font-size: 12px; color: rgba(255,255,255,0.45); display: flex; align-items: center; gap: 5px; }

        /* ─ Floating WA ─ */
        .wa-float {
          position: fixed; bottom: 22px; right: 20px; z-index: 999;
          background: #25d366; border-radius: 50%;
          width: 52px; height: 52px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 20px rgba(37,211,102,0.4);
          text-decoration: none; color: #fff;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .wa-float:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(37,211,102,0.55); }
      `}</style>

      {/* ── Floating WA button ── */}
      <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="wa-float" title="Try Nova">
        <IconWA />
      </a>

      {/* ── Navbar ── */}
      <nav className="ln-nav">
        <div className="ln-nav-inner">
          <Link to="/" className="ln-logo">
            <img src="/nova-logo.png" alt="Nova"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
            <div className="ln-logo-fallback" style={{ display: 'none' }}>N</div>
            Agent <span className="ln-accent">Nova</span>
          </Link>
          <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="btn-cta">
            Try Nova <IconArrow />
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div className="hero">
        <div>
          <div className="hero-label">WhatsApp AI for Sri Lankan businesses</div>
          <h1>
            Your customers aren't<br />
            waiting for <em>tomorrow</em>
          </h1>
          <p className="hero-sub">
            Nova connects to your WhatsApp number and handles every customer conversation: orders, payment slips, questions. 24 hours a day, in Sinhala and English. While you sleep.
          </p>
          <div className="hero-ctas">
            <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="btn-cta lg">
              <IconWA /> Try Nova on WhatsApp
            </a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer" className="btn-ghost lg">
              Talk to us
            </a>
          </div>
          <div className="hero-trust">
            {['No app download needed', 'Works on your existing number', 'Live in under 24 hours'].map((t, i) => (
              <div key={i} className="trust-item">
                <IconCheck /> {t}
              </div>
            ))}
          </div>
        </div>
        <PhoneMockup />
      </div>

      {/* ── Stats ── */}
      <div className="stats-bar">
        <div className="stats-inner">

          {/* Reply speed */}
          <div className="stat">
            <div className="stat-icon" style={{ background: 'rgba(0,212,255,0.08)' }}>
              <svg className="stat-bolt" width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M13 2L4.5 13.5H11L10 22L20 10H13.5L13 2Z"
                  fill="#00d4ff" stroke="#00d4ff" strokeWidth="1" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="stat-num">&lt;3<span>s</span></div>
            <div className="stat-label">Average reply time</div>
          </div>

          {/* 24/7 */}
          <div className="stat">
            <div className="stat-icon" style={{ background: 'rgba(124,58,237,0.1)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#a78bfa" strokeWidth="1.5"/>
                <line x1="12" y1="12" x2="12" y2="6"
                  stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round"
                  className="stat-clock-hand-slow"/>
                <line x1="12" y1="12" x2="16" y2="12"
                  stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round"
                  className="stat-clock-hand"/>
                <circle cx="12" cy="12" r="1.2" fill="#a78bfa"/>
              </svg>
            </div>
            <div className="stat-num">24<span>/7</span></div>
            <div className="stat-label">Always available</div>
          </div>

          {/* Infinite chats */}
          <div className="stat">
            <div className="stat-icon" style={{ background: 'rgba(5,150,105,0.1)' }}>
              <svg width="30" height="22" viewBox="0 0 30 22" fill="none">
                <path className="stat-inf"
                  d="M15 11 C15 11 12 4 7 4 C3.5 4 1 7 1 11 C1 15 3.5 18 7 18 C12 18 15 11 15 11 C15 11 18 4 23 4 C26.5 4 29 7 29 11 C29 15 26.5 18 23 18 C18 18 15 11 15 11 Z"
                  stroke="#34d399" strokeWidth="2" strokeLinecap="round" fill="none"/>
              </svg>
            </div>
            <div className="stat-num">∞</div>
            <div className="stat-label">Simultaneous chats</div>
          </div>

          {/* Any language */}
          <div className="stat">
            <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.1)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path className="stat-bub1"
                  d="M4 5C4 3.9 4.9 3 6 3H16C17.1 3 18 3.9 18 5V11C18 12.1 17.1 13 16 13H9L5 16V13H6C4.9 13 4 12.1 4 11V5Z"
                  fill="#f59e0b" opacity="0.9"/>
                <path className="stat-bub2"
                  d="M18 9H20C21.1 9 22 9.9 22 11V16C22 17.1 21.1 18 20 18H19V20L16 18H12C10.9 18 10 17.1 10 16V14"
                  stroke="#fcd34d" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
              </svg>
            </div>
            <div className="stat-num">Any<span> lang</span></div>
            <div className="stat-label">Sinhala, English + more</div>
          </div>

        </div>
      </div>

      {/* ── Problems ── */}
      <section className="section">
        <div className="container">
          <div className="section-label">Sound familiar?</div>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(26px,4vw,40px)', letterSpacing: '-0.03em', maxWidth: 560, lineHeight: 1.15 }}>
            This is costing you customers every single day
          </h2>
          <div className="problems-grid">
            {[
              { time: '11:47 PM', msg: 'Customer asked about your packages.', sub: "You're asleep. They messaged a competitor 8 minutes later." },
              { time: '2:30 PM',  msg: '6 people waiting. You\'re in a meeting.', sub: "Every minute they wait is a minute closer to leaving." },
              { time: 'Every day',msg: 'Another blurry payment screenshot arrives.', sub: "Real slip? Reused slip? Someone has to check. Every. Single. Time." },
              { time: 'Always',   msg: '"What are your prices?" Again.', sub: "Your team copies the same reply 30 times a day instead of doing real work." },
            ].map((p, i) => (
              <div key={i} className="problem-cell">
                <div className="problem-time">{p.time}</div>
                <div className="problem-msg">{p.msg}</div>
                <div className="problem-sub">{p.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="section alt">
        <div className="container">
          <div className="section-label">What Nova does</div>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(26px,4vw,40px)', letterSpacing: '-0.03em', maxWidth: 500, lineHeight: 1.15, marginBottom: 8 }}>
            Everything your WhatsApp needs to run itself
          </h2>
          <div className="feature-split">
            <div className="feature-list">
              {[
                { title: 'Replies in Sinhala and English', desc: 'Detects the language automatically. Switches when your customer switches. No setup.' },
                { title: 'Takes orders through conversation', desc: 'Collects name, address, package, date (whatever you need) through natural chat. Saves to your dashboard.' },
                { title: 'Reads payment slips', desc: 'Customer sends a screenshot or PDF. Nova reads the amount, date, bank, and flags suspicious slips.' },
                { title: 'Searches your product catalog', desc: "Customer asks what you have. Nova searches your catalog in real time and shows what's relevant." },
                { title: 'Your team can take over anytime', desc: 'Turn AI off for one chat. Reply manually. Turn it back on. Nova picks up where you left off.' },
              ].map((f, i) => (
                <div key={i} className="feature-item">
                  <div className="feature-icon"><IconCheck /></div>
                  <div>
                    <div className="feature-title">{f.title}</div>
                    <div className="feature-desc">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="feature-highlight">
                <div className="badge">Payment Verification</div>
                <h3>Nova catches fake payment slips, automatically</h3>
                <p>When a customer sends a payment slip, Nova reads it using AI vision. It checks the date, amount, and bank. If the payment date is before the order was placed, Nova flags it as suspicious before your team even sees it.</p>
              </div>
              <div className="feature-highlight">
                <div className="badge">Full Admin Dashboard</div>
                <h3>Every conversation. Every order. One place.</h3>
                <p>See all customer chats live. Manage orders and track payments. Send quick replies. Your whole team works from the same dashboard.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Nova does more ── */}
      <section className="section">
        <div className="container">
          <div className="section-label">Beyond answering questions</div>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(26px,4vw,40px)', letterSpacing: '-0.03em', lineHeight: 1.15, marginBottom: 48 }}>
            Nova is a sales assistant,<br />not just a reply bot
          </h2>
          <div className="more-grid">
            {[
              {
                tag: 'Upsell',
                color: '#7c3aed',
                title: 'Sells the better option, naturally',
                desc: 'When a customer picks the basic package, Nova knows when to mention the upgrade. Not pushy. Just helpful. Like a good salesperson.',
                stat: 'Higher average order value',
              },
              {
                tag: 'Cross-sell',
                color: '#0891b2',
                title: 'Recommends what goes with it',
                desc: 'Customer orders a yoga mat? Nova mentions the bottle combo. A dress? Nova asks about accessories. At the right moment, in the right tone.',
                stat: 'More items per order',
              },
              {
                tag: 'Reviews',
                color: '#f59e0b',
                title: 'Asks for reviews after delivery',
                desc: 'After an order is complete, Nova follows up warmly in the customer\'s language and sends your Google review link. No manual follow-up needed.',
                stat: 'More 5-star reviews, automatically',
              },
              {
                tag: 'De-escalation',
                color: '#dc2626',
                title: 'Handles angry customers with calm',
                desc: "Customer sends a wall of angry text? Nova doesn't panic. It acknowledges, empathises, checks the order, and responds with composure. Keeps situations from getting worse.",
                stat: 'Fewer escalations to your team',
              },
            ].map((c, i) => (
              <div key={i} className="more-card">
                <div className="more-card-tag" style={{ background: `${c.color}18`, color: c.color }}>{c.tag}</div>
                <h3 className="more-card-title">{c.title}</h3>
                <p className="more-card-desc">{c.desc}</p>
                <div className="more-card-stat" style={{ borderLeftColor: c.color, color: c.color }}>
                  {c.stat}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <div className="section-label">Getting started</div>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(26px,4vw,40px)', letterSpacing: '-0.03em', lineHeight: 1.15 }}>
            Live in 24 hours
          </h2>
          <div className="steps">
            {[
              { n: '01', title: 'Connect your WhatsApp number', desc: 'We connect Nova to your existing WhatsApp Business number. Your customers keep messaging the same number. Nothing changes on their end.' },
              { n: '02', title: 'Train Nova on your business', desc: 'Tell Nova your products, prices, and how you want to talk to customers. Upload your FAQ document. Done in a few hours.' },
              { n: '03', title: 'Go live. Nova handles the rest.', desc: 'Every message is answered instantly, 24/7. You watch from the dashboard. Jump in whenever you want.' },
            ].map((s, i) => (
              <div key={i} className="step">
                <div className="step-num">{s.n}</div>
                <div style={{ paddingTop: 6 }}>
                  <div className="step-title">{s.title}</div>
                  <div className="step-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Roadmap ── */}
      <section className="section">
        <div className="container">
          <div className="section-label">What's coming</div>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(26px,4vw,40px)', letterSpacing: '-0.03em', lineHeight: 1.15, marginBottom: 8 }}>
            Nova is just getting started
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', marginBottom: 0, maxWidth: 480, lineHeight: 1.7 }}>Clients who join now get early access to everything we launch.</p>
          <div className="roadmap">
            {[
              { title: 'POS & Inventory Management', desc: 'Stock tracking, QR code scanning, sales reports. Your shop and your WhatsApp, connected.' },
              { title: 'Branded Product Catalog Website', desc: 'Every client gets their own link. Customers browse your products like a proper website, built automatically from Nova.' },
              { title: 'AI Voice Call Answering', desc: 'Nova answers your inbound calls, understands what callers say, and responds with a natural AI voice.' },
              { title: 'Broadcast & Campaigns', desc: 'Send promotional messages to your customer list through approved WhatsApp templates.' },
            ].map((r, i) => (
              <div key={i} className="roadmap-item">
                <h3>{r.title}</h3>
                <p>{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <div className="cta-strip">
        <NovaCharacter />
        <h2 style={{ marginTop: 28 }}>Stop losing customers<br />to <em>silence</em></h2>
        <p>Message Nova on WhatsApp right now. See it respond. No sign-up. No credit card. Just open WhatsApp.</p>
        <div className="cta-row">
          <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="btn-cta lg">
            <IconWA /> Try Nova on WhatsApp
          </a>
          <a href={NOVA_WA} target="_blank" rel="noreferrer" className="btn-ghost lg">
            Talk to us directly
          </a>
        </div>
        <div className="cta-note">No contracts · No setup fees · Cancel anytime</div>
      </div>

      {/* ── Footer ── */}
      <footer className="footer">
        <div className="footer-top">
          <div>
            <Link to="/" className="ln-logo" style={{ textDecoration: 'none' }}>
              <img src="/nova-logo.png" alt="Nova"
                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
              <div className="ln-logo-fallback" style={{ display: 'none' }}>N</div>
              Agent <span className="ln-accent">Nova</span>
            </Link>
            <p className="footer-brand-desc">AI-powered WhatsApp automation for Sri Lankan businesses. Your business, always on.</p>
            <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="btn-cta" style={{ marginTop: 20 }}>
              Try Nova Free →
            </a>
          </div>
          <div className="footer-col">
            <div className="footer-col-title">Product</div>
            <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer">Try Nova</a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">Get a Demo</a>
            <Link to="/pricing">Pricing</Link>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">Custom Features</a>
          </div>
          <div className="footer-col">
            <div className="footer-col-title">Company</div>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">About</a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">Contact</a>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Use</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Agent Nova. All rights reserved.</span>
          <span className="footer-flag">Built in Sri Lanka 🇱🇰</span>
        </div>
      </footer>
    </div>
  );
}
