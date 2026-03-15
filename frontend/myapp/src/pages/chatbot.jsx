import { useState, useRef, useEffect, useContext, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { sendQuery, getChatHistory, deleteHistoryItem, clearAllHistory } from "../services/chatbotService";
import { AuthContext } from "../context/AuthContext";
import { logout } from "../services/authService";

const AGE_GROUPS    = ["child", "teen", "adult"];
const STORY_LENGTHS = ["short", "medium", "long"];
const SUGGESTIONS   = [
  "A story about honesty",
  "Courage for a child",
  "Kindness and friendship",
  "Perseverance in hard times",
];

export default function Chatbot() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  // ── chat state ────────────────────────────────────────────
  const [messages,      setMessages]      = useState([]);
  const [input,         setInput]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [ageGroup,      setAgeGroup]      = useState("child");
  const [storyLength,   setStoryLength]   = useState("medium");
  const [activeConvId,  setActiveConvId]  = useState(null); // currently loaded conversation_id

  // ── sidebar / history state ───────────────────────────────
  const [history,       setHistory]       = useState([]);   // from API
  const [historyLoading,setHistoryLoading]= useState(false);
  const [menuOpen,      setMenuOpen]      = useState(false);
  const [sidebarOpen,   setSidebarOpen]   = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);

  // ── scroll to bottom on new message ──────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ── load history from API on mount ───────────────────────
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await getChatHistory({ limit: 30, skip: 0 });
      setHistory(data.history || []);
    } catch (err) {
      console.error("History load failed:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ── role helpers ─────────────────────────────────────────
  const isAnnotator = user?.role === "annotator" || user?.role === "ANNOTATOR";
  const isAdmin     = user?.role === "admin"     || user?.role === "ADMIN";

  // ── new chat ──────────────────────────────────────────────
  const startNewChat = () => {
    setMessages([]);
    setActiveConvId(null);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // ── load a past conversation into the chat area ───────────
  const loadConversation = (item) => {
    setActiveConvId(item.conversation_id);
    setMessages([
      { role: "user", text: item.user_query },
      { role: "bot",  story: item.generated_story, moral: item.moral },
    ]);
    setAgeGroup(item.age_group   || "child");
    setStoryLength(item.story_length || "medium");
    setSidebarOpen(false);
  };

  // ── send message ──────────────────────────────────────────
  const sendMessage = async (overrideInput) => {
    const text = (overrideInput || input).trim();
    if (!text || loading) return;

    // optimistic user bubble
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);
    setActiveConvId(null); // new message = new conversation

    try {
      const res = await sendQuery({
        age_group:       ageGroup,
        genre_or_virtue: text,
        story_length:    storyLength,
        other_notes:     "",
      });

      const storyText = res.generated_story || res.story || "No story returned.";
      const moral     = res.moral || "";

      setMessages((prev) => [...prev, { role: "bot", story: storyText, moral }]);

      // refresh sidebar history so new entry appears immediately
      loadHistory();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const errMsg = Array.isArray(detail)
        ? detail.map((d) => d.msg).join(", ")
        : detail || "Something went wrong. Please try again.";
      setMessages((prev) => [...prev, { role: "bot", story: `⚠️ ${errMsg}`, moral: null }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── delete a single history item ─────────────────────────
  const handleDeleteItem = async (e, convId) => {
    e.stopPropagation();
    try {
      await deleteHistoryItem(convId);
      setHistory((prev) => prev.filter((h) => h.conversation_id !== convId));
      if (activeConvId === convId) startNewChat();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // ── clear all history ─────────────────────────────────────
  const clearChat = async () => {
    try {
      await clearAllHistory();
      setHistory([]);
      startNewChat();
    } catch (err) {
      console.error("Clear failed:", err);
    }
  };

  // ── logout ────────────────────────────────────────────────
  const handleLogout = async () => {
    await logout();
    setUser(null);
    navigate("/");
  };

  // ── group history by date ─────────────────────────────────
  const groupedHistory = (() => {
    const today     = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const groups    = { Today: [], Yesterday: [], Older: [] };

    history.forEach((h) => {
      const d = new Date(h.created_at);
      if (d.toDateString() === today.toDateString())     groups.Today.push(h);
      else if (d.toDateString() === yesterday.toDateString()) groups.Yesterday.push(h);
      else groups.Older.push(h);
    });
    return groups;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" }}>

      {/* ── Navbar ─────────────────────────────────────── */}
      <nav className="navbar">
        <Link to="/" className="navbar-brand">Story<span style={{ color: "#f97316" }}>Nest</span></Link>
        <div className="nav-links">
          <Link className="nav-link" to="/">Home</Link>
          <Link className="nav-link active" to="/chatbot">Chatbot</Link>
          {(isAnnotator || isAdmin) && <Link className="nav-link" to="/annotator">Annotator</Link>}
        </div>
        <div className="nav-actions">
          {user && <span style={{ fontSize: 13, color: "var(--text-2)" }}>👋 {user.username}</span>}
          <button className="secondary-btn" style={{ padding: "7px 14px", fontSize: 13 }} onClick={handleLogout}>
            Logout
          </button>
        </div>
        <button className={`hamburger ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(!menuOpen)}>
          <span /><span /><span />
        </button>
      </nav>

      {/* ── Mobile menu ────────────────────────────────── */}
      <div className={`mobile-menu ${menuOpen ? "open" : ""}`}>
        <Link className="nav-link" to="/" onClick={() => setMenuOpen(false)}>Home</Link>
        <Link className="nav-link active" to="/chatbot" onClick={() => setMenuOpen(false)}>Chatbot</Link>
        {(isAnnotator || isAdmin) && (
          <Link className="nav-link" to="/annotator" onClick={() => setMenuOpen(false)}>Annotator</Link>
        )}
        <div className="nav-divider" />
        <button className="nav-link" style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "var(--danger)" }} onClick={handleLogout}>
          Logout
        </button>
      </div>

      {/* ── Chat Layout ────────────────────────────────── */}
      <div className="chat-layout" style={{ flex: 1, overflow: "hidden" }}>

        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 89 }} />
        )}

        {/* ── Sidebar ──────────────────────────────────── */}
        <aside className={`chat-sidebar ${sidebarOpen ? "mobile-open" : ""}`}>

          {/* Header: New Chat + Clear */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="chat-sidebar-title">Chats</span>
            <div style={{ display: "flex", gap: 6 }}>
              {/* New Chat button */}
              <button
                className="icon-btn"
                style={{ width: 28, height: 28 }}
                onClick={startNewChat}
                title="New Chat"
              >
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              {/* Clear All button */}
              <button
                className="icon-btn"
                style={{ width: 28, height: 28 }}
                onClick={clearChat}
                title="Clear all history"
              >
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          {/* History list grouped by date */}
          {historyLoading ? (
            <p style={{ fontSize: 12, color: "var(--text-3)", padding: "0 6px" }}>Loading…</p>
          ) : history.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-3)", padding: "0 6px" }}>No history yet</p>
          ) : (
            Object.entries(groupedHistory).map(([group, items]) =>
              items.length === 0 ? null : (
                <div key={group} style={{ marginBottom: 8 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "6px 6px 4px" }}>
                    {group}
                  </p>
                  {items.map((h) => (
                    <div
                      key={h.conversation_id}
                      className={`chat-history-item ${activeConvId === h.conversation_id ? "active" : ""}`}
                      onClick={() => loadConversation(h)}
                      style={{ justifyContent: "space-between" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                        <span style={{ flexShrink: 0 }}>💬</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
                          {h.user_query?.slice(0, 34) || "Story"}
                        </span>
                      </div>
                      {/* Delete single item */}
                      <button
                        onClick={(e) => handleDeleteItem(e, h.conversation_id)}
                        style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: "2px 4px", borderRadius: 4, opacity: 0.6 }}
                        title="Delete"
                      >
                        <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )
            )
          )}

          {/* Settings panel */}
          <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <p className="chat-sidebar-title" style={{ marginBottom: 10 }}>Settings</p>

            <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 6 }}>Age Group</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
              {AGE_GROUPS.map((a) => (
                <button key={a} onClick={() => setAgeGroup(a)} style={{
                  padding: "7px 10px", borderRadius: 8, border: "1px solid",
                  borderColor: ageGroup === a ? "var(--primary)" : "var(--border)",
                  background:  ageGroup === a ? "var(--primary-light)" : "transparent",
                  color:       ageGroup === a ? "var(--primary)" : "var(--text-2)",
                  fontSize: 12, fontWeight: ageGroup === a ? 600 : 400,
                  cursor: "pointer", textAlign: "left", textTransform: "capitalize",
                  fontFamily: "var(--font-body)"
                }}>{a}</button>
              ))}
            </div>

            <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 6 }}>Story Length</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {STORY_LENGTHS.map((s) => (
                <button key={s} onClick={() => setStoryLength(s)} style={{
                  padding: "7px 10px", borderRadius: 8, border: "1px solid",
                  borderColor: storyLength === s ? "var(--primary)" : "var(--border)",
                  background:  storyLength === s ? "var(--primary-light)" : "transparent",
                  color:       storyLength === s ? "var(--primary)" : "var(--text-2)",
                  fontSize: 12, fontWeight: storyLength === s ? 600 : 400,
                  cursor: "pointer", textAlign: "left", textTransform: "capitalize",
                  fontFamily: "var(--font-body)"
                }}>{s}</button>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Main chat area ─────────────────────────────── */}
        <div className="chat-main">

          {/* Topbar */}
          <div className="chat-topbar">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Mobile sidebar toggle */}
              <button className="icon-btn" onClick={() => setSidebarOpen(!sidebarOpen)}
                style={{ display: "none" }} id="sidebar-toggle">
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button className="back-btn" onClick={() => navigate(-1)}>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <div>
                <p style={{ fontWeight: 600, fontSize: 15 }}>Story Assistant</p>
                <p style={{ fontSize: 12, color: "var(--text-3)" }}>{ageGroup} · {storyLength}</p>
              </div>
            </div>
            {/* New Chat (topbar) */}
            <button
              className="secondary-btn"
              style={{ fontSize: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
              onClick={startNewChat}
              title="Start a new chat"
            >
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Chat
            </button>
          </div>

          {/* Messages */}
          <div className="chat-messages">
            {messages.length === 0 && !loading && (
              <div className="chat-empty">
                <div className="empty-icon">📚</div>
                <h3>What story shall we tell?</h3>
                <p>Ask for any moral story — pick a virtue, character, or theme.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 20 }}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="chat-option-chip" onClick={() => sendMessage(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble-wrap ${m.role}`}>
                <div className={`chat-avatar ${m.role}`}>{m.role === "bot" ? "🤖" : "👤"}</div>
                <div className={`chat-bubble ${m.role}`}>
                  {m.role === "user" ? m.text : (
                    <>
                      <div style={{ fontFamily: "'Georgia', serif", lineHeight: 1.75 }}>{m.story}</div>
                      {m.moral && (
                        <div className="moral">
                          <strong>💡 Moral:</strong> {m.moral}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-bubble-wrap">
                <div className="chat-avatar bot">🤖</div>
                <div className="chat-bubble bot" style={{ padding: 0 }}>
                  <div className="typing-dot"><span /><span /><span /></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="chat-input-area">
            <div className="chat-options">
              {AGE_GROUPS.map((a) => (
                <button key={a} className={`chat-option-chip ${ageGroup === a ? "selected" : ""}`}
                  onClick={() => setAgeGroup(a)}>{a}</button>
              ))}
              <div style={{ width: 1, background: "var(--border)", margin: "0 4px" }} />
              {STORY_LENGTHS.map((s) => (
                <button key={s} className={`chat-option-chip ${storyLength === s ? "selected" : ""}`}
                  onClick={() => setStoryLength(s)}>{s}</button>
              ))}
            </div>
            <div className="chat-input-row">
              <input
                ref={inputRef}
                className="field-input"
                placeholder="Ask for a moral story… e.g. 'A story about courage'"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
              <button
                className="primary-btn"
                style={{ flexShrink: 0, padding: "11px 20px" }}
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
              >
                {loading ? (
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    <span style={{ width: 5, height: 5, background: "white", borderRadius: "50%", animation: "bounce 1.2s infinite" }} />
                    <span style={{ width: 5, height: 5, background: "white", borderRadius: "50%", animation: "bounce 1.2s infinite 0.2s" }} />
                    <span style={{ width: 5, height: 5, background: "white", borderRadius: "50%", animation: "bounce 1.2s infinite 0.4s" }} />
                  </span>
                ) : (
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2L15 22l-4-9-9-4 19-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}