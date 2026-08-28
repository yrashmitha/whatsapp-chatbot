/**
 * How a Meta event is drawn, in one place.
 *
 * The order row and the chat header show the same two facts and must not drift
 * into showing them differently — the point of a mark is that it is recognised
 * without being read, and that only works if it looks the same everywhere.
 *
 * Lead and Purchase are deliberately different colours. They mean different
 * things — an order was placed, and money arrived — and at a glance across a
 * list of fifty rows, colour is what separates them; two identical green pills
 * force you to read the words every time.
 */

/** An order was placed and Meta was told. */
export const LEAD_OK = { background: 'rgba(99,102,241,0.12)', color: '#4f46e5' };

/** Money arrived and Meta was told. Green is kept for the one that is revenue. */
export const PURCHASE_OK = { background: 'rgba(16,185,129,0.14)', color: '#059669' };

/** Something that should have reached Meta did not. */
export const FAILED = { background: 'rgba(239,68,68,0.12)', color: '#dc2626' };

/** Not due yet — an order nobody has paid for. Never an alarm. */
export const NOT_DUE = { background: 'rgba(100,116,139,0.10)', color: '#94a3b8' };

/**
 * Reduce one order's two event states to what should be drawn.
 *
 * A purchase is only missing when the order has actually been paid. Most orders
 * are waiting for payment, and treating those as failures would put a dozen red
 * marks on one screen and make the mark worthless.
 *
 * @param {{lead: string|null, purchase: string|null, paid: boolean}} state
 * @returns {{lead: 'ok'|'bad'|'idle', purchase: 'ok'|'bad'|'idle', broken: boolean}}
 */
export function marksFor(state) {
  const lead = state?.lead === 'ok' ? 'ok' : state?.lead === 'error' ? 'bad' : 'idle';
  const purchase = state?.purchase === 'ok' ? 'ok'
    : state?.purchase === 'error' ? 'bad'
      : state?.paid ? 'bad' : 'idle';
  return { lead, purchase, broken: lead === 'bad' || purchase === 'bad' };
}

/**
 * The style for one mark.
 *
 * @param {'Lead'|'Purchase'} which
 * @param {'ok'|'bad'|'idle'} kind
 */
export function styleFor(which, kind) {
  if (kind === 'bad') return FAILED;
  if (kind === 'idle') return NOT_DUE;
  return which === 'Purchase' ? PURCHASE_OK : LEAD_OK;
}

/** ✓ when sent, ✗ when it failed, · when it is not due. */
export function glyphFor(kind) {
  return kind === 'ok' ? '✓' : kind === 'bad' ? '✗' : '·';
}
