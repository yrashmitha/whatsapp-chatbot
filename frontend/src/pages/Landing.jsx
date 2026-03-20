import { useEffect } from 'react';

const NOVA_WA      = 'https://wa.me/94771784821';
const NOVA_WA_DEMO = 'https://wa.me/94771784821?text=Hi%20Nova%2C%20I%20want%20to%20see%20a%20demo';

const problems = [
  { time: '11:47 PM', icon: '🌙', msg: 'Customer just messaged asking about your packages.', sub: "You're asleep. They won't wait until morning." },
  { time: '2:30 PM',  icon: '📱', msg: '6 customers waiting. You\'re in a meeting.',          sub: "Every minute they wait, they're opening a competitor's chat." },
  { time: 'Every day',icon: '💳', msg: 'Someone sends a blurry payment screenshot.',          sub: 'Is it real? Is it from last month? You have to check manually. Every single time.' },
  { time: 'Always',   icon: '😓', msg: '"Do you have this in blue?" — for the 40th time.',    sub: "Your team is copy-pasting the same reply all day instead of doing real work." },
];

const benefits = [
  { icon: '🌙', title: 'Never miss a customer again',       desc: 'Nova replies at 2am, on weekends, on public holidays. Every message gets an instant, intelligent answer.' },
  { icon: '🗣️', title: 'Speaks Sinhala, English, or both', desc: 'Nova automatically detects how your customer types and matches their language — no setup needed.' },
  { icon: '📦', title: 'Takes orders inside WhatsApp',      desc: 'No website, no app, no form. Nova collects all order details through natural conversation and saves them to your dashboard.' },
  { icon: '💳', title: 'Reads payment slips automatically', desc: 'Customer sends a screenshot? Nova reads it, checks the amount and date, and flags anything suspicious. No manual checking.' },
  { icon: '🎯', title: 'Trained on your business',          desc: 'Upload your products, prices, policies, and FAQs. Nova learns your business and answers in your own words.' },
  { icon: '👥', title: 'Your team stays in control',        desc: 'Read every conversation live. Jump in anytime. Turn AI off for one customer and take over manually — then hand back to Nova.' },
];

const steps = [
  { num: '01', title: 'Connect your WhatsApp',       desc: 'We connect Nova to your existing WhatsApp Business number. Your customers keep messaging the same number they always have.' },
  { num: '02', title: 'Train Nova on your business', desc: 'Tell Nova what you sell, how you talk to customers, and what your policies are. Upload your FAQs and product list.' },
  { num: '03', title: 'Go live in 24 hours',         desc: 'Nova starts handling every conversation. You watch from the dashboard and focus on what actually grows your business.' },
];

const footerLinks = [
  { label: 'Try Nova',      href: NOVA_WA_DEMO },
  { label: 'WhatsApp Us',   href: NOVA_WA },
  { label: 'Privacy Policy',href: '/privacy' },
  { label: 'Terms of Use',  href: '/terms' },
];

