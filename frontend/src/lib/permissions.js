import { useAuthStore } from '../stores/auth';

/**
 * Whether a user holds a permission.
 *
 * Deliberately the same three rules as the server's hasPermission, in the same
 * order. When the two disagree the user gets a button that 403s, which is the
 * one failure mode worth being careful about here.
 *
 * @param {Object|null} user
 * @param {string} permission
 * @returns {boolean}
 */
export function can(user, permission) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  // A client login with no uid is the owner: the shared password, full rights.
  if (user.role === 'client' && !user.uid) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

/**
 * The permission check bound to whoever is signed in.
 *
 * Hiding a control is a courtesy, not a control. Every one of these has a
 * matching guard on the route behind it, and that guard is what actually
 * refuses; this only keeps the screen honest about what is worth clicking.
 *
 * @returns {{can: (permission: string) => boolean, user: Object|null,
 *            isOperator: boolean, isOwner: boolean}}
 */
export function usePermissions() {
  const user = useAuthStore(s => s.user);
  return {
    user,
    can: (permission) => can(user, permission),
    // An operator is a named person with their own login, as opposed to whoever
    // is holding the shared client password.
    isOperator: !!user?.uid,
    isOwner: user?.role === 'superadmin' || (user?.role === 'client' && !user?.uid),
  };
}
