// import { useContext } from "react";
// import { Navigate } from "react-router-dom";
// import { AuthContext } from "../context/AuthContext";

// export default function ProtectedRoute({ children, role }) {
//   const { user } = useContext(AuthContext);

//   if (!user) return <Navigate to="/login" />;

//   if (role && user.role !== role) return <Navigate to="/" />;

//   return children;
// }
import { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

export default function ProtectedRoute({ children, role }) {
  const { user, authLoading } = useContext(AuthContext);

  // Wait for auth check to finish before redirecting
  if (authLoading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "var(--bg)"
      }}>
        <div style={{
          width: 32, height: 32,
          border: "3px solid var(--border)",
          borderTopColor: "var(--primary)",
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite"
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" />;

  // Backend returns lowercase roles: "user", "annotator", "admin"
  // Support both cases just in case
  if (role) {
    const userRole = user.role?.toLowerCase();
    const requiredRole = role?.toLowerCase();
    // Admin bypasses all role checks — they can access every protected page
    if (userRole !== "admin" && userRole !== requiredRole) return <Navigate to="/" />;
  }

  return children;
}