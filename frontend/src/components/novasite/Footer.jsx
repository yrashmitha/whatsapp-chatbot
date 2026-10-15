import { Link } from 'react-router-dom';
import { whatsappLink } from '../../config/novaSolutions';

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="nv-footer">
      <div className="nv-container">
        <div className="nv-footer-top">
          <div>
            <Link to="/" className="nv-logo">
              <span className="nv-logo-mark">N</span>
              Nova Solutions
            </Link>
            <p className="nv-footer-desc">
              Technology built around your business. AI-powered sales, business
              management software, automation, and custom engineering for
              Sri Lankan and international clients.
            </p>
          </div>
          <div>
            <div className="nv-footer-col-title">Solutions</div>
            <div className="nv-footer-col">
              <Link to="/solutions/ai-sales-assistant">Nova AI Sales Assistant</Link>
              <Link to="/solutions/business-management">Nova Business OS</Link>
            </div>
          </div>
          <div>
            <div className="nv-footer-col-title">Services</div>
            <div className="nv-footer-col">
              <Link to="/services">Custom Engineering</Link>
              <Link to="/services/ai-automation">AI Automation</Link>
            </div>
          </div>
          <div>
            <div className="nv-footer-col-title">Company</div>
            <div className="nv-footer-col">
              <Link to="/about">About</Link>
              <Link to="/contact">Contact</Link>
              <a href={whatsappLink()} target="_blank" rel="noreferrer">WhatsApp</a>
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
            </div>
          </div>
        </div>
        <div className="nv-footer-bottom">
          <span>© {year} Nova Solutions. All rights reserved.</span>
          <span>Sri Lanka · Serving international clients</span>
        </div>
      </div>
    </footer>
  );
}
