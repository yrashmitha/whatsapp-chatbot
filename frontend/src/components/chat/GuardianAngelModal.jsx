import { useState } from 'react';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';
import PitchVoiceRecorder from './PitchVoiceRecorder';

/**
 * GuardianAngelModal: the operator drafts a Guardian Angel message for a
 * customer, part of the tarot add-on. The draft is sent to the chat composer for
 * review; nothing is sent to the customer from here.
 *
 * Props:
 *   phone     {string}    Customer phone number
 *   clientId  {string}    Multi-tenant client ID
 *   orders    {Array}     This customer's orders (to pick the story from)
 *   onClose   {Function}  Close the modal
 *   onDraft   {Function}  Called with the message text to put in the composer
 */
function storyOf(o) {
  let cf = o?.custom_fields;
  if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch { cf = {}; } }
  cf = cf || {};
  let td = o?.tarot_data;
  if (typeof td === 'string') { try { td = JSON.parse(td); } catch { td = {}; } }
  return (td?.question || cf.needs || cf.problems || cf.summary || '').toString();
}

export default function GuardianAngelModal({ phone, clientId, orders = [], onClose, onDraft }) {
  const toast = useToast();

  // Newest order that has a story, else the newest order.
  const defaultOrder = (orders.find(o => storyOf(o).trim()) || orders[0])?.order_id || '';
  const [orderId, setOrderId] = useState(defaultOrder);
  const [story, setStory]     = useState('');
  const [gender, setGender]   = useState('auto');
  const [relationship, setRelationship] = useState('auto');
  const [details, setDetails] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const chosen = orders.find(o => o.order_id === orderId);
  const orderStory = chosen ? storyOf(chosen) : '';

  const generate = async () => {
    if (!orderId && !story.trim()) return toast.error("Pick an order or type the customer's story");
    setLoading(true);
    try {
      const res = await api.post('/crm/guardian-angel', {
        phone,
        ...(orderId && { order_id: orderId }),
        ...(story.trim() && { story: story.trim() }),
        gender,
        ...(relationship !== 'auto' && { relationship }),
        ...(details.trim() && { details: details.trim() }),
      }, clientId ? { params: { client_id: clientId } } : {});
      setMessage(res.data.message || '');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to draft the message');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800">👼 Guardian Angel message</h2>
            <p className="text-xs text-slate-400 mt-0.5">Drafts the message. You review and send it from the chat box.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
          {orders.length > 0 && (
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Order (its story and tarot reading are used)</label>
              <select className={inputCls} value={orderId} onChange={e => setOrderId(e.target.value)} disabled={loading}>
                <option value="">No order, type the story below</option>
                {orders.map(o => (
                  <option key={o.order_id} value={o.order_id}>
                    {o.order_id} ({o.status}){storyOf(o) ? `: ${storyOf(o).slice(0, 50)}` : ''}
                  </option>
                ))}
              </select>
              {orderStory && (
                <p className="text-xs text-slate-500 mt-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 leading-relaxed">{orderStory}</p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">
              Customer story {orderStory ? '(optional, replaces the order story)' : ''}
            </label>
            <textarea
              className={inputCls}
              style={{ resize: 'none', minHeight: 70 }}
              rows={3}
              value={story}
              onChange={e => setStory(e.target.value)}
              placeholder="Leave blank to use the order's story"
              disabled={loading}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Customer is</label>
            <select className={inputCls} value={gender} onChange={e => setGender(e.target.value)} disabled={loading}>
              <option value="auto">Auto (from name and story)</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Relationship type</label>
            <select className={inputCls} value={relationship} onChange={e => setRelationship(e.target.value)} disabled={loading}>
              <option value="auto">Auto (from the story)</option>
              <option value="regular">Regular relationship or marriage</option>
              <option value="affair_other">Aniyam sambandayak: the other person is married or committed</option>
              <option value="affair_self">Aniyam sambandayak: the customer is married or committed</option>
              <option value="gay">Gay relationship (two men)</option>
              <option value="lesbian">Lesbian relationship (two women)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Extra details (optional)</label>
            <textarea
              className={inputCls}
              style={{ resize: 'none', minHeight: 60 }}
              rows={2}
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder="Anything else you know: how long, who ended it, ages, kids, family pressure, what they most want"
              disabled={loading}
            />
          </div>

          {message && (
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Draft (you can edit)</label>
              <textarea
                className={inputCls}
                style={{ minHeight: 260 }}
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
            </div>
          )}

          {message && <PitchVoiceRecorder phone={phone} clientId={clientId} onSent={onClose} />}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex gap-2 shrink-0 flex-wrap">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer">Cancel</button>
          <button
            onClick={generate}
            disabled={loading}
            className={message
              ? 'px-4 py-2.5 text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-xl border-0 cursor-pointer disabled:opacity-50'
              : 'flex-1 py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50'}
            style={message ? undefined : { background: 'linear-gradient(135deg,#7c3aed,#a855f7)' }}
          >
            {loading ? 'Writing…' : message ? '↺ Redraft' : '👼 Draft message'}
          </button>
          {message && (
            <button
              onClick={() => { onDraft?.(message.trim()); onClose(); }}
              className="flex-1 py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)' }}
            >
              ✉ Put in chat box
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
