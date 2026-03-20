import { useEffect, useRef } from 'react';

const NOVA_WA = 'https://wa.me/94771784821';
const NOVA_WA_DEMO = 'https://wa.me/94771784821?text=Hi%20Nova%2C%20I%20want%20to%20see%20a%20demo';

const problems = [
  {
    time: '11:47 PM',
    msg: 'Customer just messaged asking about your packages.',
    sub: 'You\'re asleep. They won\'t wait until morning.',
    icon: '🌙',
  },
  {
    time: '2:30 PM',
    msg: '6 customers waiting. You\'re in a meeting.',
    sub: 'Every minute they wait, they\'re opening a competitor\'s chat.',
    icon: '📱',
  },
  {
    time: 'Every day',
    msg: 'Someone sends a blurry payment screenshot.',
    sub: 'Is it real? Is it from last month? You have to check manually. Every. Single. Time.',
    icon: '💳',
  },
  {
    time: 'Always',
    msg: '"Do you have this in blue?" — for the 40th time this week.',
    sub: 'Your team is copy-pasting the same reply all day instead of doing real work.',
    icon: '😓',
  },
];

const benefits = [
  {
    icon: '🌙',
    title: 'Never miss a customer again',
    desc: 'Nova replies at 2am, on weekends, on public holidays. Every message gets an instant, intelligent answer.',
  },
  {
    icon: '🧠',
    title: 'Speaks Sinhala, English, or both',
    desc: 'Nova automatically detects how your customer types and matches their language — no setup needed.',
  },
  {
    icon: '📦',
    title: 'Takes orders inside WhatsApp',
    desc: 'No website, no app, no form. Nova collects all order details through natural conversation and saves them to your dashboard.',
  },
  {
    icon: '💳',
    title: 'Reads payment slips automatically',
    desc: 'Customer sends a screenshot? Nova reads it, checks the amount and date, and flags anything suspicious. No manual checking.',
  },
  {
    icon: '🎯',
    title: 'Trained on your business',
    desc: 'Upload your products, prices, policies, and FAQs. Nova learns your business and answers in your own words.',
  },
  {
    icon: '👥',
    title: 'Your team stays in control',
    desc: 'Read every conversation live. Jump in anytime. Turn AI off for one customer and take over manually — then hand back to Nova.',
  },
];

const steps = [
  { num: '01', title: 'Connect your WhatsApp', desc: 'We connect Nova to your existing WhatsApp Business number. Your customers keep messaging the same number they always have.' },
  { num: '02', title: 'Train Nova on your business', desc: 'Tell Nova what you sell, how you talk to customers, and what your policies are. Upload your FAQs and product list.' },
  { num: '03', title: 'Go live in 24 hours', desc: 'Nova starts handling every conversation. You watch from the dashboard and focus on what actually grows your business.' },
];

