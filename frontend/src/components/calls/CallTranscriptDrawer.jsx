import React from 'react';
import Drawer from '../ui/Drawer';
import { formatDateTime } from '../../lib/utils';

const STATUS_COLORS = {
  completed:     'bg-emerald-100 text-emerald-700',
  'no-answer':   'bg-slate-100  text-slate-600',
  busy:          'bg-amber-100  text-amber-700',
  failed:        'bg-red-100    text-red-700',
  'in-progress': 'bg-blue-100   text-blue-700',
};

function formatDuration(seconds) {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function CallTranscriptDrawer({ call, onClose }) {
  if (!call) return null;

  const transcript = Array.isArray(call.transcript) ? call.transcript : [];

  return (
    <Drawer open={!!call} onClose={onClose} title="Call Transcript" width="520px">
      <div className="flex flex-col h-full overflow-hidden">
        {/* Call metadata */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 shrink-0 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 text-sm">{call.caller_phone || '-'}</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[call.status] || 'bg-slate-100 text-slate-600'}`}>
              {call.status || '-'}
            </span>
          </div>
          <div className="flex gap-4 text-xs text-slate-500">
            <span>Called: {call.called_phone || '-'}</span>
            <span>Duration: {formatDuration(call.duration_seconds)}</span>
          </div>
          <div className="text-xs text-slate-400">{formatDateTime(call.created_at)}</div>
        </div>

        {/* AI Summary */}
        {call.ai_summary && (
          <div className="mx-5 mt-4 shrink-0 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
            <p className="text-xs font-semibold text-blue-600 mb-1">AI Summary</p>
            <p className="text-sm text-blue-800 leading-relaxed">{call.ai_summary}</p>
          </div>
        )}

        {/* Transcript */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {transcript.length === 0 ? (
            <p className="text-sm text-slate-400 text-center mt-8">No transcript available.</p>
          ) : (
            transcript.map((turn, idx) => {
              const isAI = turn.speaker === 'ai';
              return (
                <div
                  key={idx}
                  className={`flex ${isAI ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      isAI
                        ? 'bg-violet-100 text-violet-900 rounded-tr-sm'
                        : 'bg-slate-100 text-slate-800 rounded-tl-sm'
                    }`}
                  >
                    <p className={`text-[10px] font-semibold mb-1 ${isAI ? 'text-violet-500' : 'text-slate-400'}`}>
                      {isAI ? 'AI' : 'Caller'}
                    </p>
                    {turn.text}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Drawer>
  );
}
