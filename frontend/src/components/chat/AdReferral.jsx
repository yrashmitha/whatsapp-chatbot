/**
 * The ad a customer clicked to start this conversation.
 *
 * Sits above their first message, because that is where the question is asked:
 * reading a chat and wanting to know what this person was promised before they
 * ever typed anything. The headline and body are the ad's own copy as Meta sent
 * it, so it says what they actually saw rather than what the campaign is called.
 *
 * @param {Object} props
 * @param {Object} props.referral - the referral row from the messages endpoint
 */
export default function AdReferral({ referral }) {
  if (!referral) return null;
  const {
    headline, body, source_url: url, source_id: adId, source_type: type,
    ad_name: adName, campaign_name: campaign, effective_status: status, amount_spent: spent,
  } = referral;
  // The referral's own headline is the page name, identical on every ad, so the
  // ad's name is what actually tells one from another. It comes from the cache
  // rather than the referral, and may be missing for an ad we have not seen.
  const title = adName || headline;

  return (
    <div
      className="mb-1.5 rounded-lg border px-2.5 py-2 text-xs"
      style={{
        background: 'rgba(59,130,246,0.06)',
        borderColor: 'rgba(59,130,246,0.25)',
        maxWidth: 320,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1" style={{ color: '#60a5fa', fontWeight: 600 }}>
        <span>📣</span>
        <span>Came from {type === 'post' ? 'a post' : 'an ad'}</span>
      </div>
      {title && (
        <div className="font-medium" style={{ color: 'var(--text-1)' }}>{title}</div>
      )}
      {adName && headline && headline !== adName && (
        <div style={{ color: 'var(--text-3)' }}>{headline}</div>
      )}
      {(campaign || spent || status) && (
        <div className="mt-1 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-2)' }}>
          {campaign && <span>{campaign}</span>}
          {spent && <span>spent {spent}</span>}
          {status && status !== 'ACTIVE' && (
            <span style={{ color: '#fbbf24' }}>{status.toLowerCase().replace(/_/g, ' ')}</span>
          )}
        </div>
      )}
      {body && (
        // Ad copy runs long; two lines is enough to recognise which ad it was.
        <div
          className="mt-0.5"
          style={{
            color: 'var(--text-2)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >{body}</div>
      )}
      {(adId || url) && (
        <div className="mt-1 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          {adId && <span className="font-mono text-[10px]">{adId}</span>}
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
      )}
    </div>
  );
}
