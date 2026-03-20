// // frontend/myapp/src/pages/chatbot.jsx
// import { useState, useRef, useEffect, useContext, useCallback } from "react";
// import { useNavigate, Link } from "react-router-dom";
// import {
//   sendQuery,
//   getSessions,
//   getSessionMessages,
//   deleteSession,
//   clearAllHistory,
// } from "../services/chatbotService";
// import { AuthContext } from "../context/AuthContext";
// import { logout } from "../services/authService";

// const AGE_GROUPS    = ["child", "teen", "adult"];
// const STORY_LENGTHS = ["short", "medium", "long"];
// const SUGGESTIONS   = [
//   "A story about honesty",
//   "Courage under pressure",
//   "Kindness and friendship",
//   "Perseverance in hard times",
// ];

// // ── date grouping helper ─────────────────────────────────────
// function dateGroup(isoString) {
//   const d     = new Date(isoString);
//   const now   = new Date();
//   const diff  = (now - d) / 86400000; // days
//   if (diff < 1)  return "Today";
//   if (diff < 2)  return "Yesterday";
//   if (diff < 8)  return "Previous 7 Days";
//   if (diff < 31) return "Previous 30 Days";
//   return d.toLocaleString("default", { month: "long", year: "numeric" });
// }

// function groupSessions(sessions) {
//   const groups = {};
//   const order  = [];
//   sessions.forEach((s) => {
//     const g = dateGroup(s.last_updated);
//     if (!groups[g]) { groups[g] = []; order.push(g); }
//     groups[g].push(s);
//   });
//   return order.map((g) => ({ label: g, items: groups[g] }));
// }

// export default function Chatbot() {
//   const { user, setUser } = useContext(AuthContext);
//   const navigate = useNavigate();

//   // ── session / chat state ──────────────────────────────────
//   const [sessions,        setSessions]       = useState([]);   // sidebar list
//   const [sessionsLoading, setSessionsLoading]= useState(false);
//   const [activeSessionId, setActiveSessionId]= useState(null); // currently open session
//   const [messages,        setMessages]       = useState([]);
//   const [input,           setInput]          = useState("");
//   const [loading,         setLoading]        = useState(false);
//   const [ageGroup,        setAgeGroup]       = useState("child");
//   const [storyLength,     setStoryLength]    = useState("medium");

//   // ── UI state ──────────────────────────────────────────────
//   const [sidebarOpen,  setSidebarOpen]  = useState(false);
//   const [menuOpen,     setMenuOpen]     = useState(false);
//   const [hoveredId,    setHoveredId]    = useState(null);
//   const [deleteConfirm,setDeleteConfirm]= useState(null); // session_id pending delete

//   const messagesEndRef = useRef(null);
//   const inputRef       = useRef(null);

//   // ── auto-scroll ────────────────────────────────────────────
//   useEffect(() => {
//     messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
//   }, [messages, loading]);

//   const isAnnotator = user?.role === "annotator" || user?.role === "ANNOTATOR";
//   const isAdmin     = user?.role === "admin"     || user?.role === "ADMIN";

//   // ── load sessions list ─────────────────────────────────────
//   const loadSessions = useCallback(async () => {
//     setSessionsLoading(true);
//     try {
//       const data = await getSessions({ limit: 100 });
//       setSessions(data.sessions || []);
//     } catch (e) {
//       console.error("Sessions load failed:", e);
//     } finally {
//       setSessionsLoading(false);
//     }
//   }, []);

//   useEffect(() => { loadSessions(); }, [loadSessions]);

//   // ── new chat ───────────────────────────────────────────────
//   const startNewChat = () => {
//     setActiveSessionId(null);
//     setMessages([]);
//     setInput("");
//     setSidebarOpen(false);
//     setTimeout(() => inputRef.current?.focus(), 80);
//   };

//   // ── open a past session ────────────────────────────────────
//   const openSession = async (sessionId) => {
//     if (sessionId === activeSessionId) { setSidebarOpen(false); return; }
//     try {
//       const data = await getSessionMessages(sessionId);
//       setActiveSessionId(sessionId);
//       setMessages(data.messages || []);
//       setAgeGroup(data.age_group || "child");
//       setStoryLength(data.story_length || "medium");
//       setSidebarOpen(false);
//     } catch (e) {
//       console.error("Load session failed:", e);
//     }
//   };

//   // ── send message ───────────────────────────────────────────
//   const sendMessage = async (overrideInput) => {
//     const text = (overrideInput || input).trim();
//     if (!text || loading) return;

//     setMessages((prev) => [...prev, { role: "user", text }]);
//     setInput("");
//     setLoading(true);

