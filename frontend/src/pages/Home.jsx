import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/nova-site.css';
import Header from '../components/novasite/Header';
import Footer from '../components/novasite/Footer';
import Reveal from '../components/novasite/Reveal';
import ProblemDiscovery from '../components/novasite/ProblemDiscovery';
import TechConstellation from '../components/novasite/TechConstellation';
import { whatsappLink, ENGINEERING_SERVICES } from '../config/novaSolutions';

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8h9M8.5 4l4 4-4 4" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="8" fill="currentColor" opacity="0.14" />
      <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
const PILLARS = [
  { tag: 'Sell Smarter', title: 'AI-powered customer communication', desc: 'Nova AI Sales Assistant handles customer conversations, answers product questions, and guides purchases on WhatsApp around the clock.' },
  { tag: 'Operate Better', title: 'Unified business operations', desc: 'Nova Business OS brings inventory, profit tracking, accounts, and staff management into one place, instead of scattered spreadsheets.' },
  { tag: 'Build Anything', title: 'Custom applications & automation', desc: 'When off-the-shelf software falls short, our engineering team builds what your business actually needs, from web apps to workflow automation.' },
];

const STEPS = [
  { title: 'Discover', desc: 'We start by understanding the business problem instead of jumping to a solution.' },
  { title: 'Architect', desc: 'We plan the right technical approach for your scale, budget, and timeline.' },
  { title: 'Engineer', desc: 'We build and validate the solution, with you involved at every stage.' },
  { title: 'Launch & Evolve', desc: 'We deploy, then keep improving and supporting the system as your business grows.' },
];

const INDUSTRIES = [
  { name: 'Retail & E-commerce', sub: 'Product discovery, orders, inventory' },
  { name: 'Restaurants & Hospitality', sub: 'Orders, inquiries, guest communication' },
  { name: 'Service Businesses', sub: 'Bookings, follow-ups, client management' },
  { name: 'Growing SMEs', sub: 'Operational systems that scale with you' },
  { name: 'Enterprise Teams', sub: 'Integrations and custom engineering' },
];

