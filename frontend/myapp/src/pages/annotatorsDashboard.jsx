import { useState, useEffect, useRef, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../services/api";
import { logout } from "../services/authService";
import { AuthContext } from "../context/AuthContext";

const AGE_OPTIONS = ["child", "teen", "adult"];

const storiesAPI = {
  getAll:     (params) => api.get("/api/stories/", { params }),
  getStats:   ()       => api.get("/api/stories/stats/summary"),
  create:     (data)   => api.post("/api/stories/", data),
  update:     (id, d)  => api.put(`/api/stories/${id}`, d),
  remove:     (id)     => api.delete(`/api/stories/${id}`),
  bulkDelete: (ids)    => api.post("/api/stories/bulk-delete", ids),
  exportCSV:  (params) => api.get("/api/stories/export/csv", { params, responseType: "blob" }),
  importCSV:  (file)   => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/api/stories/import/csv", fd, { headers: { "Content-Type": "multipart/form-data" } });
  },
};

// Extract unique meaningful words from text (for auto-keyword generation)
function extractKeywords(title, storyText) {
  const stopWords = new Set([
    "the","a","an","and","or","but","in","on","at","to","for","of","is","was","were",
    "be","been","being","have","has","had","do","does","did","will","would","could",
    "should","may","might","shall","can","that","this","these","those","with","from",
    "by","as","it","its","he","she","they","we","you","i","me","him","her","us","them",
    "his","my","your","our","their","so","if","then","than","when","where","who","what",
    "how","all","each","every","both","few","more","most","other","some","such","no",
    "not","only","same","too","very","just","into","up","out","about","after","before",
    "one","two","three","there","here","which","while","although","because","since",
  ]);

  const combined = (title + " " + storyText).toLowerCase();
  const words = combined.match(/\b[a-z]{4,}\b/g) || [];
  const freq = {};
  words.forEach((w) => {
    if (!stopWords.has(w)) freq[w] = (freq[w] || 0) + 1;
  });

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w)
    .join(", ");
}

function Toast({ toasts }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{ background: t.type === "error" ? "#dc2626" : "#16a34a", color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 14, fontFamily: "inherit", boxShadow: "0 4px 20px rgba(0,0,0,0.18)", animation: "slideUp 0.22s ease" }}>{t.msg}</div>
      ))}
    </div>
  );
}