//     // If this is a new session, generate session_id now so all turns share it
//     const sid = activeSessionId || (() => {
//       const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
//       setActiveSessionId(id);
//       return id;
//     })();

//     try {
//       const res = await sendQuery({
//         age_group:       ageGroup,
//         genre_or_virtue: text,
//         story_length:    storyLength,
//         other_notes:     "",
//         session_id:      sid,
//       });

//       const storyText = res.generated_story || res.story || "No story returned.";
//       setMessages((prev) => [...prev, { role: "bot", story: storyText, moral: res.moral || "" }]);

//       // Refresh sidebar so the new/updated session appears
//       loadSessions();
//     } catch (err) {
//       const detail = err?.response?.data?.detail;
//       const errMsg = Array.isArray(detail)
//         ? detail.map((d) => d.msg).join(", ")
//         : detail || "Something went wrong. Please try again.";
//       setMessages((prev) => [...prev, { role: "bot", story: `⚠️ ${errMsg}`, moral: null }]);
//     } finally {
//       setLoading(false);
//       setTimeout(() => inputRef.current?.focus(), 100);
//     }
//   };

//   const handleKeyDown = (e) => {
//     if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
//   };

//   // ── delete session ─────────────────────────────────────────
//   const handleDeleteSession = async (e, sessionId) => {
//     e.stopPropagation();
//     if (deleteConfirm !== sessionId) { setDeleteConfirm(sessionId); return; }
//     try {
//       await deleteSession(sessionId);
//       setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
//       if (activeSessionId === sessionId) startNewChat();
//     } catch (err) { console.error("Delete session failed:", err); }
//     setDeleteConfirm(null);
//   };

//   // ── clear all ──────────────────────────────────────────────
//   const handleClearAll = async () => {
//     if (!window.confirm("Delete all chat history?")) return;
//     try {
//       await clearAllHistory();
//       setSessions([]);
//       startNewChat();
//     } catch (err) { console.error("Clear all failed:", err); }
//   };

//   // ── logout ─────────────────────────────────────────────────
//   const handleLogout = async () => { await logout(); setUser(null); navigate("/"); };

//   const grouped = groupSessions(sessions);

//   // ─────────────────────────────────────────────────────────────
//   // RENDER
//   // ─────────────────────────────────────────────────────────────
//   return (
//     <div style={{
//       display: "flex", flexDirection: "column", height: "100vh",
//       background: "var(--bg)", fontFamily: "var(--font-body)",
//     }}>

//       {/* ── Navbar ── */}
//       <nav className="navbar">
//         <Link to="/" className="navbar-brand">
//           Story<span style={{ color: "#f97316" }}>Nest</span>
//         </Link>
//         <div className="nav-links">
//           <Link className="nav-link" to="/">Home</Link>
//           <Link className="nav-link active" to="/chatbot">Chatbot</Link>
//           {(isAnnotator || isAdmin) && <Link className="nav-link" to="/annotator">Annotator</Link>}
//         </div>
//         <div className="nav-actions">
//           {user && <span style={{ fontSize: 13, color: "var(--text-2)" }}>👋 {user.username}</span>}
//           <button className="secondary-btn" style={{ padding: "7px 14px", fontSize: 13 }} onClick={handleLogout}>
//             Logout
//           </button>
//         </div>
//         <button className={`hamburger ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(!menuOpen)}>
//           <span /><span /><span />
//         </button>
//       </nav>

//       {/* ── Mobile nav menu ── */}
//       <div className={`mobile-menu ${menuOpen ? "open" : ""}`}>
//         <Link className="nav-link" to="/" onClick={() => setMenuOpen(false)}>Home</Link>
//         <Link className="nav-link active" to="/chatbot" onClick={() => setMenuOpen(false)}>Chatbot</Link>
//         {(isAnnotator || isAdmin) && (
//           <Link className="nav-link" to="/annotator" onClick={() => setMenuOpen(false)}>Annotator</Link>
//         )}
//         <div className="nav-divider" />
//         <button className="nav-link" style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "var(--danger)" }} onClick={handleLogout}>
//           Logout
//         </button>
//       </div>

//       {/* ── Chat layout ── */}
//       <div className="chat-layout" style={{ flex: 1, overflow: "hidden" }}>

//         {/* Mobile sidebar backdrop */}
//         {sidebarOpen && (
//           <div onClick={() => setSidebarOpen(false)}
//             style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 89 }} />
//         )}