export default function Landing() {
  useEffect(() => { document.title = 'Agent Nova — Your Business, Always On'; }, []);

  return (
    <div className="ln-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ln-root {
          font-family: 'Inter', sans-serif;
          background: #07091a;
          color: #fff;
          min-height: 100vh;
          overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
        }

        /* ── Typography ── */
        .ln-heading { font-family: 'Space Grotesk', sans-serif; font-weight: 800; line-height: 1.1; letter-spacing: -0.03em; }
        .ln-subheading { font-family: 'Space Grotesk', sans-serif; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
        .ln-grad { background: linear-gradient(130deg, #00d4ff 0%, #00a8d4 50%, #00ff99 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .ln-glow { text-shadow: 0 0 40px rgba(0,212,255,0.5); }

        /* ── Buttons ── */
        .ln-btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          background: linear-gradient(135deg, #00d4ff, #0099cc);
          color: #000; font-family: 'Space Grotesk', sans-serif; font-weight: 700;
          border: none; border-radius: 14px; cursor: pointer;
          transition: transform 0.18s, box-shadow 0.18s, filter 0.18s;
          text-decoration: none; white-space: nowrap;
        }
        .ln-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 36px rgba(0,212,255,0.4); filter: brightness(1.08); }
        .ln-btn-outline {
          display: inline-flex; align-items: center; gap: 8px;
          background: rgba(0,212,255,0.06); color: #00d4ff;
          font-family: 'Space Grotesk', sans-serif; font-weight: 600;
          border: 1.5px solid rgba(0,212,255,0.4); border-radius: 14px;
          cursor: pointer; transition: background 0.18s, transform 0.18s;
          text-decoration: none; white-space: nowrap;
        }
        .ln-btn-outline:hover { background: rgba(0,212,255,0.12); transform: translateY(-2px); }
        .ln-btn-lg { padding: 16px 30px; font-size: 16px; }
        .ln-btn-sm { padding: 10px 20px; font-size: 14px; }

        /* ── Cards ── */
        .ln-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px; padding: 28px 24px;
          transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
        }
        .ln-card:hover { transform: translateY(-4px); border-color: rgba(0,212,255,0.2); box-shadow: 0 12px 40px rgba(0,212,255,0.1); }

        /* ── Layout ── */
        .ln-container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
        .ln-section { padding: 72px 20px; }
        .ln-section-dark { padding: 72px 20px; background: rgba(0,0,0,0.25); }
        .ln-section-title { text-align: center; margin-bottom: 48px; }
        .ln-section-title h2 { font-size: clamp(26px, 5vw, 42px); margin-bottom: 12px; }
        .ln-section-title p { color: rgba(255,255,255,0.5); font-size: 16px; max-width: 480px; margin: 0 auto; line-height: 1.6; }

        /* ── Grid ── */
        .ln-grid-2 { display: grid; grid-template-columns: 1fr; gap: 16px; }
        .ln-grid-3 { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 600px) {
          .ln-grid-2 { grid-template-columns: 1fr 1fr; }
          .ln-grid-3 { grid-template-columns: 1fr 1fr; }
        }
        @media (min-width: 900px) {
          .ln-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
        }

        /* ── Hero CTA row ── */
        .ln-cta-row { display: flex; flex-direction: column; gap: 12px; align-items: center; }
        @media (min-width: 480px) { .ln-cta-row { flex-direction: row; justify-content: center; } }

        /* ── Navbar ── */
        .ln-nav {
          position: sticky; top: 0; z-index: 100;
          background: rgba(7,9,26,0.88); backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(0,212,255,0.1);
        }
        .ln-nav-inner {
          max-width: 1100px; margin: 0 auto; padding: 0 20px;
          display: flex; align-items: center; justify-content: space-between; height: 60px;
        }
        .ln-logo { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 18px; letter-spacing: -0.5px; display: flex; align-items: center; gap: 8px; }

        /* ── Steps ── */
        .ln-steps { display: flex; flex-direction: column; }
        .ln-step {
          display: flex; gap: 20px; align-items: flex-start;
          padding: 28px 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .ln-step:last-child { border-bottom: none; }
        .ln-step-num {
          flex-shrink: 0; width: 50px; height: 50px; border-radius: 14px;
          background: rgba(0,212,255,0.08); border: 1px solid rgba(0,212,255,0.25);
          display: flex; align-items: center; justify-content: center;
          color: #00d4ff; font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 14px;
        }

        /* ── Coming soon card ── */
        .ln-coming-card {
          background: linear-gradient(135deg, rgba(0,212,255,0.06), rgba(0,153,204,0.03));
          border: 1px solid rgba(0,212,255,0.15);
          border-radius: 22px; padding: 40px 28px;
        }
        @media (min-width: 600px) { .ln-coming-card { padding: 48px 40px; } }

        /* ── Badge ── */
        .ln-badge {
          display: inline-block; background: rgba(0,212,255,0.1);
          border: 1px solid rgba(0,212,255,0.3); border-radius: 999px;
          padding: 5px 14px; font-size: 12px; color: #00d4ff; font-weight: 600;
          font-family: 'Space Grotesk', sans-serif; letter-spacing: 0.5px;
        }

        /* ── Footer ── */
        .ln-footer {
          border-top: 1px solid rgba(255,255,255,0.07);
          padding: 56px 20px 36px;
          background: rgba(0,0,0,0.3);
        }
        .ln-footer-inner {
          max-width: 1100px; margin: 0 auto;
        }
        .ln-footer-top {
          display: grid; grid-template-columns: 1fr;
          gap: 40px; margin-bottom: 48px;
        }
        @media (min-width: 600px) {
          .ln-footer-top { grid-template-columns: 2fr 1fr 1fr; gap: 32px; }
        }
        .ln-footer-brand p { color: rgba(255,255,255,0.4); font-size: 14px; line-height: 1.7; margin-top: 12px; max-width: 280px; }
        .ln-footer-col h4 { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 13px; color: rgba(255,255,255,0.5); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 16px; }
        .ln-footer-col a { display: block; color: rgba(255,255,255,0.65); font-size: 14px; text-decoration: none; margin-bottom: 10px; transition: color 0.15s; }
        .ln-footer-col a:hover { color: #00d4ff; }
        .ln-footer-bottom {
          border-top: 1px solid rgba(255,255,255,0.06);
          padding-top: 24px;
          display: flex; flex-direction: column; gap: 8px; align-items: center; text-align: center;
        }
        @media (min-width: 600px) {
          .ln-footer-bottom { flex-direction: row; justify-content: space-between; text-align: left; }
        }
        .ln-footer-bottom span { color: rgba(255,255,255,0.25); font-size: 13px; }

        /* ── Blob bg ── */
        .ln-blob { position: absolute; border-radius: 50%; pointer-events: none; }

        /* ── Divider ── */
        .ln-divider { width: 40px; height: 3px; background: linear-gradient(90deg, #00d4ff, #00ff99); border-radius: 999px; margin: 16px auto 0; }

        /* ── Misc ── */
        .ln-time-badge { font-size: 11px; color: #00d4ff; font-weight: 600; font-family: 'Space Grotesk', sans-serif; background: rgba(0,212,255,0.1); padding: 3px 10px; border-radius: 999px; }
        .ln-hero-note { font-size: 13px; color: rgba(255,255,255,0.28); margin-top: 16px; }
        .ln-wa-float {
          position: fixed; bottom: 24px; right: 20px; z-index: 999;
          width: 56px; height: 56px; border-radius: 50%;
          background: #25d366; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 20px rgba(37,211,102,0.45);
          text-decoration: none; font-size: 26px; transition: transform 0.2s, box-shadow 0.2s;
        }
        .ln-wa-float:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(37,211,102,0.6); }
      `}</style>

      {/* ── Floating WhatsApp button ── */}
      <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="ln-wa-float" title="Chat with Nova">💬</a>

      {/* ── Navbar ── */}
      <nav className="ln-nav">
        <div className="ln-nav-inner">
          <div className="ln-logo">
            <img src="/nova-logo.png" alt="Nova" style={{ width: 32, height: 32, borderRadius: '50%' }} onError={e => { e.target.style.display = 'none'; }} />
            Agent <span className="ln-grad">Nova</span>
          </div>
          <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="ln-btn-primary ln-btn-sm">
            Try Nova Free →
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ padding: '80px 20px 72px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div className="ln-blob" style={{ top: -120, left: '50%', transform: 'translateX(-50%)', width: 500, height: 500, background: 'radial-gradient(circle, rgba(0,212,255,0.09) 0%, transparent 70%)' }} />
        <div className="ln-blob" style={{ top: 160, left: '5%', width: 260, height: 260, background: 'radial-gradient(circle, rgba(0,255,153,0.05) 0%, transparent 70%)' }} />
        <div className="ln-blob" style={{ top: 100, right: '5%', width: 200, height: 200, background: 'radial-gradient(circle, rgba(0,153,204,0.06) 0%, transparent 70%)' }} />

        <div style={{ maxWidth: 760, margin: '0 auto', position: 'relative' }}>
          <div className="ln-badge" style={{ marginBottom: 28 }}>🇱🇰 Built for Sri Lankan businesses</div>

          <h1 className="ln-heading" style={{ fontSize: 'clamp(34px, 7vw, 66px)', marginBottom: 22 }}>
            Your business is losing<br />
            customers{' '}
            <span className="ln-grad ln-glow">while you sleep</span>
          </h1>

          <p style={{ fontSize: 'clamp(16px, 2.5vw, 20px)', color: 'rgba(255,255,255,0.6)', lineHeight: 1.75, marginBottom: 40, maxWidth: 580, margin: '0 auto 40px' }}>
            Nova is an AI assistant that connects to your WhatsApp number and handles every customer conversation — orders, payments, questions — 24 hours a day, in Sinhala and English.
          </p>

          <div className="ln-cta-row">
            <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="ln-btn-primary ln-btn-lg">
              💬 Try Nova on WhatsApp
            </a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer" className="ln-btn-outline ln-btn-lg">
              Talk to us directly
            </a>
          </div>
          <p className="ln-hero-note">No app download. No credit card. Just WhatsApp.</p>
        </div>
      </section>

      {/* ── Pain Points ── */}
      <section className="ln-section-dark">
        <div className="ln-container">
          <div className="ln-section-title">
            <h2 className="ln-subheading">Sound familiar?</h2>
            <div className="ln-divider" />
            <p style={{ marginTop: 16 }}>These are the moments where businesses lose customers every single day.</p>
          </div>
          <div className="ln-grid-2">
            {problems.map((p, i) => (
              <div key={i} className="ln-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 26 }}>{p.icon}</span>
                  <span className="ln-time-badge">{p.time}</span>
                </div>
                <p className="ln-subheading" style={{ fontSize: 15, marginBottom: 8, lineHeight: 1.45 }}>{p.msg}</p>
                <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 14, lineHeight: 1.65 }}>{p.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bridge ── */}
      <section className="ln-section" style={{ textAlign: 'center' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <span style={{ fontSize: 12, color: '#00d4ff', fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>The Fix</span>
          <h2 className="ln-heading" style={{ fontSize: 'clamp(26px, 5vw, 46px)', marginTop: 14, marginBottom: 18 }}>
            Nova handles it.<br /><span className="ln-grad">You focus on your business.</span>
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.52)', fontSize: 17, lineHeight: 1.75 }}>
            Connect Nova to your WhatsApp number. Train it on your business in a few hours. From that moment, every customer gets an instant, intelligent reply — day or night, no matter how many people message at once.
          </p>
        </div>
      </section>

      {/* ── Benefits ── */}
      <section className="ln-section-dark">
        <div className="ln-container">
          <div className="ln-section-title">
            <h2 className="ln-subheading">What you actually get</h2>
            <div className="ln-divider" />
            <p style={{ marginTop: 16 }}>Not features. Real outcomes for your business.</p>
          </div>
          <div className="ln-grid-3">
            {benefits.map((b, i) => (
              <div key={i} className="ln-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 30 }}>{b.icon}</span>
                <h3 className="ln-subheading" style={{ fontSize: 16 }}>{b.title}</h3>
                <p style={{ color: 'rgba(255,255,255,0.48)', fontSize: 14, lineHeight: 1.7 }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="ln-section">
        <div className="ln-container" style={{ maxWidth: 860 }}>
          <div className="ln-section-title">
            <h2 className="ln-subheading">Up and running in 24 hours</h2>
            <div className="ln-divider" />
            <p style={{ marginTop: 16 }}>Three steps. We guide you through every one of them.</p>
          </div>
          <div className="ln-steps">
            {steps.map((s, i) => (
              <div key={i} className="ln-step">
                <div className="ln-step-num">{s.num}</div>
                <div>
                  <h3 className="ln-subheading" style={{ fontSize: 17, marginBottom: 6 }}>{s.title}</h3>
                  <p style={{ color: 'rgba(255,255,255,0.48)', fontSize: 15, lineHeight: 1.7 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Coming Soon ── */}
      <section className="ln-section-dark">
        <div className="ln-container" style={{ maxWidth: 900 }}>
          <div className="ln-coming-card">
            <span className="ln-badge" style={{ marginBottom: 20, display: 'inline-block' }}>🚀 Coming Soon</span>
            <h2 className="ln-heading" style={{ fontSize: 'clamp(22px, 4vw, 34px)', marginBottom: 12 }}>Nova is just getting started</h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 15, lineHeight: 1.7, maxWidth: 560, marginBottom: 32 }}>
              We're building more tools into Nova so your entire business runs from one place.
            </p>
            <div className="ln-grid-2">
              <div>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🏪</div>
                <h3 className="ln-subheading" style={{ fontSize: 15, marginBottom: 6 }}>POS & Stock Management</h3>
                <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 14, lineHeight: 1.65 }}>QR scanning, inventory tracking, sales reports — your WhatsApp and your physical shop, in one place.</p>
              </div>
              <div>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🌐</div>
                <h3 className="ln-subheading" style={{ fontSize: 15, marginBottom: 6 }}>Your Own Catalog Website</h3>
                <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 14, lineHeight: 1.65 }}>Every client gets a clean branded product link. Customers browse your catalog like a real website — built from what you already added to Nova.</p>
              </div>
            </div>
            <p style={{ marginTop: 28, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
              Clients who join now get early access when these launch. 🎉
            </p>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="ln-section" style={{ textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div className="ln-blob" style={{ bottom: -80, left: '50%', transform: 'translateX(-50%)', width: 700, height: 400, background: 'radial-gradient(circle, rgba(0,212,255,0.07) 0%, transparent 70%)' }} />
        <div style={{ maxWidth: 620, margin: '0 auto', position: 'relative' }}>
          <h2 className="ln-heading" style={{ fontSize: 'clamp(28px, 6vw, 50px)', marginBottom: 18 }}>
            Ready to stop losing<br />
            <span className="ln-grad ln-glow">customers to silence?</span>
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 17, lineHeight: 1.75, marginBottom: 40 }}>
            Message Nova on WhatsApp right now. See it respond. Ask it anything about your business. Experience exactly what your customers will experience.
          </p>
          <div className="ln-cta-row">
            <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="ln-btn-primary ln-btn-lg">
              💬 Try Nova on WhatsApp
            </a>
            <a href={NOVA_WA} target="_blank" rel="noreferrer" className="ln-btn-outline ln-btn-lg">
              Talk to us directly
            </a>
          </div>
          <p className="ln-hero-note">No contracts. No setup fees. Cancel anytime.</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="ln-footer">
        <div className="ln-footer-inner">
          <div className="ln-footer-top">
            {/* Brand */}
            <div className="ln-footer-brand">
              <div className="ln-logo" style={{ marginBottom: 4 }}>
                <img src="/nova-logo.png" alt="Nova" style={{ width: 30, height: 30, borderRadius: '50%' }} onError={e => { e.target.style.display = 'none'; }} />
                Agent <span className="ln-grad">Nova</span>
              </div>
              <p>AI-powered WhatsApp automation for Sri Lankan businesses. Your business, always on.</p>
              <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="ln-btn-primary ln-btn-sm" style={{ marginTop: 20, width: 'fit-content' }}>
                💬 Try Nova Free
              </a>
            </div>

            {/* Product */}
            <div className="ln-footer-col">
              <h4>Product</h4>
              <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer">Try Nova</a>
              <a href={NOVA_WA} target="_blank" rel="noreferrer">Get a Demo</a>
              <a href={NOVA_WA} target="_blank" rel="noreferrer">Pricing</a>
              <a href={NOVA_WA} target="_blank" rel="noreferrer">Custom Features</a>
            </div>

            {/* Legal */}
            <div className="ln-footer-col">
              <h4>Company</h4>
              <a href={NOVA_WA} target="_blank" rel="noreferrer">About</a>
              <a href={NOVA_WA} target="_blank" rel="noreferrer">Contact Us</a>
              <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
              <a href="/terms" target="_blank" rel="noreferrer">Terms of Use</a>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="ln-footer-bottom">
            <span>© 2026 Agent Nova. All rights reserved.</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Made with ❤️ in Sri Lanka 🇱🇰
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
