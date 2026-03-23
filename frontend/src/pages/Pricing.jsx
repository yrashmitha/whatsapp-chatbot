import { useEffect } from 'react';
import { Link } from 'react-router-dom';

const NOVA_WA      = 'https://wa.me/94771784821';
const NOVA_WA_DEMO = 'https://wa.me/94771784821?text=Hi%20Nova%2C%20I%20want%20to%20see%20a%20demo';

const IconCheck = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="8" fill="rgba(0,212,255,0.12)"/>
    <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="#00d4ff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconX = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="8" fill="rgba(255,255,255,0.04)"/>
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="rgba(255,255,255,0.2)" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);
const IconWA = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
    <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.413A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z" fillRule="evenodd" clipRule="evenodd"/>
  </svg>
);

const PLANS = [
  {
    name: 'Starter',
    price: 4900,
    desc: 'For small shops exploring WhatsApp AI',
    color: '#0891b2',
    messages: '1,000',
    overage: 'LKR 5 per extra reply',
    popular: false,
    scenarios: [
      'A home bakery getting 30-50 orders a month via WhatsApp',
      'A beauty salon answering appointment questions manually every day',
      'A small clothing page that keeps missing messages after hours',
      'A tuition class replying to the same parent questions repeatedly',
    ],
    highlights: [
      '1,000 AI replies / month',
      '1 WhatsApp number',
      'Responds in any language',
      'Order taking via chat',
      'Knowledge base (3 docs)',
      'Product catalog (20 items)',
      'Dashboard + order view',
      'Dedicated onboarding',
      'WhatsApp support',
    ],
    locked: [
      'Payment slip reading',
      'Upsell / cross-sell AI',
      'Auto review requests',
    ],
  },
  {
    name: 'Growth',
    price: 9900,
    desc: 'For active businesses with real customer volume',
    color: '#7c3aed',
    messages: '3,000',
    overage: 'LKR 4 per extra reply',
    popular: true,
    scenarios: [
      'An online supplement or cosmetics shop taking 100+ orders a month',
      'A food business collecting payment slips and confirming orders daily',
      'A fashion page where customers always ask "what goes with this?"',
      'Any shop that wants more Google reviews without asking manually',
    ],
    highlights: [
      '3,000 AI replies / month',
      '1 WhatsApp number',
      'Responds in any language',
      'Order taking via chat',
      'Knowledge base (15 docs)',
      'Product catalog (100 items)',
      'Dashboard + order view',
      'Payment slip reading',
      'Upsell / cross-sell AI',
      'Auto review requests',
      'Dedicated onboarding',
      'Priority WhatsApp support',
    ],
    locked: [],
  },
  {
    name: 'Business',
    price: 24900,
    desc: 'For businesses that run entirely on WhatsApp',
    color: '#059669',
    messages: '10,000',
    overage: 'LKR 3 per extra reply',
    popular: false,
    scenarios: [
      'A wholesale supplier managing hundreds of dealer conversations daily',
      'A multi-brand store running two separate WhatsApp numbers',
      'An agency managing customer service for their own clients',
      'A business where the AI needs to sound and feel like a specific brand persona',
    ],
    highlights: [
      '10,000 AI replies / month',
      '2 WhatsApp numbers',
      'Responds in any language',
      'Order taking via chat',
      'Unlimited knowledge base',
      'Unlimited product catalog',
      'Dashboard + order view',
      'Payment slip reading',
      'Upsell / cross-sell AI',
      'Auto review requests',
      'Custom AI personality',
      'Dedicated onboarding',
      'Dedicated support',
    ],
    locked: [],
  },
];

