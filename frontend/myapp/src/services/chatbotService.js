// import api from "./api";

// export const sendQuery = async (data) => {
//   const res = await api.post("/api/chatbot/query", data);
//   return res.data;
// };

import api from "./api";

// ── SEND QUERY ───────────────────────────────
// Called on every "Send" in the Chatbot page
export const sendQuery = async (data) => {
  const res = await api.post("/api/chatbot/query", data);
  return res.data;
};

// ── GET HISTORY ──────────────────────────────
// Fetches the sidebar history list for the current user
export const getChatHistory = async ({ limit = 20, skip = 0 } = {}) => {
  const res = await api.get("/api/chatbot/history", {
    params: { limit, skip }
  });
  return res.data; // { history: [...], total, limit, skip }
};

// ── DELETE ONE HISTORY ITEM ──────────────────
export const deleteHistoryItem = async (conversationId) => {
  const res = await api.delete(`/api/chatbot/history/${conversationId}`);
  return res.data;
};

// ── CLEAR ALL HISTORY ────────────────────────
// Triggered by the clear button in the Chatbot topbar
export const clearAllHistory = async () => {
  const res = await api.delete("/api/chatbot/history/clear");
  return res.data;
};