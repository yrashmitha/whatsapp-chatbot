import { useState, useEffect } from 'react';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

/**
 * Matches {{price}}, {{anchor}}, {{price:key}}, {{anchor:key}}.
 * Mirrors PRICE_TOKEN in backend/src/services/quickReplyBlocks.js - the two
 * have to agree or the preview lies about what the customer will receive.
 */
const PRICE_TOKEN = /\{\{(price|anchor)(?::([a-z0-9_-]+))?\}\}/gi;

/** Render the figures into a block, the way the server will when it sends. */
function renderPrices(text, services) {
  if (!text || !services?.length) return text || '';
  const byKey = new Map(services.map(x => [String(x.key).toLowerCase(), x]));
  return text.replace(PRICE_TOKEN, (whole, field, key) => {
    const svc = key ? byKey.get(key.toLowerCase()) : services[0];
    if (!svc) return whole;
    const v = field.toLowerCase() === 'anchor' ? svc.anchor : svc.price;
    if (v === null || v === undefined || v === '') return whole;
    return Number(v).toLocaleString('en-US');
  });
}


export default function QuickReplies() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const clientId   = superAdmin ? (selectedClientId || null) : user?.clientId;
  const toast      = useToast();

  const [replies, setReplies]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [editingId, setEditingId]   = useState(null);   // null = no edit, 'new' = add form
  const [formTitle, setFormTitle]   = useState('');
  const [formText, setFormText]     = useState('');
  // What this block sells. Empty for the blocks that are not a pitch.
  const [formServices, setFormServices] = useState([]);
  const [saving, setSaving]         = useState(false);

  const params = clientId ? { client_id: clientId } : {};

  const load = () => {
    setLoading(true);
    api.get('/quick-replies', { params })
      .then(r => setReplies(r.data))
      .catch(() => toast.error('Failed to load quick replies'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setEditingId('new'); setFormTitle(''); setFormText(''); setFormServices([]); };
  const openEdit = (r) => {
    setEditingId(r.id); setFormTitle(r.title); setFormText(r.text);
    setFormServices(Array.isArray(r.services) ? r.services : []);
  };
  const cancelEdit = () => setEditingId(null);

  const handleSave = async () => {
    if (!formTitle.trim() || !formText.trim()) return toast.error('Title and message are required');
    setSaving(true);
    try {
      if (editingId === 'new') {
        await api.post('/quick-replies', { title: formTitle.trim(), text: formText.trim(), services: formServices, ...params });
        toast.success('Quick reply added');
      } else {
        await api.put(`/quick-replies/${editingId}`, { title: formTitle.trim(), text: formText.trim(), services: formServices, ...params });
        toast.success('Quick reply updated');
      }
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this quick reply?')) return;
    try {
      await api.delete(`/quick-replies/${id}`, { params });
      toast.success('Deleted');
      load();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Quick Replies</h1>
          <p className="text-xs text-slate-400 mt-0.5">Type <span className="font-mono bg-slate-100 px-1 rounded">/</span> in chat to use these templates</p>
        </div>
        {editingId !== 'new' && (
          <button
            onClick={openNew}
            className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-xl border-0 cursor-pointer transition-colors"
          >+ Add Quick Reply</button>
        )}
      </div>

      {/* Add / Edit form */}
      {editingId !== null && (
        <div className="mb-4 p-4 bg-violet-50 border border-violet-200 rounded-2xl">
          <p className="text-xs font-semibold text-violet-700 mb-3">{editingId === 'new' ? 'New Quick Reply' : 'Edit Quick Reply'}</p>
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Title <span className="text-slate-400 font-normal">(used for filtering, e.g. "greeting")</span></label>
              <input
                className={inputCls}
                placeholder="greeting"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Message</label>
              <textarea
                className={inputCls}
                rows={4}
                placeholder="Hello! How can I help you today?"
                value={formText}
                onChange={e => setFormText(e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </div>

            {/* What this block sells. On the same form as the words, and saved
                with them, because a price kept anywhere else drifts from the
                sentence that quotes it. */}
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-500">
                  Services sold in this message
                  <span className="text-slate-400 font-normal"> (leave empty if this is not a pitch)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setFormServices([...formServices, { key: '', label: '', price: '', anchor: '' }])}
                  className="px-2 py-1 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg border-0 cursor-pointer"
                >+ Add service</button>
              </div>

              {formServices.length > 0 && (
                <p className="text-xs text-slate-400 mb-2">
                  Write <span className="font-mono bg-slate-100 px-1 rounded">{'{{price}}'}</span> and
                  <span className="font-mono bg-slate-100 px-1 rounded ml-1">{'{{anchor}}'}</span> in the message instead of typing a number.
                  {formServices.length > 1 && <> With more than one service, name it: <span className="font-mono bg-slate-100 px-1 rounded">{`{{price:${formServices[0].key || 'key'}}}`}</span></>}
                </p>
              )}

              {formServices.map((svc, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-center mb-2">
                  <input
                    className={inputCls + ' flex-1 min-w-[7rem] font-mono'}
                    placeholder="key"
                    value={svc.key}
                    onChange={e => setFormServices(formServices.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                  />
                  <input
                    className={inputCls + ' flex-[2] min-w-[9rem]'}
                    placeholder="name shown to the team"
                    value={svc.label}
                    onChange={e => setFormServices(formServices.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                  />
                  <input
                    className={inputCls + ' w-24'}
                    type="number" placeholder="price"
                    value={svc.price ?? ''}
                    onChange={e => setFormServices(formServices.map((x, j) => j === i ? { ...x, price: e.target.value } : x))}
                  />
                  <input
                    className={inputCls + ' w-24'}
                    type="number" placeholder="usual"
                    value={svc.anchor ?? ''}
                    onChange={e => setFormServices(formServices.map((x, j) => j === i ? { ...x, anchor: e.target.value } : x))}
                  />
                  <button
                    type="button"
                    onClick={() => setFormServices(formServices.filter((_, j) => j !== i))}
                    className="px-2 py-1 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-lg border-0 cursor-pointer"
                  >Remove</button>
                </div>
              ))}

              {/* The sentence the customer will actually read. Without this the
                  person editing is checking a token, not the message. */}
              {formServices.length > 0 && formText.match(PRICE_TOKEN) && (
                <div className="mt-2 p-2.5 bg-slate-50 rounded-xl">
                  <p className="text-xs font-medium text-slate-400 mb-1">What the customer sees</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                    {renderPrices(formText, formServices)}
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end mt-1">
              <button onClick={cancelEdit} className="px-4 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 rounded-xl border-0 cursor-pointer"
              >{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <span className="w-6 h-6 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin inline-block" />
        </div>
      ) : replies.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">No quick replies yet. Click <strong>+ Add Quick Reply</strong> to create one.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {replies.map(r => (
            <li key={r.id} className="flex items-start gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-violet-600">/{r.title}</span>
                <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{renderPrices(r.text, r.services)}</p>
                {r.services?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {r.services.map(sv => (
                      <span key={sv.key} className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg">
                        {sv.label || sv.key} · රු. {Number(sv.price).toLocaleString('en-US')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => openEdit(r)}
                  className="px-2.5 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg border-0 cursor-pointer"
                >Edit</button>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="px-2.5 py-1 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-lg border-0 cursor-pointer"
                >Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