const ALL_FEATURES = [
  { label: 'AI replies / month',      values: ['1,000', '3,000', '10,000'] },
  { label: 'WhatsApp numbers',        values: ['1', '1', '2'] },
  { label: 'Any language',            values: [true, true, true] },
  { label: 'Order taking via chat',   values: [true, true, true] },
  { label: 'Dashboard + order view',  values: [true, true, true] },
  { label: 'Knowledge base docs',     values: ['3', '15', 'Unlimited'] },
  { label: 'Product catalog items',   values: ['20', '100', 'Unlimited'] },
  { label: 'Payment slip reading',    values: [false, true, true] },
  { label: 'Upsell / cross-sell AI',  values: [false, true, true] },
  { label: 'Auto review requests',    values: [false, true, true] },
  { label: 'Custom AI personality',   values: [false, false, true] },
  { label: 'Dedicated onboarding',    values: [true, true, true] },
  { label: 'Overage rate',            values: ['LKR 5/reply', 'LKR 4/reply', 'LKR 3/reply'] },
  { label: 'Support',                 values: ['WhatsApp', 'Priority WA', 'Dedicated'] },
];

const FAQS = [
  {
    q: 'What counts as an AI reply?',
    a: 'Every message Nova sends to a customer counts as one AI reply. If Nova sends 3 messages in one conversation, that is 3 replies. Replies from your team do not count.',
  },
  {
    q: 'What happens when I run out of replies?',
    a: 'Nova keeps working. Extra replies are charged at the overage rate for your plan (LKR 3-5 per reply). We will notify you when you reach 80% of your limit.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes. Upgrade or downgrade any time. Changes take effect on your next billing cycle. No penalties.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes. Message us on WhatsApp to try Nova live before you pay anything. We set it up on a demo number so you can see exactly how it behaves.',
  },
  {
    q: 'Does this include WhatsApp API fees?',
    a: "No. Meta charges separately for WhatsApp Business API usage (roughly LKR 3-10 per conversation depending on type). Nova's monthly fee covers the AI, dashboard, and platform. We will explain the full cost breakdown before you sign up.",
  },
  {
    q: 'Will my WhatsApp account get banned?',
    a: 'Nova follows WhatsApp Business Policy. However, account bans are ultimately Meta\'s decision based on your message content, how customers respond, and your overall account history. We cannot guarantee your account will never be restricted. See our Terms for the full disclaimer.',
  },
];

