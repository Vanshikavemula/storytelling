// frontend/myapp/src/services/chatbotService.js
import api from "./api";

// ── SEND QUERY ───────────────────────────────────────────────
// Pass session_id to continue an existing chat, omit to start a new one
export const sendQuery = async (data) => {
  const res = await api.post("/api/chatbot/query", data);
  return res.data;
};

// ── GET SESSIONS (sidebar) ───────────────────────────────────
// Returns one item per chat session: { session_id, title, message_count, last_updated }
export const getSessions = async ({ limit = 50, skip = 0 } = {}) => {
  const res = await api.get("/api/chatbot/sessions", { params: { limit, skip } });
  return res.data; // { sessions: [...], total }
};

// ── GET SESSION MESSAGES ──────────────────────────────────────
// Load all messages in a session when user clicks it in sidebar
export const getSessionMessages = async (sessionId) => {
  const res = await api.get(`/api/chatbot/sessions/${sessionId}`);
  return res.data; // { session_id, age_group, story_length, messages: [...] }
};

// ── DELETE SESSION ────────────────────────────────────────────
export const deleteSession = async (sessionId) => {
  const res = await api.delete(`/api/chatbot/sessions/${sessionId}`);
  return res.data;
};

// ── CLEAR ALL ─────────────────────────────────────────────────
export const clearAllHistory = async () => {
  const res = await api.delete("/api/chatbot/history/clear");
  return res.data;
};

// ── LEGACY (kept for compat) ──────────────────────────────────
export const getChatHistory = async ({ limit = 30, skip = 0 } = {}) => {
  const res = await api.get("/api/chatbot/history", { params: { limit, skip } });
  return res.data;
};
export const deleteHistoryItem = async (conversationId) => {
  const res = await api.delete(`/api/chatbot/history/${conversationId}`);
  return res.data;
};