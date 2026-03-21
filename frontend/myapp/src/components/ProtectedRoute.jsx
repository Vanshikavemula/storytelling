import { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

export default function ProtectedRoute({ children, role }) {
  const { user, authLoading } = useContext(AuthContext);

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

  // Not logged in → go to login
  if (!user) return <Navigate to="/login" />;

  const userRole = user.role?.toLowerCase();

  if (role) {
    const requiredRole = role.toLowerCase();

    // Admin can access everything
    if (userRole === "admin") return children;

    // chatbot route (role="user"): only "user" allowed, not "annotator"
    if (requiredRole === "user") {
      if (userRole !== "user") return <Navigate to="/" />;
    }

    // annotator route (role="annotator"): only "annotator" allowed, not "user"
    if (requiredRole === "annotator") {
      if (userRole !== "annotator") return <Navigate to="/" />;
    }
  }

  return children;
}