export default function Pricing() {
  useEffect(() => { document.title = 'Pricing | Agent Nova'; }, []);

  return (
    <div className="pr-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .pr-root {
          font-family: 'Space Grotesk', sans-serif;
          background: #06080f; color: #f0f0f0;
          min-height: 100vh; overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
        }

        /* Nav */
        .pr-nav {
          position: sticky; top: 0; z-index: 100;
          background: rgba(6,8,15,0.9); backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding: 0 24px;
        }
        .pr-nav-inner {
          max-width: 1080px; margin: 0 auto;
          display: flex; align-items: center; justify-content: space-between; height: 58px;
        }
        .pr-logo {
          font-weight: 800; font-size: 17px; letter-spacing: -0.5px;
          display: flex; align-items: center; gap: 8px; color: #fff; text-decoration: none;
        }
        .pr-logo img { width: 30px; height: 30px; border-radius: 8px; object-fit: cover; }
        .pr-logo-fallback {
          width: 30px; height: 30px; border-radius: 8px;
          background: linear-gradient(135deg, #00d4ff, #0066cc);
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; font-weight: 800; color: #000;
        }
        .pr-accent { color: #00d4ff; }
        .btn-cta {
          display: inline-flex; align-items: center; gap: 8px;
          background: #00d4ff; color: #000;
          font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px;
          border: none; border-radius: 10px; padding: 11px 22px;
          cursor: pointer; text-decoration: none;
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .btn-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(0,212,255,0.35); }
        .btn-ghost {
          display: inline-flex; align-items: center; gap: 8px;
          background: transparent; color: rgba(255,255,255,0.75);
          font-weight: 600; font-size: 15px;
          border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 11px 22px;
          cursor: pointer; text-decoration: none;
          transition: border-color 0.15s, color 0.15s, transform 0.15s;
        }
        .btn-ghost:hover { border-color: rgba(255,255,255,0.35); color: #fff; transform: translateY(-2px); }

        /* Hero */
        .pr-hero {
          max-width: 680px; margin: 0 auto;
          padding: 72px 24px 56px;
          text-align: center;
        }
        .pr-label {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
          color: #00d4ff; margin-bottom: 20px;
        }
        .pr-hero h1 {
          font-weight: 800; font-size: clamp(34px, 5vw, 54px);
          letter-spacing: -0.03em; line-height: 1.08; color: #fff; margin-bottom: 18px;
        }
        .pr-hero p {
          font-size: 17px; color: rgba(255,255,255,0.62); line-height: 1.7; max-width: 520px; margin: 0 auto;
        }

        /* Plans grid */
        .plans-grid {
          max-width: 1080px; margin: 0 auto;
          padding: 0 24px 80px;
          display: grid; grid-template-columns: 1fr;
          gap: 20px;
        }
        @media (min-width: 860px) { .plans-grid { grid-template-columns: 1fr 1fr 1fr; } }

        .plan-card {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px; padding: 32px 28px;
          display: flex; flex-direction: column; gap: 0;
          position: relative; background: rgba(255,255,255,0.02);
          transition: transform 0.2s, border-color 0.2s;
        }
        .plan-card:hover { transform: translateY(-4px); }
        .plan-card.popular {
          border-color: rgba(124,58,237,0.5);
          background: rgba(124,58,237,0.04);
        }
        .popular-badge {
          position: absolute; top: -13px; left: 50%; transform: translateX(-50%);
          font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
          background: #7c3aed; color: #fff;
          padding: 4px 16px; border-radius: 999px;
          white-space: nowrap;
        }
        .plan-name {
          font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
          margin-bottom: 10px;
        }
        .plan-price {
          font-size: 42px; font-weight: 800; letter-spacing: -0.04em;
          color: #fff; line-height: 1; margin-bottom: 4px;
        }
        .plan-price span { font-size: 18px; font-weight: 500; color: rgba(255,255,255,0.45); vertical-align: top; margin-top: 10px; display: inline-block; }
        .plan-price sub { font-size: 14px; font-weight: 500; color: rgba(255,255,255,0.45); vertical-align: baseline; }
        .plan-desc { font-size: 13px; color: rgba(255,255,255,0.55); line-height: 1.55; margin-bottom: 28px; margin-top: 8px; }
        .plan-overage { font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 8px; }

        .plan-scenarios {
          margin-top: 20px;
          padding-top: 18px;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .plan-scenarios-title {
          font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
          text-transform: uppercase; color: rgba(255,255,255,0.35);
          margin-bottom: 10px;
        }
        .plan-scenario-item {
          display: flex; align-items: flex-start; gap: 8px;
          font-size: 12px; color: rgba(255,255,255,0.55);
          line-height: 1.5; margin-bottom: 7px;
        }
        .plan-scenario-item::before {
          content: '→'; color: inherit; flex-shrink: 0; opacity: 0.6;
        }

        .plan-divider { border: none; border-top: 1px solid rgba(255,255,255,0.07); margin: 24px 0; }

        .plan-features { display: flex; flex-direction: column; gap: 12px; flex: 1; }
        .plan-feature {
          display: flex; align-items: flex-start; gap: 10px;
          font-size: 13px; color: rgba(255,255,255,0.72); line-height: 1.4;
        }
        .plan-feature svg { flex-shrink: 0; margin-top: 1px; }
        .plan-locked { color: rgba(255,255,255,0.22); }

        .plan-cta { margin-top: 28px; display: block; text-align: center; }
        .plan-cta-btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; padding: 14px;
          font-weight: 700; font-size: 15px; font-family: 'Space Grotesk', sans-serif;
          border-radius: 12px; border: none; cursor: pointer; text-decoration: none;
          text-align: center; transition: transform 0.15s, box-shadow 0.15s;
        }
        .plan-cta-btn.primary { background: #00d4ff; color: #000; }
        .plan-cta-btn.primary:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(0,212,255,0.35); }
        .plan-cta-btn.outline {
          background: transparent; color: #fff;
          border: 1px solid rgba(255,255,255,0.2);
        }
        .plan-cta-btn.outline:hover { border-color: rgba(255,255,255,0.45); transform: translateY(-2px); }
        .plan-cta-btn.purple { background: #7c3aed; color: #fff; }
        .plan-cta-btn.purple:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(124,58,237,0.4); }

        /* Comparison table */
        .compare-section {
          max-width: 1080px; margin: 0 auto;
          padding: 0 24px 88px;
        }
        .compare-title {
          font-size: clamp(22px, 3vw, 32px); font-weight: 800;
          letter-spacing: -0.03em; color: #fff; margin-bottom: 32px; text-align: center;
        }
        .compare-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 16px;
        }
        .compare-table {
          width: 100%; min-width: 560px; border-collapse: collapse;
        }
        .compare-table th {
          padding: 16px 20px; text-align: center;
          font-size: 13px; font-weight: 700;
          background: rgba(255,255,255,0.03);
          border-bottom: 1px solid rgba(255,255,255,0.07);
          border-right: 1px solid rgba(255,255,255,0.05);
        }
        .compare-table th:first-child { text-align: left; }
        .compare-table th:last-child { border-right: none; }
        .compare-table th.popular-col {
          background: rgba(124,58,237,0.08);
          color: #a78bfa;
        }
        .compare-table td {
          padding: 13px 20px; font-size: 13px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          border-right: 1px solid rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.62);
          text-align: center;
        }
        .compare-table td:first-child { text-align: left; color: rgba(255,255,255,0.75); font-weight: 500; }
        .compare-table td:last-child { border-right: none; }
        .compare-table td.popular-col { background: rgba(124,58,237,0.04); }
        .compare-table tr:last-child td { border-bottom: none; }
        .compare-table tr:hover td { background: rgba(255,255,255,0.02); }
        .compare-table tr:hover td.popular-col { background: rgba(124,58,237,0.06); }

        /* FAQ */
        .faq-section {
          max-width: 720px; margin: 0 auto;
          padding: 0 24px 88px;
        }
        .faq-title {
          font-size: clamp(22px, 3vw, 32px); font-weight: 800;
          letter-spacing: -0.03em; color: #fff; margin-bottom: 32px; text-align: center;
        }
        .faq-item {
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding: 22px 0;
        }
        .faq-q { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 10px; }
        .faq-a { font-size: 14px; color: rgba(255,255,255,0.62); line-height: 1.75; }

        /* CTA strip */
        .cta-strip {
          background: linear-gradient(135deg, rgba(0,212,255,0.07) 0%, rgba(0,100,200,0.05) 100%);
          border-top: 1px solid rgba(0,212,255,0.1); border-bottom: 1px solid rgba(0,212,255,0.1);
          padding: 72px 24px; text-align: center;
        }
        .cta-strip h2 {
          font-size: clamp(26px, 4vw, 42px); font-weight: 800; letter-spacing: -0.03em;
          color: #fff; margin-bottom: 14px; line-height: 1.1;
        }
        .cta-strip h2 em { font-style: normal; color: #00d4ff; }
        .cta-strip p { font-size: 16px; color: rgba(255,255,255,0.62); max-width: 440px; margin: 0 auto 32px; line-height: 1.7; }
        .cta-row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
        .cta-note { margin-top: 14px; font-size: 12px; color: rgba(255,255,255,0.38); }

        /* Footer */
        .pr-footer { padding: 40px 24px 32px; text-align: center; }
        .pr-footer-links { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; margin-bottom: 16px; }
        .pr-footer-links a { font-size: 13px; color: rgba(255,255,255,0.45); text-decoration: none; transition: color 0.15s; }
        .pr-footer-links a:hover { color: #fff; }
        .pr-footer-copy { font-size: 12px; color: rgba(255,255,255,0.28); }

        /* Floating WA */
        .wa-float {
          position: fixed; bottom: 22px; right: 20px; z-index: 999;
          background: #25d366; border-radius: 50%;
          width: 52px; height: 52px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 20px rgba(37,211,102,0.4);
          text-decoration: none; color: #fff;
          transition: transform 0.2s;
        }
        .wa-float:hover { transform: scale(1.1); }
      `}</style>

      <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="wa-float"><IconWA /></a>

      {/* Nav */}
      <nav className="pr-nav">
        <div className="pr-nav-inner">
          <Link to="/" className="pr-logo">
            <img src="/nova-logo.png" alt="Nova"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
            <div className="pr-logo-fallback" style={{ display: 'none' }}>N</div>
            Agent <span className="pr-accent">Nova</span>
          </Link>
          <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="btn-cta">
            Try Nova Free
          </a>
        </div>
      </nav>

      {/* Hero */}
      <div className="pr-hero">
        <div className="pr-label">Pricing</div>
        <h1>Simple pricing.<br />No surprises.</h1>
        <p>Pick the plan that fits your message volume. All plans include a free trial. No contracts, no setup fees.</p>
      </div>

      {/* Plans */}
      <div className="plans-grid">
        {PLANS.map((plan, i) => (
          <div key={i} className={`plan-card ${plan.popular ? 'popular' : ''}`}>
            {plan.popular && <div className="popular-badge">Most Popular</div>}
            <div className="plan-name" style={{ color: plan.color }}>{plan.name}</div>
            <div className="plan-price">
              <span>LKR </span>{plan.price.toLocaleString()}<sub>/mo</sub>
            </div>
            <div className="plan-desc">{plan.desc}</div>
            <hr className="plan-divider" />
            <div className="plan-features">
              {plan.highlights.map((f, j) => (
                <div key={j} className="plan-feature"><IconCheck /> {f}</div>
              ))}
              {plan.locked.map((f, j) => (
                <div key={j} className="plan-feature plan-locked"><IconX /> {f}</div>
              ))}
            </div>
            <div className="plan-overage">{plan.overage} over limit</div>
            <div className="plan-scenarios">
              <div className="plan-scenarios-title">Good fit if you are...</div>
              {plan.scenarios.map((s, j) => (
                <div key={j} className="plan-scenario-item">{s}</div>
              ))}
            </div>
            <div className="plan-cta">
              <a
                href={`${NOVA_WA}?text=Hi%20Nova%2C%20I%20want%20the%20${plan.name}%20plan`}
                target="_blank" rel="noreferrer"
                className={`plan-cta-btn ${plan.popular ? 'purple' : i === 2 ? 'outline' : 'primary'}`}
              >
                {plan.popular ? <><IconWA /> {plan.name} plan</> : plan.name === 'Starter' ? 'Start Free Trial' : 'Get Business Plan'}
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Comparison table */}
      <div className="compare-section">
        <div className="compare-title">Full feature comparison</div>
        <div className="compare-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Starter<br /><span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.45)' }}>LKR 4,900/mo</span></th>
                <th className="popular-col">Growth<br /><span style={{ fontSize: 12, fontWeight: 500 }}>LKR 9,900/mo</span></th>
                <th>Business<br /><span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.45)' }}>LKR 24,900/mo</span></th>
              </tr>
            </thead>
            <tbody>
              {ALL_FEATURES.map((row, i) => (
                <tr key={i}>
                  <td>{row.label}</td>
                  {row.values.map((val, j) => (
                    <td key={j} className={j === 1 ? 'popular-col' : ''}>
                      {val === true ? <IconCheck /> : val === false ? <IconX /> : val}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ */}
      <div className="faq-section">
        <div className="faq-title">Common questions</div>
        {FAQS.map((f, i) => (
          <div key={i} className="faq-item">
            <div className="faq-q">{f.q}</div>
            <div className="faq-a">{f.a}</div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="cta-strip">
        <h2>Not sure which plan?<br />Try <em>Nova first</em>.</h2>
        <p>Message Nova directly on WhatsApp. No account needed. See it handle real conversations before you decide anything.</p>
        <div className="cta-row">
          <a href={NOVA_WA_DEMO} target="_blank" rel="noreferrer" className="btn-cta">
            <IconWA /> Try Nova on WhatsApp
          </a>
          <a href={NOVA_WA} target="_blank" rel="noreferrer" className="btn-ghost">
            Talk to us
          </a>
        </div>
        <div className="cta-note">No contracts · No setup fees · Cancel anytime</div>
      </div>

      {/* Footer */}
      <footer className="pr-footer">
        <div className="pr-footer-links">
          <Link to="/">Home</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Use</Link>
          <a href={NOVA_WA} target="_blank" rel="noreferrer">Contact</a>
        </div>
        <div className="pr-footer-copy">© 2026 Agent Nova. All rights reserved.</div>
      </footer>
    </div>
  );
}
