import { BrowserRouter, Routes, Route } from "react-router-dom";

import Home from "./pages/home";
import Login from "./pages/login";
import Signup from "./pages/signup";
import Chatbot from "./pages/chatbot";
import AnnotatorsDashboard from "./pages/annotatorsDashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>

        <Route path="/" element={<Home />} />

        <Route path="/login" element={<Login />} />

        <Route path="/signup" element={<Signup />} />

        <Route path="/chatbot" element={<Chatbot />} />

        <Route path="/annotator" element={<AnnotatorsDashboard />} />

      </Routes>
    </BrowserRouter>
  );
}