import { createContext, useState, useEffect } from "react";
import { getCurrentUser } from "../services/authService";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(() => {
    // persist preference in localStorage
    return localStorage.getItem("darkMode") === "true";
  });

  // apply data-theme to <html> whenever darkMode changes
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("darkMode", darkMode);
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode((d) => !d);

  const loadUser = async () => {
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
    <AuthContext.Provider value={{ user, setUser, loadUser, authLoading, darkMode, toggleDarkMode }}>
      {children}
    </AuthContext.Provider>
  );
};