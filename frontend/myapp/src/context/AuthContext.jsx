import { createContext, useState, useEffect } from "react";
import { getCurrentUser } from "../services/authService";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true); // prevent flash before check completes

  const loadUser = async () => {
    // ✅ Only call /api/auth/me if a token actually exists in localStorage
    // Without this check, every page load hits the backend with no token → 401 loop
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setUser(null);
      setAuthLoading(false);
      return;
    }

    try {
      const data = await getCurrentUser();
      setUser(data);
    } catch (err) {
      // Token is invalid or expired — clear it silently, don't redirect here
      console.warn("Session expired or invalid token, clearing.");
      localStorage.removeItem("auth_token");
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loadUser, authLoading }}>
      {children}
    </AuthContext.Provider>
  );
};