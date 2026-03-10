import { formatTime } from '../../lib/utils';

export default function MessageBubble({ msg }) {
  const senderType = msg.sender_type || msg.role;
  const isUser = senderType === 'user';
  const isAdmin = senderType === 'admin';
  const text = msg.message_text || msg.content || '';

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
        {msg.type === 'image' && msg.media_url ? (
          <img src={msg.media_url} alt="media" className="rounded-lg max-w-full mb-1" style={{ maxHeight: 200 }} />
        ) : null}
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
