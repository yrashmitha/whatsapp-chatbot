import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import api from '../lib/api';

/* ── Icons ──────────────────────────────────────────────────── */
const IC = ({ d, d2 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    {d2 && <path strokeLinecap="round" strokeLinejoin="round" d={d2} />}
  </svg>
);

const icons = {
  chat:      <IC d="M8 10h.01M12 10h.01M16 10h.01M21 16c0 1.1-.9 2-2 2H7l-4 4V6a2 2 0 012-2h14a2 2 0 012 2v10z" />,
  orders:    <IC d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />,
  products:  <IC d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />,
  knowledge: <IC d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />,
  media:     <IC d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  clients:   <IC d="M17 20h5v-2a4 4 0 00-5.916-3.519M9 20H4v-2a4 4 0 015.916-3.519M15 7a4 4 0 11-8 0 4 4 0 018 0zm6 3a3 3 0 11-6 0 3 3 0 016 0zm-18 0a3 3 0 11-6 0 3 3 0 016 0z" />,
  addons:    <IC d="M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5M16 3l5 5-9 9H7v-5l9-9z" />,
  plugins:   <IC d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.4.959.4v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" />,
  settings:  <IC d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" d2="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
  moon:      <IC d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />,
  sun:       <IC d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />,
  logout:    <IC d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />,
  summary:      <IC d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  quickreplies: <IC d="M7 8h10M7 12h6m-6 4h4M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  calls:        <IC d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />,
  voiceclips:   <IC d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />,
  packages:     <IC d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />,
  consult:      <IC d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />,
};

const ALL_NAV = [
  { to: '/summary',   label: 'Summary',   icon: icons.summary   },
  { to: '/chat',      label: 'Chats',     icon: icons.chat      },
  { to: '/orders',    label: 'Orders',    icon: icons.orders    },
  { to: '/products',  label: 'Products',  icon: icons.products,  key: 'product_catalog_enabled' },
  { to: '/knowledge', label: 'Knowledge', icon: icons.knowledge, key: 'knowledge_base_enabled'  },
  { to: '/media',     label: 'Media',     icon: icons.media     },
  { to: '/clients',   label: 'Clients',   icon: icons.clients,   adminOnly: true },
  { to: '/packages',  label: 'Packages',  icon: icons.packages,  adminOnly: true },
  { to: '/addons',    label: 'Addons',    icon: icons.addons,    adminOnly: true },
  { to: '/calls',        label: 'Calls',        icon: icons.calls,       addonKey: 'ai_call_answering' },
  { to: '/voice-clips',  label: 'Voice Clips',  icon: icons.voiceclips },
  { to: '/plugins',       label: 'Plugins',  icon: icons.plugins              },
  { to: '/test-chat',     label: 'Test Chat', icon: icons.plugins             },
  { to: '/settings',      label: 'Settings', icon: icons.settings             },
  { to: '/consult-admin', label: 'Consult',  icon: icons.consult, adminOnly: true },
];

export default function Layout({ children }) {
  const { user, logout, selectedClientId, setSelectedClientId } = useAuthStore();
  const { theme, toggle } = useThemeStore();
  const superAdmin = isSuperAdmin(user);
  const navigate = useNavigate();

  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
    enabled: superAdmin,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings', clientId],
    queryFn: () => api.get('/settings', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
  });

  const { data: addonsStatus } = useQuery({
    queryKey: ['addons-status', clientId],
    queryFn: () => api.get('/crm/addons-status', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
  });

  const navItems = ALL_NAV.filter(n => {
    if (n.adminOnly && !superAdmin) return false;
    if (n.key && !settings?.[n.key]) return false;
    if (n.addonKey && !addonsStatus?.addons?.includes(n.addonKey)) return false;
    return true;
  });

  const handleLogout = () => { logout(); navigate('/login', { replace: true }); };

  const iconBtn = (onClick, title, icon) => (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer border-0"
      style={{ background: 'var(--bg-card)', color: 'var(--text-2)' }}
    >{icon}</button>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>

      {/* ── Top nav bar ── */}
      <header
        className="flex items-center px-3 gap-2 shrink-0"
        style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', height: '48px' }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0 pr-3 mr-1" style={{ borderRight: '1px solid var(--border)' }}>
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ background: 'linear-gradient(135deg,#6366f1,#38bdf8)' }}
          >N</div>
          <span
            className="text-sm font-semibold whitespace-nowrap hidden sm:block"
            style={{ background: 'linear-gradient(135deg,#818cf8,#38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >Agent Nova</span>
        </div>

        {/* Nav items */}
        <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto">
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              style={({ isActive }) => isActive
                ? { background: 'rgba(99,102,241,0.12)', color: 'var(--accent)' }
                : { color: 'var(--text-2)' }
              }
            >
              {icon}
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-1.5 shrink-0 pl-2" style={{ borderLeft: '1px solid var(--border)' }}>
          {superAdmin && (
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
              className="text-xs rounded-lg px-2 py-1 border outline-none"
              style={{ background: 'var(--bg-card)', color: 'var(--text-2)', borderColor: 'var(--border)', maxWidth: '120px' }}
            >
              <option value="">All Clients</option>
              {(clientsData?.clients || []).map(c => (
                <option key={c.client_id} value={c.client_id}>{c.client_id}</option>
              ))}
            </select>
          )}
          {user && (
            <span className="text-xs px-2 py-1 rounded-lg hidden md:block" style={{ background: 'var(--bg-card)', color: 'var(--text-3)' }}>
              {superAdmin ? 'Admin' : user.clientId}
            </span>
          )}
          {iconBtn(toggle, theme === 'dark' ? 'Light mode' : 'Dark mode', theme === 'dark' ? icons.sun : icons.moon)}
          {iconBtn(handleLogout, 'Logout', icons.logout)}
        </div>
      </header>

      {/* ── Page content ── */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">{children}</main>
    </div>
  );
}