export default function Landing() {
  const heroRef = useRef();

  useEffect(() => {
    document.title = 'Agent Nova — Your Business, Always On';
  }, []);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#080d1a', color: '#fff', minHeight: '100vh', overflowX: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .glow { box-shadow: 0 0 30px rgba(0,212,255,0.3), 0 0 60px rgba(0,212,255,0.1); }
        .glow-text { text-shadow: 0 0 30px rgba(0,212,255,0.6); }
        .gradient-text { background: linear-gradient(135deg, #00d4ff, #0099cc, #00ff94); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .card-hover { transition: transform 0.2s, box-shadow 0.2s; }
        .card-hover:hover { transform: translateY(-4px); box-shadow: 0 8px 40px rgba(0,212,255,0.15); }
        .btn-primary { background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; font-weight: 700; border: none; cursor: pointer; transition: all 0.2s; border-radius: 12px; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(0,212,255,0.4); filter: brightness(1.1); }
        .btn-outline { background: transparent; color: #00d4ff; border: 1.5px solid #00d4ff; font-weight: 600; cursor: pointer; transition: all 0.2s; border-radius: 12px; }
        .btn-outline:hover { background: rgba(0,212,255,0.1); transform: translateY(-2px); }
        .section-divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 0; }
        .noise { background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E"); }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:0.4} 100%{transform:scale(1.4);opacity:0} }
        .float { animation: float 4s ease-in-out infinite; }
        .pulse-ring { animation: pulse-ring 2s ease-out infinite; }
      `}</style>

      {/* ── Navbar ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(8,13,26,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,212,255,0.1)', padding: '0 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/nova-logo.png" alt="Nova" style={{ width: 36, height: 36, borderRadius: '50%' }} onError={e => { e.target.style.display = 'none'; }} />
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' }}>
              Agent <span className="gradient-text">Nova</span>
            </span>
          </div>
          <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer">
            <button className="btn-primary" style={{ padding: '10px 22px', fontSize: 14 }}>
              Try Nova Free →
            </button>
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section ref={heroRef} style={{ padding: '100px 24px 80px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        {/* bg glow blobs */}
        <div style={{ position: 'absolute', top: '-100px', left: '50%', transform: 'translateX(-50%)', width: 600, height: 600, background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 200, left: '10%', width: 300, height: 300, background: 'radial-gradient(circle, rgba(0,153,204,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 800, margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'inline-block', background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', borderRadius: 999, padding: '6px 16px', fontSize: 13, color: '#00d4ff', marginBottom: 28, fontWeight: 500 }}>
            🇱🇰 Built for Sri Lankan businesses
          </div>

          <h1 style={{ fontSize: 'clamp(36px, 6vw, 68px)', fontWeight: 900, lineHeight: 1.1, marginBottom: 24, letterSpacing: '-2px' }}>
            Your business is losing<br />
            customers <span className="gradient-text glow-text">while you sleep</span>
          </h1>

          <p style={{ fontSize: 'clamp(17px, 2vw, 21px)', color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, marginBottom: 44, maxWidth: 620, margin: '0 auto 44px' }}>
            Nova is an AI that connects to your WhatsApp number and handles every customer conversation — orders, payments, questions — 24 hours a day, in Sinhala and English.
          </p>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer">
              <button className="btn-primary" style={{ padding: '16px 32px', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>💬</span> Try Nova on WhatsApp
              </button>
            </a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">
              <button className="btn-outline" style={{ padding: '16px 32px', fontSize: 16 }}>
                Talk to us directly
              </button>
            </a>
          </div>

          <p style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
            No app download. No credit card. Just WhatsApp.
          </p>
        </div>
      </section>

      {/* ── Real Problems ── */}
      <section style={{ padding: '80px 24px', background: 'rgba(0,0,0,0.3)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-1px', marginBottom: 12 }}>
              Sound familiar?
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 17 }}>These are the moments where businesses lose customers every single day.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            {problems.map((p, i) => (
              <div key={i} className="card-hover" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '28px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ fontSize: 28 }}>{p.icon}</span>
                  <span style={{ fontSize: 12, color: '#00d4ff', fontWeight: 600, background: 'rgba(0,212,255,0.1)', padding: '3px 10px', borderRadius: 999 }}>{p.time}</span>
                </div>
                <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, lineHeight: 1.4 }}>{p.msg}</p>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 1.6 }}>{p.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Solution bridge ── */}
      <section style={{ padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <p style={{ fontSize: 13, color: '#00d4ff', fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 }}>The fix</p>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, letterSpacing: '-1px', marginBottom: 20 }}>
            Nova handles it.<br /><span className="gradient-text">You focus on your business.</span>
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 18, lineHeight: 1.7 }}>
            Connect Nova to your WhatsApp number. Train it on your business in a few hours. From that moment, every customer gets an instant, intelligent reply — day or night.
          </p>
        </div>
      </section>

      {/* ── Benefits ── */}
      <section style={{ padding: '20px 24px 80px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-1px', marginBottom: 12 }}>
              What you actually get
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 17 }}>Not features. Real outcomes for your business.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {benefits.map((b, i) => (
              <div key={i} className="card-hover" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontSize: 32 }}>{b.icon}</span>
                <h3 style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.3 }}>{b.title}</h3>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, lineHeight: 1.7 }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section style={{ padding: '80px 24px', background: 'rgba(0,0,0,0.3)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-1px', marginBottom: 12 }}>
              Up and running in 24 hours
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 17 }}>Three steps. We guide you through every one of them.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 28, padding: '32px 0', borderBottom: i < steps.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none', alignItems: 'flex-start' }}>
                <div style={{ flexShrink: 0, width: 56, height: 56, borderRadius: 14, background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00d4ff', fontWeight: 800, fontSize: 15 }}>
                  {s.num}
                </div>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: 19, marginBottom: 8 }}>{s.title}</h3>
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, lineHeight: 1.7 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Coming soon ── */}
      <section style={{ padding: '80px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(0,212,255,0.07), rgba(0,153,204,0.04))', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 24, padding: '48px 40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#00d4ff', background: 'rgba(0,212,255,0.15)', padding: '4px 12px', borderRadius: 999, letterSpacing: 1, textTransform: 'uppercase' }}>Coming Soon</span>
            </div>
            <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, marginBottom: 16, letterSpacing: '-0.5px' }}>
              Nova is just getting started
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24, marginTop: 32 }}>
              <div>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🏪</div>
                <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>POS & Stock Management</h3>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 1.6 }}>QR scanning, inventory tracking, sales reports — your WhatsApp automation and your physical shop, in one place.</p>
              </div>
              <div>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🌐</div>
                <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Your Own Product Catalog Website</h3>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 1.6 }}>Every Nova client gets a clean branded link. Your customers browse your products like a real website — built automatically from what you already added.</p>
              </div>
            </div>
            <p style={{ marginTop: 28, color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
              Clients who join now get early access when these launch. 🚀
            </p>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={{ padding: '80px 24px 100px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 800, height: 400, background: 'radial-gradient(circle, rgba(0,212,255,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative' }}>
          <h2 style={{ fontSize: 'clamp(30px, 5vw, 52px)', fontWeight: 900, letterSpacing: '-1.5px', marginBottom: 20, lineHeight: 1.15 }}>
            Ready to stop losing<br /><span className="gradient-text glow-text">customers to silence?</span>
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1.7, marginBottom: 44 }}>
            Message Nova on WhatsApp right now. See it respond. Ask it anything about your business type. Experience exactly what your customers will experience.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer">
              <button className="btn-primary" style={{ padding: '18px 36px', fontSize: 17, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>💬</span> Try Nova on WhatsApp
              </button>
            </a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer">
              <button className="btn-outline" style={{ padding: '18px 36px', fontSize: 17 }}>
                Talk to us directly
              </button>
            </a>
          </div>
          <p style={{ marginTop: 18, fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>
            No contracts. No setup fees. Cancel anytime.
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <span style={{ fontWeight: 800, fontSize: 16 }}>Agent <span className="gradient-text">Nova</span></span>
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>© 2026 Agent Nova. Built for Sri Lankan businesses.</span>
          <a href={NOVA_WA} target="_blank" rel="noreferrer" style={{ color: '#00d4ff', fontSize: 13, textDecoration: 'none' }}>WhatsApp us</a>
        </div>
      </footer>
    </div>
  );
}