//         {/* ════════════════════════════════════════
//             SIDEBAR
//         ════════════════════════════════════════ */}
//         <aside className={`chat-sidebar ${sidebarOpen ? "mobile-open" : ""}`}
//           style={{ display: "flex", flexDirection: "column", gap: 0, padding: 0 }}>

//           {/* Sidebar top: New Chat button */}
//           <div style={{ padding: "16px 12px 10px", borderBottom: "1px solid var(--border)" }}>
//             <button
//               onClick={startNewChat}
//               style={{
//                 width: "100%", display: "flex", alignItems: "center", gap: 10,
//                 padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)",
//                 background: activeSessionId === null ? "var(--primary-light)" : "var(--surface)",
//                 color: activeSessionId === null ? "var(--primary)" : "var(--text-2)",
//                 fontWeight: 600, fontSize: 13, cursor: "pointer",
//                 transition: "all 0.15s", fontFamily: "var(--font-body)",
//               }}
//             >
//               {/* pencil/compose icon */}
//               <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
//                 <path strokeLinecap="round" strokeLinejoin="round"
//                   d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
//               </svg>
//               New Chat
//             </button>
//           </div>

//           {/* Sidebar label + clear all */}
//           <div style={{
//             padding: "10px 14px 6px",
//             display: "flex", alignItems: "center", justifyContent: "space-between",
//           }}>
//             <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-3)" }}>
//               My Chats
//             </span>
//             {sessions.length > 0 && (
//               <button onClick={handleClearAll} title="Clear all chats" style={{
//                 background: "none", border: "none", cursor: "pointer",
//                 color: "var(--text-3)", padding: 4, borderRadius: 4,
//                 display: "flex", alignItems: "center",
//               }}>
//                 <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
//                   <path strokeLinecap="round" strokeLinejoin="round"
//                     d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
//                 </svg>
//               </button>
//             )}
//           </div>

//           {/* Session list */}
//           <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 16px" }}>
//             {sessionsLoading ? (
//               <div style={{ padding: "20px 6px", textAlign: "center" }}>
//                 <div style={{
//                   width: 20, height: 20, margin: "0 auto 8px",
//                   border: "2px solid var(--border)", borderTopColor: "var(--primary)",
//                   borderRadius: "50%", animation: "spin 0.7s linear infinite",
//                 }} />
//                 <p style={{ fontSize: 12, color: "var(--text-3)" }}>Loading chats…</p>
//               </div>
//             ) : sessions.length === 0 ? (
//               <div style={{ padding: "32px 10px", textAlign: "center" }}>
//                 <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
//                 <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>
//                   No chats yet.<br />Start one below!
//                 </p>
//               </div>
//             ) : (
//               grouped.map(({ label, items }) => (
//                 <div key={label}>
//                   {/* Date group label */}
//                   <p style={{
//                     fontSize: 10, fontWeight: 700, color: "var(--text-3)",
//                     textTransform: "uppercase", letterSpacing: "0.08em",
//                     padding: "10px 8px 4px", margin: 0,
//                   }}>{label}</p>

//                   {items.map((s) => {
//                     const isActive  = activeSessionId === s.session_id;
//                     const isHovered = hoveredId === s.session_id;
//                     const isPending = deleteConfirm === s.session_id;

//                     return (
//                       <div
//                         key={s.session_id}
//                         onClick={() => openSession(s.session_id)}
//                         onMouseEnter={() => setHoveredId(s.session_id)}
//                         onMouseLeave={() => { setHoveredId(null); setDeleteConfirm(null); }}
//                         style={{
//                           display: "flex", alignItems: "center", gap: 8,
//                           padding: "9px 10px", borderRadius: 8, cursor: "pointer",
//                           marginBottom: 2,
//                           background: isActive ? "var(--primary-light)" : isHovered ? "rgba(0,0,0,0.04)" : "transparent",
//                           border: isActive ? "1px solid rgba(91,79,207,0.25)" : "1px solid transparent",
//                           transition: "all 0.12s",
//                         }}
//                       >
//                         {/* chat bubble icon */}
//                         <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
//                           stroke={isActive ? "var(--primary)" : "var(--text-3)"} strokeWidth={2}
//                           style={{ flexShrink: 0 }}>
//                           <path strokeLinecap="round" strokeLinejoin="round"
//                             d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
//                         </svg>

//                         {/* Title */}
//                         <span style={{
//                           flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
//                           fontSize: 13, fontWeight: isActive ? 600 : 400,
//                           color: isActive ? "var(--primary)" : "var(--text)",
//                         }}>
//                           {s.title}
//                         </span>

