import { useNavigate, Link } from "react-router-dom";
import { useContext, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { logout } from "../services/authService";

export default function Home() {
  const navigate = useNavigate();
  const { user, setUser, darkMode, toggleDarkMode } = useContext(AuthContext);
  const [menuOpen, setMenuOpen] = useState(false);

  const isAnnotator = ["annotator", "ANNOTATOR"].includes(user?.role);
  const isAdmin     = ["admin", "ADMIN"].includes(user?.role);

  const D = {
    bg: "#13111f", surface: "#1e1b2e", surface2: "#252238", border: "#2e2a45",
    text: "#f0eeff", text2: "#b0acd0", text3: "#6e6a90",
    primary: "#5b4fcf", primaryLight: "#2a2450", primaryText: "#c4b8ff",
  };
  const L = {
    bg: "#f5f4ff", surface: "#ffffff", surface2: "#faf9ff", border: "#e4e1f5",
    text: "#1a1633", text2: "#5c5880", text3: "#9491b0",
    primary: "#5b4fcf", primaryLight: "#ede9ff", primaryText: "#5b4fcf",
  };
  const C = darkMode ? D : L;

  const handleLogout = async () => {
    await logout(); setUser(null); navigate("/"); setMenuOpen(false);
  };

  const features = [
    { icon: "📖", title: "Moral Stories", desc: "AI-crafted tales with timeless virtues — kindness, courage, honesty and more." },
    { icon: "🎯", title: "Age-Appropriate", desc: "Stories tailored for children, teens, or adults with suitable language and themes." },
    { icon: "✨", title: "Instant Generation", desc: "Get a unique, meaningful story in seconds — just describe what you need." },
    { icon: "🗂️", title: "Every Genre", desc: "Fables, fairy tales, adventure, folklore — the format fits your mood." },
    { icon: "🌍", title: "Cultural Diversity", desc: "Stories drawn from rich traditions across the world." },
    { icon: "🧠", title: "Learning & Retention", desc: "Narratives designed to make moral lessons memorable." },
  ];

  const navLinkStyle = (active) => ({
    textDecoration: "none",
    color: active ? C.primary : C.text2,
    fontSize: 14, fontWeight: active ? 600 : 500,
    padding: "7px 14px", borderRadius: 999,
    background: active ? C.primaryLight : "transparent",
  });

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans', sans-serif", color: C.text }}>

      {/* Navbar */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, height: 68, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", zIndex: 100, background: darkMode ? "rgba(30,27,46,0.97)" : "rgba(255,255,255,0.9)", backdropFilter: "blur(16px)", borderBottom: `1px solid ${C.border}` }}>
        <Link to="/" style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: C.primary, textDecoration: "none" }}>
          Story<span style={{ color: "#f97316" }}>Nest</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Link to="/" style={navLinkStyle(true)}>Home</Link>
          {user && <Link to="/chatbot" style={navLinkStyle(false)}>Chatbot</Link>}
          {(isAnnotator || isAdmin)
            ? <Link to="/annotator" style={navLinkStyle(false)}>Annotators</Link>
            : <Link to="/signup?role=annotator" style={navLinkStyle(false)}>Annotators</Link>}
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
              <button onClick={handleLogout} style={{ padding: "7px 16px", fontSize: 13, background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>Logout</button>
            </>
          ) : (
            <>
              <button onClick={() => navigate("/login")} style={{ padding: "7px 16px", fontSize: 13, background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>Login</button>
              <button onClick={() => navigate("/signup")} style={{ padding: "7px 18px", fontSize: 13, background: C.primary, color: "white", border: "none", borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>Sign Up</button>
            </>
          )}
        </div>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)", display: "flex", flexDirection: "column" }} onClick={() => setMenuOpen(false)}>
          <div style={{ background: C.surface, padding: 24, display: "flex", flexDirection: "column", gap: 16, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }} onClick={(e) => e.stopPropagation()}>
            <Link to="/" style={{ color: C.text2, textDecoration: "none", fontSize: 15 }} onClick={() => setMenuOpen(false)}>Home</Link>
            {user && <Link to="/chatbot" style={{ color: C.text2, textDecoration: "none", fontSize: 15 }} onClick={() => setMenuOpen(false)}>Chatbot</Link>}
            {(isAnnotator || isAdmin) ? <Link to="/annotator" style={{ color: C.text2, textDecoration: "none", fontSize: 15 }} onClick={() => setMenuOpen(false)}>Annotators</Link> : <Link to="/signup?role=annotator" style={{ color: C.text2, textDecoration: "none", fontSize: 15 }} onClick={() => setMenuOpen(false)}>Annotators</Link>}
            <hr style={{ border: "none", borderTop: `1px solid ${C.border}` }} />
            {user
              ? <button onClick={handleLogout} style={{ background: "none", border: "none", cursor: "pointer", color: "#e53e3e", textAlign: "left", fontSize: 15, fontFamily: "inherit" }}>Logout</button>
              : <>
                  <button onClick={() => { navigate("/login"); setMenuOpen(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.text2, textAlign: "left", fontSize: 15, fontFamily: "inherit" }}>Login</button>
                  <button onClick={() => { navigate("/signup"); setMenuOpen(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.primary, textAlign: "left", fontSize: 15, fontFamily: "inherit", fontWeight: 600 }}>Sign Up</button>
                </>}
          </div>
        </div>
      )}

      {/* Hero */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "140px 24px 48px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.primaryLight, color: C.primary, borderRadius: 999, padding: "6px 16px", fontSize: 13, fontWeight: 600, marginBottom: 24, border: `1px solid ${darkMode ? "rgba(91,79,207,0.3)" : "rgba(91,79,207,0.2)"}` }}>
          ✦ AI-Powered Storytelling
        </div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(36px, 6vw, 62px)", fontWeight: 700, lineHeight: 1.15, letterSpacing: -1, color: C.text, marginBottom: 18 }}>
          Stories that teach,<br /><em style={{ color: C.primary, fontStyle: "italic" }}>values that last</em>
        </h1>
        <p style={{ fontSize: 18, color: C.text2, maxWidth: 540, margin: "0 auto 32px", lineHeight: 1.7 }}>
          Discover beautifully crafted moral stories powered by AI — tailored by age, genre, and virtue for every reader.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 56 }}>
          {user ? (
            <button onClick={() => navigate("/chatbot")} style={{ padding: "13px 32px", fontSize: 16, background: C.primary, color: "white", border: "none", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>✨ Generate a Story</button>
          ) : (
            <>
              <button onClick={() => navigate("/signup")} style={{ padding: "13px 32px", fontSize: 16, background: C.primary, color: "white", border: "none", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Get Started Free</button>
              <button onClick={() => navigate("/login")} style={{ padding: "13px 28px", fontSize: 16, background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>Login</button>
            </>
          )}
        </div>

        {/* Features grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 56 }}>
          {features.map((f, i) => (
            <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "24px 22px", textAlign: "left", cursor: "default", transition: "transform 0.15s, box-shadow 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = darkMode ? "0 20px 40px rgba(0,0,0,0.4)" : "0 20px 40px rgba(15,23,42,0.15)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = ""; }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{f.icon}</div>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: C.text }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Annotator CTA */}
        <div style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 60%, #6366f1 100%)", borderRadius: 20, padding: "48px 40px", position: "relative", overflow: "hidden", marginBottom: 40, textAlign: "center" }}>
          <div style={{ position: "absolute", top: -30, right: -30, width: 160, height: 160, background: "rgba(255,255,255,0.08)", borderRadius: "50%" }} />
          <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 700, color: "#ffffff", margin: "0 0 12px", position: "relative" }}>Want to be an Annotator?</h3>
          <p style={{ color: "rgba(255,255,255,0.80)", fontSize: 15, lineHeight: 1.7, maxWidth: 460, margin: "0 auto 28px", position: "relative" }}>
            Help shape the AI by reviewing and tagging stories. Join our growing dataset of moral wisdom.
          </p>
          <button onClick={() => navigate("/signup?role=annotator")} style={{ background: "#ffffff", color: "#4f46e5", border: "none", borderRadius: 999, padding: "13px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", position: "relative", boxShadow: "0 4px 20px rgba(0,0,0,0.15)", transition: "transform 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}>
            Join as Annotator →
          </button>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) { .features-grid-home { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width: 540px) { .features-grid-home { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}