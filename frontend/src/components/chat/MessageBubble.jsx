import { formatMessageTime } from '../../lib/utils';
import ExtractedReading from './ExtractedReading';


/**
 * WhatsApp's inline formatting: *bold*, _italic_, ~strike~, `mono`.
 *
 * Returns React elements, never HTML — the text comes from customers and must
 * not be interpreted as markup. A marker only counts when it wraps at least one
 * non-space character, which is what stops a lone asterisk in ordinary prose
 * from swallowing the rest of the line.
 */
const WA_BOUNDARY = '\\s.,;:!?()\\[\\]{}"\\u2018\\u2019\\u201c\\u201d\\n';
const WA_RE = new RegExp(
  '(^|[' + WA_BOUNDARY + '])' +   // start, whitespace or punctuation before it
  '([*_~`])' +                    // the mark
  '(?![\\s])' +                   // no space straight after the opening mark
  '([^\\n]*?[^\\s])' +            // the content, ending on a non-space
  '\\2' +                         // the same mark again
  '(?=$|[' + WA_BOUNDARY + '])',  // end, whitespace or punctuation after it
  'g'
);

const WA_TAGS = { '*': 'strong', _: 'em', '~': 's', '`': 'code' };

function formatWhatsApp(text) {
  if (!text) return text;

  const out = [];
  let last = 0;
  let key = 0;

  for (const m of text.matchAll(WA_RE)) {
    const [full, lead, mark, inner] = m;
    const markStart = m.index + lead.length;

    // Everything up to and including the boundary character stays as text.
    if (markStart > last) out.push(text.slice(last, markStart));

    const Tag = WA_TAGS[mark];
    out.push(
      Tag === 'code'
        ? <code key={key++} className="font-mono text-[0.9em]">{inner}</code>
        : <Tag key={key++}>{inner}</Tag>
    );
    last = m.index + full.length;
  }

  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Delivery state of an outbound message, drawn the way WhatsApp draws it so it
 * reads without a legend: one tick sent, two delivered, two blue read.
 *
 * Absent for anything sent before receipts were recorded, and for messages the
 * CRM sent outside the bot path — no ticks means unknown, never "not delivered".
 */
function DeliveryTicks({ status, errorCode, errorMessage, deliveredAt, readAt, sentAt }) {
  if (!status) return null;

  const when = (t) => {
    if (!t) return null;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const failed = status === 'failed';
  const read = status === 'read';
  const double = read || status === 'delivered';

  const rows = failed
    ? [['Not delivered', [errorCode, errorMessage].filter(Boolean).join(' \u00b7 ') || 'WhatsApp rejected it']]
    : [
        ['Sent', when(sentAt)],
        ['Delivered', when(deliveredAt)],
        ['Read', when(readAt)],
      ].filter(([label, value]) => value || label.toLowerCase() === status);

  return (
    // Focusable so the detail is reachable by tap as well as hover; a phone
    // has no hover, and this CRM is meant to be worked from one.
    <span
      tabIndex={0}
      aria-label={`Message ${status}`}
      className="relative inline-flex items-center align-middle ml-1.5 group/tick outline-none cursor-default"
    >
      {failed ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500 text-white px-1.5 py-[1px] shadow-sm">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" d="M18 6 L6 18 M6 6 L18 18" />
          </svg>
          <span className="text-[10px] font-bold leading-none tracking-wide">FAILED</span>
        </span>
      ) : read ? (
        // A filled chip, not a colour change. On a green bubble a blue tick is
        // barely distinguishable from a white one, and this is the state the
        // person replying most needs to see.
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-400 text-slate-900 px-1.5 py-[1px] shadow-sm">
          <svg viewBox="0 0 22 14" className="w-[15px] h-[10px]" fill="none" stroke="currentColor"
               strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 7.6 L4.8 11.4 L11.4 3.4" />
            <path d="M9.4 7.6 L13.2 11.4 L20.4 3.4" />
          </svg>
          <span className="text-[10px] font-bold leading-none tracking-wide">READ</span>
        </span>
      ) : (
        <svg
          viewBox="0 0 22 14"
          className="w-[19px] h-[13px] shrink-0"
          fill="none"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          stroke="rgba(255,255,255,0.7)"
        >
          <path d="M1 7.6 L4.8 11.4 L11.4 3.4" />
          {double && <path d="M9.4 7.6 L13.2 11.4 L20.4 3.4" />}
        </svg>
      )}

      {/* Hover detail. pointer-events-none so it can never block the bubble. */}
      <span
        className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover/tick:flex group-focus/tick:flex flex-col
                   whitespace-nowrap rounded-lg bg-slate-900 text-white shadow-lg px-2.5 py-1.5 z-30"
      >
        {rows.map(([label, value]) => (
          <span key={label} className="flex items-center gap-2 text-[11px] leading-snug">
            <span className={`font-semibold ${label.toLowerCase() === status ? 'text-sky-300' : 'text-slate-400'}`}>
              {label}
            </span>
            <span className="text-slate-300">{value || '\u2014'}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

// In production frontend+backend share the same origin so relative /uploads/ paths work as-is.
// In dev, set VITE_BACKEND_URL=https://your-app.railway.app in frontend/.env.local to load
// media files from the production Railway volume.
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

function resolveMediaUrl(url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${BACKEND_URL}${url}`;
}


/**
 * The list or buttons that were sent, drawn as the customer saw them.
 *
 * Previously this was recorded as a line of text, which made it impossible to
 * tell from the CRM what options someone was actually offered.
 */
function InteractiveMenu({ menu }) {
  const rows = menu.kind === 'list'
    ? (menu.sections || []).flatMap(sec => (sec.rows || []).map(r => ({ ...r, section: sec.title })))
    : [];

  return (
    <div className="mt-1.5 rounded-lg border border-white/30 bg-white/10 overflow-hidden">
      {menu.header && (
        <div className="px-2.5 py-1.5 text-xs font-semibold border-b border-white/20">{menu.header}</div>
      )}
      {menu.footer && (
        <div className="px-2.5 pt-1.5 text-[11px] opacity-70">{menu.footer}</div>
      )}

      {menu.kind === 'buttons' ? (
        <div className="p-1.5 flex flex-col gap-1">
          {(menu.buttons || []).map((b, i) => (
            <div key={i} className="text-center text-xs font-medium rounded-md border border-white/40 px-2 py-1.5">
              {b.title}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="px-2.5 py-1.5 text-xs font-medium border-b border-white/20 flex items-center gap-1.5">
            <span>☰</span>{menu.button || 'Menu'}
          </div>
          <div className="p-1.5 flex flex-col gap-1">
            {rows.map((r, i) => (
              <div key={i} className="rounded-md bg-white/10 px-2 py-1.5">
                <div className="text-xs font-medium">{r.title}</div>
                {r.description && <div className="text-[11px] opacity-70 mt-0.5">{r.description}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MessageBubble({ msg, onDelete }) {
  const senderType = msg.sender_type || msg.role;
  const isUser = senderType === 'user';
  const isAdmin = senderType === 'admin';
  const rawText = msg.message_text || msg.content || '';
  const parts = rawText.split('[[MSG_BREAK]]').map(t => t.trim()).filter(Boolean);
  const text = parts[0] || '';
  const extraParts = parts.slice(1);

  let interactive = msg.interactive || null;
  if (typeof interactive === 'string') {
    try { interactive = JSON.parse(interactive); } catch { interactive = null; }
  }

  // Deleted message placeholder
  if (msg.is_deleted) {
    return (
      <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
        <div className="max-w-[75%] rounded-2xl px-3.5 py-2 text-sm bg-white border border-slate-200 text-slate-400 italic">
          🚫 Message hidden from CRM
        </div>
      </div>
    );
  }

  const hasImage = msg.media_type === 'image' && msg.media_url;
  const hasPdf   = msg.media_type === 'pdf'   && msg.media_url;
  const hasAudio = msg.media_type === 'audio' && msg.media_url;
  const mediaUrl = resolveMediaUrl(msg.media_url);

  const bubble = (
    <div className={`group flex ${isUser ? 'justify-start' : 'justify-end'} items-end gap-1 mb-2`}>
      {/* Delete button — left of bubble for outbound, visible on hover */}
      {!isUser && onDelete && (
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-slate-300 hover:text-red-400 shrink-0 bg-transparent border-0 cursor-pointer"
          title="Hide from CRM"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}

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

        {/* Audio media */}
        {hasAudio && (
          <div className="mb-1">
            {/* Safari plays no Ogg, and Ogg is the only thing WhatsApp renders
                as a voice note, so the file that was sent and the file the CRM
                can play are not the same file. The AAC copy sits beside it under
                the same name. Chrome takes either; Safari takes the second.
                A clip from before this existed has no .m4a, and the browser
                simply falls through to the Ogg as it did before. */}
            <audio controls className="w-full max-w-xs rounded" style={{ height: 36 }}>
              {/\.ogg$/i.test(mediaUrl) && <source src={mediaUrl.replace(/\.ogg$/i, '.m4a')} type="audio/mp4" />}
              <source src={mediaUrl} />
            </audio>
          </div>
        )}

        {/* Hide bare [Image/PDF/Audio: ...] labels when media is already rendered */}
        {text && !(hasImage && /^\[Image:[^\]]*\]$/.test(text.trim()))
               && !(hasPdf   && /^\[PDF:[^\]]*\]$/.test(text.trim()))
               && !(hasAudio && /^\[Audio:[^\]]*\]$/.test(text.trim())) && (
          <div className="whitespace-pre-wrap break-words">{formatWhatsApp(text)}</div>
        )}
        {isUser && msg.extracted && <ExtractedReading extracted={msg.extracted} />}

        {interactive && <InteractiveMenu menu={interactive} />}

        <div className={`text-xs mt-1 ${isUser ? 'text-slate-400' : 'opacity-60'} text-right`}>
          {/* Every outbound message is stored as 'bot' whoever wrote it, so the
              only thing that distinguishes a person's reply is sent_by. */}
          {!isUser && (
            <span className="mr-1.5" title={msg.sent_by ? 'Sent by a person' : 'Sent by the bot'}>
              {msg.sent_by ? `👤 ${msg.sent_by_name || 'operator'}` : '🤖'}
            </span>
          )}
          {formatMessageTime(msg.created_at)}
          {!isUser && !isAdmin && msg.cost_usd && parseFloat(msg.cost_usd) > 0 && (
            <span className="ml-1.5">${parseFloat(msg.cost_usd).toFixed(6)}</span>
          )}
          {!isUser && (
            <DeliveryTicks
              status={msg.delivery_status}
              errorCode={msg.error_code}
              errorMessage={msg.error_message}
              sentAt={msg.created_at}
              deliveredAt={msg.delivered_at}
              readAt={msg.read_at}
            />
          )}
        </div>
      </div>
    </div>
  );

  if (!extraParts.length) return bubble;

  return (
    <>
      {bubble}
      {extraParts.map((part, i) => (
        <div key={i} className={`flex ${isUser ? 'justify-start' : 'justify-end'} items-end gap-1 mb-2`}>
          <div
            className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words
              ${isUser
                ? 'bg-white border border-slate-200 text-slate-800'
                : isAdmin
                ? 'bg-violet-600 text-white'
                : 'bg-emerald-600 text-white'}`}
          >
            {formatWhatsApp(part)}
          </div>
        </div>
      ))}
    </>
  );
}
