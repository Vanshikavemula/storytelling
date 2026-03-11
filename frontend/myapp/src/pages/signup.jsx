// import { useState } from "react";
// import { signup } from "../services/authService";
// import { useSearchParams, useNavigate } from "react-router-dom";

// export default function Signup() {

//   const [params] = useSearchParams();
//   const navigate = useNavigate();

//   const role = params.get("role") === "annotator" ? "ANNOTATOR" : "USER";

//   const [form, setForm] = useState({});

//   const handleSignup = async () => {
//     await signup({ ...form, role });
//     navigate("/login");
//   };

//   return (
//     <div className="hero">

//       <div className="card" style={{padding:"40px", maxWidth:"500px", margin:"auto"}}>

//         <h2 style={{marginBottom:"20px"}}>Signup</h2>

//         <input
//           className="field-input"
//           placeholder="Username"
//           onChange={(e)=>setForm({...form,username:e.target.value})}
//         />

//         <br/><br/>

//         <input
//           className="field-input"
//           placeholder="Email"
//           onChange={(e)=>setForm({...form,email:e.target.value})}
//         />

//         <br/><br/>

//         <input
//           className="field-input"
//           type="password"
//           placeholder="Password"
//           onChange={(e)=>setForm({...form,password:e.target.value})}
//         />

//         <br/><br/>

//         <button
//           className="primary-btn"
//           onClick={handleSignup}
//         >
//           Signup as {role}
//         </button>

//       </div>

//     </div>
//   );
// }

import { useState } from "react";
import { signup } from "../services/authService";
import { useSearchParams, useNavigate, Link } from "react-router-dom";

