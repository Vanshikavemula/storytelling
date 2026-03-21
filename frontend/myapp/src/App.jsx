import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/home";
import Login from "./pages/login";
import Signup from "./pages/signup";
import Chatbot from "./pages/chatbot";
import AnnotatorsDashboard from "./pages/annotatorsDashboard";
import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Chatbot: user and admin only — annotators get redirected */}
        <Route
          path="/chatbot"
          element={
            <ProtectedRoute role="user">
              <Chatbot />
            </ProtectedRoute>
          }
        />

        {/* Annotator dashboard: annotator and admin only */}
        <Route
          path="/annotator"
          element={
            <ProtectedRoute role="annotator">
              <AnnotatorsDashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}