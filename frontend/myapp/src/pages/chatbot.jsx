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
  const { user, setUser, darkMode, toggleDarkMode } = useContext(AuthContext);
  const navigate = useNavigate();

  const [sessions,        setSessions]        = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages,        setMessages]        = useState([]);
  const [input,           setInput]           = useState("");
  const [loading,         setLoading]         = useState(false);
  const [ageGroup,        setAgeGroup]        = useState(null);
  const [storyLength,     setStoryLength]     = useState(null);
  const [selectedVirtue,  setSelectedVirtue]  = useState(null);
  const [showOtherVirtue, setShowOtherVirtue] = useState(false);
  const [otherVirtue,     setOtherVirtue]     = useState("");
  const [sidebarOpen,     setSidebarOpen]     = useState(false);
  const [menuOpen,        setMenuOpen]        = useState(false);
  const [hoveredId,       setHoveredId]       = useState(null);
  const [deleteConfirm,   setDeleteConfirm]   = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);
  const otherVirtueRef = useRef(null);

  const D = {
    bg: "#13111f", surface: "#1e1b2e", surface2: "#252238", border: "#2e2a45",
    text: "#f0eeff", text2: "#b0acd0", text3: "#6e6a90",
    primary: "#5b4fcf", primaryLight: "#2a2450", primaryText: "#c4b8ff", accent: "#2d1f10",
  };
  const L = {
    bg: "#f5f4ff", surface: "#ffffff", surface2: "#faf9ff", border: "#e4e1f5",
    text: "#1a1633", text2: "#5c5880", text3: "#9491b0",
    primary: "#5b4fcf", primaryLight: "#ede9ff", primaryText: "#5b4fcf", accent: "#fff3e8",
  };
  const C = darkMode ? D : L;

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { if (showOtherVirtue) setTimeout(() => otherVirtueRef.current?.focus(), 60); }, [showOtherVirtue]);

  const isAnnotator = user?.role === "annotator" || user?.role === "ANNOTATOR";
  const isAdmin     = user?.role === "admin"     || user?.role === "ADMIN";

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await getSessions({ limit: 100 });
      setSessions(data.sessions || []);
    } catch (e) { console.error("Sessions load failed:", e); }
    finally { setSessionsLoading(false); }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const startNewChat = () => {
    setActiveSessionId(null); setMessages([]); setInput("");
    setAgeGroup(null); setStoryLength(null); setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const openSession = async (sessionId) => {
    if (sessionId === activeSessionId) { setSidebarOpen(false); return; }
    try {
      const data = await getSessionMessages(sessionId);
      setActiveSessionId(sessionId);
      setMessages(data.messages || []);
      setAgeGroup(data.age_group || null);
      setStoryLength(data.story_length || null);
      setSidebarOpen(false);
    } catch (e) { console.error("Load session failed:", e); }
  };

  const toggleAgeGroup    = (val) => setAgeGroup(prev => prev === val ? null : val);
  const toggleStoryLength = (val) => setStoryLength(prev => prev === val ? null : val);

  const sendMessage = async (overrideInput) => {
    const text = (overrideInput || input).trim();
    if (!text || loading) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);
    const sid = activeSessionId || (() => {
      const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      setActiveSessionId(id); return id;
    })();
    try {
      const res = await sendQuery({ age_group: ageGroup || "child", genre_or_virtue: text, story_length: storyLength || "medium", other_notes: "", session_id: sid });
      setMessages((prev) => [...prev, { role: "bot", story: res.generated_story || res.story || "No story returned.", moral: res.moral || "" }]);
      loadSessions();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const errMsg = Array.isArray(detail) ? detail.map((d) => d.msg).join(", ") : detail || "Something went wrong.";
      setMessages((prev) => [...prev, { role: "bot", story: `⚠️ ${errMsg}`, moral: null }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const handleVirtueClick = (virtue) => {
    if (selectedVirtue === virtue) { setSelectedVirtue(null); setInput(""); }
    else { setSelectedVirtue(virtue); setShowOtherVirtue(false); setOtherVirtue(""); setInput(`A story about ${virtue}`); setTimeout(() => inputRef.current?.focus(), 60); }
  };

  const handleOtherClick = () => {
    const next = !showOtherVirtue; setShowOtherVirtue(next); setSelectedVirtue(null);
    if (!next) { setOtherVirtue(""); setInput(""); }
  };

  const handleOtherVirtueConfirm = () => {
    if (otherVirtue.trim()) { setInput(`A story about ${otherVirtue.trim()}`); setShowOtherVirtue(false); setTimeout(() => inputRef.current?.focus(), 60); }
  };

  const handleDeleteSession = async (e, sessionId) => {
    e.stopPropagation();
    if (deleteConfirm !== sessionId) { setDeleteConfirm(sessionId); return; }
    try { await deleteSession(sessionId); setSessions((prev) => prev.filter((s) => s.session_id !== sessionId)); if (activeSessionId === sessionId) startNewChat(); }
    catch (err) { console.error("Delete session failed:", err); }
    setDeleteConfirm(null);
  };

  const handleClearAll = async () => {
    if (!window.confirm("Delete all chat history?")) return;
    try { await clearAllHistory(); setSessions([]); startNewChat(); }
    catch (err) { console.error("Clear all failed:", err); }
  };

  const handleLogout = async () => { await logout(); setUser(null); navigate("/"); };

  const grouped = groupSessions(sessions);

  const chipStyle = (isSelected) => ({
    fontSize: 12, fontWeight: 500, padding: "5px 12px", borderRadius: 999,
    border: `1px solid ${isSelected ? C.primary : C.border}`,
    background: isSelected ? C.primaryLight : C.surface2,
    color: isSelected ? C.primaryText : C.text2,
    cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
    transition: "all 0.15s", outline: "none",
  });

  const labelStyle = { fontSize: 11, fontWeight: 700, color: C.text3, whiteSpace: "nowrap", marginRight: 2, textTransform: "uppercase", letterSpacing: "0.06em" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", paddingTop: 68, overflow: "hidden", background: C.bg, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }}>

      {/* Navbar */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, height: 68, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", zIndex: 100, background: darkMode ? "rgba(30,27,46,0.97)" : "rgba(255,255,255,0.9)", backdropFilter: "blur(16px)", borderBottom: `1px solid ${C.border}` }}>
        <Link to="/" style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: C.primary, textDecoration: "none" }}>Story<span style={{ color: "#f97316" }}>Nest</span></Link>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[{ to: "/", label: "Home" }, { to: "/chatbot", label: "Chatbot", active: true }, ...(isAnnotator || isAdmin ? [{ to: "/annotator", label: "Annotator" }] : [])].map(({ to, label, active }) => (
            <Link key={to} to={to} style={{ textDecoration: "none", color: active ? C.primary : C.text2, fontSize: 14, fontWeight: active ? 600 : 500, padding: "7px 14px", borderRadius: 999, background: active ? C.primaryLight : "transparent" }}>{label}</Link>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {user && <span style={{ fontSize: 13, color: C.text2 }}>👋 {user.username}</span>}
          <button onClick={handleLogout} style={{ display: "inline-flex", alignItems: "center", padding: "7px 14px", fontSize: 13, background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>Logout</button>
        </div>
      </nav>

      {/* Chat layout */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 89 }} />}

        {/* Sidebar */}
        <aside style={{ width: 280, borderRight: `1px solid ${C.border}`, background: C.surface, display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px 6px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: C.text3 }}>My Chats</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button onClick={startNewChat} title="New chat" style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 4, borderRadius: 4, display: "flex" }}>
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              </button>
              {sessions.length > 0 && (
                <button onClick={handleClearAll} title="Clear all" style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 4, borderRadius: 4, display: "flex" }}>
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              )}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
            {sessionsLoading ? (
              <div style={{ padding: 20, textAlign: "center" }}>
                <div style={{ width: 20, height: 20, margin: "0 auto 8px", border: `2px solid ${C.border}`, borderTopColor: C.primary, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                <p style={{ fontSize: 12, color: C.text3 }}>Loading chats…</p>
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: "32px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
                <p style={{ fontSize: 12, color: C.text3, lineHeight: 1.5 }}>No chats yet.<br />Start one below!</p>
              </div>
            ) : grouped.map(({ label, items }) => (
              <div key={label}>
                <p style={{ fontSize: 10, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.08em", padding: "10px 8px 4px", margin: 0 }}>{label}</p>
                {items.map((s) => {
                  const isActive  = activeSessionId === s.session_id;
                  const isHovered = hoveredId === s.session_id;
                  const isPending = deleteConfirm === s.session_id;
                  return (
                    <div key={s.session_id} onClick={() => openSession(s.session_id)} onMouseEnter={() => setHoveredId(s.session_id)} onMouseLeave={() => { setHoveredId(null); setDeleteConfirm(null); }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 2, background: isActive ? C.primaryLight : isHovered ? (darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)") : "transparent", border: `1px solid ${isActive ? "rgba(91,79,207,0.35)" : "transparent"}`, transition: "all 0.12s" }}>
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke={isActive ? C.primaryText : C.text3} strokeWidth={2} style={{ flexShrink: 0 }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? C.primaryText : C.text2 }}>{s.title}</span>
                      {(isHovered || isActive) && (
                        <button onClick={(e) => handleDeleteSession(e, s.session_id)} style={{ flexShrink: 0, background: isPending ? "#e53e3e" : "none", border: "none", cursor: "pointer", padding: "2px 5px", borderRadius: 5, color: isPending ? "white" : C.text3, fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center" }}>
                          {isPending ? "Delete?" : <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Settings — dark mode toggle uses shared context */}
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 14px 16px", flexShrink: 0, background: C.surface }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10 }}>Settings</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: C.text3, marginBottom: 8 }}>Appearance</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.text2 }}>{darkMode ? "🌙 Dark Mode" : "☀️ Light Mode"}</span>
              <button onClick={toggleDarkMode} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: darkMode ? C.primary : C.border, position: "relative", transition: "background 0.2s", flexShrink: 0, padding: 0 }}>
                <span style={{ position: "absolute", top: 3, left: darkMode ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.18)", display: "block" }} />
              </button>
            </div>
          </div>
        </aside>

        {/* Main chat */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20, background: C.bg }}>
            {messages.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: "60px 24px", color: C.text3 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📚</div>
                <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: C.text2, marginBottom: 8 }}>What story shall we tell?</h3>
                <p style={{ fontSize: 14 }}>Ask for any moral story — pick a virtue, character, or theme.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 20 }}>
                  {SUGGESTIONS.map((s) => <button key={s} onClick={() => sendMessage(s)} style={chipStyle(false)}>{s}</button>)}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 10, maxWidth: 780, width: "100%", flexDirection: m.role === "user" ? "row-reverse" : "row", marginLeft: m.role === "user" ? "auto" : 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, background: m.role === "bot" ? C.primaryLight : C.accent }}>{m.role === "bot" ? "🤖" : "👤"}</div>
                <div style={{ padding: "12px 16px", borderRadius: m.role === "bot" ? "4px 16px 16px 16px" : "16px 4px 16px 16px", fontSize: 14, lineHeight: 1.65, maxWidth: "calc(100% - 50px)", background: m.role === "bot" ? C.surface : C.primary, border: m.role === "bot" ? `1px solid ${C.border}` : "none", color: m.role === "bot" ? C.text : "white" }}>
                  {m.role === "user" ? m.text : (
                    <>
                      <div style={{ fontFamily: "Georgia, serif", lineHeight: 1.75 }}>{m.story}</div>
                      {m.moral && <div style={{ marginTop: 10, padding: "8px 12px", background: darkMode ? "rgba(91,79,207,0.2)" : "rgba(91,79,207,0.07)", borderRadius: 8, fontSize: 13, fontWeight: 500, color: C.primaryText, borderLeft: `3px solid ${C.primary}` }}><strong>💡 Moral:</strong> {m.moral}</div>}
                    </>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, background: C.primaryLight }}>🤖</div>
                <div style={{ padding: "12px 16px", borderRadius: "4px 16px 16px 16px", background: C.surface, border: `1px solid ${C.border}` }}>
                  <div className="typing-dot"><span /><span /><span /></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div style={{ padding: "14px 24px 16px", background: C.surface, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={labelStyle}>Age:</span>
              {AGE_GROUPS.map((a) => <button key={a} onClick={() => toggleAgeGroup(a)} style={chipStyle(ageGroup === a)}>{a}</button>)}
              <div style={{ width: 1, height: 18, background: C.border, margin: "0 2px", flexShrink: 0 }} />
              <span style={labelStyle}>Length:</span>
              {STORY_LENGTHS.map((s) => <button key={s} onClick={() => toggleStoryLength(s)} style={chipStyle(storyLength === s)}>{s}</button>)}
              {(!ageGroup || !storyLength) && <span style={{ fontSize: 11, color: C.text3, marginLeft: 4, whiteSpace: "nowrap" }}>{!ageGroup && !storyLength ? "(defaults: child · medium)" : !ageGroup ? "(age default: child)" : "(length default: medium)"}</span>}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={labelStyle}>Virtue:</span>
              {VIRTUES.map((v) => <button key={v} onClick={() => handleVirtueClick(v)} style={chipStyle(selectedVirtue === v)}>{v}</button>)}
              <button onClick={handleOtherClick} style={{ ...chipStyle(showOtherVirtue), display: "inline-flex", alignItems: "center", gap: 4 }}>
                <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Other
              </button>
              {showOtherVirtue && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 160 }}>
                  <input ref={otherVirtueRef} value={otherVirtue} onChange={(e) => setOtherVirtue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleOtherVirtueConfirm(); } }} placeholder="Type a virtue…" style={{ flex: 1, padding: "4px 10px", borderRadius: 999, border: `1px solid ${C.primary}`, outline: "none", fontSize: 12, fontFamily: "inherit", background: C.primaryLight, color: C.primaryText }} />
                  <button onClick={handleOtherVirtueConfirm} disabled={!otherVirtue.trim()} style={{ padding: "4px 12px", borderRadius: 999, border: "none", background: C.primary, color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: otherVirtue.trim() ? 1 : 0.45 }}>Use</button>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <input ref={inputRef} style={{ flex: 1, border: `1.5px solid ${C.border}`, outline: "none", padding: "12px 16px", borderRadius: 12, fontSize: 14, fontFamily: "inherit", color: C.text, background: C.surface2, transition: "border-color 0.18s" }} placeholder={activeSessionId ? "Ask a follow-up…" : "Ask for any story… e.g. 'A story about courage'"} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={loading} />
              <button onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{ flexShrink: 0, padding: "11px 20px", background: C.primary, color: "white", border: "none", borderRadius: 999, cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.6 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {loading ? <span style={{ display: "inline-flex", gap: 4 }}>{[0, 0.2, 0.4].map((d, i) => <span key={i} style={{ width: 5, height: 5, background: "white", borderRadius: "50%", animation: "bounce 1.2s infinite", animationDelay: `${d}s`, display: "block" }} />)}</span>
                  : <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2L15 22l-4-9-9-4 19-7z" /></svg>}
              </button>
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}`}</style>
    </div>
  );
}