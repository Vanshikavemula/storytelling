// import { Link } from "react-router-dom";
// import { useContext } from "react";
// import { AuthContext } from "../context/AuthContext";

// export default function Navbar(){

// const {user} = useContext(AuthContext)

// return(

// <div className="navbar">

// <h2>StoryBot AI</h2>

// <div className="nav-links">

// <Link to="/">Home</Link>

// {user && <Link to="/chatbot">Chatbot</Link>}

// {user?.role === "ANNOTATOR" && (
// <Link to="/annotator">Annotator</Link>
// )}

// </div>

// </div>

// )

// }
import { Link, useNavigate } from "react-router-dom";
import { useContext, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { logout } from "../services/authService";

export default function Navbar() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    navigate("/");
    setMenuOpen(false);
  };

  // Backend returns role as lowercase: "user", "annotator", "admin"
  const isAnnotator = user?.role === "annotator" || user?.role === "ANNOTATOR";
  const isAdmin = user?.role === "admin" || user?.role === "ADMIN";

  return (
    <>
      <nav className="navbar">
        <Link to="/" className="navbar-brand">Story<span style={{color:"#f97316"}}>Nest</span></Link>

        <div className="nav-links">
          <Link className="nav-link" to="/">Home</Link>
          {user && <Link className="nav-link" to="/chatbot">Chatbot</Link>}
          {(isAnnotator || isAdmin) && (
            <Link className="nav-link" to="/annotator">Annotator</Link>
          )}
        </div>

        <div className="nav-actions">
          {user ? (
            <>
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>
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
              <button className="primary-btn sm" onClick={() => navigate("/signup")}>
                Sign Up
              </button>
            </>
          )}
        </div>

        <button
          className={`hamburger ${menuOpen ? "open" : ""}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
        >
          <span /><span /><span />
        </button>
      </nav>

      {/* Mobile menu */}
      <div className={`mobile-menu ${menuOpen ? "open" : ""}`}>
        <Link className="nav-link" to="/" onClick={() => setMenuOpen(false)}>Home</Link>
        {user && (
          <Link className="nav-link" to="/chatbot" onClick={() => setMenuOpen(false)}>
            Chatbot
          </Link>
        )}
        {(isAnnotator || isAdmin) && (
          <Link className="nav-link" to="/annotator" onClick={() => setMenuOpen(false)}>
            Annotator
          </Link>
        )}
        <div className="nav-divider" />
        {user ? (
          <button
            className="nav-link"
            style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "var(--danger)" }}
            onClick={handleLogout}
          >
            Logout
          </button>
        ) : (
          <>
            <Link className="nav-link" to="/login" onClick={() => setMenuOpen(false)}>Login</Link>
            <Link className="nav-link" to="/signup" onClick={() => setMenuOpen(false)}>Sign Up</Link>
          </>
        )}
      </div>
    </>
  );
}