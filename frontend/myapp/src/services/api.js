import axios from "axios";

// const api = axios.create({
//   baseURL: "http://localhost:8000",
//   withCredentials: false,  // backend uses Bearer tokens, not cookies
// });
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
});

// ── Attach JWT token to every request automatically ──────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── On 401: clear the bad token but DO NOT redirect here ─────────
// Redirection is handled by ProtectedRoute and AuthContext instead.
// If the interceptor redirects, it creates an infinite loop because
// AuthContext.loadUser() is called on every page including /login itself.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Only clear token — let the component/context handle navigation
      localStorage.removeItem("auth_token");
    }
    return Promise.reject(error);
  }
);

export default api;