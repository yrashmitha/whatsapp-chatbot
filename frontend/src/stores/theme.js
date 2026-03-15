import { create } from 'zustand';

// Apply saved theme immediately before React renders
const stored = localStorage.getItem('nova_theme') || 'light';
document.documentElement.setAttribute('data-theme', stored);

export const useThemeStore = create(set => ({
  theme: stored,
  toggle: () => set(s => {
    const next = s.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('nova_theme', next);
    document.documentElement.setAttribute('data-theme', next);
    return { theme: next };
  }),
}));
