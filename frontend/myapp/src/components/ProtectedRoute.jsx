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

  const userRole = user.role?.toLowerCase();

  // Admin can access everything
  if (userRole === "admin") return children;

  // If a specific role is required, check it
  // Annotators can access annotator pages AND chatbot (no role restriction on chatbot route)
  if (role) {
    const requiredRole = role.toLowerCase();
    if (userRole !== requiredRole) return <Navigate to="/" />;
  }

  return children;
}