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
import Addons from './pages/Addons';
import Plugins from './pages/Plugins';
import Summary from './pages/Summary';
import QuickReplies from './pages/QuickReplies';

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
  { path: '/addons', element: <ProtectedRoute><Addons /></ProtectedRoute> },
  { path: '/plugins', element: <ProtectedRoute><Plugins /></ProtectedRoute> },
  { path: '/quick-replies', element: <ProtectedRoute><QuickReplies /></ProtectedRoute> },
  { path: '/', element: <Navigate to="/chat" replace /> },
  { path: '*', element: <Navigate to="/chat" replace /> },
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
