import { useEffect } from 'react';

const NOVA_WA = 'https://wa.me/94771784821';

const LAST_UPDATED = 'March 20, 2026';

export default function Privacy() {
  useEffect(() => { document.title = 'Privacy Policy | Agent Nova'; }, []);

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
          <a href="/" className="legal-logo">
            <img src="/nova-logo.png" alt="Nova"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
            <div className="legal-logo-fallback" style={{ display: 'none' }}>N</div>
            Agent <span className="legal-accent">Nova</span>
          </a>
          <a href="/" className="legal-back">← Back to home</a>
        </div>
      </nav>

      <div className="legal-body">
        <div className="legal-header">
          <h1>Privacy Policy</h1>
          <div className="legal-meta">Last updated: {LAST_UPDATED}</div>
        </div>

        <div className="legal-section">
          <h2>1. Who we are</h2>
          <p>Agent Nova ("we", "our", "us") is an AI-powered WhatsApp business automation service. We operate the Agent Nova platform, which enables businesses ("Clients") to automate customer conversations via the WhatsApp Business API.</p>
          <p>This Privacy Policy explains what data we collect, how we use it, and your rights regarding that data when you use our service or interact with a business that uses our platform.</p>
        </div>

        <div className="legal-section">
          <h2>2. Information we collect</h2>
          <p>We collect information in two ways: directly from our business clients, and indirectly from their end customers through WhatsApp conversations.</p>
          <p><strong style={{ color: '#fff' }}>From business clients (you, if you sign up for Nova):</strong></p>
          <ul>
            <li>Business name, contact phone number, and WhatsApp Business number</li>
            <li>Business description, product catalog, pricing, and knowledge base content you upload</li>
            <li>Account settings and AI configuration preferences</li>
            <li>Billing information (processed by our payment provider; we do not store card details)</li>
          </ul>
          <p style={{ marginTop: 16 }}><strong style={{ color: '#fff' }}>From end customers (people who message your WhatsApp):</strong></p>
          <ul>
            <li>WhatsApp phone number and display name as provided by Meta</li>
            <li>Message content sent to your WhatsApp number (text, images, documents)</li>
            <li>Order details, delivery addresses, and payment information voluntarily shared in conversation</li>
            <li>Message timestamps and conversation history</li>
          </ul>
        </div>

        <div className="legal-section">
          <h2>3. How we use your information</h2>
          <ul>
            <li>To operate the AI assistant and generate replies to customer messages</li>
            <li>To store and display conversation history in the business dashboard</li>
            <li>To process and manage orders placed through chat</li>
            <li>To improve AI response quality (aggregated and anonymised, not linked to specific users)</li>
            <li>To send service notifications (e.g. usage alerts, billing notices) to business clients</li>
            <li>To comply with legal obligations</li>
          </ul>
          <p>We do not sell personal data to third parties. We do not use customer conversation data for advertising.</p>
        </div>

        <div className="legal-section">
          <h2>4. WhatsApp and Meta</h2>
          <div className="legal-highlight">
            <p>Agent Nova operates through the WhatsApp Business API provided by Meta Platforms, Inc. By using our service, you and your customers are also subject to Meta's Privacy Policy and WhatsApp's Terms of Service. We have no control over how Meta collects, processes, or stores data on their infrastructure. Please review Meta's policies at meta.com/privacy.</p>
          </div>
          <p>Message delivery, read receipts, and phone number data are transmitted through Meta's servers. We receive this data via webhooks and store it to power the dashboard and AI functionality.</p>
        </div>

        <div className="legal-section">
          <h2>5. Third-party services</h2>
          <p>We use the following third-party services to operate the platform:</p>
          <ul>
            <li><strong style={{ color: '#e0e0e0' }}>Google Gemini (AI)</strong> - Customer messages are sent to Google's Gemini API to generate AI responses. Google processes this data under their terms and privacy policy.</li>
            <li><strong style={{ color: '#e0e0e0' }}>Railway / hosting infrastructure</strong> - Our servers and database are hosted on cloud infrastructure. Data is stored in encrypted form.</li>
            <li><strong style={{ color: '#e0e0e0' }}>Meta WhatsApp Business API</strong> - Message delivery and phone number data.</li>
          </ul>
          <p>We do not share personal data with any other third parties except as required by law.</p>
        </div>

        <div className="legal-section">
          <h2>6. Data retention</h2>
          <p>Conversation history and order data are retained for as long as your business account is active. When you close your account, we delete your data within 30 days, except where retention is required by law.</p>
          <p>End customers can request deletion of their conversation data by contacting the business they messaged directly, or by contacting us.</p>
        </div>

        <div className="legal-section">
          <h2>7. Data security</h2>
          <p>We use industry-standard security measures including encrypted connections (HTTPS/TLS), encrypted database storage, and access controls. However, no system is completely secure. We cannot guarantee the absolute security of data transmitted over the internet.</p>
        </div>

        <div className="legal-section">
          <h2>8. Your rights</h2>
          <p>Depending on your location, you may have rights to access, correct, or delete your personal data. To exercise these rights, contact us via WhatsApp or the contact details below. We will respond within 30 days.</p>
        </div>

        <div className="legal-section">
          <h2>9. Children</h2>
          <p>Our service is not directed at children under 13. We do not knowingly collect data from children. If you believe we have collected data from a child, please contact us immediately.</p>
        </div>

        <div className="legal-section">
          <h2>10. Changes to this policy</h2>
          <p>We may update this Privacy Policy from time to time. We will notify active clients of significant changes via WhatsApp or email. Continued use of the service after changes constitutes acceptance of the updated policy.</p>
        </div>

        <div className="legal-section legal-contact">
          <h2>11. Contact us</h2>
          <p>For privacy-related questions or data requests, contact us on WhatsApp: <a href={NOVA_WA} target="_blank" rel="noreferrer">wa.me/94771784821</a></p>
        </div>
      </div>

      <footer className="legal-footer">
        <div className="legal-footer-links">
          <a href="/">Home</a>
          <a href="/pricing">Pricing</a>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Use</a>
          <a href={NOVA_WA} target="_blank" rel="noreferrer">Contact</a>
        </div>
        <div className="legal-footer-copy">© 2026 Agent Nova. All rights reserved.</div>
      </footer>
    </div>
  );
}