export default function AnnotatorsDashboard() {
  const { user, setUser, darkMode, toggleDarkMode } = useContext(AuthContext);
  const navigate = useNavigate();

  const D = {
    bg: "#13111f", surface: "#1e1b2e", surface2: "#252238", border: "#2e2a45",
    text: "#f0eeff", text2: "#b0acd0", text3: "#6e6a90",
    primary: "#5b4fcf", primaryLight: "#2a2450", primaryText: "#c4b8ff",
  };
  const L = {
    bg: "#f5f4ff", surface: "#ffffff", surface2: "#faf9ff", border: "#e4e1f5",
    text: "#1a1633", text2: "#5c5880", text3: "#9491b0",
    primary: "#5b4fcf", primaryLight: "#ede9ff", primaryText: "#5b4fcf",
  };
  const C = darkMode ? D : L;

  const [stories, setStories]           = useState([]);
  const [total, setTotal]               = useState(0);
  const [stats, setStats]               = useState(null);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [search, setSearch]             = useState("");
  const [ageFilter, setAgeFilter]       = useState("all");
  const [showForm, setShowForm]         = useState(false);
  const [editingStory, setEditing]      = useState(null);
  const [selectedIds, setSelected]      = useState(new Set());
  const [expandedId, setExpanded]       = useState(null);
  const [menuOpen, setMenuOpen]         = useState(false);
  const [navMenuOpen, setNavMenuOpen]   = useState(false);
  const [toasts, setToasts]             = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [formError, setFormError]       = useState("");

  const csvRef      = useRef(null);
  const entityRef   = useRef(null);
  const searchTimer = useRef(null);
  const formRef     = useRef(null);

  const emptyForm = { entity: "", virtues: "", keywords: "", age_group: "", story_text: "" };
  const [form, setForm] = useState(emptyForm);

  const isAnnotator = user?.role === "annotator" || user?.role === "ANNOTATOR";
  const isAdmin     = user?.role === "admin"     || user?.role === "ADMIN";

  const addToast = (msg, type = "success") => {
    const id = Date.now();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  };

  const loadStories = async (searchVal = search, ageVal = ageFilter) => {
    setLoading(true);
    try {
      const params = { limit: 100, skip: 0 };
      if (searchVal.trim()) params.search    = searchVal.trim();
      if (ageVal !== "all") params.age_group = ageVal;
      const res = await storiesAPI.getAll(params);
      setStories(res.data.stories ?? []);
      setTotal(res.data.total     ?? 0);
    } catch { addToast("Failed to load stories", "error"); }
    finally { setLoading(false); }
  };

  const loadStats = async () => {
    try { const res = await storiesAPI.getStats(); setStats(res.data); } catch { /* silent */ }
  };

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadStories(search, ageFilter), 350);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  useEffect(() => { loadStories(search, ageFilter); }, [ageFilter]);
  useEffect(() => { loadStats(); }, [stories.length]);

  // Auto-generate keywords whenever story title or story text changes (only if user hasn't typed keywords)
  const prevAutoRef = useRef("");
  useEffect(() => {
    if (!form.entity && !form.story_text) return;
    const autoGenerated = extractKeywords(form.entity, form.story_text);
    // Only overwrite if keywords field is empty OR contains the previously auto-generated value
    if (!form.keywords || form.keywords === prevAutoRef.current) {
      prevAutoRef.current = autoGenerated;
      setForm((prev) => ({ ...prev, keywords: autoGenerated }));
    }
  }, [form.entity, form.story_text]);

  const openAdd = () => {
    prevAutoRef.current = "";
    setForm(emptyForm); setEditing(null); setFormError(""); setShowForm(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      entityRef.current?.focus();
    }, 80);
  };

  const openEdit = (s) => {
    prevAutoRef.current = s.keywords || "";
    setForm({ entity: s.entity || "", virtues: s.virtues || "", keywords: s.keywords || "", age_group: s.age_group || "", story_text: s.story_text || "" });
    setEditing(s); setFormError(""); setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const closeForm = () => {
    prevAutoRef.current = "";
    setShowForm(false); setEditing(null); setForm(emptyForm); setFormError("");
  };

  const handleSave = async () => {
    if (!form.entity.trim())     { setFormError("Story Title is required."); return; }
    if (!form.story_text.trim()) { setFormError("Story text is required."); return; }
    if (form.story_text.trim().length < 20) { setFormError("Story text must be at least 20 characters."); return; }
    if (!form.keywords.trim())   { setFormError("Keywords are required — they help the AI find this story."); return; }

    setFormError(""); setSaving(true);
    try {
      const payload = {
        entity:     form.entity.trim(),
        virtues:    form.virtues.trim()  || null,
        keywords:   form.keywords.trim(),          // mandatory — never null
        age_group:  form.age_group       || null,
        story_text: form.story_text.trim(),
      };
      if (editingStory) { await storiesAPI.update(editingStory.story_id, payload); addToast("Story updated ✓"); }
      else { await storiesAPI.create(payload); addToast("Story added ✓"); }
      closeForm(); loadStories();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setFormError(Array.isArray(d) ? d.map((x) => x.msg).join(", ") : d || "Failed to save.");
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this story?")) return;
    try { await storiesAPI.remove(id); addToast("Story deleted"); loadStories(); }
    catch { addToast("Delete failed", "error"); }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected stories?`)) return;
    try { await storiesAPI.bulkDelete([...selectedIds]); setSelected(new Set()); addToast(`Deleted ${selectedIds.size} stories`); loadStories(); }
    catch { addToast("Bulk delete failed", "error"); }
  };

  const toggleOne = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(selectedIds.size === stories.length && stories.length > 0 ? new Set() : new Set(stories.map((s) => s.story_id)));

  const handleExport = async () => {
    setMenuOpen(false);
    try {
      const params = {};
      if (ageFilter !== "all") params.age_group = ageFilter;
      const res = await storiesAPI.exportCSV(params);
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "stories.csv" });
      a.click(); URL.revokeObjectURL(url); addToast("CSV exported ✓");
    } catch { addToast("Export failed", "error"); }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setMenuOpen(false);
    try {
      const res = await storiesAPI.importCSV(file);
      setImportResult(res.data); addToast(`Imported ${res.data.imported_count} stories ✓`); loadStories();
    } catch (e) { addToast("Import failed: " + (e?.response?.data?.detail || "Unknown error"), "error"); }
    e.target.value = "";
  };

  const handleLogout = async () => { setMenuOpen(false); setNavMenuOpen(false); await logout(); setUser(null); navigate("/"); };

  const inputStyle = {
    width: "100%", border: `1.5px solid ${C.border}`, outline: "none",
    padding: "10px 12px", borderRadius: 10, fontSize: 14,
    fontFamily: "inherit", background: C.surface, color: C.text,
    transition: "border-color 0.15s",
  };

  const navLinkStyle = (active) => ({
    textDecoration: "none", color: active ? C.primary : C.text2,
    fontSize: 14, fontWeight: active ? 600 : 500,
    padding: "7px 14px", borderRadius: 999,
    background: active ? C.primaryLight : "transparent", fontFamily: "inherit",
  });

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── Navbar ── */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, height: 68, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", zIndex: 100, background: darkMode ? "rgba(30,27,46,0.97)" : "rgba(255,255,255,0.92)", backdropFilter: "blur(16px)", borderBottom: `1px solid ${C.border}` }}>
        <Link to="/" style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: C.primary, textDecoration: "none" }}>
          Story<span style={{ color: "#f97316" }}>Nest</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Link to="/" style={navLinkStyle(false)}>Home</Link>
          <Link to="/chatbot" style={navLinkStyle(false)}>Chatbot</Link>
          {(isAnnotator || isAdmin) && <Link to="/annotator" style={navLinkStyle(true)}>Annotator</Link>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={toggleDarkMode} title="Toggle dark mode" style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", background: darkMode ? C.primary : C.border, position: "relative", transition: "background 0.2s", padding: 0, flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 2, left: darkMode ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>
              {darkMode ? "🌙" : "☀️"}
            </span>
          </button>
          {user && <span style={{ fontSize: 13, color: C.text2 }}>👋 {user.username}</span>}
          <button onClick={handleLogout} style={{ padding: "7px 14px", fontSize: 13, background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>Logout</button>
        </div>
        <button className={`hamburger ${navMenuOpen ? "open" : ""}`} onClick={() => setNavMenuOpen((v) => !v)}>
          <span style={{ background: C.text2 }} /><span style={{ background: C.text2 }} /><span style={{ background: C.text2 }} />
        </button>
      </nav>

      {/* Mobile nav */}
      <div className={`mobile-menu ${navMenuOpen ? "open" : ""}`} style={{ background: darkMode ? "rgba(30,27,46,0.98)" : "rgba(255,255,255,0.97)", borderBottomColor: C.border }}>
        <Link to="/" style={navLinkStyle(false)} onClick={() => setNavMenuOpen(false)}>Home</Link>
        <Link to="/chatbot" style={navLinkStyle(false)} onClick={() => setNavMenuOpen(false)}>Chatbot</Link>
        {(isAnnotator || isAdmin) && <Link to="/annotator" style={navLinkStyle(true)} onClick={() => setNavMenuOpen(false)}>Annotator</Link>}
        <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
        <button onClick={handleLogout} style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "#e53e3e", fontFamily: "inherit", fontSize: 15, padding: "12px 16px" }}>Logout</button>
      </div>

      {/* Page content */}
      <div style={{ paddingTop: 68 }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 16px 40px" }}>

          {/* Top bar */}
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: C.text, margin: 0 }}>Annotators Dashboard</h1>
              <p style={{ fontSize: 13, color: C.text2, marginTop: 2 }}>
                Welcome, <strong>{user?.username || "Annotator"}</strong>
                {stats && <span style={{ marginLeft: 10 }}>· {stats.total_stories} total stories</span>}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {selectedIds.size > 0 && (
                <button onClick={handleBulkDelete} style={{ padding: "7px 14px", fontSize: 13, color: "#dc2626", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>
                  Delete ({selectedIds.size})
                </button>
              )}
              <button onClick={openAdd} style={{ padding: "8px 18px", fontSize: 14, background: C.primary, color: "white", border: "none", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                + Add Story
              </button>
              <div style={{ position: "relative" }}>
                <button onClick={() => setMenuOpen((v) => !v)} style={{ width: 36, height: 36, borderRadius: 10, background: C.surface2, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="5"  r="2" fill={C.text2}/>
                    <circle cx="12" cy="12" r="2" fill={C.text2}/>
                    <circle cx="12" cy="19" r="2" fill={C.text2}/>
                  </svg>
                </button>
                {menuOpen && (
                  <div style={{ position: "absolute", right: 0, top: 42, width: 190, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "8px 0", boxShadow: "0 12px 30px rgba(0,0,0,0.15)", zIndex: 50 }}>
                    <input ref={csvRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleImportFile} />
                    <button onClick={() => { setMenuOpen(false); csvRef.current?.click(); }} style={{ width: "100%", padding: "10px 16px", fontSize: 14, background: "transparent", border: "none", textAlign: "left", cursor: "pointer", color: C.text, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke={C.text2} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                      Import CSV
                    </button>
                    <button onClick={handleExport} style={{ width: "100%", padding: "10px 16px", fontSize: 14, background: "transparent", border: "none", textAlign: "left", cursor: "pointer", color: C.text, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke={C.text2} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      Export CSV ({total})
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {menuOpen && <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />}

          {/* Stats chips */}
          {stats && Object.keys(stats.by_age_group || {}).length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {Object.entries(stats.by_age_group).map(([ag, cnt]) => (
                <span key={ag} onClick={() => setAgeFilter(ag === ageFilter ? "all" : ag)}
                  style={{ borderRadius: 999, padding: "4px 14px", fontSize: 13, fontWeight: 500, background: C.primaryLight, color: C.primaryText, cursor: "pointer", border: `1px solid ${ageFilter === ag ? C.primary : "transparent"}` }}>
                  {ag}: {cnt}
                </span>
              ))}
            </div>
          )}

          {/* Import result banner */}
          {importResult && (
            <div style={{ background: darkMode ? "#0f2d1a" : "#f0fdf4", border: `1px solid ${darkMode ? "#166534" : "#86efac"}`, borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 14, display: "flex", justifyContent: "space-between", alignItems: "center", color: C.text }}>
              <span>✅ Imported <strong>{importResult.imported_count}</strong> · ⚠️ Duplicates <strong>{importResult.duplicate_count}</strong> · ⏭️ Skipped <strong>{importResult.skipped_count}</strong></span>
              <button onClick={() => setImportResult(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.text3 }}>×</button>
            </div>
          )}

          {/* Search + filter toolbar */}
          <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 60%" }}>
              <input style={inputStyle} type="text" placeholder="Search by story title, virtues, keywords, or story text..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div style={{ flex: "0 0 200px" }}>
              <select style={inputStyle} value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)}>
                <option value="all">All Age Groups</option>
                {AGE_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* ── ADD / EDIT FORM ── */}
          {showForm && (
            <div ref={formRef} style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: darkMode ? "0 4px 20px rgba(0,0,0,0.3)" : "0 4px 20px rgba(91,79,207,0.1)", marginBottom: 18, overflow: "hidden" }}>

              {/* Form header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={closeForm}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.border}`, color: C.text2, fontSize: 13, fontWeight: 500, fontFamily: "inherit", padding: "6px 12px", borderRadius: 999, cursor: "pointer", transition: "all 0.18s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.primary; e.currentTarget.style.color = C.primary; e.currentTarget.style.transform = "translateX(-2px)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.text2; e.currentTarget.style.transform = "translateX(0)"; }}>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    Back
                  </button>
                  <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>
                    {editingStory ? "Edit Story" : "Add New Story"}
                  </h2>
                </div>
              </div>

              {/* Form body */}
              <div style={{ padding: "16px 18px 20px" }}>
                {formError && (
                  <div style={{ background: darkMode ? "#2d0a0a" : "#fff5f5", border: "1px solid #fed7d7", color: "#dc2626", fontSize: 13, padding: "10px 14px", borderRadius: 10, marginBottom: 12 }}>
                    ⚠️ {formError}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: 12 }}>

                  {/* ── Story Title (was Entity / Name) ── */}
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: C.text2, display: "block", marginBottom: 6 }}>
                      Story Title <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      style={inputStyle}
                      placeholder="e.g., The Boy Who Cried Wolf"
                      value={form.entity}
                      onChange={(e) => setForm({ ...form, entity: e.target.value })}
                      ref={entityRef}
                    />
                  </div>

                  {/* Age Group */}
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: C.text2, display: "block", marginBottom: 6 }}>Age Group</label>
                    <select style={inputStyle} value={form.age_group} onChange={(e) => setForm({ ...form, age_group: e.target.value })}>
                      <option value="">Select age group...</option>
                      {AGE_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>

                  {/* Virtues */}
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: C.text2, display: "block", marginBottom: 6 }}>Virtue(s)</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g., Honesty, Courage, Compassion"
                      value={form.virtues}
                      onChange={(e) => setForm({ ...form, virtues: e.target.value })}
                    />
                  </div>

                  {/* ── Keywords — mandatory, auto-generated from title + story ── */}
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: C.text2, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      Keywords / Synonyms <span style={{ color: "#dc2626" }}>*</span>
                      <span style={{ fontSize: 10, fontWeight: 500, color: C.text3, background: C.primaryLight, padding: "2px 7px", borderRadius: 999 }}>
                        auto-generated · editable
                      </span>
                    </label>
                    <input
                      style={{
                        ...inputStyle,
                        borderColor: form.keywords.trim() ? C.border : "#f97316",
                      }}
                      placeholder="e.g., truth, integrity, honesty, lying"
                      value={form.keywords}
                      onChange={(e) => {
                        prevAutoRef.current = ""; // user manually typed — stop auto-overwrite
                        setForm({ ...form, keywords: e.target.value });
                      }}
                    />
                    {!form.keywords.trim() && (
                      <p style={{ fontSize: 12, color: "#f97316", marginTop: 4 }}>
                        ⚠️ Keywords are required — they help the AI match user queries to this story.
                      </p>
                    )}
                    {form.keywords.trim() && (
                      <p style={{ fontSize: 11, color: C.text3, marginTop: 4 }}>
                        ✓ You can edit these keywords freely.
                      </p>
                    )}
                  </div>

                  {/* Story Text */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: C.text2, display: "block", marginBottom: 6 }}>
                      Story Text <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <textarea
                      rows={7}
                      style={{ ...inputStyle, resize: "vertical", minHeight: 80, lineHeight: 1.5 }}
                      placeholder="Enter the complete story here..."
                      value={form.story_text}
                      onChange={(e) => setForm({ ...form, story_text: e.target.value })}
                    />
                    <span style={{ fontSize: 12, color: C.text3, marginTop: 4, display: "block" }}>{form.story_text.length} characters</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  <button onClick={handleSave} disabled={saving} style={{ padding: "9px 20px", fontSize: 14, background: C.primary, color: "white", border: "none", borderRadius: 999, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                    {saving ? "Saving…" : editingStory ? "Update Story" : "Save Story"}
                  </button>
                  <button onClick={closeForm} style={{ padding: "9px 20px", fontSize: 14, background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>
                    Cancel
                  </button>
                </div>

                {/* Guidelines */}
                <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface2 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, color: C.text2, margin: "0 0 6px" }}>Guidelines for Annotators</h3>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.text3 }}>
                    <li><strong style={{ color: C.text2 }}>Story Title</strong>, <strong style={{ color: C.text2 }}>Keywords</strong>, and <strong style={{ color: C.text2 }}>Story Text</strong> are required.</li>
                    <li>Keywords are <strong style={{ color: C.text2 }}>auto-generated</strong> from the title and story — review and refine them as needed.</li>
                    <li>Enter multiple virtues separated by commas.</li>
                    <li>Age group must be <strong style={{ color: C.text2 }}>child</strong>, <strong style={{ color: C.text2 }}>teen</strong>, or <strong style={{ color: C.text2 }}>adult</strong>.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ── STORIES LIST ── */}
          <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: darkMode ? "0 4px 20px rgba(0,0,0,0.2)" : "0 4px 20px rgba(91,79,207,0.06)", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>
                Annotated Stories <span style={{ fontSize: 14, fontWeight: 400, color: C.text3 }}>({total})</span>
              </h2>
              {stories.length > 0 && (
                <label style={{ fontSize: 13, color: C.text2, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedIds.size === stories.length} onChange={toggleAll} />
                  Select all
                </label>
              )}
            </div>
            <div style={{ padding: "16px 18px 20px" }}>
              {loading ? (
                <div style={{ textAlign: "center", padding: "40px 10px", color: C.text3 }}>
                  <div style={{ width: 32, height: 32, margin: "0 auto 12px", border: `3px solid ${C.border}`, borderTopColor: C.primary, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                  Loading stories…
                </div>
              ) : stories.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 10px", fontSize: 15, color: C.text3 }}>
                  {search || ageFilter !== "all" ? "No stories match your search or filter." : 'No stories yet. Click "+ Add Story" to get started.'}
                </div>
              ) : stories.map((s) => (
                <div key={s.story_id}
                  style={{ borderRadius: 12, border: `1px solid ${C.border}`, padding: "12px 12px 10px", marginBottom: 10, background: C.surface2, transition: "box-shadow 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = darkMode ? "0 8px 24px rgba(0,0,0,0.3)" : "0 10px 25px rgba(15,23,42,0.12)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = ""; }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1 }}>
                      <input type="checkbox" checked={selectedIds.has(s.story_id)} onChange={() => toggleOne(s.story_id)} style={{ marginTop: 4, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        {/* Story Title displayed here */}
                        <p style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: "0 0 4px" }}>{s.entity}</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {s.age_group && (
                            <span style={{ borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 500, background: darkMode ? "#1a2d4a" : "#dbeafe", color: darkMode ? "#93c5fd" : "#1d4ed8" }}>{s.age_group}</span>
                          )}
                          {s.virtues && s.virtues.split(",").slice(0, 3).map((v, i) => (
                            <span key={i} style={{ borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 500, background: darkMode ? "#2d1a4a" : "#f3e8ff", color: darkMode ? "#c4b5fd" : "#6b21a8" }}>{v.trim()}</span>
                          ))}
                          {s.keywords && s.keywords.split(",").slice(0, 3).map((k, i) => (
                            <span key={i} style={{ borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 500, background: darkMode ? "#0f2d1a" : "#dcfce7", color: darkMode ? "#86efac" : "#15803d" }}>{k.trim()}</span>
                          ))}
                          {!s.keywords && (
                            <span style={{ borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 600, background: "#fff7ed", color: "#f97316", border: "1px solid #fed7aa" }}>
                              ⚠️ No keywords
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>
                          ID #{s.story_id} · {new Date(s.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · {s.story_text?.length ?? 0} chars
                        </p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => setExpanded(expandedId === s.story_id ? null : s.story_id)} style={{ border: "none", background: "transparent", fontSize: 13, padding: "4px 8px", borderRadius: 999, cursor: "pointer", color: C.primary }}>
                        {expandedId === s.story_id ? "▲ Hide" : "▼ Read"}
                      </button>
                      <button onClick={() => openEdit(s)} style={{ border: "none", background: "transparent", fontSize: 13, padding: "4px 8px", borderRadius: 999, cursor: "pointer", color: C.primary }}>Edit</button>
                      <button onClick={() => handleDelete(s.story_id)} style={{ border: "none", background: "transparent", fontSize: 13, padding: "4px 8px", borderRadius: 999, cursor: "pointer", color: "#dc2626" }}>Delete</button>
                    </div>
                  </div>
                  {expandedId === s.story_id && (
                    <div>
                      <hr style={{ margin: "10px 0", border: "none", borderTop: `1px solid ${C.border}` }} />
                      <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.6 }}>{s.story_text}</p>
                      {s.virtues  && <p style={{ fontSize: 13, color: C.text3, marginTop: 6 }}><strong style={{ color: C.text2 }}>Virtues:</strong> {s.virtues}</p>}
                      {s.keywords && <p style={{ fontSize: 13, color: C.text3, marginTop: 2 }}><strong style={{ color: C.text2 }}>Keywords:</strong> {s.keywords}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      <Toast toasts={toasts} />
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}