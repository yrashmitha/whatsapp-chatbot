import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import api, { adminApi } from '../lib/api';
import Layout from '../components/Layout';
import Drawer from '../components/ui/Drawer';
import { useToast } from '../components/ui/Toast';

/* ── Helpers ─────────────────────────────────────────────── */
const BRANDING_KEYS = ['report_signature', 'report_footer', 'report_invocation', 'report_divider', 'report_font', 'report_logo_url', 'report_logo_width', 'report_logo_height', 'pdf_title', 'pdf_author', 'pdf_subject', 'pdf_producer'];

const TABS = ['Identity', 'WhatsApp', 'AI', 'Branding', 'Reports', 'Features', 'Order Fields', 'Access'];
const TYPES = ['general', 'ecommerce', 'restaurant', 'astrology', 'service'];
const AI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className="relative w-9 h-5 rounded-full transition-colors cursor-pointer"
        style={{ background: checked ? '#6366f1' : 'var(--border)' }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </div>
      {label && <span className="text-sm" style={{ color: 'var(--text-2)' }}>{label}</span>}
    </label>
  );
}

function Field({ label, children, hint }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{label}</label>
      {children}
      {hint && <span className="text-xs" style={{ color: 'var(--text-3)' }}>{hint}</span>}
    </div>
  );
}