//                         {/* Delete button — shows on hover */}
//                         {(isHovered || isActive) && (
//                           <button
//                             onClick={(e) => handleDeleteSession(e, s.session_id)}
//                             title={isPending ? "Click again to confirm" : "Delete chat"}
//                             style={{
//                               flexShrink: 0, background: isPending ? "var(--danger)" : "none",
//                               border: "none", cursor: "pointer", padding: "2px 5px", borderRadius: 5,
//                               color: isPending ? "white" : "var(--text-3)",
//                               fontSize: 10, fontWeight: 600,
//                               display: "flex", alignItems: "center", gap: 3,
//                             }}
//                           >
//                             {isPending ? (
//                               "Delete?"
//                             ) : (
//                               <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
//                                 <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
//                               </svg>
//                             )}
//                           </button>
//                         )}
//                       </div>
//                     );
//                   })}
//                 </div>
//               ))
//             )}
//           </div>

//           {/* Settings panel at bottom */}
//           <div style={{ borderTop: "1px solid var(--border)", padding: "14px 14px 16px" }}>
//             <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10 }}>
//               Settings
//             </p>

//             <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 5 }}>Age Group</p>
//             <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
//               {AGE_GROUPS.map((a) => (
//                 <button key={a} onClick={() => setAgeGroup(a)} style={{
//                   flex: 1, padding: "6px 4px", borderRadius: 7, border: "1px solid",
//                   borderColor: ageGroup === a ? "var(--primary)" : "var(--border)",
//                   background: ageGroup === a ? "var(--primary-light)" : "transparent",
//                   color: ageGroup === a ? "var(--primary)" : "var(--text-2)",
//                   fontSize: 11, fontWeight: ageGroup === a ? 700 : 400,
//                   cursor: "pointer", textTransform: "capitalize", fontFamily: "var(--font-body)",
//                 }}>{a}</button>
//               ))}
//             </div>

//             <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 5 }}>Length</p>
//             <div style={{ display: "flex", gap: 4 }}>
//               {STORY_LENGTHS.map((s) => (
//                 <button key={s} onClick={() => setStoryLength(s)} style={{
//                   flex: 1, padding: "6px 4px", borderRadius: 7, border: "1px solid",
//                   borderColor: storyLength === s ? "var(--primary)" : "var(--border)",
//                   background: storyLength === s ? "var(--primary-light)" : "transparent",
//                   color: storyLength === s ? "var(--primary)" : "var(--text-2)",
//                   fontSize: 11, fontWeight: storyLength === s ? 700 : 400,
//                   cursor: "pointer", textTransform: "capitalize", fontFamily: "var(--font-body)",
//                 }}>{s}</button>
//               ))}
//             </div>
//           </div>
//         </aside>

//         {/* ════════════════════════════════════════
//             MAIN CHAT AREA
//         ════════════════════════════════════════ */}
//         <div className="chat-main">

//           {/* Topbar */}
//           <div className="chat-topbar">
//             <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
//               {/* Mobile: hamburger to open sidebar */}
//               <button
//                 className="icon-btn"
//                 id="sidebar-toggle"
//                 onClick={() => setSidebarOpen(!sidebarOpen)}
//                 style={{ display: "none" }}
//               >
//                 <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
//                   <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
//                 </svg>
//               </button>

//               <button className="back-btn" onClick={() => navigate(-1)}>
//                 <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
//                   <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
//                 </svg>
//                 Back
//               </button>

//               <div>
//                 <p style={{ fontWeight: 600, fontSize: 15 }}>
//                   {activeSessionId
//                     ? (sessions.find(s => s.session_id === activeSessionId)?.title || "Chat") 
//                     : "Story Assistant"}
//                 </p>
//                 <p style={{ fontSize: 12, color: "var(--text-3)" }}>{ageGroup} · {storyLength}</p>
//               </div>
//             </div>

//             {/* Topbar: New Chat button */}
//             <button
//               onClick={startNewChat}
//               className="secondary-btn"
//               style={{ fontSize: 12, padding: "7px 14px", display: "flex", alignItems: "center", gap: 6 }}
//             >
//               <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
//                 <path strokeLinecap="round" strokeLinejoin="round"
//                   d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
//               </svg>
//               New Chat
//             </button>
//           </div>

//           {/* Messages area */}
//           <div className="chat-messages">
//             {messages.length === 0 && !loading && (
//               <div className="chat-empty">
//                 <div className="empty-icon">📚</div>
//                 <h3>What story shall we tell?</h3>
//                 <p>Ask for any moral story — pick a virtue, character, or theme.</p>
//                 <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 20 }}>
//                   {SUGGESTIONS.map((s) => (
//                     <button key={s} className="chat-option-chip" onClick={() => sendMessage(s)}>{s}</button>
//                   ))}
//                 </div>
//               </div>
//             )}

