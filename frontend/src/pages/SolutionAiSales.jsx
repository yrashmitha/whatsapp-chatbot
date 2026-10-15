import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/nova-site.css';
import Header from '../components/novasite/Header';
import Footer from '../components/novasite/Footer';
import Reveal from '../components/novasite/Reveal';
import { whatsappLink } from '../config/novaSolutions';

const FEATURES = [
  { title: 'WhatsApp customer interactions', desc: 'Customers message your existing WhatsApp number. No new app to install, nothing for them to learn.' },
  { title: 'Product discovery and questions', desc: 'Understands questions about your catalog and responds with relevant, accurate answers.' },
  { title: 'Order inquiry and collection', desc: 'Collects the details needed to start or progress an order through natural conversation.' },
  { title: 'Configured to your business', desc: 'Tuned to your catalog, policies, and tone, not a generic chatbot script.' },
];

const WORKFLOW = [
  { title: 'Customer sends a message', desc: 'A question, an order, or a request arrives on your WhatsApp number.' },
  { title: 'AI understands the inquiry', desc: 'Nova reads the message in context and works out what the customer needs.' },
  { title: 'AI provides product information', desc: 'Relevant answers and details are pulled from your catalog and policies.' },
  { title: 'AI assists with the next step', desc: 'The conversation moves toward an order, a booking, or a handoff to your team.' },
];

export default function SolutionAiSales() {
  useEffect(() => { document.title = 'Nova AI Sales Assistant | Nova Solutions'; }, []);

  return (
    <div className="nv-root">
      <Header />

      <section className="nv-hero">
        <div className="nv-hero-text">
          <h1>You Sleep. <span className="nv-accent-text">He Sells.</span></h1>
          <p className="nv-hero-sub">
            Customer inquiries don't stop when your working hours do. Nova AI
            Sales Assistant connects to your WhatsApp number and keeps
            answering, guiding, and selling after you've logged off.
          </p>
          <div className="nv-hero-ctas">
            <a href={whatsappLink("Hi Nova, I'd like to see the AI Sales Assistant in action.")} target="_blank" rel="noreferrer" className="nv-btn nv-btn-whatsapp">See Nova AI in Action</a>
            <Link to="/contact" className="nv-btn nv-btn-secondary">Book a Consultation</Link>
          </div>
        </div>
        <div className="nv-hero-visual">
          <picture>
            <source media="(max-width: 640px)" srcSet="/solutions-ai-sales-page-mobile.png" />
            <img className="nv-shot" src="/solutions-ai-sales-page-desktop.png" alt="Nova AI Sales Assistant chatting with a customer on WhatsApp, recommending products and placing an order" loading="eager" />
          </picture>
        </div>
      </section>

      <section className="nv-section nv-alt">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">What Nova AI Sales Assistant does.</Reveal>
          <p className="nv-lede">Illustrative capabilities, configured to your catalog and policies before launch.</p>
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

      <section className="nv-section">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">From message to order.</Reveal>
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
          <h2>See Nova AI in Action.</h2>
          <p>
            Message our demo number to try the experience yourself, or book a
            consultation to talk through setting it up for your business.
          </p>
          <div className="nv-cta-row">
            <a href={whatsappLink("Hi Nova, I'd like to see the AI Sales Assistant in action.")} target="_blank" rel="noreferrer" className="nv-btn nv-btn-whatsapp nv-btn-lg">Try It on WhatsApp</a>
            <Link to="/contact" className="nv-btn nv-btn-primary nv-btn-lg">Book a Consultation</Link>
          </div>
        </Reveal>
      </section>

      <Footer />
    </div>
  );
}
