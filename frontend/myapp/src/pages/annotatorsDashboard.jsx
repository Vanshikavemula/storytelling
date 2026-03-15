import { useState, useEffect, useRef, useContext } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { logout } from "../services/authService";
import { AuthContext } from "../context/AuthContext";
import "../styles/style.css";

const AGE_OPTIONS = ["child", "teen", "adult"];

// ── API helpers (all hit /api/stories/* with JWT from api.js interceptor) ──
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
    return api.post("/api/stories/import/csv", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};

// ── Tiny Toast ────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 999,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: t.type === "error" ? "#dc2626" : "#16a34a",
          color: "#fff", padding: "10px 18px", borderRadius: 12,
          fontSize: 14, fontFamily: "IBM Plex Sans, sans-serif",
          boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
          animation: "slideUp 0.22s ease",
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AnnotatorsDashboard() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [stories, setStories]       = useState([]);
  const [total, setTotal]           = useState(0);
  const [stats, setStats]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [search, setSearch]         = useState("");
  const [ageFilter, setAgeFilter]   = useState("all");
  const [showForm, setShowForm]     = useState(false);
  const [editingStory, setEditing]  = useState(null);
  const [selectedIds, setSelected]  = useState(new Set());
  const [expandedId, setExpanded]   = useState(null);
  const [menuOpen, setMenuOpen]     = useState(false);
  const [toasts, setToasts]         = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [formError, setFormError]   = useState("");

  const csvRef      = useRef(null);
  const entityRef   = useRef(null);
  const searchTimer = useRef(null);

  const emptyForm = { entity: "", virtues: "", keywords: "", age_group: "", story_text: "" };
  const [form, setForm] = useState(emptyForm);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const addToast = (msg, type = "success") => {
    const id = Date.now();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  };

  // ── Load stories ──────────────────────────────────────────────────────────
  const loadStories = async (searchVal = search, ageVal = ageFilter) => {
    setLoading(true);
    try {
      const params = { limit: 100, skip: 0 };
      if (searchVal.trim())    params.search    = searchVal.trim();
      if (ageVal !== "all")    params.age_group = ageVal;
      const res = await storiesAPI.getAll(params);
      setStories(res.data.stories ?? []);
      setTotal(res.data.total   ?? 0);
    } catch {
      addToast("Failed to load stories", "error");
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await storiesAPI.getStats();
      setStats(res.data);
    } catch { /* silent */ }
  };

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadStories(search, ageFilter), 350);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Immediate filter change
  useEffect(() => { loadStories(search, ageFilter); }, [ageFilter]);

  // Stats refresh when list changes
  useEffect(() => { loadStats(); }, [stories.length]);

  // ── Form helpers ──────────────────────────────────────────────────────────
  const openAdd = () => {
    setForm(emptyForm);
    setEditing(null);
    setFormError("");
    setShowForm(true);
    setTimeout(() => entityRef.current?.focus(), 80);
  };

  const openEdit = (s) => {
    setForm({
      entity:     s.entity     || "",
      virtues:    s.virtues    || "",
      keywords:   s.keywords   || "",
      age_group:  s.age_group  || "",
      story_text: s.story_text || "",
    });
    setEditing(s);
    setFormError("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
  };

  const handleSave = async () => {
    if (!form.entity.trim())      { setFormError("Entity / Title is required."); return; }
    if (!form.story_text.trim())  { setFormError("Story text is required.");     return; }
    if (form.story_text.trim().length < 20) {
      setFormError("Story text must be at least 20 characters.");
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const payload = {
        entity:     form.entity.trim(),
        virtues:    form.virtues.trim()   || null,
        keywords:   form.keywords.trim()  || null,
        age_group:  form.age_group        || null,
        story_text: form.story_text.trim(),
      };
      if (editingStory) {
        await storiesAPI.update(editingStory.story_id, payload);
        addToast("Story updated ✓");
      } else {
        await storiesAPI.create(payload);
        addToast("Story added ✓");
      }
      closeForm();
      loadStories();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setFormError(Array.isArray(d) ? d.map((x) => x.msg).join(", ") : d || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this story? This cannot be undone.")) return;
    try {
      await storiesAPI.remove(id);
      addToast("Story deleted");
      loadStories();
    } catch {
      addToast("Delete failed", "error");
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected stories?`)) return;
    try {
      await storiesAPI.bulkDelete([...selectedIds]);
      setSelected(new Set());
      addToast(`Deleted ${selectedIds.size} stories`);
      loadStories();
    } catch {
      addToast("Bulk delete failed", "error");
    }
  };

  // ── Select helpers ────────────────────────────────────────────────────────
  const toggleOne = (id) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () =>
    setSelected(selectedIds.size === stories.length && stories.length > 0
      ? new Set()
      : new Set(stories.map((s) => s.story_id)));

  // ── CSV Export ────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setMenuOpen(false);
    try {
      const params = {};
      if (ageFilter !== "all") params.age_group = ageFilter;
      const res = await storiesAPI.exportCSV(params);
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "stories.csv" });
      a.click();
      URL.revokeObjectURL(url);
      addToast("CSV exported ✓");
    } catch {
      addToast("Export failed", "error");
    }
  };

  // ── CSV Import ────────────────────────────────────────────────────────────
  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setMenuOpen(false);
    try {
      const res = await storiesAPI.importCSV(file);
      setImportResult(res.data);
      addToast(`Imported ${res.data.imported_count} stories ✓`);
      loadStories();
    } catch (e) {
      addToast("Import failed: " + (e?.response?.data?.detail || "Unknown error"), "error");
    }
    e.target.value = "";
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    setUser(null);
    navigate("/");
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-root">
      <div className="app-container">

        {/* ══════════════════ TOP BAR ══════════════════ */}
        <header className="top-bar">
          <div>
            <h1 className="app-title">StoryNest — Annotators Dashboard</h1>
            <p className="app-subtitle">
              Welcome, <strong>{user?.username || "Annotator"}</strong>
              {stats && (
                <span style={{ marginLeft: 10 }}>
                  · {stats.total_stories} total stories
                </span>
              )}
            </p>
          </div>

          <div className="top-bar-actions">
            {/* Bulk delete button — only shows when items are selected */}
            {selectedIds.size > 0 && (
              <button
                className="secondary-btn small"
                style={{ color: "#dc2626" }}
                onClick={handleBulkDelete}
              >
                Delete ({selectedIds.size})
              </button>
            )}

            <button className="primary-btn" onClick={openAdd}>
              + Add Story
            </button>

            {/* ── 3-dot menu ── */}
            <div className="menu-container">
              <button className="menu-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="5"  r="2" fill="#374151"/>
                  <circle cx="12" cy="12" r="2" fill="#374151"/>
                  <circle cx="12" cy="19" r="2" fill="#374151"/>
                </svg>
              </button>

              <div className={`menu-dropdown ${menuOpen ? "" : "dropdown-hidden"}`}>
                {/* hidden file input */}
                <input
                  ref={csvRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleImportFile}
                />

                <button
                  className="dropdown-item"
                  onClick={() => { setMenuOpen(false); csvRef.current?.click(); }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                  </svg>
                  Import CSV
                </button>

                <button className="dropdown-item" onClick={handleExport}>
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                  </svg>
                  Export CSV ({total})
                </button>

                <button className="dropdown-item danger" onClick={handleLogout}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v10"/>
                    <path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>
                  </svg>
                  Logout
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Close menu on outside click */}
        {menuOpen && (
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
        )}

        {/* ══════════════════ STATS CHIPS ══════════════════ */}
        {stats && Object.keys(stats.by_age_group || {}).length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {Object.entries(stats.by_age_group).map(([ag, cnt]) => (
              <span
                key={ag}
                className="chip chip-blue"
                style={{ fontSize: 13, padding: "4px 14px", cursor: "pointer" }}
                onClick={() => setAgeFilter(ag === ageFilter ? "all" : ag)}
              >
                {ag}: {cnt}
              </span>
            ))}
          </div>
        )}

        {/* ══════════════════ IMPORT RESULT BANNER ══════════════════ */}
        {importResult && (
          <div style={{
            background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12,
            padding: "12px 16px", marginBottom: 16, fontSize: 14,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>
              ✅ Imported <strong>{importResult.imported_count}</strong>
              &nbsp;·&nbsp;⚠️ Duplicates <strong>{importResult.duplicate_count}</strong>
              &nbsp;·&nbsp;⏭️ Skipped <strong>{importResult.skipped_count}</strong>
            </span>
            <button
              onClick={() => setImportResult(null)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6b7280" }}
            >×</button>
          </div>
        )}

        {/* ══════════════════ SEARCH + FILTER TOOLBAR ══════════════════ */}
        <section className="toolbar">
          <div className="toolbar-left">
            <input
              className="field-input"
              type="text"
              placeholder="Search by entity, virtues, keywords, or story text..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-right">
            <select
              className="field-input"
              value={ageFilter}
              onChange={(e) => setAgeFilter(e.target.value)}
            >
              <option value="all">All Age Groups</option>
              {AGE_OPTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        </section>

        {/* ══════════════════ ADD / EDIT FORM ══════════════════ */}
        {showForm && (
          <section className="card">
            <div className="card-header">
              <h2 className="card-title" id="form-title">
                {editingStory ? "Edit Story" : "Add New Story"}
              </h2>
              <div className="card-actions">
                <button className="secondary-btn small" onClick={closeForm}>Cancel</button>
              </div>
            </div>

            <div className="card-body">
              {/* Error */}
              {formError && (
                <div className="auth-error" style={{ marginBottom: 12 }}>
                  ⚠️ {formError}
                </div>
              )}

              <div className="grid-2">
                {/* Entity */}
                <div className="form-group">
                  <label className="field-label">
                    Entity / Name <span className="required">*</span>
                  </label>
                  <input
                    ref={entityRef}
                    className="field-input"
                    placeholder="e.g., Abraham Lincoln, Gandhi"
                    value={form.entity}
                    onChange={(e) => setForm({ ...form, entity: e.target.value })}
                  />
                </div>

                {/* Age Group */}
                <div className="form-group">
                  <label className="field-label">Age Group</label>
                  <select
                    className="field-input"
                    value={form.age_group}
                    onChange={(e) => setForm({ ...form, age_group: e.target.value })}
                  >
                    <option value="">Select age group...</option>
                    {AGE_OPTIONS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>

                {/* Virtues */}
                <div className="form-group">
                  <label className="field-label">Virtue(s)</label>
                  <input
                    className="field-input"
                    placeholder="e.g., Honesty, Courage, Compassion"
                    value={form.virtues}
                    onChange={(e) => setForm({ ...form, virtues: e.target.value })}
                  />
                </div>

                {/* Keywords */}
                <div className="form-group">
                  <label className="field-label">Keywords / Synonyms <span className="required">*</span></label>
                  <input
                    className="field-input"
                    placeholder="e.g., truth, integrity, honesty, truthfulness"
                    value={form.keywords}
                    onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  />
                </div>

                {/* Story Text — full width */}
                <div className="form-group full">
                  <label className="field-label">
                    Story Text <span className="required">*</span>
                  </label>
                  <textarea
                    rows={7}
                    className="field-input textarea"
                    placeholder="Enter the complete story here..."
                    value={form.story_text}
                    onChange={(e) => setForm({ ...form, story_text: e.target.value })}
                  />
                  <span style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                    {form.story_text.length} characters
                  </span>
                </div>
              </div>

              <div className="form-actions">
                <button
                  className="primary-btn"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving…" : editingStory ? "Update Story" : "Save Story"}
                </button>
                <button className="secondary-btn" onClick={closeForm}>
                  Cancel
                </button>
              </div>

              {/* Guidelines */}
              <div className="guidelines">
                <h3 className="guidelines-title">Guidelines for Annotators</h3>
                <ul className="guidelines-list">
                  <li><strong>Entity/Name</strong> and <strong>Story Text</strong> are required.</li>
                  <li>Enter multiple virtues or keywords separated by commas.</li>
                  <li>Age group must be <strong>child</strong>, <strong>teen</strong>, or <strong>adult</strong>.</li>
                  <li>Use <strong>Import CSV</strong> to bulk-add rows; <strong>Export CSV</strong> to download your dataset.</li>
                  <li>Keep story texts descriptive but concise for better model training.</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* ══════════════════ STORIES LIST ══════════════════ */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              Annotated Stories&nbsp;
              <span id="stories-count" style={{ fontSize: 14, fontWeight: 400, color: "#6b7280" }}>
                ({total})
              </span>
            </h2>

            {stories.length > 0 && (
              <label style={{
                fontSize: 13, color: "#6b7280",
                display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
              }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === stories.length}
                  onChange={toggleAll}
                />
                Select all
              </label>
            )}
          </div>

          <div className="card-body">
            {/* Loading */}
            {loading ? (
              <div className="empty-state">
                <div style={{
                  width: 32, height: 32, margin: "0 auto 12px",
                  border: "3px solid #e5e7eb", borderTopColor: "#4f46e5",
                  borderRadius: "50%", animation: "spin 0.7s linear infinite",
                }}/>
                Loading stories…
              </div>

            /* Empty */
            ) : stories.length === 0 ? (
              <div className="empty-state">
                {search || ageFilter !== "all"
                  ? "No stories match your search or filter."
                  : 'No stories yet. Click "+ Add Story" to get started.'}
              </div>

            /* Story cards */
            ) : (
              stories.map((s) => (
                <div key={s.story_id} className="story-card">
                  <div className="story-header">

                    {/* Left: checkbox + meta */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.story_id)}
                        onChange={() => toggleOne(s.story_id)}
                        style={{ marginTop: 4, flexShrink: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <p className="story-title">{s.entity}</p>

                        <div className="story-chips">
                          {s.age_group && (
                            <span className="chip chip-blue">{s.age_group}</span>
                          )}
                          {s.virtues && s.virtues.split(",").slice(0, 3).map((v, i) => (
                            <span key={i} className="chip chip-purple">{v.trim()}</span>
                          ))}
                          {s.keywords && s.keywords.split(",").slice(0, 2).map((k, i) => (
                            <span key={i} className="chip chip-green">{k.trim()}</span>
                          ))}
                        </div>

                        <p className="story-meta">
                          ID #{s.story_id}
                          &nbsp;·&nbsp;
                          {new Date(s.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit", month: "short", year: "numeric",
                          })}
                          &nbsp;·&nbsp;
                          {s.story_text?.length ?? 0} chars
                        </p>
                      </div>
                    </div>

                    {/* Right: action buttons */}
                    <div className="story-actions">
                      <button
                        className="btn-ghost"
                        onClick={() => setExpanded(expandedId === s.story_id ? null : s.story_id)}
                      >
                        {expandedId === s.story_id ? "▲ Hide" : "▼ Read"}
                      </button>
                      <button className="btn-ghost" onClick={() => openEdit(s)}>Edit</button>
                      <button className="btn-ghost danger" onClick={() => handleDelete(s.story_id)}>
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Expandable story text */}
                  {expandedId === s.story_id && (
                    <div>
                      <hr style={{ margin: "10px 0", border: "none", borderTop: "1px solid #e5e7eb" }}/>
                      <p className="story-text">{s.story_text}</p>
                      {s.virtues && (
                        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
                          <strong>Virtues:</strong> {s.virtues}
                        </p>
                      )}
                      {s.keywords && (
                        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
                          <strong>Keywords:</strong> {s.keywords}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

      </div>{/* /app-container */}

      <Toast toasts={toasts} />

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}