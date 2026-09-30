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

  const parseJson = (v) => (typeof v === 'string'
    ? (() => { try { return JSON.parse(v || '{}'); } catch { return {}; } })()
    : (v || {}));

  const orderCf = parseJson(order?.custom_fields);

  // Pre-fill the question from a reading that already exists, and failing that
  // from what the order was taken for. A pack sibling has no tarot_data at all
  // until it is generated, and its brief is the whole reason it exists, so
  // without this fallback reading 2 opens with an empty box and the operator
  // has to go and find the wording again.
  const existingQuestion = parseJson(order?.tarot_data).question || orderCf.needs || '';

  // Reuse a chart already fetched for this order
  const existingChart = (() => {
    const p = parseJson(order?.tarot_data);
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
  const [pack, setPack] = useState(null);       // this order's place in a pack, once split
  // Problems AI Fill found in the chat. A pack customer states two or three and
  // they used to be collapsed into one reading, so the rest went unanswered.
  const [problems, setProblems] = useState([]);
  const [splitting, setSplitting] = useState(false);
  const editProblem = (i, v) => setProblems(ps => ps.map((p, j) => (j === i ? { ...p, question: v } : p)));
  const dropProblem = (i) => setProblems(ps => ps.filter((_, j) => j !== i));
  const [linkedIds, setLinkedIds] = useState(() => {
    const p = parseJson(order?.tarot_data);
    return Array.isArray(p.linked_order_ids) ? p.linked_order_ids : [];
  });
  const toggleLink = (id) => setLinkedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const params = clientId ? { params: { client_id: clientId } } : {};

  useEffect(() => {
    let live = true;
    api.get(`/crm/tarot-reading/linkable/${order.order_id}`, params)
      .then(({ data }) => {
        if (!live) return;
        const rows = data.orders || [];
        setLinkable(rows);
        setPack(data.pack || null);
        // Reading 2 of a pack should follow on from reading 1 without anybody
        // having to remember to tick it: the readings are one session and the
        // later ones are worth much less read cold. Only when the operator has
        // not already chosen, so a regenerate keeps whatever chain it had.
        setLinkedIds(ids => (ids.length || !data.pack)
          ? ids
          : rows.filter(o => o.same_pack && o.has_reading && o.pack_seq < data.pack.seq)
                .map(o => o.order_id));
      })
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
      const found = Array.isArray(data.problems) ? data.problems : [];
      // On a pack sibling, AI Fill re-reads the same chat and finds the same
      // list, so problem 1 would land in the box of reading 2. Take the one
      // this order is actually for. If the split does not line up any more,
      // leave what is already there rather than overwriting it with the wrong
      // brief, which the operator would have no reason to notice.
      const mine = pack ? found[pack.seq - 1]?.question : found[0]?.question || data.question;
      if (mine) setQuestion(mine);
      // Only offer a split when there is more than one problem and this order is
      // not already part of a pack. The first problem stays on this order, so it
      // is shown in the question box above rather than repeated in the list.
      setProblems(!pack && found.length > 1 ? found : []);
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
      toast.success(
        !mine ? 'No clear question found in the chat'
          : pack ? `Filled from the chat — problem ${pack.seq} of ${pack.of}`
          : found.length > 1 ? `Filled from the chat — ${found.length} separate problems found`
          : 'Filled from the chat');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'AI fill failed');
    } finally {
      setAiFilling(false);
    }
  };

  /**
   * Turn the confirmed problems into one order per problem. The first stays on
   * this order (with whatever the operator has edited in the question box), the
   * rest become siblings at price 0 so the pack's income is still counted once.
   */
  const handleSplit = async () => {
    const payload = [
      { topic: problems[0]?.topic || '', question: question.trim() },
      ...problems.slice(1),
    ].filter(p => p.question.trim());
    if (payload.length < 2) return toast.error('Need at least two problems to split');
    if (!window.confirm(
      `Create ${payload.length - 1} extra order(s) for this customer?\n\n` +
      `This order keeps the full price and problem 1. The others are created at Rs 0 ` +
      `so the pack is not counted as income twice.`)) return;
    setSplitting(true);
    try {
      const { data } = await api.post(`/crm/tarot-reading/split-pack/${order.order_id}`, { problems: payload }, params);
      toast.success(`Created ${data.created.length} order(s): ${data.created.map(c => c.order_id).join(', ')}`);
      setProblems([]);
      setPack({ pack_id: data.pack_id, seq: 1, of: data.of });
      onGenerated?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Split failed');
    } finally {
      setSplitting(false);
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
              {pack && (
                <span className="ml-1 font-medium text-violet-500">
                  · reading {pack.seq} of {pack.of}
                </span>
              )}
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

          {problems.length > 1 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 flex flex-col gap-2">
              <div className="text-xs font-semibold text-amber-800">
                ⚠ This customer asked about {problems.length} separate things
              </div>
              <p className="text-xs text-amber-700 leading-relaxed">
                One order produces one reading. Problem 1 is in the box above and stays on
                this order. Split to create an order for each of the rest, so none of them
                goes unanswered. Check the wording first, and remove anything that is not a
                real separate problem.
              </p>
              {problems.slice(1).map((p, i) => (
                <div key={i + 1} className="flex flex-col gap-1 rounded-lg bg-white/70 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-amber-900">
                      {i + 2}. {p.topic || 'Problem ' + (i + 2)}
                    </span>
                    <button
                      onClick={() => dropProblem(i + 1)}
                      disabled={splitting || generating}
                      className="text-xs text-amber-700 bg-transparent border-0 cursor-pointer disabled:opacity-50"
                    >
                      remove
                    </button>
                  </div>
                  <textarea
                    className="w-full px-2 py-1.5 text-xs border border-amber-200 rounded-lg outline-none focus:border-amber-400 bg-white"
                    style={{ resize: 'none', minHeight: 60 }}
                    rows={3}
                    value={p.question}
                    onChange={e => editProblem(i + 1, e.target.value)}
                    disabled={splitting || generating}
                  />
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSplit}
                  disabled={splitting || generating}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border-0 cursor-pointer disabled:opacity-50"
                  style={{ background: '#b45309', color: '#fff' }}
                >
                  {splitting ? 'Creating…' : `Create ${problems.length - 1} more order${problems.length > 2 ? 's' : ''}`}
                </button>
                <button
                  onClick={() => setProblems([])}
                  disabled={splitting || generating}
                  className="text-xs text-amber-800 bg-transparent border-0 cursor-pointer disabled:opacity-50"
                >
                  It is one problem, dismiss
                </button>
              </div>
              <span className="text-[11px] text-amber-600">
                The extra orders are created at Rs 0. This order keeps the full price, so the
                pack is not counted as income twice.
              </span>
            </div>
          )}

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
                  <label
                    key={o.order_id}
                    className={`flex items-start gap-2 text-xs text-slate-600 ${o.has_reading ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                    title={o.has_reading ? '' : 'Not generated yet — there is no reading for Gemini to read'}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={linkedIds.includes(o.order_id)}
                      onChange={() => toggleLink(o.order_id)}
                      /* Nothing to feed Gemini until this sibling has been generated. */
                      disabled={generating || !o.has_reading}
                    />
                    <span>
                      <span className="font-medium text-slate-700">#{o.order_id}</span>
                      {o.same_pack && (
                        <span className="ml-1 px-1 rounded bg-violet-100 text-violet-700 font-medium">
                          same pack · {o.pack_seq}/{o.pack_of}
                        </span>
                      )}
                      {!o.has_reading && (
                        <span className="ml-1 px-1 rounded bg-slate-100 text-slate-500">not generated yet</span>
                      )}
                      {o.created_at ? ` · ${new Date(o.created_at).toISOString().slice(0, 10)}` : ''}
                      {o.topic ? <span className="block text-slate-500 font-medium">{o.topic}</span> : null}
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
