/**
 * The ad a customer clicked to start this conversation.
 *
 * Sits above their first message, because that is where the question is asked:
 * reading a chat and wanting to know what this person saw before they typed
 * anything. A thumbnail answers that faster than any amount of text, so the
 * picture leads and the name sits beside it.
 *
 * Deliberately not shown: the page name, which is identical on every ad; the ad
 * id, which means nothing to a person; and the spend, which belongs in a report
 * rather than in the middle of somebody's conversation.
 *
 * @param {Object} props
 * @param {Object} props.referral - the referral row from the messages endpoint
 */
export default function AdReferral({ referral }) {
  if (!referral) return null;
  const {
    headline, body, source_url: url, source_type: type,
    ad_name: adName, thumb_url: thumb, media_type: media,
  } = referral;

  // The ad's own name if we know it; otherwise the referral's headline, which
  // is the page name and at least says something.
  const title = adName || headline;

  return (
    <div
      className="mb-1.5 rounded-lg border px-2 py-2 text-xs"
      style={{
        background: 'rgba(59,130,246,0.06)',
        borderColor: 'rgba(59,130,246,0.25)',
        maxWidth: 300,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: '#60a5fa', fontWeight: 600 }}>
        <span>📣</span>
        <span>Came from {type === 'post' ? 'a post' : 'an ad'}</span>
      </div>

      <div className="flex gap-2">
        {thumb && (
          <a
            href={url || thumb}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="shrink-0 relative"
            title="Open the ad"
          >
            <img
              src={thumb}
              alt=""
              className="rounded object-cover"
              style={{ width: 52, height: 52 }}
              // A missing picture should leave a tidy card, not a broken icon.
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
            {media === 'video' && (
              <span
                className="absolute inset-0 flex items-center justify-center text-white"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
              >▶</span>
            )}
          </a>
        )}

        <div className="min-w-0">
          {title && (
            <div className="font-medium truncate" style={{ color: 'var(--text-1)' }}>{title}</div>
          )}
          {body && (
            // Ad copy runs to thousands of characters; two lines is enough to
            // recognise which one it was.
            <div
              style={{
                color: 'var(--text-2)',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >{body}</div>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ color: '#60a5fa' }}
            >open</a>
          )}
        </div>
      </div>
    </div>
  );
}
