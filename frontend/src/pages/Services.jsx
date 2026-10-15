import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/nova-site.css';
import Header from '../components/novasite/Header';
import Footer from '../components/novasite/Footer';
import Reveal from '../components/novasite/Reveal';
import { ENGINEERING_SERVICES } from '../config/novaSolutions';

export default function Services() {
  useEffect(() => { document.title = 'Services | Nova Solutions'; }, []);

  return (
    <div className="nv-root">
      <Header />

      <section className="nv-hero" id="engineering">
        <div className="nv-hero-text">
          <h1>Your Requirements. <span className="nv-accent-text">Our Engineering.</span></h1>
          <p className="nv-hero-sub">
            When off-the-shelf software falls short, our engineering team
            builds what your business actually needs, from web apps to
            full workflow automation.
          </p>
          <div className="nv-hero-ctas">
            <Link to="/contact" className="nv-btn nv-btn-primary">Book a Consultation</Link>
          </div>
        </div>
        <div className="nv-hero-visual">
          <img className="nv-shot" src="/services-engineering-desktop.png" alt="Custom engineering dashboard surrounded by web, mobile, API, database, cloud, and automation capabilities" loading="eager" />
        </div>
      </section>

      <section className="nv-section nv-alt">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">What we build.</Reveal>
          <Reveal as="div" className="nv-eng-grid" stagger>
            {ENGINEERING_SERVICES.map(s => (
              <div className="nv-eng-card" key={s.title}>
                <h4>{s.title}</h4>
                <p>{s.desc}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="nv-section">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">AI automation, in depth.</Reveal>
          <p className="nv-lede">
            If describing a workflow is the hard part, automating it is ours.
            See the five-step shape we use for every automation project.
          </p>
          <Link to="/services/ai-automation" className="nv-btn nv-btn-secondary" style={{ marginTop: 24 }}>See How Automation Works</Link>
        </div>
      </section>

      <section className="nv-cta-strip">
        <Reveal as="div" className="nv-container">
          <h2>Let's Build What's Next.</h2>
          <p>
            Tell us what you're working on, and we'll tell you plainly what's
            feasible before anything is built.
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
