import axios from 'axios';

// Set VITE_API_URL in a .env file at the project root, e.g.:
// VITE_API_URL=http://localhost:5000
const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const api = axios.create({ baseURL: `${baseURL}/api` });

// Attach the JWT (stored after login) to every request automatically.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('reliefgrid_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
