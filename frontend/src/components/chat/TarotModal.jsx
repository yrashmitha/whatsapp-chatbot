import { useState } from 'react';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

/**
 * TarotModal — Admin triggers a 3-card tarot reading for a customer.
 *
 * Props:
 *   phone     {string}   Customer's phone number
 *   clientId  {string}   Multi-tenant client ID
 *   onClose   {Function} Close the modal
 *   onResult  {Function} Called with reading text so admin can paste it into chat
 */
export default function TarotModal({ phone, clientId, onClose, onResult }) {
  const toast = useToast();

  const [question, setQuestion]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);   // { reading, cards }
  const [downloading, setDownloading] = useState(false);

  const handleGenerate = async () => {
    if (!question.trim()) return toast.error('Please enter the customer\'s question or situation');
    setLoading(true);
    setResult(null);
    try {
      const params = clientId ? { params: { client_id: clientId } } : {};
      const res = await api.post('/crm/tarot-reading', { phone, question: question.trim() }, params);
      setResult(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to generate reading');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!result || downloading) return;
    setDownloading(true);
    try {
      const token  = localStorage.getItem('crm_token');
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/crm/tarot-reading/pdf${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone, question, reading: result.reading, cards: result.cards }),
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const cd   = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const last4 = (phone || '').replace(/\D/g, '').slice(-4) || '0000';
      const filename = match ? match[1] : `tarot-reading-${last4}.pdf`;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download PDF');
    } finally {
      setDownloading(false);
    }
  };

  const handleSendToChat = () => {
    if (!result) return;
    onResult?.(result.reading);
    onClose();
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

  const POSITION_COLORS = { Past: '#8b5cf6', Present: '#3b82f6', Future: '#10b981' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800">🔮 Tarot Card Reading</h2>
            <p className="text-xs text-slate-400 mt-0.5">3-card spread · Past · Present · Future</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">

          {/* Question input */}
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">
              Customer's Question / Situation
            </label>
            <textarea
              className={inputCls}
              style={{ resize: 'none', minHeight: 80 }}
              rows={3}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Describe the customer's question, problem, or situation they need guidance on…"
              disabled={loading}
            />
          </div>

          {/* Cards drawn */}
          {result && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Cards Drawn</p>
              <div className="grid grid-cols-3 gap-2">
                {result.cards.map(c => (
                  <div
                    key={c.position}
                    className="rounded-xl border p-3 flex flex-col gap-1"
                    style={{ borderColor: POSITION_COLORS[c.position] + '40', background: POSITION_COLORS[c.position] + '08' }}
                  >
                    <span
                      className="text-xs font-bold uppercase tracking-wide"
                      style={{ color: POSITION_COLORS[c.position] }}
                    >{c.position}</span>
                    <span className="text-sm font-semibold text-slate-800">{c.name}</span>
                    <span className="text-xs text-slate-400">{c.reversed ? '🔄 Reversed' : '⬆ Upright'}</span>
                    <span className="text-xs text-slate-500 leading-relaxed mt-1">{c.meaning}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reading text */}
          {result && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Reading</p>
              <div
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap"
                style={{ maxHeight: 280, overflowY: 'auto' }}
              >
                {result.reading}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer"
          >
            Cancel
          </button>

          {!result ? (
            <button
              onClick={handleGenerate}
              disabled={loading || !question.trim()}
              className="flex-1 py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)' }}
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
                  Drawing cards…
                </>
              ) : '🃏 Generate Reading'}
            </button>
          ) : (
            <>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="px-4 py-2.5 text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-xl border-0 cursor-pointer disabled:opacity-50"
              >
                ↺ Redraw
              </button>
              <button
                onClick={handleDownloadPdf}
                disabled={downloading}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl border-0 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {downloading ? (
                  <span className="w-3.5 h-3.5 border-2 border-slate-400/30 border-t-slate-500 rounded-full animate-spin block" />
                ) : '⬇'}
                PDF
              </button>
              <button
                onClick={handleSendToChat}
                className="flex-1 py-2.5 text-sm font-medium text-white rounded-xl border-0 cursor-pointer flex items-center justify-center gap-1.5"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)' }}
              >
                ✉ Send to Chat
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
