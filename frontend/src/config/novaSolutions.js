/**
 * Central, editable configuration for the Nova Solutions marketing site.
 * Update contact details and the technology list here rather than in components.
 */

// Configure the real business WhatsApp number via env in production; this
// reuses the existing Agent Nova contact numbers already live on this site.
export const WHATSAPP_NUMBER = '94776891125';

export function whatsappLink(message) {
  const text = encodeURIComponent(message || "Hi Nova Solutions, I'd like to book a consultation.");
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
}

export const NAV = [
  {
    label: 'Solutions',
    items: [
      { label: 'Overview', href: '/#solutions' },
      { label: 'Nova AI Sales Assistant', href: '/solutions/ai-sales-assistant' },
      { label: 'Nova Business OS', href: '/solutions/business-management' },
    ],
  },
  {
    label: 'Services',
    items: [
      { label: 'Overview', href: '/services' },
      { label: 'AI Automation', href: '/services/ai-automation' },
      { label: 'Custom Engineering', href: '/services#engineering' },
    ],
  },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

export const SERVICE_OPTIONS = [
  'AI Sales Assistant',
  'Business Management Software',
  'AI Automation',
  'Custom Web Application',
  'Website / E-commerce',
  'Other',
];

export const ENGINEERING_SERVICES = [
  { title: 'Custom Web Development', desc: 'Business websites, marketing sites, client portals, and internal tools built around your workflow.' },
  { title: 'E-Commerce Development', desc: 'Online shopping experiences and the commerce workflows that support them.' },
  { title: 'Custom Software Engineering', desc: 'Software built around your requirements, not a predefined package.' },
  { title: 'AI Automation & Intelligent Workflows', desc: 'Customer communication automation, process automation, and AI-assisted internal workflows.' },
  { title: 'System Integrations', desc: 'Connecting existing tools and platforms so your systems work together.' },
  { title: 'Maintenance & Support', desc: 'An engineering partner beyond initial delivery, offering support, optimization, and system evolution.' },
];

export const TECH_STACK = [
  { name: 'React', group: 'frontend' },
  { name: 'AWS', group: 'cloud' },
  { name: 'Java', group: 'backend' },
  { name: 'Spring Boot', group: 'backend' },
  { name: 'MySQL', group: 'database' },
  { name: 'Python', group: 'backend' },
  { name: 'LangChain', group: 'ai' },
  { name: 'LangGraph', group: 'ai' },
  { name: 'LLM / AI', group: 'ai' },
];
