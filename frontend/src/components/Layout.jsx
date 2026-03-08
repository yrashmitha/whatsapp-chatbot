import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import api from '../lib/api';

const navItems = [
  { to: '/chat', label: 'Chats', icon: '💬' },
  { to: '/orders', label: 'Orders', icon: '📦' },
  { to: '/products', label: 'Products', icon: '🛍️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Layout({ children }) {
  const { user, logout, selectedClientId, setSelectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const navigate = useNavigate();

  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
    enabled: superAdmin,
  });

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="text-base font-bold text-violet-700">CRM Dashboard</div>
          {user && (
            <div className="mt-1 text-xs text-slate-500 truncate">
              {superAdmin ? '⭐ Super Admin' : user.clientId}
            </div>
          )}
        </div>

        {/* Global client selector for superadmin */}
        {superAdmin && (
          <div className="px-3 py-2 border-b border-slate-100">
            <label className="block text-xs text-slate-400 mb-1">Viewing client</label>
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-violet-400 bg-white"
            >
              <option value="">All Clients</option>
              {(clientsData?.clients || []).map(c => (
                <option key={c.client_id} value={c.client_id}>{c.client_id}</option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5
                ${isActive
                  ? 'bg-violet-50 text-violet-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-100">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors cursor-pointer bg-transparent border-0"
          >
            <span>🚪</span> Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
