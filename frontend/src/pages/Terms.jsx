import { useEffect } from 'react';
import { Link } from 'react-router-dom';

const NOVA_WA = 'https://wa.me/94771784821';

const LAST_UPDATED = 'March 20, 2026';

export default function Terms() {
  useEffect(() => { document.title = 'Terms of Use | Agent Nova'; }, []);

  return (
    <div className="legal-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .legal-root {
          font-family: 'Space Grotesk', sans-serif;
          background: #06080f; color: #d8d8d8;
          min-height: 100vh; overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
        }
        .legal-nav {
          position: sticky; top: 0; z-index: 100;
          background: rgba(6,8,15,0.9); backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding: 0 24px;
        }
        .legal-nav-inner {
          max-width: 800px; margin: 0 auto;
          display: flex; align-items: center; justify-content: space-between; height: 58px;
        }
        .legal-logo {
          font-weight: 800; font-size: 17px; letter-spacing: -0.5px;
          display: flex; align-items: center; gap: 8px; color: #fff; text-decoration: none;
        }
        .legal-logo img { width: 28px; height: 28px; border-radius: 7px; object-fit: cover; }
        .legal-logo-fallback {
          width: 28px; height: 28px; border-radius: 7px;
          background: linear-gradient(135deg, #00d4ff, #0066cc);
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 800; color: #000;
        }
        .legal-accent { color: #00d4ff; }
        .legal-back {
          font-size: 13px; color: rgba(255,255,255,0.5); text-decoration: none;
          transition: color 0.15s;
        }
        .legal-back:hover { color: #fff; }

        .legal-body {
          max-width: 760px; margin: 0 auto;
          padding: 56px 24px 88px;
        }
        .legal-header { margin-bottom: 48px; }
        .legal-header h1 {
          font-size: clamp(28px, 4vw, 42px); font-weight: 800;
          letter-spacing: -0.03em; color: #fff; margin-bottom: 12px;
        }
        .legal-meta { font-size: 13px; color: rgba(255,255,255,0.4); }

        .legal-section { margin-bottom: 44px; }
        .legal-section h2 {
          font-size: 18px; font-weight: 700; color: #fff;
          margin-bottom: 16px; padding-bottom: 10px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .legal-section p {
          font-size: 14px; line-height: 1.85; color: rgba(255,255,255,0.65);
          margin-bottom: 14px;
        }
        .legal-section p:last-child { margin-bottom: 0; }
        .legal-section ul {
          list-style: none; display: flex; flex-direction: column; gap: 8px;
          padding-left: 4px; margin-top: 4px;
        }
        .legal-section ul li {
          font-size: 14px; line-height: 1.75; color: rgba(255,255,255,0.65);
          padding-left: 16px; position: relative;
        }
        .legal-section ul li::before {
          content: '·'; position: absolute; left: 0;
          color: #00d4ff; font-weight: 700;
        }
        .legal-highlight {
          background: rgba(0,212,255,0.06);
          border: 1px solid rgba(0,212,255,0.14);
          border-radius: 12px; padding: 20px 22px;
          margin: 20px 0;
        }
        .legal-highlight p { color: rgba(255,255,255,0.75); margin: 0; }
        .legal-warning {
          background: rgba(220,38,38,0.08);
          border: 1px solid rgba(220,38,38,0.25);
          border-radius: 12px; padding: 22px 24px;
          margin: 20px 0;
        }
        .legal-warning-title {
          font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
          color: #f87171; margin-bottom: 12px;
        }
        .legal-warning p { color: rgba(255,255,255,0.7); margin-bottom: 10px; font-size: 14px; line-height: 1.8; }
        .legal-warning p:last-child { margin-bottom: 0; }
        .legal-contact a { color: #00d4ff; text-decoration: none; }
        .legal-contact a:hover { text-decoration: underline; }

        /* Footer */
        .legal-footer { padding: 32px 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.06); }
        .legal-footer-links { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; margin-bottom: 12px; }
        .legal-footer-links a { font-size: 13px; color: rgba(255,255,255,0.45); text-decoration: none; transition: color 0.15s; }
        .legal-footer-links a:hover { color: #fff; }
        .legal-footer-copy { font-size: 12px; color: rgba(255,255,255,0.28); }
      `}</style>

      <nav className="legal-nav">
        <div className="legal-nav-inner">
          <Link to="/" className="legal-logo">
            <img src="/nova-logo.png" alt="Nova"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
            <div className="legal-logo-fallback" style={{ display: 'none' }}>N</div>
            Agent <span className="legal-accent">Nova</span>
          </Link>
          <Link to="/" className="legal-back">← Back to home</Link>
        </div>
      </nav>

      <div className="legal-body">
        <div className="legal-header">
          <h1>Terms of Use</h1>
          <div className="legal-meta">Last updated: {LAST_UPDATED}</div>
        </div>

        <div className="legal-section">
          <h2>1. Acceptance of terms</h2>
          <p>By accessing or using the Agent Nova platform ("Service"), you agree to be bound by these Terms of Use. If you do not agree, do not use the Service.</p>
          <p>These Terms apply to all clients (businesses) that subscribe to Agent Nova, as well as any individuals who interact with the Service on behalf of a business.</p>
        </div>

        <div className="legal-section">
          <h2>2. Description of service</h2>
          <p>Agent Nova provides an AI-powered WhatsApp automation platform. The Service connects to your WhatsApp Business number via the Meta WhatsApp Business API and uses AI to respond to customer messages, take orders, and assist with business operations.</p>
          <p>We provide access to the platform, the AI model, the dashboard, and supporting tools. We do not guarantee any particular business outcome from using the Service.</p>
        </div>

        <div className="legal-section">
          <h2>3. WhatsApp account restrictions and bans</h2>

          <div className="legal-warning">
            <div className="legal-warning-title">Important: WhatsApp Ban Risk</div>
            <p>Agent Nova operates through the Meta WhatsApp Business API. WhatsApp (Meta Platforms, Inc.) has the sole and absolute right to restrict, limit, suspend, or permanently ban any WhatsApp Business Account at any time, for any reason, at their discretion.</p>
            <p>Reasons Meta may restrict your account include (but are not limited to): high spam report rates from customers, messaging outside the 24-hour customer service window without approved templates, sending promotional content that violates WhatsApp policies, using unapproved message templates, unusual messaging volume or patterns, or any other breach of WhatsApp Business Policy.</p>
            <p><strong style={{ color: '#fff' }}>Agent Nova is not responsible for any restriction, suspension, or permanent ban of your WhatsApp Business Account.</strong> We have no control over Meta's enforcement decisions. A restriction or ban may result in loss of your WhatsApp number, loss of conversation history accessible through WhatsApp, and disruption to your business communications.</p>
            <p>By using Agent Nova, you acknowledge and accept this risk. You are responsible for understanding and complying with WhatsApp Business Policy and Meta's terms at all times.</p>
          </div>

          <p>Agent Nova takes steps to reduce the risk of policy violations (e.g. respecting the 24-hour messaging window, read receipts, reply delays) but cannot guarantee full compliance with Meta's policies, which may change without notice.</p>
        </div>

        <div className="legal-section">
          <h2>4. Your responsibilities</h2>
          <p>You are responsible for:</p>
          <ul>
            <li>All content you configure Nova to send, including system prompts, product descriptions, and templates</li>
            <li>Ensuring that messages sent through your WhatsApp number comply with WhatsApp Business Policy and applicable Sri Lankan law</li>
            <li>Obtaining any necessary consents from your customers to receive automated WhatsApp messages</li>
            <li>Maintaining the security of your Agent Nova account credentials</li>
            <li>Notifying your customers that they may be interacting with an AI system</li>
            <li>Monitoring conversations and intervening when appropriate</li>
          </ul>
        </div>

        <div className="legal-section">
          <h2>5. Acceptable use</h2>
          <p>You must not use Agent Nova to:</p>
          <ul>
            <li>Send spam, unsolicited bulk messages, or promotional messages outside of approved WhatsApp templates</li>
            <li>Harass, deceive, or defraud customers</li>
            <li>Collect sensitive personal data (e.g. passwords, full card numbers) via WhatsApp chat</li>
            <li>Violate any applicable law, including Sri Lanka's Computer Crimes Act, Consumer Affairs Authority regulations, or data protection obligations</li>
            <li>Impersonate another person, business, or brand</li>
            <li>Distribute malware, phishing links, or harmful content</li>
          </ul>
          <p>We reserve the right to suspend or terminate your account immediately if we determine that your use violates these terms or places our platform or other clients at risk.</p>
        </div>

        <div className="legal-section">
          <h2>6. AI accuracy and limitations</h2>
          <div className="legal-highlight">
            <p>Agent Nova uses AI (Google Gemini) to generate responses. AI can make mistakes. Responses may be inaccurate, incomplete, or contextually inappropriate. You are responsible for reviewing AI behaviour, correcting errors, and ensuring the AI does not mislead your customers. Agent Nova is not liable for any loss caused by inaccurate AI responses.</p>
          </div>
          <p>We recommend monitoring conversations regularly, especially when Nova is newly configured. Use the manual override feature to take over conversations when needed.</p>
        </div>

        <div className="legal-section">
          <h2>7. Payment and billing</h2>
          <p>Subscription fees are charged monthly in advance in Sri Lankan Rupees (LKR). All payments are non-refundable except where required by law. If you exceed your plan's monthly AI reply limit, overage charges apply at the rate specified in your plan.</p>
          <p>Pricing is subject to change with 30 days' notice to active subscribers. Continued use after a price change takes effect constitutes acceptance of the new pricing.</p>
          <p>Meta's WhatsApp Business API usage charges (conversation fees) are separate from Agent Nova's subscription fee and are your responsibility to manage.</p>
        </div>

        <div className="legal-section">
          <h2>8. Limitation of liability</h2>
          <p>To the maximum extent permitted by Sri Lankan law, Agent Nova and its operators shall not be liable for:</p>
          <ul>
            <li>Loss of business, revenue, or profits arising from use of the Service</li>
            <li>WhatsApp account restrictions, suspensions, or bans</li>
            <li>Inaccurate, inappropriate, or harmful AI-generated responses</li>
            <li>Service interruptions, downtime, or data loss</li>
            <li>Actions taken by Meta, Google, or any other third-party provider</li>
            <li>Any indirect, incidental, or consequential damages</li>
          </ul>
          <p>Our total liability to you for any claim arising out of or relating to these Terms or the Service shall not exceed the amount you paid us in the 3 months preceding the claim.</p>
        </div>

        <div className="legal-section">
          <h2>9. Intellectual property</h2>
          <p>The Agent Nova platform, branding, and software are owned by us. You retain ownership of your business content (product data, system prompts, knowledge base) that you upload.</p>
          <p>You grant us a limited licence to use your content solely to provide the Service to you.</p>
        </div>

        <div className="legal-section">
          <h2>10. Termination</h2>
          <p>You may cancel your subscription at any time by contacting us. Cancellation takes effect at the end of your current billing period.</p>
          <p>We may terminate or suspend your account immediately if you breach these Terms, if your use poses a risk to our platform or other clients, or if required by law.</p>
          <p>Upon termination, your access to the dashboard and AI will stop. We will retain your data for 30 days before deletion, during which you may request an export.</p>
        </div>

        <div className="legal-section">
          <h2>11. Governing law</h2>
          <p>These Terms are governed by the laws of Sri Lanka. Any disputes arising from these Terms shall be subject to the exclusive jurisdiction of the courts of Sri Lanka.</p>
        </div>

        <div className="legal-section">
          <h2>12. Changes to these terms</h2>
          <p>We may update these Terms from time to time. We will notify active clients of significant changes via WhatsApp. Continued use of the Service after changes take effect constitutes acceptance.</p>
        </div>

        <div className="legal-section legal-contact">
          <h2>13. Contact</h2>
          <p>Questions about these Terms? Contact us on WhatsApp: <a href={NOVA_WA} target="_blank" rel="noreferrer">wa.me/94771784821</a></p>
        </div>
      </div>

      <footer className="legal-footer">
        <div className="legal-footer-links">
          <Link to="/">Home</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Use</Link>
          <a href={NOVA_WA} target="_blank" rel="noreferrer">Contact</a>
        </div>
        <div className="legal-footer-copy">© 2026 Agent Nova. All rights reserved.</div>
      </footer>
    </div>
  );
}