//             {messages.map((m, i) => (
//               <div key={i} className={`chat-bubble-wrap ${m.role}`}>
//                 <div className={`chat-avatar ${m.role}`}>{m.role === "bot" ? "🤖" : "👤"}</div>
//                 <div className={`chat-bubble ${m.role}`}>
//                   {m.role === "user" ? (
//                     m.text
//                   ) : (
//                     <>
//                       <div style={{ fontFamily: "'Georgia', serif", lineHeight: 1.75 }}>{m.story}</div>
//                       {m.moral && (
//                         <div className="moral">
//                           <strong>💡 Moral:</strong> {m.moral}
//                         </div>
//                       )}
//                     </>
//                   )}
//                 </div>
//               </div>
//             ))}

//             {loading && (
//               <div className="chat-bubble-wrap">
//                 <div className="chat-avatar bot">🤖</div>
//                 <div className="chat-bubble bot" style={{ padding: 0 }}>
//                   <div className="typing-dot"><span /><span /><span /></div>
//                 </div>
//               </div>
//             )}
//             <div ref={messagesEndRef} />
//           </div>

//           {/* Input area */}
//           <div className="chat-input-area">
//             <div className="chat-options">
//               {AGE_GROUPS.map((a) => (
//                 <button key={a} className={`chat-option-chip ${ageGroup === a ? "selected" : ""}`}
//                   onClick={() => setAgeGroup(a)}>{a}</button>
//               ))}
//               <div style={{ width: 1, background: "var(--border)", margin: "0 4px" }} />
//               {STORY_LENGTHS.map((s) => (
//                 <button key={s} className={`chat-option-chip ${storyLength === s ? "selected" : ""}`}
//                   onClick={() => setStoryLength(s)}>{s}</button>
//               ))}
//             </div>
//             <div className="chat-input-row">
//               <input
//                 ref={inputRef}
//                 className="field-input"
//                 placeholder={activeSessionId ? "Ask a follow-up…" : "Ask for a moral story… e.g. 'A story about courage'"}
//                 value={input}
//                 onChange={(e) => setInput(e.target.value)}
//                 onKeyDown={handleKeyDown}
//                 disabled={loading}
//               />
//               <button
//                 className="primary-btn"
//                 style={{ flexShrink: 0, padding: "11px 20px" }}
//                 onClick={() => sendMessage()}
//                 disabled={loading || !input.trim()}
//               >
//                 {loading ? (
//                   <span style={{ display: "inline-flex", gap: 4 }}>
//                     {[0, 0.2, 0.4].map((d, i) => (
//                       <span key={i} style={{
//                         width: 5, height: 5, background: "white", borderRadius: "50%",
//                         animation: `bounce 1.2s infinite ${d}s`,
//                       }} />
//                     ))}
//                   </span>
//                 ) : (
//                   <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
//                     <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2L15 22l-4-9-9-4 19-7z" />
//                   </svg>
//                 )}
//               </button>
//             </div>
//           </div>
//         </div>{/* /chat-main */}
//       </div>{/* /chat-layout */}

//       {/* Mobile: show sidebar toggle in topbar */}
//       <style>{`
//         @media (max-width: 768px) {
//           #sidebar-toggle { display: flex !important; }
//         }
//         @keyframes spin { to { transform: rotate(360deg); } }
//       `}</style>
//     </div>
//   );
// }
// frontend/myapp/src/pages/chatbot.jsx
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
  const [ageGroup,        setAgeGroup]        = useState("child");
  const [storyLength,     setStoryLength]     = useState("medium");
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
      setAgeGroup(data.age_group || "child");
      setStoryLength(data.story_length || "medium");
      setSidebarOpen(false);
    } catch (e) {
      console.error("Load session failed:", e);
    }
  };

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
        age_group:       ageGroup,
        genre_or_virtue: text,
        story_length:    storyLength,
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

            {/* Row 1: Age group + Length */}
            <div className="chat-options">
              {AGE_GROUPS.map((a) => (
                <button key={a} className={`chat-option-chip ${ageGroup === a ? "selected" : ""}`}
                  onClick={() => setAgeGroup(a)}>{a}</button>
              ))}
              <div className="options-divider" />
              {STORY_LENGTHS.map((s) => (
                <button key={s} className={`chat-option-chip ${storyLength === s ? "selected" : ""}`}
                  onClick={() => setStoryLength(s)}>{s}</button>
              ))}
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