export default function Signup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const role = params.get("role") === "annotator" ? "annotator" : "user";

  const [form, setForm] = useState({
    username: "",
    email: "",
    firstname: "",
    lastname: "",
    phone: "",
    password: "",
    confirm_password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const validate = () => {
    if (!form.firstname.trim()) return "First name is required.";
    if (!form.lastname.trim()) return "Last name is required.";
    if (!form.username.trim() || form.username.length < 3) return "Username must be at least 3 characters.";
    if (!form.email.trim() || !form.email.includes("@")) return "Enter a valid email address.";
    if (!form.phone.trim() || form.phone.replace(/\D/g, "").length !== 10)
      return "Enter a valid 10-digit phone number.";
    if (!form.password || form.password.length < 6) return "Password must be at least 6 characters.";
    if (form.password !== form.confirm_password) return "Passwords do not match.";
    return null;
  };

  const handleSignup = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    setLoading(true);
    try {
      await signup({ ...form, role });
      // After signup, go to login — user must log in to get token
      // Pass role hint so login can redirect correctly
      navigate("/login?from=signup&role=" + role);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (Array.isArray(detail)) {
        // Pydantic validation errors come as an array
        setError(detail.map((d) => d.msg).join(", "));
      } else {
        setError(detail || "Signup failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleSignup(); };

  const InputField = ({ label, field, type = "text", placeholder, icon }) => (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <div className="field-input-icon">
        <span className="input-icon">{icon}</span>
        <input
          className="field-input"
          type={type}
          placeholder={placeholder}
          value={form[field]}
          onChange={update(field)}
          onKeyDown={handleKeyDown}
          autoComplete={field}
        />
      </div>
    </div>
  );

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 500 }}>

        {/* Logo */}
        <div className="auth-logo">
          <div className="logo-mark">📖</div>
          <Link to="/" style={{ textDecoration: "none" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--primary)" }}>
              Story<span style={{ color: "#f97316" }}>Nest</span>
            </span>
          </Link>
        </div>

        {/* Back button */}
        <button className="back-btn" style={{ marginBottom: 20 }} onClick={() => navigate(-1)}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Role badge */}
        {role === "annotator" && (
          <div style={{ marginBottom: 16 }}>
            <span className="role-badge">✏️ Annotator Account</span>
          </div>
        )}

        <h1 className="auth-title">Create an account</h1>
        <p className="auth-subtitle">
          {role === "annotator"
            ? "Join as an annotator and help build the dataset"
            : "Start generating moral stories today"}
        </p>

        {error && <div className="auth-error">⚠️ {error}</div>}

        {/* First + Last name row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field-group">
            <label className="field-label">First Name</label>
            <input
              className="field-input"
              placeholder="John"
              value={form.firstname}
              onChange={update("firstname")}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Last Name</label>
            <input
              className="field-input"
              placeholder="Doe"
              value={form.lastname}
              onChange={update("lastname")}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>

        {/* Username */}
        <div className="field-group">
          <label className="field-label">Username</label>
          <div className="field-input-icon">
            <svg className="input-icon" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <input
              className="field-input"
              placeholder="Choose a username"
              value={form.username}
              onChange={update("username")}
              onKeyDown={handleKeyDown}
              autoComplete="username"
            />
          </div>
        </div>

        {/* Email */}
        <div className="field-group">
          <label className="field-label">Email</label>
          <div className="field-input-icon">
            <svg className="input-icon" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <input
              className="field-input"
              type="email"
              placeholder="your@email.com"
              value={form.email}
              onChange={update("email")}
              onKeyDown={handleKeyDown}
              autoComplete="email"
            />
          </div>
        </div>

        {/* Phone */}
        <div className="field-group">
          <label className="field-label">Phone Number</label>
          <div className="field-input-icon">
            <svg className="input-icon" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            <input
              className="field-input"
              type="tel"
              placeholder="10-digit phone number"
              value={form.phone}
              onChange={update("phone")}
              onKeyDown={handleKeyDown}
              autoComplete="tel"
              maxLength={15}
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
                placeholder="Min. 6 characters"
                value={form.password}
                onChange={update("password")}
                onKeyDown={handleKeyDown}
                autoComplete="new-password"
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
          {/* Password strength bar */}
          {form.password.length > 0 && (
            <div style={{ display: "flex", gap: 4, marginTop: 6, alignItems: "center" }}>
              {[1, 2, 3].map((n) => (
                <div key={n} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: form.password.length >= n * 3
                    ? (form.password.length >= 9 ? "var(--success)" : "var(--accent)")
                    : "var(--border)",
                  transition: "background 0.2s"
                }} />
              ))}
              <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 6 }}>
                {form.password.length < 3 ? "Weak" : form.password.length < 9 ? "Fair" : "Strong"}
              </span>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div className="field-group">
          <label className="field-label">Confirm Password</label>
          <div className="field-input-icon">
            <svg className="input-icon" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <input
              className="field-input"
              type={showPassword ? "text" : "password"}
              placeholder="Re-enter your password"
              value={form.confirm_password}
              onChange={update("confirm_password")}
              onKeyDown={handleKeyDown}
              autoComplete="new-password"
              style={{
                borderColor: form.confirm_password && form.confirm_password !== form.password
                  ? "var(--danger)" : undefined
              }}
            />
          </div>
          {form.confirm_password && form.confirm_password !== form.password && (
            <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>Passwords don't match</p>
          )}
        </div>

        <button
          className="primary-btn"
          style={{ width: "100%", padding: "13px", fontSize: 15, marginTop: 8 }}
          onClick={handleSignup}
          disabled={loading}
        >
          {loading ? (
            <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
              Creating account...
            </span>
          ) : `Sign Up as ${role === "annotator" ? "Annotator" : "User"}`}
        </button>

        <div className="auth-footer" style={{ marginTop: 24 }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
            Sign in
          </Link>
        </div>

        {role !== "annotator" && (
          <div className="auth-footer" style={{ marginTop: 10 }}>
            Want to annotate?{" "}
            <Link to="/signup?role=annotator" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
              Join as Annotator
            </Link>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}