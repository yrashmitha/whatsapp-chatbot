import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import Modal from './ui/Modal';

/**
 * Feature discovery.
 *
 * Every feature in the catalog is visible to every client, whether or not they
 * have bought it — a feature nobody can see is a feature nobody asks for. What
 * a locked feature does is explain itself and point the user at whoever can
 * turn it on.
 *
 * This is presentation only. Entitlement is still enforced server-side on every
 * endpoint, so revealing a feature here grants no access to it.
 */

/** Small padlock chip shown next to a locked feature. */
export function LockBadge({ className = '' }) {
  return (
    <span
      className={`inline-flex items-center justify-center text-[10px] leading-none px-1 py-0.5 rounded bg-slate-200 text-slate-500 ${className}`}
      aria-label="Locked feature"
    >
      🔒
    </span>
  );
}

/**
 * Explains a locked feature and how to get it.
 *
 * A superadmin can enable it themselves, so they are sent to the Addons page
 * rather than told to contact someone.
 */
function FeatureLockModal({ addon, open, onClose, superAdmin, clientId }) {
  const navigate = useNavigate();
  if (!addon) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={addon.name}
      footer={
        superAdmin ? (
          <>
            <button
              onClick={() => { onClose(); navigate('/addons'); }}
              className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 border-0 cursor-pointer"
            >
              Enable on Addons page
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 border-0 cursor-pointer"
            >
              Not now
            </button>
          </>
        ) : (
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 border-0 cursor-pointer"
          >
            Got it
          </button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <LockBadge className="mt-0.5" />
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Not enabled on your account
          </span>
        </div>

        <p className="text-sm text-slate-700 leading-relaxed">{addon.description}</p>

        <div className="rounded-lg p-3 bg-violet-50 border border-violet-100">
          {superAdmin ? (
            <p className="text-sm text-violet-900">
              You can switch this on yourself from the Addons page
              {clientId ? <> for <span className="font-semibold">{clientId}</span></> : null}.
            </p>
          ) : (
            <p className="text-sm text-violet-900">
              Contact your administrator to have this enabled for your account.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Feature-gate helper for a page.
 *
 * @param {string|null} clientId    - Client whose entitlements apply
 * @param {boolean}     superAdmin  - Whether the current user can self-enable
 * @returns {{
 *   isEnabled: (addonId: string) => boolean,
 *   showLocked: (addonId: string) => void,
 *   guard: (addonId: string, action: Function) => Function,
 *   catalog: Array,
 *   enabledAddons: Array<string>,
 *   lockModal: JSX.Element,
 * }}
 */
export function useFeatureGate(clientId, superAdmin = false) {
  const [lockedId, setLockedId] = useState(null);

  const { data: addonsData } = useQuery({
    queryKey: ['addons-status', clientId],
    queryFn: () => api.get('/crm/addons-status', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
  });

  const { data: catalog } = useQuery({
    queryKey: ['addons-catalog'],
    queryFn: () => api.get('/addons/catalog').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const enabledAddons = addonsData?.addons || [];
  const isEnabled = (addonId) => enabledAddons.includes(addonId);
  const showLocked = (addonId) => setLockedId(addonId);

  /**
   * Wrap a click handler so a locked feature explains itself instead of acting.
   * Keeps the call site to one expression rather than an if/else at each button.
   */
  const guard = (addonId, action) => (...args) => {
    if (isEnabled(addonId)) return action(...args);
    return showLocked(addonId);
  };

  const addon = (catalog || []).find(a => a.id === lockedId)
    || (lockedId ? { id: lockedId, name: lockedId, description: 'This feature is not enabled on your account.' } : null);

  const lockModal = (
    <FeatureLockModal
      addon={addon}
      open={!!lockedId}
      onClose={() => setLockedId(null)}
      superAdmin={superAdmin}
      clientId={clientId}
    />
  );

  return { isEnabled, showLocked, guard, catalog: catalog || [], enabledAddons, lockModal };
}
