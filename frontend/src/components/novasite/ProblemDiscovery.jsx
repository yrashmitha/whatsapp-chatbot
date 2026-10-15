import { useState } from 'react';
import { Link } from 'react-router-dom';
import Reveal from './Reveal';

function ChatIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5C3 6.4 6.6 3 11 3s8 3.4 8 7.5-3.6 7.5-8 7.5c-1 0-1.9-.15-2.8-.45L3 19l1.3-3.3C3.5 14.4 3 12.5 3 10.5Z" /></svg>;
}
function ChartIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17V9M9 17V3M15 17v-5M3 17h14" /></svg>;
}
function GearIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="2.6" /><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" /></svg>;
}
function DocIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2.5h5.5L16 7v10.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" /><path d="M11 2.5V7h5M7 11h6M7 14h6" /></svg>;
}
function BulbIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2.5a5.5 5.5 0 0 0-3 10.1c.6.4 1 1.1 1 1.9v.5h4v-.5c0-.8.4-1.5 1-1.9A5.5 5.5 0 0 0 10 2.5Z" /><path d="M8.3 17.5h3.4" /></svg>;
}
function LinkBrokenIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 11.5 4.6 15.4a2.5 2.5 0 1 1-3.5-3.5L5 8" /><path d="M11.5 8.5l3.9-3.9a2.5 2.5 0 1 1 3.5 3.5L15 12" /><path d="M3 3l14 14" opacity=".5" /></svg>;
}
function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="8" fill="currentColor" opacity="0.14" />
      <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckBadge() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="9" fill="var(--nv-accent)" />
      <path d="M5 9l2.6 2.6L13 6.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8h9M8.5 4l4 4-4 4" />
    </svg>
  );
}

const PROBLEMS = [
  {
    id: 'cant-respond',
    Icon: ChatIcon,
    color: '#365cf5',
    title: "I can't respond to every customer.",
    desc: 'Messages pile up, especially after business hours.',
    quote: "I'm getting 100+ messages a day and can't keep up. Customers are blaming me for slow replies.",
    solution: 'Nova AI Sales Assistant',
    explanation: "Our AI Sales Assistant connects to your WhatsApp and handles customer conversations, product questions, and order collection, 24/7, even when your team isn't available.",
    features: ['Instant customer replies', 'Product discovery', 'Order collection', 'Trained for your business'],
    image: '/ai-sales-desktop.png',
    to: '/solutions/ai-sales-assistant',
    serviceOption: 'AI Sales Assistant',
    ctaLabel: 'Explore AI Sales Assistant',
  },
  {
    id: 'no-profit-visibility',
    Icon: ChartIcon,
    color: '#22b8a4',
    title: "I don't know where my profit goes.",
    desc: "Sales are happening, but my numbers aren't clear.",
    quote: "I'm making sales, but I don't actually know my profit.",
    solution: 'Nova Business OS',
    explanation: 'Nova Business OS tracks inventory, orders, and accounts together, so your margins update as orders come in instead of waiting on a manual reconciliation.',
    features: ['Live profit tracking', 'Inventory visibility', 'Centralized accounts', 'One source of truth'],
    image: '/business-os-desktop.png',
    to: '/solutions/business-management',
    serviceOption: 'Business Management Software',
    ctaLabel: 'Explore Business Management',
  },
  {
    id: 'repetitive-tasks',
    Icon: GearIcon,
    color: '#7c5cff',
    title: 'My team wastes time on repetitive work.',
    desc: 'We copy data, send updates, and follow up manually.',
    quote: 'My team wastes hours on repetitive tasks.',
    solution: 'AI Automation',
    explanation: 'If a task follows a describable pattern, from logging data to updating records across systems, our AI Automation service maps it out and builds the workflow around it.',
    features: ['Workflow mapping', 'Fewer manual steps', 'Connected systems', 'Human review where needed'],
    image: '/automation-desktop.png',
    to: '/services/ai-automation',
    serviceOption: 'AI Automation',
    ctaLabel: 'Explore AI Automation',
  },
  {
    id: 'scattered-spreadsheets',
    Icon: DocIcon,
    color: '#f59e0b',
    title: 'My business runs on spreadsheets.',
    desc: 'Important information is scattered across files and tools.',
    quote: 'Everything in my business lives in different spreadsheets that never agree.',
    solution: 'Nova Business OS',
    explanation: "Nova Business OS centralizes inventory, accounts, and staff records in one system. For anything it doesn't cover out of the box, we can build the missing piece around it.",
    features: ['Inventory in one place', 'Accounts alongside operations', 'Staff records included', 'Built around how you work'],
    image: '/business-os-desktop.png',
    to: '/solutions/business-management',
    serviceOption: 'Business Management Software',
    ctaLabel: 'Explore Business Management',
  },
  {
    id: 'no-fit',
    Icon: BulbIcon,
    color: '#eab308',
    title: 'I have an idea, but no software exists for it.',
    desc: 'I need something designed around how my business works.',
    quote: 'I have a business idea, but nothing off-the-shelf fits what I need.',
    solution: 'Custom Software Engineering',
    explanation: 'This is where custom engineering comes in. We build the web application, system, or tool around your actual requirements instead of forcing you into a template.',
    features: ['Built to your requirements', 'Web, mobile, or both', 'No forced templates', 'Engineered, not assembled'],
    image: '/services-engineering-desktop.png',
    to: '/services',
    serviceOption: 'Custom Web Application',
    ctaLabel: 'Discuss Custom Software',
  },
  {
    id: 'systems-not-talking',
    Icon: LinkBrokenIcon,
    color: '#f43f5e',
    title: "My systems don't talk to each other.",
    desc: 'My team keeps entering the same information in different places.',
    quote: "My systems don't talk to each other, so someone re-enters the same data twice.",
    solution: 'Systems Integration & Automation',
    explanation: 'This is a systems integration problem. We connect the tools you already use so information moves between them automatically, instead of being retyped.',
    features: ['Connects your existing tools', 'Removes double entry', 'Automated data flow', 'No rip-and-replace needed'],
    image: '/automation-desktop.png',
    to: '/services/ai-automation',
    serviceOption: 'AI Automation',
    ctaLabel: 'Discuss Integration',
  },
];

