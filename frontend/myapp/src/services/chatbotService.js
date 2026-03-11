import api from "./api";

export const sendQuery = async (data) => {
  const res = await api.post("/api/chatbot/query", data);
  return res.data;
};