import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../lib/api';
import Button from './ui/Button';
import Spinner from './ui/Spinner';
import { useToast } from './ui/Toast';

/**
 * Runs a file through the client's extraction instructions and shows exactly
 * what comes back — so a payment slip or document can be tuned against without
 * anyone having to send one over WhatsApp.
 */
export default function MediaExtractPanel({ clientId }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const params = clientId ? { client_id: clientId } : {};

  const runMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/test-chat/extract', fd, {
        params,
        headers: { 'Content-Type': undefined },
      }).then(r => r.data);
    },
    onSuccess: (d) => setResult(d),
    onError: (err) => toast.error(err?.response?.data?.error || 'Extraction failed'),
  });

  if (!clientId) {
    return <p className="text-sm text-slate-400">Select a client from the sidebar first.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-400">
        Upload a payment slip, photo or PDF to see what the client's extraction
        instructions pull out of it. Nothing is saved against a customer.
      </p>

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); }}
          className="text-sm"
        />
        {file && (
          <p className="text-xs text-slate-500">
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </p>
        )}
        <div>
          <Button onClick={() => runMutation.mutate()} disabled={!file || runMutation.isPending}>
            {runMutation.isPending ? 'Reading…' : 'Read this file'}
          </Button>
        </div>
      </div>

      {runMutation.isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-4 justify-center">
          <Spinner size="sm" /> Reading the file…
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-600 mb-1.5">
              Extracted text
              {result.mediaType && (
                <span className="ml-2 font-normal text-slate-400">({result.mediaType})</span>
              )}
            </div>
            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {result.text || <span className="text-slate-400">Nothing was returned.</span>}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-600 mb-1.5">
              Parsed JSON
              {!result.parsed && (
                <span className="ml-2 font-normal text-amber-600">
                  not valid JSON — the payment-slip flow expects JSON
                </span>
              )}
            </div>
            {result.parsed ? (
              <pre className="text-xs text-slate-700 bg-slate-50 rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(result.parsed, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-slate-400">—</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
