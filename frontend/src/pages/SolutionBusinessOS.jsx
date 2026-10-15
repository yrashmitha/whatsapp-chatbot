import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/nova-site.css';
import Header from '../components/novasite/Header';
import Footer from '../components/novasite/Footer';
import Reveal from '../components/novasite/Reveal';

const FEATURES = [
  { title: 'Inventory management', desc: 'Track stock levels across your catalog in one place, instead of a separate spreadsheet per product line.' },
  { title: 'Profit tracking', desc: 'See revenue and margins update as orders come in, without waiting for an end-of-month reconciliation.' },
  { title: 'Business accounts', desc: 'Keep accounts organized alongside day-to-day operations rather than in a disconnected tool.' },
  { title: 'Staff management', desc: 'Manage staff records and access from the same system your team already works in.' },
];

export default function SolutionBusinessOS() {
  useEffect(() => { document.title = 'Nova Business OS | Nova Solutions'; }, []);

  return (
    <div className="nv-root">
      <Header />

      <section className="nv-hero">
        <div className="nv-hero-text">
          <h1>Less Chaos. <span className="nv-accent-text">More Control.</span></h1>
          <p className="nv-hero-sub">
            Fragmented spreadsheets and disconnected tools make it hard to see
            what's actually happening in your business. Nova Business OS
            centralizes inventory, profit, accounts, and staff into one system.
          </p>
          <div className="nv-hero-ctas">
            <Link to="/contact" className="nv-btn nv-btn-primary">Explore Your Business Needs</Link>
          </div>
        </div>
        <div className="nv-hero-visual">
          <picture>
            <source media="(max-width: 640px)" srcSet="/solutions-business-os-page-mobile.png" />
            <img className="nv-shot" src="/solutions-business-os-page-desktop.png" alt="Nova Business OS dashboard showing inventory, orders, finance, and staff panels with illustrative sample data" loading="eager" />
          </picture>
        </div>
      </section>

      <section className="nv-section nv-alt">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">One system for the operations side of the business.</Reveal>
          <p className="nv-lede">Illustrative sample data, configured to your business before launch.</p>
          <Reveal as="div" className="nv-pillars" stagger>
            {FEATURES.map(f => (
              <div className="nv-pillar" key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="nv-cta-strip">
        <Reveal as="div" className="nv-container">
          <h2>Tell Us About Your Operations.</h2>
          <p>
            Share how inventory, accounts, and staff are managed today, and
            we'll walk through what Nova Business OS would look like for you.
          </p>
          <div className="nv-cta-row">
            <Link to="/contact" className="nv-btn nv-btn-primary nv-btn-lg">Book a Consultation</Link>
          </div>
        </Reveal>
      </section>

      <Footer />
    </div>
  );
}
