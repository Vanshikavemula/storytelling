// import { useNavigate } from "react-router-dom"
// import { Link } from "react-router-dom";

// export default function Home(){

// const navigate = useNavigate()

// return(

// <div>

// <div className="navbar">

// <h2>Story AI</h2>

// <div className="nav-links">
// <Link className="nav-link" to="/">Home</Link>
// <Link className="nav-link" to="/chatbot">Chatbot</Link>
// </div>

// </div>

// <div className="hero">

// <h1>AI Powered Moral Story Assistant</h1>

// <p>
// Discover meaningful stories based on virtues, values, and characters.
// </p>

// <div className="annotator-cta">

// <h3>Want to be an Annotator?</h3>

// <p>Help build the dataset powering the AI.</p>

// <button
// className="primary-btn"
// onClick={() => navigate("/signup?role=annotator")}
// >
// Signup as Annotator
// </button>

// </div>

// </div>

// </div>

// )

// }

import { useNavigate, Link } from "react-router-dom";
import { useContext, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { logout } from "../services/authService";

export default function Home() {
  const navigate = useNavigate();
  const { user, setUser } = useContext(AuthContext);
  const [menuOpen, setMenuOpen] = useState(false);

  const isAnnotator = ["annotator", "ANNOTATOR"].includes(user?.role);
  const isAdmin     = ["admin",     "ADMIN"    ].includes(user?.role);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    navigate("/");
    setMenuOpen(false);
  };

  const features = [
    {
      icon: "📖",
      title: "Moral Stories",
      desc: "AI-crafted tales with timeless virtues — kindness, courage, honesty and more.",
    },
    {
      icon: "🎯",
      title: "Age-Appropriate",
      desc: "Stories tailored for children, teens, or adults with suitable language and themes.",
    },
    {
      icon: "✨",
      title: "Instant Generation",
      desc: "Get a unique, meaningful story in seconds — just describe what you need.",
    },
    {
      icon: "🗂️",
      title: "Every Genre",
      desc: "Fables, fairy tales, adventure, folklore — the format fits your mood.",
    },
    {
      icon: "🌍",
      title: "Cultural Diversity",
      desc: "Stories drawn from rich traditions across the world — African, Asian, European and more.",
    },
    {
      icon: "🧠",
      title: "Learning & Retention",
      desc: "Narratives designed to make moral lessons memorable and easy to apply in real life.",
    },
  ];

  return (
    <div className="page" style={{ minHeight: "100vh" }}>

      {/* ════════════════ NAVBAR ════════════════ */}
      <nav className="navbar">
        <Link to="/" className="navbar-brand" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>🪺</span>
          <span style={{
            fontFamily: "var(--font-display, 'Playfair Display', serif)",
            fontSize: 20, fontWeight: 700,
            color: "var(--primary, #4f46e5)",
          }}>
            Story<span style={{ color: "var(--accent, #f97316)" }}>Nest</span>
          </span>
        </Link>

        <div className="nav-links">
          <Link className="nav-link" to="/">Home</Link>
          {user && <Link className="nav-link" to="/chatbot">Chatbot</Link>}
          {(isAnnotator || isAdmin) && (
            <Link className="nav-link" to="/annotator">Annotator</Link>
          )}
        </div>

        <div className="nav-actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {user ? (
            <>
              <span style={{ fontSize: 13, color: "var(--text-secondary, #6b7280)" }}>
                👋 {user.username}
              </span>
              <button
                className="secondary-btn"
                style={{ padding: "7px 16px", fontSize: 13 }}
                onClick={handleLogout}
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <button
                className="secondary-btn"
                style={{ padding: "7px 16px", fontSize: 13 }}
                onClick={() => navigate("/login")}
              >
                Login
              </button>
              <button
                className="primary-btn"
                style={{ padding: "7px 18px", fontSize: 13 }}
                onClick={() => navigate("/signup")}
              >
                Sign Up
              </button>
            </>
          )}
        </div>

        {/* Hamburger */}
        <button
          className={`hamburger ${menuOpen ? "open" : ""}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
          style={{
            display: "none", flexDirection: "column", gap: 5,
            background: "none", border: "none", cursor: "pointer", padding: 4,
          }}
        >
          <span style={{ width: 22, height: 2, background: "#374151", borderRadius: 2, display: "block", transition: "0.2s" }} />
          <span style={{ width: 22, height: 2, background: "#374151", borderRadius: 2, display: "block", transition: "0.2s" }} />
          <span style={{ width: 22, height: 2, background: "#374151", borderRadius: 2, display: "block", transition: "0.2s" }} />
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column",
        }} onClick={() => setMenuOpen(false)}>
          <div style={{
            background: "#fff", padding: 24, display: "flex", flexDirection: "column",
            gap: 16, borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
          }} onClick={(e) => e.stopPropagation()}>
            <Link className="nav-link" to="/"        onClick={() => setMenuOpen(false)}>Home</Link>
            {user && <Link className="nav-link" to="/chatbot" onClick={() => setMenuOpen(false)}>Chatbot</Link>}
            {(isAnnotator || isAdmin) && (
              <Link className="nav-link" to="/annotator" onClick={() => setMenuOpen(false)}>Annotator</Link>
            )}
            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb" }} />
            {user
              ? <button className="secondary-btn" onClick={handleLogout} style={{ width: "100%" }}>Logout</button>
              : <>
                  <button className="secondary-btn" style={{ width: "100%" }} onClick={() => { navigate("/login"); setMenuOpen(false); }}>Login</button>
                  <button className="primary-btn" style={{ width: "100%" }} onClick={() => { navigate("/signup"); setMenuOpen(false); }}>Sign Up</button>
                </>
            }
          </div>
        </div>
      )}

      {/* ════════════════ HERO ════════════════ */}
      <div className="hero">

        {/* Eyebrow badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(79,70,229,0.1)", color: "#4f46e5",
          borderRadius: 999, padding: "6px 16px", fontSize: 13, fontWeight: 600,
          marginBottom: 24, border: "1px solid rgba(79,70,229,0.2)",
        }}>
          ✦ AI-Powered Storytelling
        </div>

        <h1 style={{ fontFamily: "'Playfair Display', serif", lineHeight: 1.2, marginBottom: 16 }}>
          Stories that teach,<br />
          <em style={{ color: "#4f46e5" }}>values that last</em>
        </h1>

        <p style={{ maxWidth: 540, margin: "0 auto 32px", lineHeight: 1.7 }}>
          Discover beautifully crafted moral stories powered by AI —
          tailored by age, genre, and virtue for every reader.
        </p>

        {/* CTA buttons */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 56 }}>
          {user ? (
            <button
              className="primary-btn"
              style={{ padding: "13px 32px", fontSize: 16 }}
              onClick={() => navigate("/chatbot")}
            >
              ✨ Generate a Story
            </button>
          ) : (
            <>
              <button
                className="primary-btn"
                style={{ padding: "13px 32px", fontSize: 16 }}
                onClick={() => navigate("/signup")}
              >
                Get Started Free
              </button>
              <button
                className="secondary-btn"
                style={{ padding: "13px 28px", fontSize: 16 }}
                onClick={() => navigate("/login")}
              >
                Login
              </button>
            </>
          )}
        </div>

        {/* ════════════════ FEATURES GRID ════════════════ */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 20,
          marginBottom: 56,
          textAlign: "left",
        }}
          className="features-grid-responsive"
        >
          {features.map((f, i) => (
            <div
              key={i}
              className="card"
              style={{
                padding: "24px 22px",
                borderRadius: 16,
                transition: "transform 0.15s, box-shadow 0.15s",
                cursor: "default",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.boxShadow = "0 20px 40px rgba(15,23,42,0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "";
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>{f.icon}</div>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: "#1f2937" }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>

        {/* ════════════════ ANNOTATOR CTA ════════════════ */}
        <div style={{
          background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 60%, #6366f1 100%)",
          borderRadius: 20,
          padding: "48px 40px",
          position: "relative",
          overflow: "hidden",
          marginBottom: 40,
          textAlign: "center",
        }}>
          {/* decorative blobs */}
          <div style={{
            position: "absolute", top: -30, right: -30,
            width: 160, height: 160,
            background: "rgba(255,255,255,0.08)",
            borderRadius: "50%",
          }} />
          <div style={{
            position: "absolute", bottom: -40, left: -20,
            width: 120, height: 120,
            background: "rgba(255,255,255,0.06)",
            borderRadius: "50%",
          }} />

          <h3 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 26, fontWeight: 700,
            color: "#ffffff",
            margin: "0 0 12px",
            position: "relative",
          }}>
            Want to be an Annotator?
          </h3>
          <p style={{
            color: "rgba(255,255,255,0.80)",
            fontSize: 15, lineHeight: 1.7,
            maxWidth: 460, margin: "0 auto 28px",
            position: "relative",
          }}>
            Help shape the AI by reviewing and tagging stories.
            Join our growing dataset of moral wisdom.
          </p>

          <button
            onClick={() => navigate("/signup?role=annotator")}
            style={{
              background: "#ffffff",
              color: "#4f46e5",
              border: "none",
              borderRadius: 999,
              padding: "13px 32px",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              position: "relative",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              transition: "transform 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 28px rgba(0,0,0,0.2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.15)";
            }}
          >
            Join as Annotator →
          </button>
        </div>

      </div>

      {/* Responsive grid CSS */}
      <style>{`
        @media (max-width: 860px) {
          .features-grid-responsive { grid-template-columns: repeat(2,1fr) !important; }
        }
        @media (max-width: 540px) {
          .features-grid-responsive { grid-template-columns: 1fr !important; }
          .hamburger { display: flex !important; }
          .nav-links, .nav-actions { display: none !important; }
        }
      `}</style>
    </div>
  );
}