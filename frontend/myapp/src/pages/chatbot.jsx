// import {useState} from "react"
// import {sendQuery} from "../services/chatbotService"

// export default function Chatbot(){

// const [messages,setMessages] = useState([])
// const [input,setInput] = useState("")

// const sendMessage = async()=>{

// if(!input.trim()) return

// const userMessage = {role:"user",text:input}

// setMessages(prev=>[...prev,userMessage])

// const res = await sendQuery({
// age_group:"child",
// genre_or_virtue:input,
// story_length:"medium",
// other_notes:""
// })

// const botMessage = {
// role:"bot",
// text:`${res.generated_story}\n\nMoral: ${res.moral}`
// }

// setMessages(prev=>[...prev,botMessage])

// setInput("")
// }

// return(

// <div className="hero">

// <div className="card" style={{padding:"30px",maxWidth:"800px",margin:"auto"}}>

// <h2>Story Chatbot</h2>

// <div style={{marginTop:"20px"}}>

// {messages.map((m,i)=>(
// <div key={i} style={{marginBottom:"12px"}}>
// <strong>{m.role}:</strong> {m.text}
// </div>
// ))}

// </div>

// <div style={{display:"flex",gap:"10px",marginTop:"20px"}}>

// <input
// className="field-input"
// placeholder="Ask for a story..."
// value={input}
// onChange={(e)=>setInput(e.target.value)}
// />

// <button
// className="primary-btn"
// onClick={sendMessage}
// >
// Send
// </button>

// </div>

// </div>

// </div>

// )

// }

import { useState, useRef, useEffect, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { sendQuery } from "../services/chatbotService";
import { AuthContext } from "../context/AuthContext";
import { logout } from "../services/authService";

const AGE_GROUPS = ["child", "teen", "adult"];
const STORY_LENGTHS = ["short", "medium", "long"];
const SUGGESTIONS = [
  "A story about honesty",
  "Courage for a child",
  "Kindness and friendship",
  "Perseverance in hard times",
];

export default function Chatbot() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ageGroup, setAgeGroup] = useState("child");
  const [storyLength, setStoryLength] = useState("medium");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionHistory, setSessionHistory] = useState([]);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Backend role is lowercase
  const isAnnotator = user?.role === "annotator" || user?.role === "ANNOTATOR";
  const isAdmin     = user?.role === "admin"     || user?.role === "ADMIN";

  const sendMessage = async (overrideInput) => {
    const text = (overrideInput || input).trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);
    setSessionHistory((prev) => [{ id: Date.now(), label: text.slice(0, 36) }, ...prev.slice(0, 9)]);

    try {
      const res = await sendQuery({
        age_group: ageGroup,
        genre_or_virtue: text,
        story_length: storyLength,
        other_notes: "",
      });

      // ml_service returns { story, moral, title, retrieved_story_id, processing_time_ms }
      // ChatbotResponse schema aliases "story" → "generated_story"
      // Handle both keys defensively
      const storyText = res.generated_story || res.story || "No story returned.";
      const moral     = res.moral || "";

      setMessages((prev) => [...prev, { role: "bot", story: storyText, moral }]);
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

  const handleLogout = async () => {
    await logout();
    setUser(null);
    navigate("/");
  };

  const clearChat = () => setMessages([]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" }}>

      {/* Navbar */}
      <nav className="navbar">
        <Link to="/" className="navbar-brand">Story<span style={{color:"#f97316"}}>Nest</span></Link>
        <div className="nav-links">
          <Link className="nav-link" to="/">Home</Link>
          <Link className="nav-link active" to="/chatbot">Chatbot</Link>
          {(isAnnotator || isAdmin) && (
            <Link className="nav-link" to="/annotator">Annotator</Link>
          )}
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

      {/* Mobile menu */}
      <div className={`mobile-menu ${menuOpen ? "open" : ""}`}>
        <Link className="nav-link" to="/" onClick={() => setMenuOpen(false)}>Home</Link>
        <Link className="nav-link active" to="/chatbot" onClick={() => setMenuOpen(false)}>Chatbot</Link>
        {(isAnnotator || isAdmin) && (
          <Link className="nav-link" to="/annotator" onClick={() => setMenuOpen(false)}>Annotator</Link>
        )}
        <div className="nav-divider" />
        <button
          className="nav-link"
          style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "var(--danger)" }}
          onClick={handleLogout}
        >Logout</button>
      </div>

      {/* Chat Layout */}
      <div className="chat-layout" style={{ flex: 1, overflow: "hidden" }}>

        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 89 }} />
        )}

        {/* Sidebar */}
        <aside className={`chat-sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="chat-sidebar-title">History</span>
            <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={clearChat} title="Clear">
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          {sessionHistory.length === 0
            ? <p style={{ fontSize: 12, color: "var(--text-3)", padding: "0 6px" }}>No history yet</p>
            : sessionHistory.map((h) => (
              <div key={h.id} className="chat-history-item">
                <span>💬</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
                  {h.label}
                </span>
              </div>
            ))
          }

          {/* Settings panel */}
          <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <p className="chat-sidebar-title" style={{ marginBottom: 10 }}>Settings</p>

            <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 6 }}>Age Group</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
              {AGE_GROUPS.map((a) => (
                <button key={a} onClick={() => setAgeGroup(a)} style={{
                  padding: "7px 10px", borderRadius: 8, border: "1px solid",
                  borderColor: ageGroup === a ? "var(--primary)" : "var(--border)",
                  background: ageGroup === a ? "var(--primary-light)" : "transparent",
                  color: ageGroup === a ? "var(--primary)" : "var(--text-2)",
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
                  background: storyLength === s ? "var(--primary-light)" : "transparent",
                  color: storyLength === s ? "var(--primary)" : "var(--text-2)",
                  fontSize: 12, fontWeight: storyLength === s ? 600 : 400,
                  cursor: "pointer", textAlign: "left", textTransform: "capitalize",
                  fontFamily: "var(--font-body)"
                }}>{s}</button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="chat-main">
          {/* Top bar */}
          <div className="chat-topbar">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
            <button className="icon-btn" title="Clear chat" onClick={clearChat}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
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

          {/* Input */}
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
                {loading
                  ? <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
                  : <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 768px) { #sidebar-toggle { display: flex !important; } }
      `}</style>
    </div>
  );
}