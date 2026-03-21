import api from "./api";

// ── SIGNUP ──────────────────────────────────
export const signup = async (data) => {
  const res = await api.post("/api/auth/signup", data);
  return res.data;
};

// ── LOGIN ────────────────────────────────────
// Saves JWT token to localStorage so api.js interceptor can use it
export const login = async (data) => {
  const res = await api.post("/api/auth/login", data);
  const token = res.data?.token;
  if (token) {
    localStorage.setItem("auth_token", token);
  }
  return res.data;
};

// ── LOGOUT ───────────────────────────────────
// Calls backend to blacklist token, then clears localStorage
export const logout = async () => {
  try {
    await api.post("/api/auth/logout");
  } catch (err) {
    console.warn("Logout request failed:", err?.response?.data?.detail);
  } finally {
    localStorage.removeItem("auth_token");
  }
};

// ── GET CURRENT USER ─────────────────────────
export const getCurrentUser = async () => {
  const res = await api.get("/api/auth/me");
  return res.data;
};

// ── UPDATE PROFILE ───────────────────────────
export const updateProfile = async (data) => {
  const res = await api.put("/api/auth/me", data);
  return res.data;
};

// ── CHANGE PASSWORD ──────────────────────────
export const changePassword = async (data) => {
  const res = await api.post("/api/auth/change-password", data);
  return res.data;
};