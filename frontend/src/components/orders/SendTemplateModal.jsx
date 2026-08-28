import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

/**
 * Send an approved WhatsApp template to the orders that are ticked.
 *
 * The only way to reach a customer whose 24-hour window has closed, which is
 * every customer who gave their details and then went quiet. It is also a paid
 * marketing message landing on a phone unprompted, so the dialog shows the exact
 * words that will be sent and how many people will get them, and makes the count
 * hard to miss.
 *
 * The image is picked from the media library rather than typed, because the
 * header needs a public https URL that stays reachable - the URL Meta shows on
 * an approved template is a temporary CDN link and will stop working.
 */
/**
 * @param {object}   props
 * @param {string[]} props.orderIds
 * @param {string[]} [props.alreadySent] orders whose customer has had a template
 */
export default function SendTemplateModal({ orderIds, alreadySent = [], clientId, onClose, onSent }) {
  const toast = useToast();
  const [template, setTemplate] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const params = clientId ? { client_id: clientId } : {};

  const { data: tplData, isLoading: loadingTemplates } = useQuery({
    queryKey: ['wa-templates', clientId],
    queryFn: () => api.get('/plugins/whatsapp/templates', { params }).then(r => r.data),
    retry: false,
  });

  // The endpoint answers { media: [...] }, not a bare array. Reading r.data
  // gave an object, the Array.isArray guard below turned that into an empty
  // list, and the picker showed "no images" for a library that had them.
  const { data: media = [] } = useQuery({
    queryKey: ['media', clientId],
    queryFn: () => api.get('/media', { params }).then(r => r.data.media || []),
    retry: false,
  });

  const templates = tplData?.templates || [];
  const chosen = templates.find(t => t.name === template);
  const needsImage = chosen?.header_format === 'IMAGE';
  // Only images can head a template; a PDF in the library is not a candidate.
  const images = (Array.isArray(media) ? media : [])
    .filter(m => /\.(png|jpe?g)$/i.test(m.image_url || ''));

  const send = useMutation({
    mutationFn: () => api.post('/plugins/whatsapp/send-template', {
      template, image_url: imageUrl, order_ids: orderIds, ...params,
    }).then(r => r.data),
    onSuccess: (r) => {
      if (r.failed?.length) {
        toast.error(`Sent ${r.sent}, ${r.failed.length} failed: ${r.failed[0].error}`);
      } else {
        toast.success(`Sent to ${r.sent}${r.skipped ? ` · ${r.skipped} already had it` : ''}`);
      }
      onSent?.();
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Could not send'),
  });

  // The count that matters is the one that will actually go out, not the one
  // that happens to be ticked. A marketing message is charged per send.
  const willReceive = orderIds.length - alreadySent.length;

  const blocked = !template || (needsImage && !imageUrl)
    || chosen?.variables > 0 || willReceive === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-800 mb-1">Send a WhatsApp template</h2>
        <p className="text-xs text-slate-500 mb-4">
          {willReceive} of <strong>{orderIds.length}</strong> selected
          order{orderIds.length !== 1 ? 's' : ''} will be messaged.
          {alreadySent.length > 0 && ` ${alreadySent.length} already had a template and are skipped.`}
        </p>

        {willReceive === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2 mb-3">
            Everyone selected has already had a template. Nothing would be sent.
          </p>
        )}

        {loadingTemplates && <p className="text-sm text-slate-400">Loading templates…</p>}

        {!loadingTemplates && !templates.length && (
          <p className="text-sm text-slate-500">
            {tplData?.note || 'No approved templates on this WhatsApp account.'}
          </p>
        )}

        {templates.length > 0 && (
          <>
            <label className="text-xs font-medium text-slate-500 block mb-1">Template</label>
            <select
              value={template}
              onChange={e => { setTemplate(e.target.value); setImageUrl(''); }}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 mb-3"
            >
              <option value="">Choose one…</option>
              {templates.map(t => (
                <option key={t.name} value={t.name}>
                  {t.name} · {t.language} · {t.category}
                </option>
              ))}
            </select>

            {chosen?.variables > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2 mb-3">
                This template has {chosen.variables} variable(s) in its text. Those need a value per
                person, which this screen cannot supply yet, so it cannot be sent from here.
              </p>
            )}

            {chosen?.category === 'MARKETING' && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2 mb-3">
                A marketing template is charged per message and counts towards each person's
                marketing limit. Sending one people did not want is answered with blocks, and that
                lowers delivery for every later message.
              </p>
            )}

            {needsImage && (
              <>
                <label className="text-xs font-medium text-slate-500 block mb-1">Header image</label>
                <p className="text-xs text-slate-400 mb-1.5">
                  From your media library, so the link keeps working. The image Meta shows on the
                  approved template is a temporary one and will stop loading.
                </p>
                <select
                  value={imageUrl}
                  onChange={e => setImageUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 mb-2"
                >
                  <option value="">Choose an image…</option>
                  {images.map(m => <option key={m.id} value={m.image_url}>{m.title || m.image_url}</option>)}
                </select>
                {!images.length && (
                  <p className="text-xs text-slate-500 mb-2">
                    No .png or .jpg in the library
                    {media.length ? ` (${media.length} file(s) there, none of them an image)` : ''}.
                    Upload one on the Media page first.
                  </p>
                )}
                {imageUrl && (
                  <img src={imageUrl} alt="" className="w-full max-h-40 object-contain rounded-xl mb-3 bg-slate-50" />
                )}
              </>
            )}

            {chosen?.body && (
              <div className="mb-4">
                <p className="text-xs font-medium text-slate-500 mb-1">What they will receive</p>
                <div className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-xl p-3">
                  {chosen.body}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => send.mutate()}
            disabled={blocked || send.isPending}
            className="px-4 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-xl border-0 cursor-pointer"
          >
            {send.isPending ? 'Sending…' : `Send to ${willReceive}`}
          </button>
        </div>
      </div>
    </div>
  );
}
