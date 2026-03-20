import { useEffect, useState } from 'react';

const NOVA_WA      = 'https://wa.me/94771784821';
const NOVA_WA_DEMO = 'https://wa.me/94771784821?text=Hi%20Nova%2C%20I%20want%20to%20see%20a%20demo';

/* ── Inline SVG icons — no emojis ── */
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

/* ── Fake WhatsApp chat mockup ── */
function PhoneMockup() {
  const [step, setStep] = useState(0);

  const messages = [
    { from: 'customer', text: 'Hi, oyage packages gana kiyanna puluanda?' },
    { from: 'nova',     text: 'ආයුබෝවන්! 😊 අපිට packages කිහිපයක් තියෙනවා — ඔයා කැමති business type එක කොයි වගේද?' },
    { from: 'customer', text: 'Online clothing store' },
    { from: 'nova',     text: 'Perfect! Clothing stores වලට Nova හරිම හොඳින් work කරනවා. Orders, payments, ගොඩක් questions — සෙල්ලමෙ handle වෙනවා. Demo එකක් try කරන්නද?' },
  ];

  useEffect(() => {
    if (step >= messages.length) return;
    const t = setTimeout(() => setStep(s => s + 1), step === 0 ? 600 : 1400);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div className="phone-wrap">
      <div className="phone-shell">
        {/* status bar */}
        <div className="phone-bar">
          <span style={{ fontSize: 11, fontWeight: 600 }}>9:41</span>
          <span style={{ fontSize: 11 }}>●●●</span>
        </div>
        {/* chat header */}
        <div className="phone-header">
          <div className="phone-avatar">N</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>Nova</div>
            <div style={{ fontSize: 11, color: '#4ade80', marginTop: 2 }}>online</div>
          </div>
        </div>
        {/* messages */}
        <div className="phone-body">
          {messages.slice(0, step).map((m, i) => (
            <div key={i} className={`bubble ${m.from}`}>
              {m.text}
            </div>
          ))}
          {step < messages.length && step > 0 && (
            <div className="typing-dots">
              <span/><span/><span/>
            </div>
          )}
        </div>
        {/* input bar */}
        <div className="phone-input">
          <span>Message…</span>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  useEffect(() => { document.title = 'Agent Nova — Your Business, Always On'; }, []);

  return (
    <div className="ln-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ln-root {
          font-family: 'Inter', sans-serif;
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
          color: rgba(255,255,255,0.45); margin-bottom: 20px;
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
          color: rgba(255,255,255,0.52); max-width: 480px;
          margin-bottom: 36px;
        }
        .hero-ctas { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 36px; }
        .hero-trust {
          display: flex; flex-direction: column; gap: 10px;
        }
        .trust-item {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; color: rgba(255,255,255,0.38);
        }

        /* ─ Phone mockup ─ */
        .phone-wrap {
          display: flex; justify-content: center; align-items: center;
          position: relative;
        }
        .phone-wrap::before {
          content: ''; position: absolute;
          width: 280px; height: 280px; border-radius: 50%;
          background: radial-gradient(circle, rgba(0,212,255,0.12) 0%, transparent 70%);
          pointer-events: none;
        }
        .phone-shell {
          width: 260px;
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
          min-height: 220px;
          display: flex; flex-direction: column; gap: 8px;
          background: #0d1117;
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
          padding: 28px 20px;
          border-right: 1px solid rgba(255,255,255,0.07);
          text-align: center;
        }
        .stat:last-child { border-right: none; }
        .stat-num {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 32px; font-weight: 800; color: #fff;
          letter-spacing: -0.04em; line-height: 1;
          margin-bottom: 4px;
        }
        .stat-num span { color: #00d4ff; }
        .stat-label { font-size: 12px; color: rgba(255,255,255,0.35); }

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
        .problem-sub { font-size: 13px; color: rgba(255,255,255,0.38); line-height: 1.6; }

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
        .feature-desc { font-size: 13px; color: rgba(255,255,255,0.42); line-height: 1.65; }
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
        .feature-highlight p { font-size: 14px; color: rgba(255,255,255,0.45); line-height: 1.7; }

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
          color: rgba(255,255,255,0.06); line-height: 1;
          flex-shrink: 0; width: 60px; letter-spacing: -0.04em;
          user-select: none;
        }
        .step-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 700; color: #fff;
          margin-bottom: 6px;
        }
        .step-desc { font-size: 14px; color: rgba(255,255,255,0.42); line-height: 1.7; }

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
        .testimonial-biz { font-size: 11px; color: rgba(255,255,255,0.3); }
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
        .roadmap-item p { font-size: 13px; color: rgba(255,255,255,0.38); line-height: 1.65; }

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
        .cta-strip p { font-size: 16px; color: rgba(255,255,255,0.45); max-width: 480px; margin: 0 auto 36px; line-height: 1.7; }
        .cta-row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
        .cta-note { margin-top: 16px; font-size: 12px; color: rgba(255,255,255,0.2); }

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
          font-size: 13px; color: rgba(255,255,255,0.35);
          line-height: 1.7; margin-top: 12px; max-width: 260px;
        }
        .footer-col-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 11px; font-weight: 700;
          letter-spacing: 1.5px; text-transform: uppercase;
          color: rgba(255,255,255,0.3); margin-bottom: 18px;
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
        .footer-bottom span { font-size: 12px; color: rgba(255,255,255,0.2); }
        .footer-flag { font-size: 12px; color: rgba(255,255,255,0.2); display: flex; align-items: center; gap: 5px; }

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
          <a href="/" className="ln-logo">
            <img src="/nova-logo.png" alt="Nova"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
            <div className="ln-logo-fallback" style={{ display: 'none' }}>N</div>
            Agent <span className="ln-accent">Nova</span>
          </a>
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
            Nova connects to your WhatsApp number and handles every customer conversation — orders, payment slips, questions — 24 hours a day, in Sinhala and English. While you sleep.
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
          {[
            { num: '<3', unit: 's', label: 'Average reply time' },
            { num: '24', unit: '/7', label: 'Always available' },
            { num: '∞', unit: '', label: 'Simultaneous chats' },
            { num: '2', unit: ' lang', label: 'Sinhala & English' },
          ].map((s, i) => (
            <div key={i} className="stat">
              <div className="stat-num">{s.num}<span>{s.unit}</span></div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
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
              { time: 'Always',   msg: '"What are your prices?" — again.', sub: "Your team copies the same reply 30 times a day instead of real work." },
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
                { title: 'Takes orders through conversation', desc: 'Collects name, address, package, date — whatever you need — through natural chat. Saves to your dashboard.' },
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
                <h3>Nova catches fake payment slips — automatically</h3>
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
              { n: '03', title: 'Go live — Nova handles the rest', desc: 'Every message is answered instantly, 24/7. You watch from the dashboard. Jump in whenever you want.' },
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

      {/* ── Testimonials ── */}
      <section className="section alt">
        <div className="container">
          <div className="section-label">Early feedback</div>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(26px,4vw,40px)', letterSpacing: '-0.03em', lineHeight: 1.15 }}>
            What businesses are saying
          </h2>
          <div className="testimonial-grid">
            {[
              { q: "We used to miss 20–30 messages a day. Nova handles all of them now. Our orders went up in the first week.", name: 'Sithara P.', biz: 'Online clothing store, Colombo', color: '#7c3aed' },
              { q: "The payment slip feature alone saved us from two scams last month. I didn't even know it was checking dates.", name: 'Ruwan M.', biz: 'Supplement shop, Kandy', color: '#0891b2' },
              { q: "Customers message at 1am and get a proper reply in Sinhala. I wake up and the orders are already there.", name: 'Dilini S.', biz: 'Bakery, Gampaha', color: '#059669' },
            ].map((t, i) => (
              <div key={i} className="testimonial">
                <div className="stars">★★★★★</div>
                <div className="testimonial-quote">"{t.q}"</div>
                <div className="testimonial-author">
                  <div className="testimonial-avatar" style={{ background: t.color }}>
                    {t.name[0]}
                  </div>
                  <div>
                    <div className="testimonial-name">{t.name}</div>
                    <div className="testimonial-biz">{t.biz}</div>
                  </div>
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
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.38)', marginBottom: 0, maxWidth: 480, lineHeight: 1.7 }}>Clients who join now get early access to everything we launch.</p>
          <div className="roadmap">
            {[
              { title: 'POS & Inventory Management', desc: 'Stock tracking, QR code scanning, sales reports. Your shop and your WhatsApp, connected.' },
              { title: 'Branded Product Catalog Website', desc: 'Every client gets their own link. Customers browse your products like a proper website — built automatically from Nova.' },
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
        <h2>Stop losing customers<br />to <em>silence</em></h2>
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
            <a href="/" className="ln-logo" style={{ textDecoration: 'none' }}>
              <img src="/nova-logo.png" alt="Nova"
                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
              <div className="ln-logo-fallback" style={{ display: 'none' }}>N</div>
              Agent <span className="ln-accent">Nova</span>
            </a>
            <p className="footer-brand-desc">AI-powered WhatsApp automation for Sri Lankan businesses. Your business, always on.</p>
            <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="btn-cta" style={{ marginTop: 20 }}>
              Try Nova Free →
            </a>
          </div>
          <div className="footer-col">
            <div className="footer-col-title">Product</div>
            <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer">Try Nova</a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">Get a Demo</a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">Pricing</a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">Custom Features</a>
          </div>
          <div className="footer-col">
            <div className="footer-col-title">Company</div>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">About</a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">Contact</a>
            <a href="/privacy" rel="noreferrer">Privacy Policy</a>
            <a href="/terms" rel="noreferrer">Terms of Use</a>
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
