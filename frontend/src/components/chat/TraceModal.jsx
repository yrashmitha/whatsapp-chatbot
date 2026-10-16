import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import Spinner from '../ui/Spinner';

function Row({ label, children }) {
  return (
    <div className="flex gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <div className="w-32 shrink-0 text-xs font-medium text-slate-500">{label}</div>
      <div className="flex-1 min-w-0 text-sm text-slate-700 break-words">{children}</div>
    </div>
  );
}

/** How the bot produced one reply: strategy, prompt version, searches and the chunks that came back, blocks, cost. */
export default function TraceModal({ messageId, clientId, onClose }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['message-trace', messageId, clientId],
    queryFn: () => api.get(`/message-trace/${messageId}`, { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
  });
  const t = data?.trace;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">How the bot wrote this reply</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 text-xl leading-none bg-transparent border-0 cursor-pointer">×</button>
        </div>
        <div className="px-5 py-3 overflow-y-auto">
          {isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
          {error && <p className="text-sm text-red-600">Could not load the trace.</p>}
          {data && !t && (
            <p className="text-sm text-slate-500">
              {data.sent_manual
                ? 'A person typed this message, so there is no bot trace.'
                : 'Nothing was recorded for this message. It was written before traces were saved.'}
            </p>
          )}
          {t && (
            <>
              <Row label="Strategy">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${t.strategy === 'B' ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-sky-100 text-sky-700'}`}>
                  Strategy {t.strategy}
                </span>
                {t.existingCustomer && <span className="ml-2 text-xs text-slate-400">customer from before the split</span>}
              </Row>
              <Row label="Prompt">
                version <code className="font-mono">{t.promptId || '?'}</code>, {t.promptChars?.toLocaleString()} characters
                <div className="text-xs text-slate-400 mt-0.5">
                  This chat's prompt was built {t.sessionBuiltAt ? new Date(t.sessionBuiltAt).toLocaleString() : 'at an unknown time'}.
                  A chat keeps the prompt it was built with until it is rebuilt (pressing Save in Settings rebuilds all of them).
                </div>
              </Row>
              <Row label="Model">{t.model}</Row>
              <Row label="Tools it called">
                {t.tools?.length ? (
                  <ul className="flex flex-col gap-2">
                    {t.tools.map((tool, i) => (
                      <li key={i} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-xs font-semibold text-slate-700">{tool.name}</div>
                        {tool.args?.query && <div className="text-xs text-slate-600 mt-0.5">searched for: <span className="font-medium">{tool.args.query}</span></div>}
                        {tool.name !== 'search_knowledge' && tool.args && !tool.args.query && (
                          <div className="text-xs text-slate-500 mt-0.5 font-mono break-all">{JSON.stringify(tool.args).slice(0, 200)}</div>
                        )}
                        {tool.order_id && <div className="text-xs text-slate-600 mt-0.5">order recorded: {tool.order_id}</div>}
                        {tool.error && <div className="text-xs text-red-600 mt-0.5">failed: {tool.error}</div>}
                        {tool.chunks && (
                          tool.chunks.length ? (
                            <ol className="mt-1 text-xs text-slate-600 list-decimal pl-4">
                              {tool.chunks.map((c, j) => (
                                <li key={j}>
                                  {c.title} <span className="text-slate-400">({c.similarity})</span>
                                  {c.only && <span className={`ml-1 font-semibold ${c.only === 'B' ? 'text-fuchsia-700' : 'text-sky-700'}`}>{c.only} only</span>}
                                </li>
                              ))}
                            </ol>
                          ) : <div className="text-xs text-amber-700 mt-0.5">nothing relevant came back</div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : <span className="text-slate-500">none. It answered from the prompt alone.</span>}
              </Row>
              <Row label="Quick replies">
                {t.blocks?.used?.length ? t.blocks.used.map(b => <code key={b} className="font-mono text-xs bg-slate-100 rounded px-1.5 py-0.5 mr-1">{b}</code>) : <span className="text-slate-500">none sent</span>}
                {t.blocks?.missing?.length > 0 && (
                  <div className="text-xs text-red-600 mt-1">named but not found: {t.blocks.missing.join(', ')}</div>
                )}
              </Row>
              <Row label="Tokens and cost">
                in {t.inputTokens?.toLocaleString() ?? '?'}, out {t.outputTokens?.toLocaleString() ?? '?'}
                {t.costUSD != null && <span className="text-slate-400"> · ${Number(t.costUSD).toFixed(6)}</span>}
              </Row>
              {t.fallback && <Row label="Note"><span className="text-red-600">The bot returned its fallback message.</span></Row>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
