import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/ui/Toast';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Chat from './pages/Chat';
import Orders from './pages/Orders';
import Products from './pages/Products';
import KnowledgeBase from './pages/KnowledgeBase';
import Media from './pages/Media';
import Settings from './pages/Settings';
import Clients from './pages/Clients';
import Packages from './pages/Packages';
import Addons from './pages/Addons';
import Plugins from './pages/Plugins';
import TestChat from './pages/TestChat';
import Summary from './pages/Summary';
import Calls from './pages/Calls';
import VoiceClips from './pages/VoiceClips';
import Landing from './pages/Landing';
import Pricing from './pages/Pricing';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/summary', element: <ProtectedRoute><Summary /></ProtectedRoute> },
  { path: '/chat', element: <ProtectedRoute><Chat /></ProtectedRoute> },
  { path: '/orders', element: <ProtectedRoute><Orders /></ProtectedRoute> },
  { path: '/products', element: <ProtectedRoute><Products /></ProtectedRoute> },
  { path: '/knowledge', element: <ProtectedRoute><KnowledgeBase /></ProtectedRoute> },
  { path: '/media', element: <ProtectedRoute><Media /></ProtectedRoute> },
  { path: '/settings', element: <ProtectedRoute><Settings /></ProtectedRoute> },
  { path: '/clients', element: <ProtectedRoute><Clients /></ProtectedRoute> },
  { path: '/packages', element: <ProtectedRoute><Packages /></ProtectedRoute> },
  { path: '/addons', element: <ProtectedRoute><Addons /></ProtectedRoute> },
  { path: '/plugins', element: <ProtectedRoute><Plugins /></ProtectedRoute> },
  { path: '/test-chat', element: <ProtectedRoute><TestChat /></ProtectedRoute> },
  { path: '/calls',        element: <ProtectedRoute><Calls /></ProtectedRoute> },
  { path: '/voice-clips',  element: <ProtectedRoute><VoiceClips /></ProtectedRoute> },
  { path: '/', element: <Landing /> },
  { path: '/pricing', element: <Pricing /> },
  { path: '/privacy', element: <Privacy /> },
  { path: '/terms', element: <Terms /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
