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

  // Admin bypasses all role checks
  if (userRole === "admin") return children;

  if (role) {
    const requiredRole = role.toLowerCase();

    // /chatbot requires "user" role — annotators cannot access
    if (requiredRole === "user" && userRole !== "user") {
      return <Navigate to="/" />;
    }

    // /annotator requires "annotator" role — users cannot access
    if (requiredRole === "annotator" && userRole !== "annotator") {
      return <Navigate to="/" />;
    }
  }

  return children;
}