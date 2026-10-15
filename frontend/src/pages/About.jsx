import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/nova-site.css';
import Header from '../components/novasite/Header';
import Footer from '../components/novasite/Footer';

const VALUES = [
  { title: 'Engineering-led', desc: 'We start from how a system actually needs to work, then design the product and business case around it.' },
  { title: 'Product and agency, equally', desc: 'We build our own software products and take on custom engineering work for clients. Neither side is secondary.' },
  { title: 'Transparent about capability', desc: "We tell you plainly what's feasible, what needs more discovery, and what's out of scope, before you commit to anything." },
];

export default function About() {
  useEffect(() => { document.title = 'About | Nova Solutions'; }, []);

  return (
    <div className="nv-root">
      <Header />

      <section className="nv-section" style={{ paddingBottom: 0 }}>
        <div className="nv-container">
          <h1 className="nv-h2">Software engineering, built around your business.</h1>
          <p className="nv-lede">
            Nova Solutions builds intelligent software and AI-powered solutions
            for businesses in Sri Lanka and internationally, from a WhatsApp
            AI sales assistant and business management software, to custom
            applications and automation engineered around real workflows.
          </p>
        </div>
      </section>

      <section className="nv-section">
        <div className="nv-container">
          <div className="nv-eng-grid">
            {VALUES.map(v => (
              <div className="nv-eng-card" key={v.title}>
                <h4>{v.title}</h4>
                <p>{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="nv-cta-strip">
        <div className="nv-container">
          <h2>Let's Build What's Next.</h2>
          <p>Tell us what you're working on, and we'll take it from there.</p>
          <div className="nv-cta-row">
            <Link to="/contact" className="nv-btn nv-btn-primary nv-btn-lg">Book a Consultation</Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
