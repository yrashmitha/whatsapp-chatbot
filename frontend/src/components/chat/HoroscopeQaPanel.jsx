import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '../../lib/api';
import Spinner from '../ui/Spinner';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';

/**
 * Follow-up Q&A for a customer whose report has already been delivered.
 *
 * The agent sees what the report actually said, types the customer's question,
 * and gets a drafted chat reply they can push straight into the message box —
 * instead of opening the report elsewhere and rewriting it by hand.
 */

function SectionAccordion({ sections }) {
  const [openIdx, setOpenIdx] = useState(null);
  if (!sections?.length) return <div className="text-xs text-slate-400">No report sections found.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      {sections.map((s, i) => (
        <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border-0 cursor-pointer flex items-center justify-between"
          >
            <span>{s.label}</span>
            <span className="text-slate-400">{openIdx === i ? '−' : '+'}</span>
          </button>
          {openIdx === i && (
            <div className="px-3 py-2.5 text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{s.content}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function PersonCard({ label, person }) {
  if (!person) return null;
  return (
    <div className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2.5">
      <div className="text-[10px] font-semibold text-violet-600 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-sm font-medium text-slate-800 truncate">{person.name || 'Unknown'}</div>
      <div className="text-xs text-slate-500 mt-0.5">
        {person.birthDate || '?'} {person.birthTime || ''}
      </div>
      {person.lagna && <div className="text-xs text-slate-500">Lagna: {person.lagna}</div>}
    </div>
  );
}

export default function HoroscopeQaPanel({ open, onClose, phone, clientId, onDraft }) {
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [draft, setDraft] = useState('');
  const params = clientId ? { client_id: clientId } : {};

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['horoscope-qa', phone, clientId],
    queryFn: () => api.get(`/horoscope-qa/${encodeURIComponent(phone)}`, { params }).then(r => r.data),
    enabled: open && !!phone,
    retry: false,
  });

  const askMutation = useMutation({
    mutationFn: () => api
      .post(`/horoscope-qa/${encodeURIComponent(phone)}/ask`, { question }, { params })
      .then(r => r.data),
    onSuccess: (d) => setDraft(d.reply || ''),
    onError: (err) => toast.error(err?.response?.data?.error || 'Failed to draft a reply'),
  });

  if (!open) return null;

  const record = data?.data;
  const found = data?.found;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Follow-up Answers</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none bg-transparent border-0 cursor-pointer"
          >×</button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-4 overflow-y-auto flex-1">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center">
              <Spinner /> Loading the report…
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-2 text-center py-6">
              <span className="text-sm text-red-500">
                {error?.response?.data?.error || 'Failed to load the report.'}
              </span>
              <button
                onClick={() => refetch()}
                className="text-xs text-violet-600 hover:text-violet-700 bg-transparent border-0 cursor-pointer underline"
              >Try again</button>
            </div>
          )}

          {!isLoading && !isError && found === false && (
            <div className="text-sm text-slate-400 text-center py-6">
              No delivered report found for this customer.
            </div>
          )}

          {!isLoading && record && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {record.type === 'match' ? 'Compatibility report' : record.type === 'tarot' ? 'Tarot reading' : 'Horoscope report'}
                  {record.orderId && ` · ${record.orderId}`}
                </span>
                <button
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="text-xs text-violet-600 hover:text-violet-700 bg-transparent border-0 cursor-pointer disabled:opacity-50"
                >{isFetching ? 'Reloading…' : 'Reload'}</button>
              </div>

              {record.type === 'match' ? (
                <>
                  <div className="flex gap-2">
                    <PersonCard label="Person A" person={record.match?.boy} />
                    <PersonCard label="Person B" person={record.match?.girl} />
                  </div>
                  <SectionAccordion sections={record.match?.sections} />
                </>
              ) : record.type === 'tarot' ? (
                <>
                  {record.tarot?.question && (
                    <div className="border border-slate-200 rounded-lg px-3 py-2.5">
                      <div className="text-[10px] font-semibold text-violet-600 uppercase tracking-wide mb-1">Customer's question</div>
                      <div className="text-sm text-slate-700 whitespace-pre-wrap">{record.tarot.question}</div>
                    </div>
                  )}
                  <SectionAccordion
                    sections={(record.tarot?.cards || []).map(c => ({
                      label: `${c.position}: ${c.sinhala_name || c.name} (${c.reversed ? 'Reversed' : 'Upright'})`,
                      content: c.sinhala_meaning || c.meaning,
                    }))}
                  />
                  <div className="border border-slate-200 rounded-lg px-3 py-2.5">
                    <div className="text-[10px] font-semibold text-violet-600 uppercase tracking-wide mb-1">Reading given</div>
                    <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{record.tarot?.reading}</div>
                  </div>
                </>
              ) : (
                <>
                  <PersonCard label="Customer" person={record.single} />
                  <SectionAccordion sections={record.single?.sections} />
                </>
              )}
            </div>
          )}

          {!isLoading && record && (
            <div className="flex flex-col gap-2 pt-2 border-t border-slate-200">
              <label className="block text-xs font-medium text-slate-600">Customer's question</label>
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                rows={2}
                placeholder="Paste or type what the customer is asking…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
              />
              <Button onClick={() => askMutation.mutate()} disabled={askMutation.isPending || !question.trim()}>
                {askMutation.isPending ? 'Drafting…' : 'Draft reply'}
              </Button>

              {draft && (
                <div className="mt-1 flex flex-col gap-2">
                  <div className="text-xs font-medium text-slate-600">Drafted reply</div>
                  <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 whitespace-pre-wrap">
                    {draft}
                  </div>
                  <Button variant="ghost" onClick={() => { onDraft?.(draft); onClose(); }}>
                    Use as message
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
