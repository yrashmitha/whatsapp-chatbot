import { formatTime } from '../../lib/utils';

// Resolve media URLs: if already absolute, use as-is; if starts with /uploads/, prepend backend origin.
// In production the frontend and backend share the same origin so window.location.origin works.
function resolveMediaUrl(url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // Relative path like /uploads/... — prepend origin so <img> tags work correctly
  return `${window.location.origin}${url}`;
}

export default function MessageBubble({ msg }) {
  const senderType = msg.sender_type || msg.role;
  const isUser = senderType === 'user';
  const isAdmin = senderType === 'admin';
  const text = msg.message_text || msg.content || '';

  const hasImage = msg.media_type === 'image' && msg.media_url;
  const hasPdf   = msg.media_type === 'pdf'   && msg.media_url;
  const mediaUrl = resolveMediaUrl(msg.media_url);

  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm
          ${isUser
            ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
            : isAdmin
            ? 'bg-violet-600 text-white rounded-tr-sm'
            : 'bg-emerald-600 text-white rounded-tr-sm'}`}
      >
        {isAdmin && <div className="text-xs opacity-70 mb-0.5 font-medium">Admin</div>}

        {/* Image media */}
        {hasImage && (
          <div className="mb-1">
            <a href={mediaUrl} target="_blank" rel="noreferrer">
              <img
                src={mediaUrl}
                alt="media"
                className="rounded-lg max-w-full cursor-pointer"
                style={{ maxHeight: 200 }}
              />
            </a>
            <div className="text-xs opacity-70 mt-0.5">
              <a href={mediaUrl} target="_blank" rel="noreferrer" className="underline">
                View full size
              </a>
            </div>
          </div>
        )}

        {/* PDF media */}
        {hasPdf && (
          <div className="mb-1">
            <a
              href={mediaUrl}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 no-underline
                ${isUser
                  ? 'bg-slate-100 text-slate-700 border border-slate-200'
                  : 'bg-white/20 text-white border border-white/30'}`}
            >
              <span className="text-xl">📄</span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium truncate">
                  {text.match(/\[PDF:\s*([^\]]+)\]/)
                    ? text.match(/\[PDF:\s*([^\]]+)\]/)[1]
                    : 'Document'}
                </span>
                <span className="text-xs opacity-70">Click to open PDF</span>
              </div>
            </a>
          </div>
        )}

        {text && <div className="whitespace-pre-wrap break-words">{text}</div>}
        <div className={`text-xs mt-1 ${isUser ? 'text-slate-400' : 'opacity-60'} text-right`}>
          {formatTime(msg.created_at)}
          {!isUser && !isAdmin && msg.cost_usd && parseFloat(msg.cost_usd) > 0 && (
            <span className="ml-1.5">${parseFloat(msg.cost_usd).toFixed(6)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
