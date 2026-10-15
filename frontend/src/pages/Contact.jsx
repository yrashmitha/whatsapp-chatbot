import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import '../styles/nova-site.css';
import Header from '../components/novasite/Header';
import Footer from '../components/novasite/Footer';
import { SERVICE_OPTIONS, whatsappLink } from '../config/novaSolutions';

const EMPTY = { name: '', business_name: '', email: '', phone: '', country: '', service_interest: '', message: '' };

export default function Contact() {
  useEffect(() => { document.title = 'Contact | Nova Solutions'; }, []);

  const location = useLocation();
  // Carries the problem a visitor picked on the homepage's "What's holding
  // your business back?" discovery section, so they don't have to retype it.
  const prefill = location.state || {};

  const [form, setForm] = useState({ ...EMPTY, ...prefill });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function validate() {
    const next = {};
    if (!form.name.trim()) next.name = 'Please enter your name.';
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = 'Please enter a valid email address.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setStatus('submitting');
    try {
      await axios.post('/leads', form);
      setStatus('success');
      setForm(EMPTY);
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="nv-root">
      <Header />

      <section className="nv-section" style={{ paddingBottom: 0 }}>
        <div className="nv-container">
          <h1 className="nv-h2">Book a Consultation</h1>
          <p className="nv-lede">
            Tell us about your business and what you're looking to solve.
            We'll get back to you to schedule a consultation. No pricing is
            quoted here, every project starts with a conversation.
          </p>
          {prefill.message && (
            <p className="nv-form-status success" style={{ marginTop: 20 }}>
              We've carried over what you told us, feel free to edit it below.
            </p>
          )}
        </div>
      </section>

      <section className="nv-section">
        <div className="nv-container nv-contact-grid">
          <form className="nv-form" onSubmit={handleSubmit} noValidate>
            <div className="nv-field">
              <label htmlFor="name">Name</label>
              <input id="name" type="text" value={form.name} onChange={e => update('name', e.target.value)} required aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-err' : undefined} />
              {errors.name && <span className="nv-field-error" id="name-err" role="alert">{errors.name}</span>}
            </div>

            <div className="nv-field">
              <label htmlFor="business_name">Business name <span className="opt">(optional)</span></label>
              <input id="business_name" type="text" value={form.business_name} onChange={e => update('business_name', e.target.value)} />
            </div>

            <div className="nv-field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={form.email} onChange={e => update('email', e.target.value)} required aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined} />
              {errors.email && <span className="nv-field-error" id="email-err" role="alert">{errors.email}</span>}
            </div>

            <div className="nv-field">
              <label htmlFor="phone">WhatsApp / phone <span className="opt">(optional)</span></label>
              <input id="phone" type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} />
            </div>

            <div className="nv-field">
              <label htmlFor="country">Country <span className="opt">(optional)</span></label>
              <input id="country" type="text" value={form.country} onChange={e => update('country', e.target.value)} />
            </div>

            <div className="nv-field">
              <label htmlFor="service">Service you're interested in</label>
              <select id="service" value={form.service_interest} onChange={e => update('service_interest', e.target.value)}>
                <option value="">Select one</option>
                {SERVICE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>

            <div className="nv-field">
              <label htmlFor="message">Tell us about your project <span className="opt">(optional)</span></label>
              <textarea id="message" rows={5} value={form.message} onChange={e => update('message', e.target.value)} />
            </div>

            {status === 'success' && (
              <div className="nv-form-status success" role="status">
                Thanks, we've received your request and will get back to you shortly.
              </div>
            )}
            {status === 'error' && (
              <div className="nv-form-status error" role="alert">
                Something went wrong sending your request. Please try again, or reach us directly on WhatsApp below.
              </div>
            )}

            <button type="submit" className="nv-btn nv-btn-primary nv-btn-lg" disabled={status === 'submitting'}>
              {status === 'submitting' ? 'Sending…' : 'Submit Request'}
            </button>

            <p className="nv-form-note">
              We only use these details to respond to your inquiry and will
              never share them with third parties.
            </p>
          </form>

          <div className="nv-contact-aside">
            <h3>Prefer WhatsApp?</h3>
            <p>Message us directly and we'll pick things up from there.</p>
            <a href={whatsappLink()} target="_blank" rel="noreferrer" className="nv-btn nv-btn-whatsapp">Chat on WhatsApp</a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
