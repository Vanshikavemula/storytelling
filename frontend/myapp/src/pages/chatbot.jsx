import { useState, useRef, useEffect, useContext, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  sendQuery,
  getSessions,
  getSessionMessages,
  deleteSession,
  clearAllHistory,
} from "../services/chatbotService";
import { AuthContext } from "../context/AuthContext";
import { logout } from "../services/authService";
import "../styles/global.css";

const AGE_GROUPS    = ["child", "teen", "adult"];
const STORY_LENGTHS = ["short", "medium", "long"];
const VIRTUES       = ["honesty", "courage", "kindness", "patience", "gratitude", "resilience"];
const SUGGESTIONS   = [
  "A story about honesty",
  "Courage under pressure",
  "Kindness and friendship",
  "Perseverance in hard times",
];

// ── date grouping helper ─────────────────────────────────────
function dateGroup(isoString) {
  const d    = new Date(isoString);
  const now  = new Date();
  const diff = (now - d) / 86400000;
  if (diff < 1)  return "Today";
  if (diff < 2)  return "Yesterday";
  if (diff < 8)  return "Previous 7 Days";
  if (diff < 31) return "Previous 30 Days";
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

function groupSessions(sessions) {
  const groups = {};
  const order  = [];
  sessions.forEach((s) => {
    const g = dateGroup(s.last_updated);
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(s);
  });
  return order.map((g) => ({ label: g, items: groups[g] }));
}

export default function Chatbot() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  // ── session / chat state ──────────────────────────────────
  const [sessions,        setSessions]        = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages,        setMessages]        = useState([]);
  const [input,           setInput]           = useState("");
  const [loading,         setLoading]         = useState(false);

  // null = not selected → backend will use its default (child / medium)
  const [ageGroup,        setAgeGroup]        = useState(null);
  const [storyLength,     setStoryLength]     = useState(null);

  const [selectedVirtue,  setSelectedVirtue]  = useState(null);
  const [showOtherVirtue, setShowOtherVirtue] = useState(false);
  const [otherVirtue,     setOtherVirtue]     = useState("");

  // ── UI state ──────────────────────────────────────────────
  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [menuOpen,      setMenuOpen]      = useState(false);
  const [hoveredId,     setHoveredId]     = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [darkMode,      setDarkMode]      = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);
  const otherVirtueRef = useRef(null);

  // ── apply dark mode via data-theme attribute ───────────────
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // ── auto-scroll to latest message ─────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ── focus custom-virtue input when it opens ───────────────
  useEffect(() => {
    if (showOtherVirtue) setTimeout(() => otherVirtueRef.current?.focus(), 60);
  }, [showOtherVirtue]);

  const isAnnotator = user?.role === "annotator" || user?.role === "ANNOTATOR";
  const isAdmin     = user?.role === "admin"     || user?.role === "ADMIN";

  // ── load session list ──────────────────────────────────────
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await getSessions({ limit: 100 });
      setSessions(data.sessions || []);
    } catch (e) {
      console.error("Sessions load failed:", e);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── new chat ───────────────────────────────────────────────
  const startNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    setAgeGroup(null);
    setStoryLength(null);
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  // ── open a past session ────────────────────────────────────
  const openSession = async (sessionId) => {
    if (sessionId === activeSessionId) { setSidebarOpen(false); return; }
    try {
      const data = await getSessionMessages(sessionId);
      setActiveSessionId(sessionId);
      setMessages(data.messages || []);
      // restore selections if session had them, otherwise clear to null
      setAgeGroup(data.age_group || null);
      setStoryLength(data.story_length || null);
      setSidebarOpen(false);
    } catch (e) {
      console.error("Load session failed:", e);
    }
  };

  // ── toggle chip helpers (click again to deselect) ─────────
  const toggleAgeGroup = (val) => setAgeGroup(prev => prev === val ? null : val);
  const toggleStoryLength = (val) => setStoryLength(prev => prev === val ? null : val);

  // ── send message ───────────────────────────────────────────
  const sendMessage = async (overrideInput) => {
    const text = (overrideInput || input).trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);

    const sid = activeSessionId || (() => {
      const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      setActiveSessionId(id);
      return id;
    })();

    try {
      const res = await sendQuery({
        // send null → backend schema default kicks in (child / medium)
        age_group:       ageGroup || "child",
        genre_or_virtue: text,
        story_length:    storyLength || "medium",
        other_notes:     "",
        session_id:      sid,
      });
      const storyText = res.generated_story || res.story || "No story returned.";
      setMessages((prev) => [...prev, { role: "bot", story: storyText, moral: res.moral || "" }]);
      loadSessions();
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

  // ── virtue chip handlers ───────────────────────────────────
  const handleVirtueClick = (virtue) => {
    if (selectedVirtue === virtue) {
      setSelectedVirtue(null);
      setInput("");
    } else {
      setSelectedVirtue(virtue);
      setShowOtherVirtue(false);
      setOtherVirtue("");
      setInput(`A story about ${virtue}`);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  };

  const handleOtherClick = () => {
    const next = !showOtherVirtue;
    setShowOtherVirtue(next);
    setSelectedVirtue(null);
    if (!next) { setOtherVirtue(""); setInput(""); }
  };

  const handleOtherVirtueConfirm = () => {
    if (otherVirtue.trim()) {
      setInput(`A story about ${otherVirtue.trim()}`);
      setShowOtherVirtue(false);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  };

  // ── delete session ─────────────────────────────────────────
  const handleDeleteSession = async (e, sessionId) => {
    e.stopPropagation();
    if (deleteConfirm !== sessionId) { setDeleteConfirm(sessionId); return; }
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      if (activeSessionId === sessionId) startNewChat();
    } catch (err) { console.error("Delete session failed:", err); }
    setDeleteConfirm(null);
  };

  // ── clear all ──────────────────────────────────────────────
  const handleClearAll = async () => {
    if (!window.confirm("Delete all chat history?")) return;
    try {
      await clearAllHistory();
      setSessions([]);
      startNewChat();
    } catch (err) { console.error("Clear all failed:", err); }
  };

  // ── logout ─────────────────────────────────────────────────
  const handleLogout = async () => { await logout(); setUser(null); navigate("/"); };

  const grouped = groupSessions(sessions);

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="chatbot-root">

      {/* ── Navbar ── */}
      <nav className="navbar">
        <Link to="/" className="navbar-brand">
          Story<span>Nest</span>
        </Link>
        <div className="nav-links">
          <Link className="nav-link" to="/">Home</Link>
          <Link className="nav-link active" to="/chatbot">Chatbot</Link>
          {(isAnnotator || isAdmin) && <Link className="nav-link" to="/annotator">Annotator</Link>}
        </div>
        <div className="nav-actions">
          {user && <span className="nav-username">👋 {user.username}</span>}
          <button className="secondary-btn" style={{ padding: "7px 14px", fontSize: 13 }} onClick={handleLogout}>
            Logout
          </button>
        </div>
        <button className={`hamburger ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(!menuOpen)}>
          <span /><span /><span />
        </button>
      </nav>

      {/* ── Mobile nav menu ── */}
      <div className={`mobile-menu ${menuOpen ? "open" : ""}`}>
        <Link className="nav-link" to="/" onClick={() => setMenuOpen(false)}>Home</Link>
        <Link className="nav-link active" to="/chatbot" onClick={() => setMenuOpen(false)}>Chatbot</Link>
        {(isAnnotator || isAdmin) && (
          <Link className="nav-link" to="/annotator" onClick={() => setMenuOpen(false)}>Annotator</Link>
        )}
        <div className="nav-divider" />
        <button className="nav-link danger-link" onClick={handleLogout}>Logout</button>
      </div>

      {/* ── Chat layout ── */}
      <div className="chat-layout">

        {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

        {/* ════════════ SIDEBAR ════════════ */}
        <aside className={`chat-sidebar ${sidebarOpen ? "mobile-open" : ""}`}>

          <div className="sidebar-label-row">
            <span className="sidebar-label">My Chats</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button onClick={startNewChat} title="New chat" className="clear-all-btn new-chat-icon-btn">
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              {sessions.length > 0 && (
                <button onClick={handleClearAll} title="Clear all chats" className="clear-all-btn">
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="sidebar-session-list">
            {sessionsLoading ? (
              <div className="sidebar-loading">
                <div className="sidebar-spinner" />
                <p>Loading chats…</p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="sidebar-empty">
                <div className="sidebar-empty-icon">💬</div>
                <p>No chats yet.<br />Start one below!</p>
              </div>
            ) : (
              grouped.map(({ label, items }) => (
                <div key={label}>
                  <p className="session-group-label">{label}</p>
                  {items.map((s) => {
                    const isActive  = activeSessionId === s.session_id;
                    const isHovered = hoveredId === s.session_id;
                    const isPending = deleteConfirm === s.session_id;
                    return (
                      <div
                        key={s.session_id}
                        onClick={() => openSession(s.session_id)}
                        onMouseEnter={() => setHoveredId(s.session_id)}
                        onMouseLeave={() => { setHoveredId(null); setDeleteConfirm(null); }}
                        className={`session-item ${isActive ? "active" : ""} ${isHovered ? "hovered" : ""}`}
                      >
                        <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                          stroke={isActive ? "var(--primary)" : "var(--text-3)"} strokeWidth={2}
                          style={{ flexShrink: 0 }}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <span className={`session-title ${isActive ? "active" : ""}`}>{s.title}</span>
                        {(isHovered || isActive) && (
                          <button
                            onClick={(e) => handleDeleteSession(e, s.session_id)}
                            title={isPending ? "Click again to confirm" : "Delete chat"}
                            className={`session-delete-btn ${isPending ? "pending" : ""}`}
                          >
                            {isPending ? "Delete?" : (
                              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Settings: Light / Dark mode only */}
          <div className="sidebar-settings">
            <p className="settings-heading">Settings</p>
            <p className="settings-sub">Appearance</p>
            <div className="theme-toggle-row">
              <span className="theme-label">{darkMode ? "🌙 Dark Mode" : "☀️ Light Mode"}</span>
              <button
                className={`toggle-switch ${darkMode ? "on" : ""}`}
                onClick={() => setDarkMode((d) => !d)}
                aria-label="Toggle dark mode"
              >
                <span className="toggle-thumb" />
              </button>
            </div>
          </div>
        </aside>

        {/* ════════════ MAIN CHAT ════════════ */}
        <div className="chat-main">

          {/* Messages — only this section scrolls */}
          <div className="chat-messages">
            {messages.length === 0 && !loading && (
              <div className="chat-empty">
                <div className="empty-icon">📚</div>
                <h3>What story shall we tell?</h3>
                <p>Ask for any moral story — pick a virtue, character, or theme.</p>
                <div className="suggestions-row">
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
                  {m.role === "user" ? (
                    m.text
                  ) : (
                    <>
                      <div className="story-text">{m.story}</div>
                      {m.moral && (
                        <div className="moral"><strong>💡 Moral:</strong> {m.moral}</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-bubble-wrap">
                <div className="chat-avatar bot">🤖</div>
                <div className="chat-bubble bot no-pad">
                  <div className="typing-dot"><span /><span /><span /></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area — always visible at bottom */}
          <div className="chat-input-area">

            {/* Row 1: Age group + Length — optional, click again to deselect */}
            <div className="chat-options">
              <span className="virtue-label">Age:</span>
              {AGE_GROUPS.map((a) => (
                <button
                  key={a}
                  className={`chat-option-chip ${ageGroup === a ? "selected" : ""}`}
                  onClick={() => toggleAgeGroup(a)}
                  title={ageGroup === a ? "Click to deselect" : ""}
                >
                  {a}
                </button>
              ))}
              <div className="options-divider" />
              <span className="virtue-label">Length:</span>
              {STORY_LENGTHS.map((s) => (
                <button
                  key={s}
                  className={`chat-option-chip ${storyLength === s ? "selected" : ""}`}
                  onClick={() => toggleStoryLength(s)}
                  title={storyLength === s ? "Click to deselect" : ""}
                >
                  {s}
                </button>
              ))}
              {/* hint label when nothing selected */}
              {(!ageGroup || !storyLength) && (
                <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 4, whiteSpace: "nowrap" }}>
                  {!ageGroup && !storyLength
                    ? "(defaults: child · medium)"
                    : !ageGroup
                    ? "(age default: child)"
                    : "(length default: medium)"}
                </span>
              )}
            </div>

            {/* Row 2: Virtues + Other */}
            <div className="chat-options virtue-row">
              <span className="virtue-label">Virtue:</span>
              {VIRTUES.map((v) => (
                <button
                  key={v}
                  className={`chat-option-chip virtue-chip ${selectedVirtue === v ? "selected" : ""}`}
                  onClick={() => handleVirtueClick(v)}
                >
                  {v}
                </button>
              ))}
              <button
                className={`chat-option-chip other-chip ${showOtherVirtue ? "selected" : ""}`}
                onClick={handleOtherClick}
              >
                <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Other
              </button>
              {showOtherVirtue && (
                <div className="other-virtue-inline">
                  <input
                    ref={otherVirtueRef}
                    value={otherVirtue}
                    onChange={(e) => setOtherVirtue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleOtherVirtueConfirm(); } }}
                    placeholder="Type a virtue…"
                    className="other-virtue-input"
                  />
                  <button
                    onClick={handleOtherVirtueConfirm}
                    disabled={!otherVirtue.trim()}
                    className="other-virtue-confirm"
                  >
                    Use
                  </button>
                </div>
              )}
            </div>

            {/* Row 3: Text input + Send */}
            <div className="chat-input-row">
              <input
                ref={inputRef}
                className="field-input"
                placeholder={activeSessionId ? "Ask a follow-up…" : "Ask for any story… e.g. 'A story about courage'"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
              <button
                className="primary-btn send-btn"
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
              >
                {loading ? (
                  <span className="send-loading">
                    {[0, 0.2, 0.4].map((d, i) => (
                      <span key={i} style={{ animationDelay: `${d}s` }} />
                    ))}
                  </span>
                ) : (
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2L15 22l-4-9-9-4 19-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>{/* /chat-main */}
      </div>{/* /chat-layout */}
    </div>
  );
}