function Input({ value, onChange, placeholder, disabled, type = 'text', className = '' }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full px-3 py-2 rounded-lg text-sm outline-none border ${className}`}
      style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border)' }}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 rounded-lg text-sm outline-none border resize-y"
      style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border)' }}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg text-sm outline-none border"
      style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border)' }}
    >
      {options.map(o => (
        <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>
          {typeof o === 'string' ? o : o.label}
        </option>
      ))}
    </select>
  );
}

/* ── Secret input with show/hide toggle ─────────────────── */
function SecretInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2 items-center">
      <input
        type={show ? 'text' : 'password'}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 rounded-lg text-sm outline-none border"
        style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border)' }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="shrink-0 px-2 py-2 rounded-lg border-0 cursor-pointer text-xs"
        style={{ background: 'var(--bg-card)', color: 'var(--text-3)' }}
      >{show ? 'Hide' : 'Show'}</button>
    </div>
  );
}

/* ── Empty form state ───────────────────────────────────── */
const EMPTY = {
  id: '', name: '', type: 'general',
  phone_number_id: '', wa_token_env: '', wa_token: '', use_system_wa_token: false,
  webhook_verify_token: '',
  ai_model: 'gemini-2.5-flash', temperature: 0.70,
  system_prompt_mode: 'builtin', custom_prompt: '', error_message: '',
  gemini_api_key: '', use_system_gemini_key: false,
  freeastro_api_key: '', use_system_freeastro_key: false,
  report_signature: '', report_footer: '', report_invocation: '', report_divider: '', report_font: '', report_logo_url: '', report_logo_width: 160, report_logo_height: 160, pdf_title: '', pdf_author: '', pdf_subject: '', pdf_producer: '',
  brand_name: '', brand_color: '#075e54', logo_url: '', contact_number: '',
  product_catalog_enabled: false, order_flow_enabled: true,
  knowledge_base_enabled: false, plugin_enabled: false,
  order_id_prefix: '', order_fields: [],
  ai_enabled: true,
  package_id: '', bonus_messages: 0, overage_limit: 0, per_message_cost: 0,
};

/* ── Order field row editor ─────────────────────────────── */
function OrderFieldRow({ field, onChange, onDelete }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex gap-2">
          <input
            value={field.key ?? ''} onChange={e => onChange({ ...field, key: e.target.value })}
            placeholder="field_key" className="flex-1 px-2 py-1 rounded text-xs border outline-none"
            style={{ background: 'var(--bg-base)', color: 'var(--text-1)', borderColor: 'var(--border)' }}
          />
          <input
            value={field.label ?? ''} onChange={e => onChange({ ...field, label: e.target.value })}
            placeholder="Label" className="flex-1 px-2 py-1 rounded text-xs border outline-none"
            style={{ background: 'var(--bg-base)', color: 'var(--text-1)', borderColor: 'var(--border)' }}
          />
        </div>
        <input
          value={field.description ?? ''} onChange={e => onChange({ ...field, description: e.target.value })}
          placeholder="Description (optional)" className="w-full px-2 py-1 rounded text-xs border outline-none"
          style={{ background: 'var(--bg-base)', color: 'var(--text-1)', borderColor: 'var(--border)' }}
        />
      </div>
      <div className="flex flex-col items-center gap-1 shrink-0">
        <label className="text-xs" style={{ color: 'var(--text-3)' }}>Req</label>
        <input type="checkbox" checked={!!field.required} onChange={e => onChange({ ...field, required: e.target.checked })} />
      </div>
      <button
        onClick={onDelete}
        className="w-6 h-6 flex items-center justify-center rounded border-0 cursor-pointer text-red-400 hover:text-red-600 shrink-0"
        style={{ background: 'transparent' }}
      >×</button>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────── */
export default function Clients() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useToast();

  // Redirect non-superadmins
  if (!isSuperAdmin(user)) {
    navigate('/chat', { replace: true });
    return null;
  }

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = new client
  const [form, setForm] = useState(EMPTY);
  const [activeTab, setActiveTab] = useState(0);
  const [password, setPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [savedInfo, setSavedInfo] = useState(null); // { id, webhookUrl } shown after save

  /* ── API ─ */
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => adminApi.get('/clients').then(r => {
      const d = r.data;
      return Array.isArray(d) ? d : (d.clients || []);
    }),
    retry: false,
  });

  const { data: packagesData } = useQuery({
    queryKey: ['packages'],
    queryFn: () => adminApi.get('/packages').then(r => r.data),
  });
  const packages = packagesData || [];

  // Bundled typefaces the Reports tab may offer. Anything else would be silently
  // substituted by LibreOffice and render as broken glyphs in the PDF.
  const { data: reportFonts } = useQuery({
    queryKey: ['report-fonts'],
    queryFn: () => adminApi.get('/report-fonts').then(r => r.data),
    staleTime: 60 * 60 * 1000,
  });

  // Report branding lives in its own endpoint, so it loads only when a client is
  // open for editing and saves independently of the main client form.
  const { data: brandingData } = useQuery({
    queryKey: ['client-branding', editing?.id],
    queryFn: () => adminApi.get(`/clients/${editing.id}/branding`).then(r => r.data),
    enabled: !!editing?.id && drawerOpen,
  });

  useEffect(() => {
    if (!brandingData) return;
    setForm(f => ({
      ...f,
      report_signature: brandingData.report_signature ?? '',
      report_footer: brandingData.report_footer ?? '',
      report_invocation: brandingData.report_invocation ?? '',
      report_divider: brandingData.report_divider ?? '',
      report_font: brandingData.report_font ?? '',
      report_logo_url: brandingData.report_logo_url ?? '',
      report_logo_width: brandingData.report_logo_width ?? 160,
      report_logo_height: brandingData.report_logo_height ?? 160,
      pdf_title: brandingData.pdf_title ?? '',
      pdf_author: brandingData.pdf_author ?? '',
      pdf_subject: brandingData.pdf_subject ?? '',
      pdf_producer: brandingData.pdf_producer ?? '',
    }));
  }, [brandingData]);

  const saveMutation = useMutation({
    mutationFn: (body) => editing
      ? adminApi.put(`/clients/${editing.id}`, body)
      : adminApi.post('/clients', body),
    onSuccess: (_, body) => {
      qc.invalidateQueries({ queryKey: ['admin-clients'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      const clientId = editing ? editing.id : body.id;
      const host = window.location.origin;
      setSavedInfo({ id: clientId, webhookUrl: `${host}/webhook/${clientId}` });
      showToast(editing ? 'Client updated' : 'Client created', 'success');
    },
    onError: (e) => showToast(e?.response?.data?.error || 'Save failed', 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, ...body }) => adminApi.put(`/clients/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-clients'] }),
    onError: (e) => showToast(e?.response?.data?.error || 'Update failed', 'error'),
  });

  /* ── Helpers ── */
  const set = (key) => (val) => setForm(f => ({ ...f, [key]: val }));

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setActiveTab(0);
    setPassword('');
    setSavedInfo(null);
    setDrawerOpen(true);
  }

  function openEdit(c) {
    setEditing(c);
    setForm({
      id: c.id || '',
      name: c.name || '',
      type: c.type || 'general',
      phone_number_id: c.phone_number_id || '',
      wa_token_env: c.wa_token_env || '',
      wa_token: '',  // never pre-fill token for security
      use_system_wa_token: !!c.use_system_wa_token,
      webhook_verify_token: c.webhook_verify_token || '',
      ai_model: c.ai_model || 'gemini-2.5-flash',
      temperature: c.temperature ?? 0.70,
      system_prompt_mode: c.system_prompt_mode || 'builtin',
      custom_prompt: c.custom_prompt || '',
      error_message: c.error_message || '',
      gemini_api_key: '',  // never pre-fill for security
      use_system_gemini_key: !!c.use_system_gemini_key,
      freeastro_api_key: '',  // never pre-fill for security
      use_system_freeastro_key: !!c.use_system_freeastro_key,
      brand_name: c.brand_name || '',
      brand_color: c.brand_color || '#075e54',
      logo_url: c.logo_url || '',
      contact_number: c.contact_number || '',
      product_catalog_enabled: !!c.product_catalog_enabled,
      order_flow_enabled: c.order_flow_enabled !== false,
      knowledge_base_enabled: !!c.knowledge_base_enabled,
      plugin_enabled: !!c.plugin_enabled,
      order_id_prefix: c.order_id_prefix || '',
      order_fields: Array.isArray(c.order_fields) ? c.order_fields : (c.order_fields ? JSON.parse(c.order_fields) : []),
      ai_enabled: c.ai_enabled !== false,
      package_id: c.package_id || '',
      bonus_messages: c.bonus_messages ?? 0,
      overage_limit: c.overage_limit ?? 0,
      per_message_cost: c.per_message_cost ?? 0,
    });
    setActiveTab(0);
    setPassword('');
    setSavedInfo(null);
    setDrawerOpen(true);
  }

  async function handleSave() {
    const body = { ...form };
    if (editing) delete body.id;
    // Report branding has its own endpoint; strip those keys from the main body.
    const branding = {};
    for (const k of BRANDING_KEYS) { branding[k] = body[k]; delete body[k]; }

    saveMutation.mutate(body);

    // Only meaningful for an existing client — a new one has no config row yet.
    if (editing?.id) {
      try {
        await adminApi.put(`/clients/${editing.id}/branding`, branding);
        qc.invalidateQueries({ queryKey: ['client-branding', editing.id] });
      } catch (e) {
        showToast(e?.response?.data?.error || 'Report branding failed to save', 'error');
      }
    }
  }

  async function handleSetPassword() {
    if (!password.trim()) return;
    setPwSaving(true);
    try {
      await api.post('/auth/set-password', { clientId: editing?.id || form.id, password });
      showToast('Password set', 'success');
      setPassword('');
    } catch (e) {
      showToast(e?.response?.data?.error || 'Failed', 'error');
    } finally {
      setPwSaving(false);
    }
  }

  function addOrderField() {
    set('order_fields')([...form.order_fields, { key: '', label: '', description: '', required: false }]);
  }

  function updateOrderField(i, val) {
    const updated = [...form.order_fields];
    updated[i] = val;
    set('order_fields')(updated);
  }

  function removeOrderField(i) {
    set('order_fields')(form.order_fields.filter((_, idx) => idx !== i));
  }

  /* ── Tab content ── */
  function renderTab() {
    switch (activeTab) {
      case 0: return ( // Identity
        <div className="flex flex-col gap-4">
          <Field label="Client ID" hint={editing ? 'Cannot be changed after creation' : 'Unique identifier, e.g. acme_001'}>
            <Input value={form.id} onChange={set('id')} placeholder="acme_001" disabled={!!editing} />
          </Field>
          <Field label="Business Name">
            <Input value={form.name} onChange={set('name')} placeholder="Acme Astrology" />
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={set('type')} options={TYPES} />
          </Field>
        </div>
      );
      case 1: return ( // WhatsApp
        <div className="flex flex-col gap-4">
          <Field label="Phone Number ID" hint="From Meta → WhatsApp → API Setup">
            <Input value={form.phone_number_id} onChange={set('phone_number_id')} placeholder="123456789012345" />
          </Field>
          <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <Toggle
              checked={form.use_system_wa_token}
              onChange={set('use_system_wa_token')}
              label="Use my WhatsApp token (PROD_META_ACCESS_TOKEN)"
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
              When ON, this client uses your server token. No separate token needed.
            </p>
          </div>
          {!form.use_system_wa_token && (
            <Field label="WhatsApp Access Token" hint={editing && '⚠ Leave blank to keep existing token'}>
              <SecretInput value={form.wa_token} onChange={set('wa_token')} placeholder={editing ? '(unchanged)' : 'EAAxxxxx...'} />
            </Field>
          )}
          <Field label="WA Token Env Var (legacy)" hint="Optional: env var name fallback, e.g. WA_TOKEN_ACME">
            <Input value={form.wa_token_env} onChange={set('wa_token_env')} placeholder="WA_TOKEN_ACME" />
          </Field>
          <Field label="Webhook Verify Token" hint="Any secret string. Must match what you set in Meta dashboard.">
            <Input value={form.webhook_verify_token} onChange={set('webhook_verify_token')} placeholder="my_verify_secret" />
          </Field>
          {(editing || savedInfo) && (
            <Field label="Webhook URL (copy this into Meta dashboard)">
              <div className="flex gap-2 items-center">
                <Input
                  value={`${window.location.origin}/webhook/${editing?.id || savedInfo?.id || form.id}`}
                  onChange={() => {}}
                  disabled
                />
                <button
                  onClick={() => navigator.clipboard.writeText(`${window.location.origin}/webhook/${editing?.id || savedInfo?.id || form.id}`)}
                  className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium border-0 cursor-pointer"
                  style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--accent)' }}
                >Copy</button>
              </div>
            </Field>
          )}
        </div>
      );
      case 2: return ( // AI
        <div className="flex flex-col gap-4">
          <Field label="AI Model">
            <Select value={form.ai_model} onChange={set('ai_model')} options={AI_MODELS} />
          </Field>
          <Field label={`Temperature: ${parseFloat(form.temperature).toFixed(2)}`} hint="0 = focused, 1 = creative">
            <input
              type="range" min="0" max="1" step="0.05"
              value={form.temperature}
              onChange={e => set('temperature')(parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </Field>
          <Field label="System Prompt Mode">
            <Select
              value={form.system_prompt_mode}
              onChange={set('system_prompt_mode')}
              options={[{ value: 'builtin', label: 'Built-in' }, { value: 'custom', label: 'Custom' }]}
            />
          </Field>
          {form.system_prompt_mode === 'custom' && (
            <Field label="Custom System Prompt">
              <Textarea value={form.custom_prompt} onChange={set('custom_prompt')} placeholder="You are a helpful assistant..." rows={6} />
            </Field>
          )}
          <Field label="Error Message" hint="Shown to customers when AI fails">
            <Textarea value={form.error_message} onChange={set('error_message')} placeholder="We're experiencing a brief issue, please try again shortly." rows={3} />
          </Field>
          <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <Toggle
              checked={form.use_system_gemini_key}
              onChange={set('use_system_gemini_key')}
              label="Use my Gemini API key (GEMINI_API_KEY)"
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
              When ON, this client uses your server Gemini key. No separate key needed.
            </p>
          </div>
          {!form.use_system_gemini_key && (
            <Field
              label="Gemini API Key"
              hint={editing && (editing?.has_gemini_key
                ? `⚠ Leave blank to keep existing key (${editing.gemini_key_masked})`
                : '⚠ No key stored yet — report generation will fail until one is set')}
            >
              <SecretInput value={form.gemini_api_key} onChange={set('gemini_api_key')} placeholder={editing ? '(unchanged)' : 'AIzaSy...'} />
            </Field>
          )}
          <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <Toggle
              checked={form.use_system_freeastro_key}
              onChange={set('use_system_freeastro_key')}
              label="Use my freeastroapi key (FREEASTRO_API_KEY)"
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
              When ON, this client's birth-chart lookups are billed to your server key
              instead of their own.
            </p>
          </div>
          {!form.use_system_freeastro_key && (
            <Field
              label="freeastroapi Key"
              hint={editing && (editing?.has_freeastro_key
                ? `⚠ Leave blank to keep existing key (${editing.freeastro_key_masked})`
                : '⚠ No key stored yet — chart lookups will fail until one is set')}
            >
              <SecretInput value={form.freeastro_api_key} onChange={set('freeastro_api_key')} placeholder={editing ? '(unchanged)' : 'fa_...'} />
            </Field>
          )}
        </div>
      );
      case 3: return ( // Branding
        <div className="flex flex-col gap-4">
          <Field label="Brand Display Name">
            <Input value={form.brand_name} onChange={set('brand_name')} placeholder="Acme Astrology" />
          </Field>
          <Field label="Brand Color">
            <div className="flex gap-2 items-center">
              <input
                type="color" value={form.brand_color || '#075e54'}
                onChange={e => set('brand_color')(e.target.value)}
                className="w-10 h-9 rounded cursor-pointer border"
                style={{ borderColor: 'var(--border)' }}
              />
              <Input value={form.brand_color} onChange={set('brand_color')} placeholder="#075e54" />
            </div>
          </Field>
          <Field label="Logo URL">
            <Input value={form.logo_url} onChange={set('logo_url')} placeholder="https://..." />
          </Field>
          <Field label="Contact Number" hint="Shown to customers for urgent queries">
            <Input value={form.contact_number} onChange={set('contact_number')} placeholder="+94712345678" />
          </Field>
        </div>
      );
      case 4: return ( // Reports
        <div className="flex flex-col gap-4">
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            How this client's generated reports identify themselves. Every field is
            optional and nothing is inherited from another client — leave a field
            blank and it simply does not appear in the document.
          </p>
          <Field label="Signature" hint="Printed at the end of every report">
            <Input value={form.report_signature} onChange={set('report_signature')} placeholder="Acme Astrology Services" />
          </Field>
          <Field label="Page Footer" hint="Use {brand} for the brand name; the page number follows this text">
            <Input value={form.report_footer} onChange={set('report_footer')} placeholder="{brand} | Page: " />
          </Field>
          <Field label="Cover Invocation" hint="Large line at the top of the cover page — blank to omit">
            <Input value={form.report_invocation} onChange={set('report_invocation')} placeholder="(none)" />
          </Field>
          <Field label="Cover Divider" hint="Rule above and below the invocation — blank to omit">
            <Input value={form.report_divider} onChange={set('report_divider')} placeholder="(none)" />
          </Field>
          <Field label="Report Font" hint="Only bundled fonts render correctly in the PDF">
            <select
              value={form.report_font || ''}
              onChange={e => set('report_font')(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-1)' }}
            >
              <option value="">Default ({reportFonts?.fallback || 'Abhaya Libre'})</option>
              {(reportFonts?.fonts || []).map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Cover Logo URL" hint="PNG or JPEG. Upload on the Media page, then paste the URL here">
            <Input value={form.report_logo_url} onChange={set('report_logo_url')} placeholder="https://... or /uploads/logo.png" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Logo Width (px)">
              <Input type="number" value={form.report_logo_width} onChange={set('report_logo_width')} placeholder="160" />
            </Field>
            <Field label="Logo Height (px)">
              <Input type="number" value={form.report_logo_height} onChange={set('report_logo_height')} placeholder="160" />
            </Field>
          </div>
          <div className="pt-2 mt-1 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
              PDF file properties. Blank falls back to the brand display name.
            </p>
            <div className="flex flex-col gap-4">
              <Field label="PDF Title"><Input value={form.pdf_title} onChange={set('pdf_title')} placeholder="(brand name)" /></Field>
              <Field label="PDF Author"><Input value={form.pdf_author} onChange={set('pdf_author')} placeholder="(brand name)" /></Field>
              <Field label="PDF Producer"><Input value={form.pdf_producer} onChange={set('pdf_producer')} placeholder="(brand name)" /></Field>
              <Field label="PDF Subject"><Input value={form.pdf_subject} onChange={set('pdf_subject')} placeholder="(none)" /></Field>
            </div>
          </div>
          {!editing && (
            <p className="text-xs" style={{ color: 'var(--warn, #b45309)' }}>
              Report branding is saved once the client exists. Create the client first, then reopen it here.
            </p>
          )}
        </div>
      );
      case 5: return ( // Features
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <Toggle checked={form.order_flow_enabled} onChange={set('order_flow_enabled')} label="Order Flow" />
            <Toggle checked={form.product_catalog_enabled} onChange={set('product_catalog_enabled')} label="Product Catalog" />
            <Toggle checked={form.knowledge_base_enabled} onChange={set('knowledge_base_enabled')} label="Knowledge Base" />
            <Toggle checked={form.plugin_enabled} onChange={set('plugin_enabled')} label="Plugins" />
          </div>
          {form.product_catalog_enabled && (
            <Field label="Max Products in Context">
              <Input
                type="number"
                value={form.max_products_in_context ?? 10}
                onChange={v => setForm(f => ({ ...f, max_products_in_context: parseInt(v) || 10 }))}
              />
            </Field>
          )}
          <div className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>AI Enabled</div>
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>Turn Nova AI on or off for this client</div>
            </div>
            <Toggle checked={!!form.ai_enabled} onChange={v => set('ai_enabled')(v)} />
          </div>
          <Field label="Package">
            <select
              value={form.package_id || ''}
              onChange={e => {
                const pid = e.target.value || null;
                set('package_id')(pid);
                const pkg = packages.find(p => p.id === pid);
                if (pkg) set('per_message_cost')(pkg.per_message_cost ?? 0);
              }}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none border"
              style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border)' }}
            >
              <option value="">No package</option>
              {packages.map(p => (
                <option key={p.id} value={p.id}>{p.name} — {Number(p.message_limit).toLocaleString()} msgs/mo</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Bonus Messages" hint="Rollover / manual grant">
              <input type="number" min="0" value={form.bonus_messages ?? 0}
                onChange={e => set('bonus_messages')(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none border"
                style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border)' }} />
            </Field>
            <Field label="Overage Limit" hint="Extra msgs after package">
              <input type="number" min="0" value={form.overage_limit ?? 0}
                onChange={e => set('overage_limit')(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none border"
                style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border)' }} />
            </Field>
            <Field label="Cost / Message (LKR)" hint="Overage price per msg">
              <input type="number" min="0" step="0.000001" value={form.per_message_cost ?? 0}
                onChange={e => set('per_message_cost')(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none border"
                style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border)' }} />
            </Field>
          </div>
        </div>
      );
      case 6: return ( // Order Fields
        <div className="flex flex-col gap-3">
          <Field label="Order ID Prefix" hint="e.g. ACM → order IDs will be ACM-0001">
            <Input value={form.order_id_prefix} onChange={set('order_id_prefix')} placeholder="ACM" />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Custom Order Fields</span>
            <button
              onClick={addOrderField}
              className="text-xs px-2 py-1 rounded-lg border-0 cursor-pointer"
              style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--accent)' }}
            >+ Add Field</button>
          </div>
          {form.order_fields.length === 0 && (
            <p className="text-xs text-center py-3" style={{ color: 'var(--text-3)' }}>No custom fields yet</p>
          )}
          {form.order_fields.map((f, i) => (
            <OrderFieldRow key={i} field={f} onChange={v => updateOrderField(i, v)} onDelete={() => removeOrderField(i)} />
          ))}
        </div>
      );
      case 7: return ( // Access
        <div className="flex flex-col gap-4">
          {editing && (
            <>
              <div className="p-3 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Login URL</p>
                <p className="text-sm font-mono" style={{ color: 'var(--text-1)' }}>{window.location.origin}/login</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Username: <strong>{editing.id}</strong></p>
              </div>
              <Field label="Set CRM Password" hint="Client uses this to log into the CRM dashboard">
                <div className="flex gap-2">
                  <Input value={password} onChange={setPassword} type="password" placeholder="New password" />
                  <button
                    onClick={handleSetPassword}
                    disabled={pwSaving || !password.trim()}
                    className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium border-0 cursor-pointer"
                    style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent)', opacity: (!password.trim() || pwSaving) ? 0.5 : 1 }}
                  >{pwSaving ? 'Saving…' : 'Set'}</button>
                </div>
              </Field>
            </>
          )}
          {!editing && (
            <p className="text-xs py-2" style={{ color: 'var(--text-3)' }}>Save the client first, then set a password.</p>
          )}
        </div>
      );
      default: return null;
    }
  }

  /* ── Render ── */
  const labelStyle = { color: 'var(--text-1)', fontSize: 13, fontWeight: 500 };
  const subStyle   = { color: 'var(--text-3)', fontSize: 11 };

  return (
    <Layout>
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Clients</h1>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border-0 cursor-pointer"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <span>+</span> New Client
          </button>
        </div>

        {/* Client list */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>Loading…</p>
          )}
          {!isLoading && clients.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>No clients yet. Click "New Client" to add one.</p>
          )}
          <div className="flex flex-col gap-2">
            {clients.map(c => (
              <div
                key={c.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                onClick={() => openEdit(c)}
              >
                {/* Avatar */}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: c.brand_color ? `${c.brand_color}22` : 'rgba(99,102,241,0.12)', color: c.brand_color || 'var(--accent)' }}
                >
                  {(c.name?.[0] || c.id?.[0] || '?').toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate" style={labelStyle}>{c.name || c.id}</div>
                  <div className="truncate" style={subStyle}>
                    {c.id} · {c.type || 'general'}
                    {c.package_name && <span> · <span style={{ color: 'var(--accent)' }}>{c.package_name}</span></span>}
                  </div>
                </div>

                {/* Toggles — stop propagation so click doesn't open drawer */}
                <div className="flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                  <div className="flex flex-col items-center gap-0.5">
                    <span style={{ ...subStyle }}>AI</span>
                    <Toggle
                      checked={c.ai_enabled !== false}
                      onChange={v => toggleMutation.mutate({ id: c.id, ai_enabled: v })}
                    />
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span style={{ ...subStyle }}>Active</span>
                    <Toggle
                      checked={c.active !== false}
                      onChange={v => toggleMutation.mutate({ id: c.id, active: v })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? `Edit: ${editing.name || editing.id}` : 'New Client'}
        width="560px"
      >
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Saved info banner */}
          {savedInfo && (
            <div className="mx-4 mt-3 p-3 rounded-xl text-xs" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#34d399' }}>
              <p className="font-semibold mb-1">Client saved!</p>
              <p>Webhook URL: <span className="font-mono">{savedInfo.webhookUrl}</span></p>
              <p>Login URL: <span className="font-mono">{window.location.origin}/login</span></p>
              <p>Username: <span className="font-mono">{savedInfo.id}</span></p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 px-4 pt-3 overflow-x-auto shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            {TABS.map((t, i) => (
              <button
                key={t}
                onClick={() => setActiveTab(i)}
                className="px-3 py-2 text-xs font-medium rounded-t-lg border-0 cursor-pointer whitespace-nowrap transition-colors"
                style={activeTab === i
                  ? { color: 'var(--accent)', borderBottom: '2px solid var(--accent)', background: 'rgba(99,102,241,0.06)' }
                  : { color: 'var(--text-3)', background: 'transparent' }
                }
              >{t}</button>
            ))}
          </div>

          {/* Tab body */}
          <div className="flex-1 overflow-y-auto p-4">
            {renderTab()}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => setDrawerOpen(false)}
              className="px-4 py-2 rounded-lg text-xs border-0 cursor-pointer"
              style={{ background: 'var(--bg-card)', color: 'var(--text-2)' }}
            >Cancel</button>
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending || (!form.id && !editing) || !form.name}
              className="px-4 py-2 rounded-lg text-xs font-medium border-0 cursor-pointer"
              style={{ background: 'var(--accent)', color: '#fff', opacity: (saveMutation.isPending || (!form.id && !editing) || !form.name) ? 0.5 : 1 }}
            >{saveMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Client'}</button>
          </div>
        </div>
      </Drawer>
    </Layout>
  );
}
