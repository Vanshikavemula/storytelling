// import { useState, useContext } from "react";
// import { login } from "../services/authService";
// import { AuthContext } from "../context/AuthContext";
// import { useNavigate } from "react-router-dom";

// export default function Login() {

//   const [username,setUsername] = useState("");
//   const [password,setPassword] = useState("");

//   const { loadUser } = useContext(AuthContext);
//   const navigate = useNavigate();

//   const handleLogin = async () => {

//     await login({username,password});

//     await loadUser();

//     navigate("/chatbot");

//   };

//   return (

//     <div className="hero">

//       <div className="card" style={{padding:"40px",maxWidth:"500px",margin:"auto"}}>

//         <h2 style={{marginBottom:"20px"}}>Login</h2>

//         <input
//           className="field-input"
//           placeholder="Username"
//           onChange={(e)=>setUsername(e.target.value)}
//         />

//         <br/><br/>

//         <input
//           className="field-input"
//           type="password"
//           placeholder="Password"
//           onChange={(e)=>setPassword(e.target.value)}
//         />

//         <br/><br/>

//         <button
//           className="primary-btn"
//           onClick={handleLogin}
//         >
//           Login
//         </button>

//       </div>

//     </div>

//   );
// }

import { useState, useContext } from "react";
import { login } from "../services/authService";
import { AuthContext } from "../context/AuthContext";
import { useNavigate, useSearchParams, Link } from "react-router-dom";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { loadUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const data = await login({ username, password }); 
      await loadUser();                                 

      const role = data?.user?.role?.toLowerCase();
      const roleHint = searchParams.get("role");

      if (role === "admin") {
        navigate("/");
      } else if (role === "annotator" || roleHint === "annotator") {
        navigate("/annotator");
      } else {
        navigate("/chatbot");
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map((d) => d.msg).join(", "));
      } else {
        setError(detail || "Invalid credentials. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleLogin(); };

  return (
    <div className="auth-page">
      <div className="auth-card">

        {/* Logo */}
        <div className="auth-logo">
          <div className="logo-mark">📖</div>
          <Link to="/" style={{ textDecoration: "none" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--primary)" }}>
              Story<span style={{ color: "#f97316" }}>Nest</span>
            </span>
          </Link>
        </div>

        {/* Back */}
        <button className="back-btn" style={{ marginBottom: 20 }} onClick={() => navigate(-1)}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to your account to continue</p>

        {error && <div className="auth-error">⚠️ {error}</div>}

        {/* Username */}
        <div className="field-group">
          <label className="field-label">Username</label>
          <div className="field-input-icon">
            <svg className="input-icon" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <input
              className="field-input"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="username"
            />
          </div>
        </div>

        {/* Password */}
        <div className="field-group">
          <label className="field-label">Password</label>
          <div style={{ position: "relative" }}>
            <div className="field-input-icon">
              <svg className="input-icon" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <input
                className="field-input"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="current-password"
                style={{ paddingRight: 44 }}
              />
            </div>
            <button
              onClick={() => setShowPassword(!showPassword)}
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 13 }}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <button
          className="primary-btn"
          style={{ width: "100%", padding: "13px", fontSize: 15, marginTop: 8 }}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
              Signing in...
            </span>
          ) : "Sign In"}
        </button>

        <div className="auth-footer" style={{ marginTop: 24 }}>
          Don't have an account?{" "}
          <Link to="/signup" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
            Sign up free
          </Link>
        </div>
        <div className="auth-footer" style={{ marginTop: 10 }}>
          Want to annotate?{" "}
          <Link to="/signup?role=annotator" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
            Join as Annotator
          </Link>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}