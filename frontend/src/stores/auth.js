import { create } from 'zustand';

const stored = (() => {
  try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch { return null; }
})();

export const useAuthStore = create(set => ({
  user:  stored,
  token: localStorage.getItem('crm_token') || null,

  login(token, user) {
    localStorage.setItem('crm_token', token);
    localStorage.setItem('crm_user', JSON.stringify(user));
    set({ token, user });
  },

  logout() {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
    set({ token: null, user: null });
  },
}));

export const isSuperAdmin = (user) => user?.role === 'superadmin';
