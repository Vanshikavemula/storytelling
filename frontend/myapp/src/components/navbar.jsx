import { Link, useNavigate } from "react-router-dom";
import { useContext, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { logout } from "../services/authService";

export default function Navbar() {
  const { user, setUser, darkMode, toggleDarkMode } = useContext(AuthContext);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    navigate("/");
    setMenuOpen(false);
  };

  const userRole = user?.role?.toLowerCase();
  const isAdmin     = userRole === "admin";
  const isAnnotator = userRole === "annotator";
  const isUser      = userRole === "user";

  const D = { surface2: "#252238", border: "#2e2a45", text: "#f0eeff", text2: "#b0acd0", primary: "#5b4fcf", primaryLight: "#2a2450" };
  const L = { surface2: "#faf9ff", border: "#e4e1f5", text: "#1a1633", text2: "#5c5880", primary: "#5b4fcf", primaryLight: "#ede9ff" };
  const C = darkMode ? D : L;

  const navLinkStyle = (active) => ({
    textDecoration: "none",
    color: active ? C.primary : C.text2,
    fontSize: 14, fontWeight: active ? 600 : 500,
    padding: "7px 14px", borderRadius: 999,
    background: active ? C.primaryLight : "transparent",
  });

  return (
    <>
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, height: 68, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", zIndex: 100, background: darkMode ? "rgba(30,27,46,0.97)" : "rgba(255,255,255,0.9)", backdropFilter: "blur(16px)", borderBottom: `1px solid ${C.border}` }}>
        <Link to="/" style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: C.primary, textDecoration: "none" }}>
          Story<span style={{ color: "#f97316" }}>Nest</span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Link to="/" style={navLinkStyle(false)}>Home</Link>

          {/* Chatbot: only user and admin */}
          {(isUser || isAdmin) && (
            <Link to="/chatbot" style={navLinkStyle(false)}>Chatbot</Link>
          )}

          {/* Annotator: only annotator and admin */}
          {(isAnnotator || isAdmin) && (
            <Link to="/annotator" style={navLinkStyle(false)}>Annotator</Link>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Dark mode toggle */}
          <button onClick={toggleDarkMode} title="Toggle dark mode" style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", background: darkMode ? C.primary : C.border, position: "relative", transition: "background 0.2s", padding: 0, flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 2, left: darkMode ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>
              {darkMode ? "🌙" : "☀️"}
            </span>
          </button>

          {user ? (
            <>
              <span style={{ fontSize: 13, color: C.text2 }}>👋 {user.username}</span>
              <button onClick={handleLogout} style={{ padding: "7px 16px", fontSize: 13, background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>
                Logout
              </button>
            </>
          ) : (
            <>
              <button onClick={() => navigate("/login")} style={{ padding: "7px 16px", fontSize: 13, background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>
                Login
              </button>
              <button onClick={() => navigate("/signup")} style={{ padding: "7px 18px", fontSize: 13, background: C.primary, color: "white", border: "none", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                Sign Up
              </button>
            </>
          )}
        </div>

        {/* Hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{ display: "none", flexDirection: "column", gap: 5, cursor: "pointer", padding: 8, border: "none", background: "transparent", borderRadius: 10 }}
          className="hamburger-btn"
        >
          <span style={{ display: "block", width: 22, height: 2, background: C.text2, borderRadius: 2 }} />
          <span style={{ display: "block", width: 22, height: 2, background: C.text2, borderRadius: 2 }} />
          <span style={{ display: "block", width: 22, height: 2, background: C.text2, borderRadius: 2 }} />
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{ position: "fixed", top: 68, left: 0, right: 0, background: darkMode ? "rgba(30,27,46,0.98)" : "rgba(255,255,255,0.97)", backdropFilter: "blur(16px)", borderBottom: `1px solid ${C.border}`, padding: "16px 24px 20px", display: "flex", flexDirection: "column", gap: 4, zIndex: 99 }}>
          <Link to="/" style={{ ...navLinkStyle(false), padding: "12px 16px", fontSize: 15 }} onClick={() => setMenuOpen(false)}>Home</Link>

          {(isUser || isAdmin) && (
            <Link to="/chatbot" style={{ ...navLinkStyle(false), padding: "12px 16px", fontSize: 15 }} onClick={() => setMenuOpen(false)}>Chatbot</Link>
          )}

          {(isAnnotator || isAdmin) && (
            <Link to="/annotator" style={{ ...navLinkStyle(false), padding: "12px 16px", fontSize: 15 }} onClick={() => setMenuOpen(false)}>Annotator</Link>
          )}

          <div style={{ height: 1, background: C.border, margin: "8px 0" }} />

          {user ? (
            <button onClick={handleLogout} style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "#e53e3e", fontFamily: "inherit", fontSize: 15, padding: "12px 16px" }}>
              Logout
            </button>
          ) : (
            <>
              <Link to="/login" style={{ ...navLinkStyle(false), padding: "12px 16px", fontSize: 15 }} onClick={() => setMenuOpen(false)}>Login</Link>
              <Link to="/signup" style={{ ...navLinkStyle(false), padding: "12px 16px", fontSize: 15, color: C.primary, fontWeight: 600 }} onClick={() => setMenuOpen(false)}>Sign Up</Link>
            </>
          )}
        </div>
      )}
    </>
  );
}