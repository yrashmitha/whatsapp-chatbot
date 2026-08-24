import { useState } from 'react';

/**
 * What the vision pass read out of an attachment.
 *
 * The point is for whoever is answering messages to check the bot's reading
 * without opening the file: does the amount match, is the reference right, was
 * anything flagged. So the fields that decide that come first as plain labels,
 * and the raw result is one click away rather than filling the thread.
 */

/** Payment fields, in the order someone verifying a slip actually checks them. */
const PAYMENT_FIELDS = [
  ['amount', 'Amount'],
  ['payment_date', 'Date'],
  ['reference_number', 'Reference'],
  ['sender_name', 'Payer'],
  ['payer_name', 'Payer'],
  ['sender_bank', 'From bank'],
  ['sender_account', 'From account'],
  ['recipient_name', 'To'],
  ['recipient_bank', 'To bank'],
  ['recipient_account', 'To account'],
];

export default function ExtractedReading({ extracted }) {
  const [open, setOpen] = useState(false);

  let data = extracted;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = { text: extracted }; }
  }
  if (!data || typeof data !== 'object') return null;

  // A plain text extraction, from a document that is not a payment slip.
  if (data.text && !data.document_type) {
    return (
      <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">What we read</div>
        <div className="text-xs text-slate-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
          {data.text}
        </div>
      </div>
    );
  }

  const seen = new Set();
  const rows = PAYMENT_FIELDS
    .filter(([key, label]) => {
      const v = data[key];
      if (!v || seen.has(label)) return false;
      seen.add(label);
      return true;
    })
    .map(([key, label]) => [label, key === 'amount' ? `${data.currency || ''} ${data[key]}`.trim() : data[key]]);

  const flags = Array.isArray(data.scam_flags) ? data.scam_flags.filter(Boolean) : [];
  const risky = flags.length > 0 || (data.scam_risk && data.scam_risk !== 'none');

  return (
    <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
      <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 border-b border-slate-200">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {data.document_type === 'payment_slip' ? 'Payment slip read' : `Read as ${String(data.document_type || 'document').replace(/_/g, ' ')}`}
        </span>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-[10px] text-violet-600 hover:text-violet-800 bg-transparent border-0 cursor-pointer shrink-0"
        >{open ? 'less' : 'raw'}</button>
      </div>

      {rows.length > 0 && (
        <div className="px-2.5 py-1.5 flex flex-col gap-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-2 text-[11px] leading-snug">
              <span className="text-slate-400 w-20 shrink-0">{label}</span>
              <span className="text-slate-700 break-all font-medium">{value}</span>
            </div>
          ))}
        </div>
      )}

      {risky && (
        <div className="px-2.5 py-1.5 border-t border-red-200 bg-red-50">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-red-600 mb-0.5">Flagged</div>
          {flags.length
            ? flags.map((f, i) => <div key={i} className="text-[11px] text-red-700">{f}</div>)
            : <div className="text-[11px] text-red-700">Risk: {data.scam_risk}</div>}
        </div>
      )}

      {data.notes && (
        <div className="px-2.5 pb-1.5 text-[11px] text-slate-500 italic">{data.notes}</div>
      )}

      {open && (
        <pre className="px-2.5 py-2 text-[10px] text-slate-600 bg-white border-t border-slate-200 overflow-x-auto max-h-56 overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
