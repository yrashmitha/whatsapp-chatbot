import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/nova-site.css';
import Header from '../components/novasite/Header';
import Footer from '../components/novasite/Footer';
import Reveal from '../components/novasite/Reveal';

const WORKFLOW = [
  { title: 'Customer inquiry', desc: 'A request comes in through chat, email, or a form.' },
  { title: 'AI processing', desc: 'Nova analyzes the inquiry, understands intent, and extracts the key details.' },
  { title: 'System update', desc: 'Information is securely updated across your systems, whether that is a CRM, database, or internal tool.' },
  { title: 'Human review', desc: 'Your team reviews exceptions or high-value cases for quality and accuracy, only where needed.' },
  { title: 'Action taken', desc: 'The inquiry is resolved, automations complete the task, and the customer is notified.' },
];

export default function ServiceAutomation() {
  useEffect(() => { document.title = 'AI Automation | Nova Solutions'; }, []);

  return (
    <div className="nv-root">
      <Header />

      <section className="nv-hero">
        <div className="nv-hero-text">
          <h1>If You Can Describe It, <span className="nv-accent-text">We Can Automate It.</span></h1>
          <p className="nv-hero-sub">
            Tell us about the work that slows your business down. We'll help
            identify the right automation approach and engineer a solution
            around your workflow, understanding requirements before
            committing to what's feasible.
          </p>
          <div className="nv-hero-ctas">
            <Link to="/contact" className="nv-btn nv-btn-primary">Tell Us What You Want to Automate</Link>
          </div>
        </div>
        <div className="nv-hero-visual">
          <picture>
            <source media="(max-width: 640px)" srcSet="/services-automation-page-mobile.png" />
            <img className="nv-shot" src="/services-automation-page-desktop.png" alt="Manual process compared to Nova's AI automation flow, from customer inquiry and AI processing to a system update, human review, and action taken" loading="eager" />
          </picture>
        </div>
      </section>

      <section className="nv-section nv-alt">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">From inquiry to action.</Reveal>
          <p className="nv-lede">The same five-step shape, whatever the workflow underneath it looks like.</p>
          <Reveal as="div" className="nv-steps" stagger>
            {WORKFLOW.map((s, i) => (
              <div className="nv-step" key={s.title}>
                <div className="nv-step-num">{String(i + 1).padStart(2, '0')}</div>
                <div><h4>{s.title}</h4><p>{s.desc}</p></div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="nv-cta-strip">
        <Reveal as="div" className="nv-container">
          <h2>Tell Us What You Want to Automate.</h2>
          <p>
            Describe your current workflow and the outcome you want. We'll
            tell you plainly what's feasible before anything is built.
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
