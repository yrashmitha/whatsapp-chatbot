/**
 * WhatsApp's own text formatting, applied the way WhatsApp applies it.
 *
 * Shared by the customer thread and Test Chat, because Test Chat exists to show
 * what will actually be sent. Rendering the same words two different ways is
 * how copy gets approved in one place and looks wrong in the other.
 *
 * The boundary rules are the load-bearing part. WhatsApp only treats a mark as
 * formatting when it sits against whitespace or punctuation, which is what
 * stops DFCC_TRANSACTION_RECEIPT.pdf turning italic halfway through.
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

/**
 * Render WhatsApp markup as React nodes.
 *
 * Returns the original string untouched when there is nothing to format, so a
 * caller can drop it in anywhere a string was already being rendered.
 *
 * @param {string} text
 * @returns {string|Array} the text, or a mix of strings and elements
 */
export function formatWhatsApp(text) {
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

export { WA_BOUNDARY, WA_RE, WA_TAGS };
