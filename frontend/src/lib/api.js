import axios from 'axios';

/**
 * User-Agent sent to the third-party geocoder, which rejects empty ones.
 * Brand-neutral: this is the product identifying itself, not any one client.
 */
export const GEO_USER_AGENT = 'astro-crm/1.0';


const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('crm_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// On 401, clear auth and redirect to login
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('crm_token');
      localStorage.removeItem('crm_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// Auth helper for /auth/* endpoints (different base)
export const authApi = axios.create({ baseURL: '/auth' });
authApi.interceptors.request.use(cfg => {
  const token = localStorage.getItem('crm_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Admin helper for /admin/* endpoints (no /api prefix)
export const adminApi = axios.create({
  baseURL: '/admin',
  headers: { 'Content-Type': 'application/json' },
});
adminApi.interceptors.request.use(cfg => {
  const token = localStorage.getItem('crm_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
