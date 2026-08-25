/**
 * @module services/permissions
 * @description The one definition of what a CRM user may do.
 *
 * Both halves of access control read this list: the middleware that guards a
 * route, and the UI that decides whether to draw a button. Keeping them on one
 * source is the point - a hidden button is a courtesy, not a control, and a
 * bookmarked URL walks straight past it. The server is always the authority.
 *
 * Permissions are deny-by-default. A user holds only what is in their list, so
 * a route added tomorrow and forgotten today fails closed rather than open.
 */

'use strict';

/**
 * @typedef  {Object} Permission
 * @property {string}  id        - stable identifier, stored in crm_users.permissions
 * @property {string}  group     - heading the UI groups it under
 * @property {string}  label     - what it is called to a human
 * @property {string}  [note]    - why it might be withheld
 * @property {boolean} [ownerOnly] - never grantable to an operator
 */

/** @type {Permission[]} */
const PERMISSIONS = [
  // ── Conversations ────────────────────────────────────────────────────────
  { id: 'chat.read',        group: 'Conversations', label: 'See chats and history' },
  { id: 'chat.reply',       group: 'Conversations', label: 'Reply to customers' },
  { id: 'chat.send_media',  group: 'Conversations', label: 'Send media, voice clips and PDFs' },
  { id: 'chat.claim',       group: 'Conversations', label: 'Take over a chat from the bot',
    note: 'Taking over silences the bot for that customer.' },
  { id: 'chat.view_documents', group: 'Conversations', label: 'Open documents sent in a chat',
    note: 'The PDFs sent to customers are the paid deliverable. Someone who can open every one of them can walk out with the product.' },
  { id: 'chat.delete',      group: 'Conversations', label: 'Delete messages and customers',
    note: 'Irreversible.', ownerOnly: true },

  // ── Follow-ups ───────────────────────────────────────────────────────────
  { id: 'followups.view',     group: 'Follow-ups', label: 'See the follow-up queue' },
  { id: 'followups.send',     group: 'Follow-ups', label: 'Send a follow-up now' },
  { id: 'followups.schedule', group: 'Follow-ups', label: 'Schedule and cancel follow-ups' },
  { id: 'followups.prompt',   group: 'Follow-ups', label: 'Edit the follow-up instructions',
    note: 'Changes how every follow-up in the queue is written.', ownerOnly: true },

  // ── Orders ───────────────────────────────────────────────────────────────
  { id: 'orders.view',    group: 'Orders', label: 'View orders' },
  { id: 'orders.status',  group: 'Orders', label: 'Change order status' },
  { id: 'orders.edit',    group: 'Orders', label: 'Correct order details' },
  { id: 'orders.remarks', group: 'Orders', label: 'Add and remove remarks' },
  { id: 'orders.create',  group: 'Orders', label: 'Create an order by hand' },
  { id: 'orders.delete',  group: 'Orders', label: 'Delete an order',
    note: 'Irreversible. Changing the status is almost always the right fix instead.', ownerOnly: true },
  { id: 'orders.export',  group: 'Orders', label: 'Export orders to CSV',
    note: 'This is the entire customer list, names and numbers and birth data, in one click.',
    ownerOnly: true },

  // ── Deliverables ─────────────────────────────────────────────────────────
  { id: 'reports.download', group: 'Deliverables', label: 'Download a finished report' },
  { id: 'reports.edit',     group: 'Deliverables', label: 'Edit generated report sections' },

  // ── Actions that spend the client's API credit ───────────────────────────
  { id: 'ai.generate_report', group: 'AI actions', label: 'Generate or regenerate a report',
    note: 'Billed to this client\'s Gemini key on every click.' },
  { id: 'ai.followup_draft',  group: 'AI actions', label: 'Draft a follow-up with AI',
    note: 'Billed per draft.' },
  { id: 'ai.fill',            group: 'AI actions', label: 'AI-fill order fields' },
  { id: 'ai.astro_chart',     group: 'AI actions', label: 'Fetch a birth chart',
    note: 'Billed per call to the astrology API.' },
  { id: 'ai.test_chat',       group: 'AI actions', label: 'Use Test Chat',
    note: 'Spends API credit with no customer at the other end.' },

  // ── Money ────────────────────────────────────────────────────────────────
  { id: 'finance.income',  group: 'Money', label: 'See the income summary', ownerOnly: true },
  { id: 'payroll.view',    group: 'Money', label: 'See operator commission figures', ownerOnly: true },
  { id: 'payroll.own',     group: 'Money', label: 'See their own commission figures' },

  // ── Configuration ────────────────────────────────────────────────────────
  { id: 'settings.prompts',       group: 'Configuration', label: 'Edit the system prompt',      ownerOnly: true },
  { id: 'settings.keys',          group: 'Configuration', label: 'View and change API keys',    ownerOnly: true },
  { id: 'settings.menus',         group: 'Configuration', label: 'Edit interactive menus',      ownerOnly: true },
  { id: 'settings.plugins',       group: 'Configuration', label: 'Edit plugin and report prompts', ownerOnly: true },
  { id: 'settings.knowledge',     group: 'Configuration', label: 'Edit the knowledge base',     ownerOnly: true },
  { id: 'settings.products',     group: 'Configuration', label: 'Edit the service catalogue and prices',
    note: 'What a service costs is a business decision, not an inbox one.' },
  { id: 'settings.quick_replies', group: 'Configuration', label: 'Edit quick replies' },
  { id: 'settings.media',         group: 'Configuration', label: 'Manage the media library' },
  { id: 'settings.voice_clips',   group: 'Configuration', label: 'Manage voice clips' },
  { id: 'users.manage',           group: 'Configuration', label: 'Add and remove operators',    ownerOnly: true },
];

/** @type {Set<string>} */
const VALID = new Set(PERMISSIONS.map(p => p.id));

/**
 * What a newly created operator gets: enough to work the inbox, the queue and
 * the order list, and nothing that spends money, leaks the customer list or
 * destroys data. Deliberately excludes every AI action - grant those one at a
 * time once you know what the person is for.
 *
 * @type {string[]}
 */
const OPERATOR_DEFAULT = [
  'chat.read', 'chat.reply', 'chat.send_media', 'chat.claim',
  'followups.view', 'followups.send', 'followups.schedule',
  'orders.view', 'orders.status', 'orders.edit', 'orders.remarks', 'orders.create',
  'reports.download',
  'payroll.own',
];

/**
 * Whether a request's user holds a permission.
 *
 * The owner (a shared client login) and the superadmin hold everything, which
 * is what they hold today; this function only ever narrows the new user type.
 *
 * @param {Object|undefined} user - req.user, the decoded JWT payload
 * @param {string} permission
 * @returns {boolean}
 */
function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  // A client login with no uid is the owner: the shared password, full rights.
  if (user.role === 'client' && !user.uid) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

/**
 * Drop anything that is not a real permission id.
 *
 * Guards against a stale id left over from a renamed permission silently
 * granting nothing while looking like it grants something.
 *
 * @param {*} list
 * @returns {string[]}
 */
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(p => typeof p === 'string' && VALID.has(p)))];
}

module.exports = { PERMISSIONS, OPERATOR_DEFAULT, hasPermission, sanitize, VALID };