export default function ProblemDiscovery() {
  const [selectedId, setSelectedId] = useState(PROBLEMS[0].id);
  const [customText, setCustomText] = useState('');
  const selected = PROBLEMS.find(p => p.id === selectedId);

  return (
    <div className="nv-discovery">
      <div className="nv-discovery-body">
        <Reveal as="div" className="nv-discovery-grid" stagger>
          {PROBLEMS.map(p => {
            const active = p.id === selectedId;
            return (
              <button
                type="button"
                key={p.id}
                className={`nv-discovery-card${active ? ' active' : ''}`}
                style={{ '--card-color': p.color }}
                aria-pressed={active}
                onClick={() => setSelectedId(p.id)}
              >
                {active && <span className="nv-discovery-badge"><CheckBadge /></span>}
                <span className="nv-discovery-icon"><p.Icon /></span>
                <span className="nv-discovery-card-text">
                  <span className="nv-discovery-card-title">{p.title}</span>
                  <span className="nv-discovery-card-desc">{p.desc}</span>
                </span>
                <span className="nv-discovery-card-chevron"><ArrowIcon /></span>
              </button>
            );
          })}
        </Reveal>

        {selected && (
          <div className="nv-discovery-result" style={{ '--card-color': selected.color }}>
            <div className="nv-discovery-result-label">Recommended Solution</div>
            <h3>{selected.solution}</h3>
            <p>{selected.explanation}</p>
            <div className="nv-discovery-result-visual">
              <img className="nv-shot" src={selected.image} alt={`${selected.solution} product preview`} loading="lazy" />
            </div>
            <div className="nv-feature-grid">
              {selected.features.map(f => (
                <div className="nv-feature-chip" key={f} style={{ '--nv-tint': selected.color }}><CheckIcon /> {f}</div>
              ))}
            </div>
            <div className="nv-discovery-ctas">
              <Link to={selected.to} className="nv-btn nv-btn-primary">{selected.ctaLabel} <ArrowIcon /></Link>
              <Link to="/contact" state={{ message: selected.quote, service_interest: selected.serviceOption }} className="nv-btn nv-btn-secondary">Let's Talk About Your Problem</Link>
            </div>
          </div>
        )}
      </div>

      <div className="nv-discovery-custom">
        <div className="nv-discovery-custom-icon"><ChatIcon /></div>
        <div className="nv-discovery-custom-body">
          <label htmlFor="discovery-custom">Don't see your problem here? Describe it in your own words.</label>
          <p>We'll help you find the best solution for your business.</p>
          <div className="nv-discovery-custom-row">
            <input
              id="discovery-custom"
              type="text"
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              placeholder="e.g. I spend too much time managing orders manually."
            />
            <Link
              to="/contact"
              state={{ message: customText }}
              className="nv-btn nv-btn-primary"
              onClick={e => { if (!customText.trim()) e.preventDefault(); }}
              aria-disabled={!customText.trim()}
            >
              Get Expert Advice <ArrowIcon />
            </Link>
          </div>
          <span className="nv-discovery-custom-note">This will be discussed during a free consultation.</span>
        </div>
      </div>
    </div>
  );
}