export default function Home() {
  useEffect(() => { document.title = 'Nova Solutions | Technology Built Around Your Business'; }, []);

  return (
    <div className="nv-root">
      <Header />

      {/* ── Hero ── */}
      <section className="nv-hero">
        <div className="nv-hero-text">
          <h1>Technology Built <span className="nv-accent-text">Around Your Business</span>.</h1>
          <p className="nv-hero-sub">
            From AI-powered sales and intelligent automation to custom
            applications and complete business systems, we engineer technology
            that helps you work smarter and grow.
          </p>
          <div className="nv-hero-ctas">
            <Link to="/contact" className="nv-btn nv-btn-primary nv-btn-lg">Book a Consultation <ArrowIcon /></Link>
            <a href="#solutions" className="nv-btn nv-btn-secondary nv-btn-lg">Explore Our Solutions</a>
          </div>
        </div>

        <div className="nv-hero-visual">
          <picture>
            <source media="(max-width: 640px)" srcSet="/hero-mobile.png" />
            <img className="nv-shot" src="/hero-desktop.png" alt="Nova AI Sales Assistant, Business OS, and custom engineering working together" loading="eager" />
          </picture>
        </div>
      </section>

      {/* ── Problem-first discovery ── */}
      <section className="nv-section nv-alt">
        <div className="nv-container nv-container-narrow">
          <div className="nv-discovery-eyebrow">Find Your Solution</div>
          <Reveal as="h2" className="nv-h2 nv-center">You Know the Problem.<br /><span className="nv-accent-text">We Know How to Solve It.</span></Reveal>
          <p className="nv-lede nv-center">
            You don't need to understand AI or software development. Tell us
            what's slowing your business down, and we'll help you find the
            right solution, whether it's something we've already built or
            something we create just for you.
          </p>
        </div>
        <div className="nv-container">
          <p className="nv-discovery-prompt">What's holding your business back?</p>
          <p className="nv-discovery-subprompt">Choose the challenge that feels most familiar to you.</p>
          <ProblemDiscovery />
        </div>
      </section>

      {/* ── Capabilities / Solutions overview ── */}
      <section className="nv-section" id="solutions">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">One Technology Partner. More Possibilities.</Reveal>
          <Reveal as="div" className="nv-pillars" stagger>
            {PILLARS.map(p => (
              <div className="nv-pillar" key={p.tag}>
                <div>
                  <div className="nv-pillar-tag">{p.tag}</div>
                  <h3>{p.title}</h3>
                </div>
                <p>{p.desc}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Featured products ── */}
      <section className="nv-section nv-alt">
        <div className="nv-container">
          <h2 className="nv-h2">Built to solve real business problems.</h2>
          <p className="nv-lede">Two products, each engineered around a different part of how your business runs. Sell smarter on one side, operate with less chaos on the other.</p>
        </div>

        <div className="nv-showcase">
          {/* Nova AI Sales Assistant */}
          <Reveal className="nv-showcase-row nv-tint-a" id="ai-sales-assistant">
            <div>
              <h3>You Sleep. He Sells.</h3>
              <p>
                Customer inquiries don't stop when your working hours do. Nova AI
                Sales Assistant connects to your WhatsApp number and handles
                customer conversations, answers product questions, and assists
                with the next step of a purchase.
              </p>
              <div className="nv-feature-grid">
                <div className="nv-feature-chip"><CheckIcon /> WhatsApp customer interactions</div>
                <div className="nv-feature-chip"><CheckIcon /> Product discovery &amp; questions</div>
                <div className="nv-feature-chip"><CheckIcon /> Order inquiry &amp; collection</div>
                <div className="nv-feature-chip"><CheckIcon /> Configured to your business</div>
              </div>
              <div className="nv-hero-ctas">
                <a href={whatsappLink("Hi Nova, I'd like to learn more about your AI Sales Assistant.")} target="_blank" rel="noreferrer" className="nv-btn nv-btn-whatsapp">See Nova AI in Action</a>
                <Link to="/solutions/ai-sales-assistant" className="nv-btn nv-btn-secondary">Learn More</Link>
              </div>
            </div>
            <div className="nv-showcase-visual">
              <div className="nv-demo-label">Illustrative conversation</div>
              <picture>
                <source media="(max-width: 640px)" srcSet="/ai-sales-mobile.png" />
                <img className="nv-shot" src="/ai-sales-desktop.png" alt="Nova AI Sales Assistant answering a WhatsApp customer, checking stock, and starting an order" loading="lazy" />
              </picture>
            </div>
          </Reveal>

          {/* Nova Business OS */}
          <Reveal className="nv-showcase-row rev nv-tint-b" id="business-os">
            <div>
              <h3>Less Chaos. More Control.</h3>
              <p>
                Fragmented spreadsheets and disconnected tools make it hard to see
                what's actually happening in your business. Nova Business OS
                centralizes inventory, profit tracking, business accounts, and
                staff management into one management system.
              </p>
              <div className="nv-feature-grid">
                <div className="nv-feature-chip"><CheckIcon /> Inventory management</div>
                <div className="nv-feature-chip"><CheckIcon /> Profit tracking</div>
                <div className="nv-feature-chip"><CheckIcon /> Business accounts</div>
                <div className="nv-feature-chip"><CheckIcon /> Staff management</div>
              </div>
              <div className="nv-hero-ctas">
                <Link to="/solutions/business-management" className="nv-btn nv-btn-primary">Learn More</Link>
                <Link to="/contact" className="nv-btn nv-btn-secondary">Book a Consultation</Link>
              </div>
            </div>
            <div className="nv-showcase-visual">
              <div className="nv-demo-label">Illustrative sample data</div>
              <picture>
                <source media="(max-width: 640px)" srcSet="/business-os-mobile.png" />
                <img className="nv-shot" src="/business-os-desktop.png" alt="Nova Business OS dashboard showing inventory, open orders, staff, and finance panels with illustrative sample data" loading="lazy" />
              </picture>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── AI Automation ── */}
      <section className="nv-section" id="services">
        <div className="nv-container" id="ai-automation">
          <Reveal as="h2" className="nv-h2">If You Can Describe It, We Can Automate It.</Reveal>
          <p className="nv-lede">
            Tell us about the work that slows your business down. We'll help
            identify the right automation approach and engineer a solution
            around your workflow.
          </p>
          <Reveal className="nv-flow-visual nv-full-bleed">
            <picture>
              <source media="(max-width: 640px)" srcSet="/automation-mobile.png" />
              <img className="nv-shot" src="/automation-desktop.png" alt="Manual process compared to Nova's AI automation flow, from inquiry and AI processing to a system update, human review where needed, and completed action" loading="lazy" />
            </picture>
          </Reveal>
          <div className="nv-hero-ctas nv-ctas-spaced">
            <Link to="/contact" className="nv-btn nv-btn-primary">Tell Us What You Want to Automate</Link>
            <Link to="/services/ai-automation" className="nv-btn nv-btn-secondary">See How It Works</Link>
          </div>
        </div>
      </section>

      {/* ── Custom Engineering ── */}
      <section className="nv-section nv-alt" id="engineering">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">Your Requirements. Our Engineering.</Reveal>
          <Reveal as="div" className="nv-eng-grid" stagger>
            {ENGINEERING_SERVICES.map(s => (
              <div className="nv-eng-card" key={s.title}>
                <h4>{s.title}</h4>
                <p>{s.desc}</p>
              </div>
            ))}
          </Reveal>
          <div className="nv-hero-ctas nv-ctas-spaced">
            <Link to="/services" className="nv-btn nv-btn-secondary">Explore Our Services</Link>
          </div>
        </div>
      </section>

      {/* ── Tech ecosystem ── */}
      <section className="nv-section">
        <TechConstellation />
      </section>

      {/* ── How we work ── */}
      <section className="nv-section nv-alt">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">From Idea to Intelligent Solution.</Reveal>
          <Reveal as="div" className="nv-steps" stagger>
            {STEPS.map((s, i) => (
              <div className="nv-step" key={s.title}>
                <div className="nv-step-num">{String(i + 1).padStart(2, '0')}</div>
                <div><h4>{s.title}</h4><p>{s.desc}</p></div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Industries ── */}
      <section className="nv-section">
        <div className="nv-container">
          <Reveal as="h2" className="nv-h2">Industries We Build For.</Reveal>
          <Reveal as="p" className="nv-industries-statement">
            We build for <span className="accent">retail and e-commerce</span>, <span className="accent">restaurants and hospitality</span>, <span className="accent">service businesses</span>, <span className="accent">growing SMEs</span>, and <span className="accent">enterprise teams</span>, wherever customer communication or operations need to work harder.
          </Reveal>
          <div className="nv-industries-detail">
            {INDUSTRIES.map(i => <span key={i.name}>{i.sub}</span>)}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="nv-cta-strip">
        <Reveal as="div" className="nv-container">
          <h2>Let's Build What's Next.</h2>
          <p>
            Have a process to automate, an idea to launch, or a business
            challenge to solve? Tell us what you're working on.
          </p>
          <div className="nv-cta-row">
            <Link to="/contact" className="nv-btn nv-btn-primary nv-btn-lg">Book a Consultation <ArrowIcon /></Link>
            <a href={whatsappLink()} target="_blank" rel="noreferrer" className="nv-btn nv-btn-whatsapp nv-btn-lg">Chat on WhatsApp</a>
          </div>
        </Reveal>
      </section>

      <Footer />
    </div>
  );
}
