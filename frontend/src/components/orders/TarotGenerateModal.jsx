import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

/**
 * TarotGenerateModal — Admin triggers a background tarot reading for an order.
 * Mirrors the HoroscopeModal pattern: returns immediately, generation runs async.
 *
 * Props:
 *   order      {object}    Order row (needs order_id, phone / phone_number)
 *   clientId   {string}    Multi-tenant client ID
 *   onClose    {Function}  Close the modal
 *   onGenerated {Function} Called after generation is started (triggers orders refetch)
 */
export default function TarotGenerateModal({ order, clientId, onClose, onGenerated }) {
  const toast = useToast();

  // Pre-fill question from any existing tarot_data
  const existingQuestion = (() => {
    const td = order?.tarot_data;
    if (!td) return '';
    const parsed = typeof td === 'string'
      ? (() => { try { return JSON.parse(td); } catch { return {}; } })()
      : td;
    return parsed.question || '';
  })();

  // Reuse a chart already fetched for this order
  const existingChart = (() => {
    const td = order?.tarot_data;
    if (!td) return null;
    const p = typeof td === 'string' ? (() => { try { return JSON.parse(td); } catch { return {}; } })() : td;
    return p.chart_data ? { birth: p.birth || null } : null;
  })();

  const [question, setQuestion]   = useState(existingQuestion);
  const [generating, setGenerating] = useState(false);
  const [aiFilling, setAiFilling]   = useState(false);
  const [fetchingChart, setFetchingChart] = useState(false);
  // Birth details for the chart Gemini reads as background. Filled by AI Fill.
  const [birth, setBirth] = useState(existingChart?.birth || null); // { birth_date, birth_time, lat, lng, place }
  const [lagna, setLagna] = useState(null);          // { sign, sign_si }
  const [chartFetched, setChartFetched] = useState(!!existingChart);

  // Earlier readings of this customer this one follows on from. Preselect what
  // the order was last generated with, so a regenerate keeps its chain.
  const [linkable, setLinkable] = useState([]);
  const [linkedIds, setLinkedIds] = useState(() => {
    const td = order?.tarot_data;
    const p = typeof td === 'string' ? (() => { try { return JSON.parse(td); } catch { return {}; } })() : (td || {});
    return Array.isArray(p.linked_order_ids) ? p.linked_order_ids : [];
  });
  const toggleLink = (id) => setLinkedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const params = clientId ? { params: { client_id: clientId } } : {};

  useEffect(() => {
    let live = true;
    api.get(`/crm/tarot-reading/linkable/${order.order_id}`, params)
      .then(({ data }) => { if (live) setLinkable(data.orders || []); })
      .catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.order_id]);

  const handleFetchChart = async () => {
    if (!birth?.birth_date || !birth?.birth_time || !birth?.lat) {
      return toast.error('Need birth date, time and place first — run AI Fill');
    }
    setFetchingChart(true);
    try {
      const { data } = await api.post(`/crm/tarot-reading/fetch-chart/${order.order_id}`, {
        birth_date: birth.birth_date, birth_time: birth.birth_time,
        lat: birth.lat, lng: birth.lng, birth_place_name: birth.place,
      }, params);
      setLagna({ sign: data.sign, sign_si: data.sign_si });
      setChartFetched(true);
      toast.success(`Chart fetched — Lagna: ${data.sign_si || data.sign || '?'}`);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Chart fetch failed');
    } finally {
      setFetchingChart(false);
    }
  };

  const handleAiFill = async () => {
    setAiFilling(true);
    try {
      const { data } = await api.post(`/crm/tarot-reading/ai-prepare/${order.order_id}`, {}, params);
      if (data.question) setQuestion(data.question);
      if (data.lat && data.lng && data.birth_date_iso) {
        setBirth({
          birth_date: data.birth_date_iso,
          birth_time: data.birth_time_24h || '',
          lat: data.lat,
          lng: data.lng,
          place: data.birth_place_en || '',
        });
        setChartFetched(false);
        setLagna(null);
      }
      toast.success(data.question ? 'Filled from the chat' : 'No clear question found in the chat');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'AI fill failed');
    } finally {
      setAiFilling(false);
    }
  };

  const handleGenerate = async () => {
    if (!question.trim()) return toast.error("Please enter the customer's question or situation");
    setGenerating(true);
    try {
      await api.post('/crm/tarot-reading', {
        phone: order.phone || order.phone_number,
        question: question.trim(),
        order_id: order.order_id,
        regenerate: true,
        linked_order_ids: linkedIds,
        // Only pass birth params when the chart has NOT been fetched yet — a
        // fetched chart is already cached on the order and reused server-side.
        ...(birth && birth.birth_time && !chartFetched ? {
          birth_date: birth.birth_date,
          birth_time: birth.birth_time,
          lat: birth.lat,
          lng: birth.lng,
          birth_place_name: birth.place,
        } : {}),
      }, params);
      toast.success('Tarot generation started. Takes about 30 seconds. You can navigate away.');
      onGenerated?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to start generation');
      setGenerating(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">🃏 Generate Tarot Reading</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              #{order?.order_id} · 3-card spread · Past · Present · Future
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-500">
                Customer's Question / Situation
              </label>
              <button
                onClick={handleAiFill}
                disabled={aiFilling || generating}
                className="text-xs font-medium px-2 py-1 rounded-lg border-0 cursor-pointer disabled:opacity-50"
                style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}
              >
                {aiFilling ? 'Reading chat…' : '✨ AI Fill'}
              </button>
            </div>
            <textarea
              className={inputCls}
              style={{ resize: 'none', minHeight: 90 }}
              rows={3}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Describe the customer's question, problem, or situation they need guidance on…"
              disabled={generating}
              autoFocus
            />
          </div>
          {(
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">
                Follows on from (optional, tick the earlier readings Gemini should see)
              </label>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {linkable.length === 0 && (
                  <span className="text-xs text-slate-400">No earlier tarot readings found for this customer.</span>
                )}
                {linkable.map(o => (
                  <label key={o.order_id} className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={linkedIds.includes(o.order_id)}
                      onChange={() => toggleLink(o.order_id)}
                      disabled={generating}
                    />
                    <span>
                      <span className="font-medium text-slate-700">#{o.order_id}</span>
                      {o.created_at ? ` · ${new Date(o.created_at).toISOString().slice(0, 10)}` : ''}
                      <span className="block text-slate-400 line-clamp-2">{o.question}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {birth && birth.birth_time && (
            <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-violet-700">
                  🔯 {birth.birth_date} {birth.birth_time}{birth.place ? ` · ${birth.place}` : ''}
                </span>
                <button
                  onClick={handleFetchChart}
                  disabled={fetchingChart || generating}
                  className="text-xs font-medium px-2 py-1 rounded-lg border-0 cursor-pointer disabled:opacity-50 shrink-0"
                  style={{ background: '#7c3aed', color: '#fff' }}
                >
                  {fetchingChart ? 'Fetching…' : chartFetched ? '↻ Re-fetch chart' : 'Fetch chart'}
                </button>
              </div>
              {lagna && (
                <span className="text-xs font-medium text-violet-800">
                  Lagna: {lagna.sign_si || lagna.sign} — verify before generating
                </span>
              )}
              {chartFetched && !lagna && (
                <span className="text-xs text-violet-600">Chart on file — will be given to Gemini as background.</span>
              )}
              {!chartFetched && (
                <span className="text-xs text-slate-400">Chart is optional. Fetch it to check the lagna, or just Generate (chart is fetched in the background).</span>
              )}
            </div>
          )}
          <p className="text-xs text-slate-400">
            Generation runs in the background (~30 seconds). You can navigate away after clicking Generate.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || !question.trim()}
            className="flex-1 py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: generating ? '#7c3aed' : 'linear-gradient(135deg,#7c3aed,#a855f7)' }}
          >
            {generating ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
                Starting…
              </>
            ) : '🃏 Generate Reading'}
          </button>
        </div>
      </div>
    </div>
  );
}
