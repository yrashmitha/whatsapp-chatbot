import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Drawer from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';
import { formatDateTime, STATUS_COLORS, STATUS_OPTIONS } from '../../lib/utils';
import OrderRemarks from './OrderRemarks';
import MetaTracking from './MetaTracking';
import { orderFacts, statusLabel } from './orderView';

const PAID_STATUSES = ['payment_received', 'paid', 'delivered', 'done', 'complete'];

/** A titled block. Quiet by default so the page reads as one column, not boxes in boxes. */
function Section({ title, action, children }) {
  return (
    <section className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-sub)' }}>
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider m-0" style={{ color: 'var(--text-3)' }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkBtn = 'text-xs font-medium cursor-pointer bg-transparent border-0 p-0';

/** One report line: its state on the left, what you can do about it on the right. */
function ReportRow({ icon, label, state, children }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-base w-6 text-center shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{label}</div>
        <div className="text-xs" style={{ color: state.tone === 'error' ? '#dc2626' : 'var(--text-3)' }} title={state.title}>
          {state.busy && <span className="inline-block w-2.5 h-2.5 mr-1.5 align-[-1px] border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />}
          {state.text}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">{children}</div>
    </div>
  );
}

function ActionBtn({ onClick, primary, locked, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="text-xs font-medium rounded-lg px-3 py-1.5 cursor-pointer border"
      style={primary && !locked
        ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
        : { background: 'var(--bg-card)', color: locked ? 'var(--text-3)' : 'var(--text-1)', borderColor: 'var(--border)' }}
    >{locked ? '🔒 ' : ''}{children}</button>
  );
}

/**
 * Everything about one order in one place.
 *
 * The list row only carries what you scan by; every action lives here so the
 * row can stay quiet. Reading order follows a call: who they are, what to do
 * next, what was bought, what has been said, then the owner-only reports.
 *
 * @param {object}   props
 * @param {object}   props.order      the live order row, or null when closed
 * @param {string}   props.clientId
 * @param {boolean}  props.canMarkPaid
 * @param {boolean}  props.showHoroscope  owner: horoscope, marriage and match reports
 * @param {boolean}  props.showMatch
 * @param {boolean}  props.showTarot
 * @param {Function} props.isEnabled  feature entitlement check
 * @param {Function} props.guard      wraps a click so a locked feature shows its lock modal
 * @param {object}   props.open       handlers that open the report modals and editors
 * @param {Function} props.onChat     open the conversation
 * @param {Function} props.onProduct  open the product popup
 * @param {Function} props.onDelete
 * @param {Function} props.onClose
 */
export default function OrderDetailDrawer({
  order, clientId, canMarkPaid, showHoroscope, showMatch, showTarot,
  isEnabled, guard, open, onChat, onProduct, onDelete, onClose,
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const o = order;

  const [editingFields, setEditingFields] = useState(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  // A different order should never inherit the last one's half-typed edit.
  useEffect(() => {
    setEditingFields(null); setEditingNote(false); setMoreOpen(false);
  }, [o?.order_id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['orders'] });

  const updateStatus = useMutation({
    mutationFn: (status) => api.patch(`/orders/${o.order_id}/status`, { status }),
    onSuccess: () => { refresh(); toast.success('Status updated'); },
    onError: () => toast.error('Failed to update status'),
  });
  const updateFields = useMutation({
    mutationFn: (custom_fields) => api.patch(`/orders/${o.order_id}/fields`, { custom_fields }),
    onSuccess: () => { refresh(); setEditingFields(null); toast.success('Order updated'); },
    onError: () => toast.error('Failed to update order'),
  });
  const updateNotes = useMutation({
    mutationFn: (notes) => api.patch(`/orders/${o.order_id}/notes`, { notes }),
    onSuccess: () => { refresh(); setEditingNote(false); toast.success('Note saved'); },
    onError: () => toast.error('Failed to save note'),
  });

  const f = o ? orderFacts(o) : null;
  const cf = f?.cf;
  const hd = f?.hd;
  const td = f?.td;

  const paidLocked = (s) => !canMarkPaid && PAID_STATUSES.includes(s) && !o?.credited_at;

  // The one move that most often comes next, offered as a single button.
  let next = null;
  if (o) {
    if (f.paymentIdentified && o.status !== 'payment_received' && !paidLocked('payment_received')) {
      next = { status: 'payment_received', label: 'Confirm payment received' };
    } else if (o.status === 'pending') next = { status: 'started', label: 'Mark started' };
    else if (o.status === 'started' && !paidLocked('delivered')) next = { status: 'delivered', label: 'Mark delivered' };
    else if (o.status === 'payment_identified' && !paidLocked('payment_received')) next = { status: 'payment_received', label: 'Confirm payment received' };
    else if (o.status === 'payment_received' || o.status === 'delivered') next = { status: 'done', label: 'Mark done' };
  }

  return (
    <Drawer open={!!o} onClose={onClose} width="640px" title={o ? `Order #${o.order_id || o.id}` : ''}>
      {o && (
        <div className="flex-1 overflow-y-auto">
          {/* Who, and the two things you do first: talk to them, move the order. */}
          <div className="px-5 pt-4 pb-4" style={{ borderBottom: '1px solid var(--border-sub)' }}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold truncate" style={{ color: 'var(--text-1)' }}>{f.name}</div>
                <div className="text-sm" style={{ color: 'var(--text-2)' }}>
                  {f.phone}
                  <span style={{ color: 'var(--text-3)' }}> · {formatDateTime(o.created_at)}</span>
                </div>
                {f.summaryLine && <div className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>{f.summaryLine}</div>}
              </div>
              <button type="button" onClick={onChat}
                className="shrink-0 text-sm font-medium rounded-lg px-3.5 py-2 cursor-pointer border-0 text-white"
                style={{ background: 'var(--accent)' }}>
                Open chat
              </button>
            </div>

            <div className="flex items-center gap-2 mt-3.5 flex-wrap">
              <select
                aria-label="Order status"
                value={o.status}
                onChange={e => updateStatus.mutate(e.target.value)}
                className={`text-sm font-medium rounded-lg px-3 py-2 border cursor-pointer outline-none ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
              >
                {!STATUS_OPTIONS.includes(o.status) && <option value={o.status}>{statusLabel(o.status)}</option>}
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s} disabled={paidLocked(s)}>
                    {statusLabel(s)}{paidLocked(s) ? ' (owner only)' : ''}
                  </option>
                ))}
              </select>
              {next && next.status !== o.status && (
                <button type="button" disabled={updateStatus.isPending}
                  onClick={() => updateStatus.mutate(next.status)}
                  className="text-sm font-medium rounded-lg px-3.5 py-2 cursor-pointer border disabled:opacity-60"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-1)', borderColor: 'var(--border)' }}>
                  {next.label}
                </button>
              )}
            </div>

            {f.paymentIdentified && o.status !== 'payment_received' && (
              <div className="mt-3 rounded-lg px-3 py-2 text-sm bg-amber-50 border border-amber-300 text-amber-800">
                <span className="font-semibold">Payment slip detected.</span>{' '}
                {[
                  f.paymentIdentified.amount && `Amount ${f.paymentIdentified.amount}`,
                  f.paymentIdentified.bank,
                  f.paymentIdentified.date,
                  f.paymentIdentified.ref && `Ref ${f.paymentIdentified.ref}`,
                ].filter(Boolean).join(' · ') || 'Check the bank, then confirm.'}
              </div>
            )}
          </div>

          {/* Reports sit directly under who and status: generating one is the job an owner opens an order for, and it used to be five sections down. */}
          {(showHoroscope || showTarot) && (
            <Section title="Reports">
              {showHoroscope && (
                <>
                  <ReportRow icon="🔮" label="Horoscope reading"
                    state={hd?.generating ? { busy: true, text: `Generating${hd?.progress?.percent != null ? ` ${hd.progress.percent}%` : '...'}` }
                      : f.horoscopeError ? { tone: 'error', text: 'Failed, tap Retry', title: f.horoscopeError }
                      : f.horoscopeDone ? { text: 'Ready' } : { text: 'Not generated' }}>
                    {f.horoscopeDone && <ActionBtn onClick={open.horoscopeEdit}>View / edit</ActionBtn>}
                    {f.horoscopeDone && <ActionBtn onClick={open.wa} title={hd?.wa_message ? 'View or regenerate the WhatsApp message' : 'Generate the WhatsApp message'}>WhatsApp message</ActionBtn>}
                    {!hd?.generating && (
                      <ActionBtn primary={!f.horoscopeDone} locked={!isEnabled('horoscope_reading')}
                        onClick={guard('horoscope_reading', open.horoscope)}>
                        {f.horoscopeError ? 'Retry' : f.horoscopeDone ? 'Regenerate' : 'Generate'}
                      </ActionBtn>
                    )}
                  </ReportRow>

                  {(hd?.marriage_generating || f.marriageDone || f.marriageError) && (
                    <ReportRow icon="💍" label="Marriage report"
                      state={hd?.marriage_generating ? { busy: true, text: 'Generating...' }
                        : f.marriageError && !f.marriageDone ? { tone: 'error', text: 'Failed', title: f.marriageError }
                        : { text: 'Ready' }}>
                      {f.marriageDone && <ActionBtn onClick={guard('horoscope_reading', open.marriage)}>View / edit</ActionBtn>}
                    </ReportRow>
                  )}

                  {showMatch && (
                    <ReportRow icon="💑" label="Match making"
                      state={hd?.match_generating ? { busy: true, text: `Generating${hd?.match_progress?.percent != null ? ` ${hd.match_progress.percent}%` : '...'}` }
                        : f.matchError && !f.matchDone ? { tone: 'error', text: 'Failed', title: f.matchError }
                        : f.matchDone ? { text: 'Ready' } : { text: 'Not started' }}>
                      {!hd?.match_generating && (
                        <ActionBtn primary={!f.matchDone} locked={!isEnabled('match_making')}
                          onClick={guard('match_making', f.matchDone ? open.match : open.matchNew)}>
                          {f.matchDone ? 'View / edit' : 'Enter both charts'}
                        </ActionBtn>
                      )}
                    </ReportRow>
                  )}
                </>
              )}

              {showTarot && (
                <ReportRow icon="🃏" label="Tarot reading"
                  state={td?.generating ? { busy: true, text: 'Generating...' }
                    : f.tarotError ? { tone: 'error', text: 'Failed, tap Retry', title: f.tarotError }
                    : f.tarotDone ? { text: 'Ready' } : { text: 'Not generated' }}>
                  {f.tarotDone && <ActionBtn onClick={open.tarotEdit}>View / edit</ActionBtn>}
                  {!td?.generating && (
                    <ActionBtn primary={!f.tarotDone} locked={!isEnabled('tarot_reading')}
                      onClick={guard('tarot_reading', open.tarot)}>
                      {f.tarotError ? 'Retry' : f.tarotDone ? 'Regenerate' : 'Generate'}
                    </ActionBtn>
                  )}
                </ReportRow>
              )}

              {Number(o.gen_cost_usd) > 0 && (
                <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                  AI cost so far: ${Number(o.gen_cost_usd).toFixed(4)}
                </div>
              )}
            </Section>
          )}
          <Section title="Remarks">
            <OrderRemarks orderId={o.order_id} remarks={o.remarks} clientId={clientId} />
          </Section>

          {o.ai_summary && (
            <Section title="Conversation summary">
              <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>{o.ai_summary}</div>
            </Section>
          )}

          <Section
            title="Order details"
            action={cf && !editingFields && (
              <button type="button" className={linkBtn} style={{ color: 'var(--accent)' }}
                onClick={() => setEditingFields({ ...cf })}>Edit</button>
            )}
          >
            {!cf || Object.keys(cf).length === 0 ? (
              <div className="text-sm italic" style={{ color: 'var(--text-3)' }}>No details captured yet</div>
            ) : editingFields ? (
              <div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  {Object.entries(editingFields).map(([k, v]) => (
                    <label key={k} className="flex flex-col gap-1">
                      <span className="text-xs capitalize" style={{ color: 'var(--text-3)' }}>{k.replace(/_/g, ' ')}</span>
                      <input
                        value={typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')}
                        disabled={typeof v === 'object' && v !== null}
                        onChange={e => setEditingFields(prev => ({ ...prev, [k]: e.target.value }))}
                        className="text-sm rounded-lg px-2.5 py-1.5 outline-none"
                        style={{ background: 'var(--bg-card)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <ActionBtn primary onClick={() => updateFields.mutate(editingFields)}>Save</ActionBtn>
                  <ActionBtn onClick={() => setEditingFields(null)}>Cancel</ActionBtn>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 m-0">
                {Object.entries(cf).filter(([k]) => k !== 'product_id' && k !== 'payment_identified').map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-xs capitalize" style={{ color: 'var(--text-3)' }}>{k.replace(/_/g, ' ')}</dt>
                    <dd className="text-sm m-0 break-words" style={{ color: 'var(--text-1)' }}>
                      {k === 'product' && v ? (
                        <button type="button" onClick={onProduct}
                          className="underline cursor-pointer bg-transparent border-0 p-0 text-sm text-left"
                          style={{ color: 'var(--accent)' }}>{String(v)}</button>
                      ) : (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '-'))}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section
            title="Notes"
            action={!editingNote && (
              <button type="button" className={linkBtn} style={{ color: 'var(--accent)' }}
                onClick={() => { setEditingNote(true); setNoteText(o.notes || `Today is ${formatDateTime(new Date())}.`); }}>
                {o.notes ? 'Edit' : 'Add'}
              </button>
            )}
          >
            {editingNote ? (
              <div>
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} autoFocus
                  className="w-full text-sm rounded-lg px-2.5 py-2 outline-none resize-y"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
                  placeholder="Delivery date, special instructions, reminders..." />
                <div className="flex gap-2 mt-2">
                  <ActionBtn primary onClick={() => updateNotes.mutate(noteText)}>Save</ActionBtn>
                  <ActionBtn onClick={() => setEditingNote(false)}>Cancel</ActionBtn>
                </div>
              </div>
            ) : (
              <div className="text-sm whitespace-pre-wrap" style={{ color: o.notes ? 'var(--text-2)' : 'var(--text-3)', fontStyle: o.notes ? 'normal' : 'italic' }}>
                {o.notes || 'No notes yet'}
              </div>
            )}
          </Section>


          <Section title="Tracking">
            <MetaTracking orderId={o.order_id} clientId={clientId} />
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              Created {formatDateTime(o.created_at)}{o.client_id ? ` · client ${o.client_id}` : ''}
            </div>
          </Section>

          <div className="px-5 py-4">
            <button type="button" className={linkBtn} style={{ color: 'var(--text-3)' }} onClick={() => setMoreOpen(v => !v)}>
              {moreOpen ? 'Hide' : 'More'} options
            </button>
            {moreOpen && (
              <div className="mt-3">
                <button type="button" onClick={onDelete}
                  className="text-sm font-medium rounded-lg px-3.5 py-2 cursor-pointer border text-red-600"
                  style={{ background: 'transparent', borderColor: 'rgba(220,38,38,0.35)' }}>
                  Delete this order
                </button>
                <div className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>The conversation is kept.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
