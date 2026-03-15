import { useState, useEffect, useRef, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../services/api";
import { logout } from "../services/authService";
import { AuthContext } from "../context/AuthContext";
import "../styles/style.css";

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

function Toast({ toasts }) {
  return (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:999, display:"flex", flexDirection:"column", gap:8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type==="error" ? "#dc2626" : "#16a34a",
          color:"#fff", padding:"10px 18px", borderRadius:12,
          fontSize:14, fontFamily:"IBM Plex Sans, sans-serif",
          boxShadow:"0 4px 20px rgba(0,0,0,0.18)", animation:"slideUp 0.22s ease",
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

export default function AnnotatorsDashboard() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const [stories,      setStories]      = useState([]);
  const [total,        setTotal]        = useState(0);
  const [stats,        setStats]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [search,       setSearch]       = useState("");
  const [ageFilter,    setAgeFilter]    = useState("all");
  const [showForm,     setShowForm]     = useState(false);
  const [editingStory, setEditing]      = useState(null);
  const [selectedIds,  setSelected]     = useState(new Set());
  const [expandedId,   setExpanded]     = useState(null);
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [navMenuOpen,  setNavMenuOpen]  = useState(false);
  const [toasts,       setToasts]       = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [formError,    setFormError]    = useState("");

  const csvRef      = useRef(null);
  const entityRef   = useRef(null);
  const searchTimer = useRef(null);

  const emptyForm = { entity:"", virtues:"", keywords:"", age_group:"", story_text:"" };
  const [form, setForm] = useState(emptyForm);

  const isAnnotator = user?.role === "annotator" || user?.role === "ANNOTATOR";
  const isAdmin     = user?.role === "admin"     || user?.role === "ADMIN";

  const addToast = (msg, type="success") => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  };

  const loadStories = async (searchVal=search, ageVal=ageFilter) => {
    setLoading(true);
    try {
      const params = { limit:100, skip:0 };
      if (searchVal.trim())  params.search    = searchVal.trim();
      if (ageVal !== "all")  params.age_group = ageVal;
      const res = await storiesAPI.getAll(params);
      setStories(res.data.stories ?? []);
      setTotal(res.data.total ?? 0);
    } catch { addToast("Failed to load stories", "error"); }
    finally  { setLoading(false); }
  };

  const loadStats = async () => {
    try { const res = await storiesAPI.getStats(); setStats(res.data); } catch {}
  };

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadStories(search, ageFilter), 350);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  useEffect(() => { loadStories(search, ageFilter); }, [ageFilter]);
  useEffect(() => { loadStats(); }, [stories.length]);

  const openAdd = () => {
    setForm(emptyForm); setEditing(null); setFormError(""); setShowForm(true);
    setTimeout(() => entityRef.current?.focus(), 80);
  };
  const openEdit = (s) => {
    setForm({ entity:s.entity||"", virtues:s.virtues||"", keywords:s.keywords||"", age_group:s.age_group||"", story_text:s.story_text||"" });
    setEditing(s); setFormError(""); setShowForm(true);
    window.scrollTo({ top:0, behavior:"smooth" });
  };
  const closeForm = () => { setShowForm(false); setEditing(null); setForm(emptyForm); setFormError(""); };

  const handleSave = async () => {
    if (!form.entity.trim())     { setFormError("Entity / Title is required."); return; }
    if (!form.story_text.trim()) { setFormError("Story text is required.");     return; }
    if (form.story_text.trim().length < 20) { setFormError("Story text must be at least 20 characters."); return; }
    setFormError(""); setSaving(true);
    try {
      const payload = { entity:form.entity.trim(), virtues:form.virtues.trim()||null, keywords:form.keywords.trim()||null, age_group:form.age_group||null, story_text:form.story_text.trim() };
      if (editingStory) { await storiesAPI.update(editingStory.story_id, payload); addToast("Story updated ✓"); }
      else              { await storiesAPI.create(payload);                         addToast("Story added ✓");   }
      closeForm(); loadStories();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setFormError(Array.isArray(d) ? d.map(x=>x.msg).join(", ") : d || "Failed to save.");
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this story?")) return;
    try { await storiesAPI.remove(id); addToast("Story deleted"); loadStories(); }
    catch { addToast("Delete failed","error"); }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected stories?`)) return;
    try { await storiesAPI.bulkDelete([...selectedIds]); setSelected(new Set()); addToast(`Deleted ${selectedIds.size} stories`); loadStories(); }
    catch { addToast("Bulk delete failed","error"); }
  };

  const toggleOne = (id) => setSelected(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  const toggleAll = () => setSelected(selectedIds.size===stories.length&&stories.length>0 ? new Set() : new Set(stories.map(s=>s.story_id)));

  const handleExport = async () => {
    setMenuOpen(false);
    try {
      const params = {}; if (ageFilter!=="all") params.age_group = ageFilter;
      const res = await storiesAPI.exportCSV(params);
      const url = URL.createObjectURL(new Blob([res.data],{type:"text/csv"}));
      const a = Object.assign(document.createElement("a"),{href:url,download:"stories.csv"}); a.click(); URL.revokeObjectURL(url);
      addToast("CSV exported ✓");
    } catch { addToast("Export failed","error"); }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0]; if (!file) return; setMenuOpen(false);
    try { const res = await storiesAPI.importCSV(file); setImportResult(res.data); addToast(`Imported ${res.data.imported_count} stories ✓`); loadStories(); }
    catch (e) { addToast("Import failed: "+(e?.response?.data?.detail||"Unknown error"),"error"); }
    e.target.value = "";
  };

  const handleLogout = async () => { setMenuOpen(false); await logout(); setUser(null); navigate("/"); };

  return (
    <div className="app-root" style={{ paddingTop: "var(--nav-height, 68px)" }}>

      {/* ══ GLOBAL NAVBAR (same as all other pages) ══ */}
      <nav className="navbar">
        <Link to="/" className="navbar-brand">Story<span style={{color:"#f97316"}}>Nest</span></Link>
        <div className="nav-links">
          <Link className="nav-link" to="/">Home</Link>
          <Link className="nav-link" to="/chatbot">Chatbot</Link>
          {(isAnnotator||isAdmin) && <Link className="nav-link active" to="/annotator">Annotator</Link>}
        </div>
        <div className="nav-actions">
          {user && <span style={{fontSize:13,color:"var(--text-2)"}}>👋 {user.username}</span>}
          <button className="secondary-btn" style={{padding:"7px 14px",fontSize:13}} onClick={handleLogout}>Logout</button>
        </div>
        <button className={`hamburger ${navMenuOpen?"open":""}`} onClick={()=>setNavMenuOpen(!navMenuOpen)}>
          <span/><span/><span/>
        </button>
      </nav>

      {/* Mobile nav menu */}
      <div className={`mobile-menu ${navMenuOpen?"open":""}`}>
        <Link className="nav-link" to="/" onClick={()=>setNavMenuOpen(false)}>Home</Link>
        <Link className="nav-link" to="/chatbot" onClick={()=>setNavMenuOpen(false)}>Chatbot</Link>
        {(isAnnotator||isAdmin) && <Link className="nav-link active" to="/annotator" onClick={()=>setNavMenuOpen(false)}>Annotator</Link>}
        <div className="nav-divider"/>
        <button className="nav-link" style={{border:"none",background:"none",cursor:"pointer",textAlign:"left",color:"var(--danger)"}} onClick={handleLogout}>Logout</button>
      </div>

      <div className="app-container">

        {/* ══ PAGE HEADER with Back button ══ */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button className="back-btn" onClick={()=>navigate(-1)}>
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
              </svg>
              Back
            </button>
            <div>
              <h1 className="app-title">Annotators Dashboard</h1>
              <p className="app-subtitle">
                Welcome, <strong>{user?.username||"Annotator"}</strong>
                {stats && <span style={{marginLeft:10}}>· {stats.total_stories} total stories</span>}
              </p>
            </div>
          </div>

          <div className="top-bar-actions">
            {selectedIds.size > 0 && (
              <button className="secondary-btn small" style={{color:"#dc2626"}} onClick={handleBulkDelete}>
                Delete ({selectedIds.size})
              </button>
            )}
            <button className="primary-btn" onClick={openAdd}>+ Add Story</button>

            {/* 3-dot menu */}
            <div className="menu-container">
              <button className="menu-btn" onClick={()=>setMenuOpen(v=>!v)} aria-label="Menu">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="5"  r="2" fill="#374151"/>
                  <circle cx="12" cy="12" r="2" fill="#374151"/>
                  <circle cx="12" cy="19" r="2" fill="#374151"/>
                </svg>
              </button>
              <div className={`menu-dropdown ${menuOpen?"":"dropdown-hidden"}`}>
                <button className="dropdown-item" onClick={handleExport}>
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Export CSV
                </button>
                <button className="dropdown-item" onClick={()=>{setMenuOpen(false);csvRef.current?.click();}}>
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                  Import CSV
                </button>
                <hr style={{border:"none",borderTop:"1px solid #e5e7eb",margin:"4px 0"}}/>
                <button className="dropdown-item danger" onClick={handleLogout}>
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>

        <input type="file" accept=".csv" ref={csvRef} style={{display:"none"}} onChange={handleImportFile}/>

        {/* Stats badges */}
        {stats?.by_age_group && (
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
            {Object.entries(stats.by_age_group).map(([ag,cnt])=>(
              <span key={ag} onClick={()=>setAgeFilter(ageFilter===ag?"all":ag)}
                style={{fontSize:12,fontWeight:600,padding:"4px 12px",borderRadius:999,cursor:"pointer",
                  background: ageFilter===ag?"#4f46e5":"#e0e7ff",
                  color: ageFilter===ag?"white":"#4338ca",
                  border:"1px solid",borderColor:ageFilter===ag?"#4f46e5":"#c7d2fe"}}>
                {ag}: {cnt}
              </span>
            ))}
          </div>
        )}

        {importResult && (
          <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:12,padding:"12px 16px",marginBottom:16,fontSize:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>✅ Imported <strong>{importResult.imported_count}</strong> &nbsp;·&nbsp; ⚠️ Duplicates <strong>{importResult.duplicate_count}</strong> &nbsp;·&nbsp; ⏭️ Skipped <strong>{importResult.skipped_count}</strong></span>
            <button onClick={()=>setImportResult(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#6b7280"}}>×</button>
          </div>
        )}

        {/* Search + filter */}
        <section className="toolbar">
          <div className="toolbar-left">
            <input className="field-input" type="text" placeholder="Search by entity, virtues, keywords, or story text..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div className="toolbar-right">
            <select className="field-input" value={ageFilter} onChange={e=>setAgeFilter(e.target.value)}>
              <option value="all">All Age Groups</option>
              {AGE_OPTIONS.map(a=><option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </section>

        {/* Add/Edit form */}
        {showForm && (
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">{editingStory ? "Edit Story" : "Add New Story"}</h2>
              <button className="icon-btn" onClick={closeForm} title="Close">
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="card-body">
              <div className="grid-2">
                <div>
                  <label className="field-label">Entity / Title <span className="required">*</span></label>
                  <input ref={entityRef} className="field-input" placeholder="e.g. The Honest Woodcutter" value={form.entity} onChange={e=>setForm(p=>({...p,entity:e.target.value}))}/>
                </div>
                <div>
                  <label className="field-label">Age Group</label>
                  <select className="field-input" value={form.age_group} onChange={e=>setForm(p=>({...p,age_group:e.target.value}))}>
                    <option value="">— Select —</option>
                    {AGE_OPTIONS.map(a=><option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Virtues</label>
                  <input className="field-input" placeholder="e.g. honesty, courage" value={form.virtues} onChange={e=>setForm(p=>({...p,virtues:e.target.value}))}/>
                </div>
                <div>
                  <label className="field-label">Keywords</label>
                  <input className="field-input" placeholder="e.g. forest, woodcutter" value={form.keywords} onChange={e=>setForm(p=>({...p,keywords:e.target.value}))}/>
                </div>
              </div>
              <div style={{marginTop:14}}>
                <label className="field-label">Story Text <span className="required">*</span></label>
                <textarea className="field-input textarea" rows={8} placeholder="Write the full story here..." value={form.story_text} onChange={e=>setForm(p=>({...p,story_text:e.target.value}))} style={{resize:"vertical"}}/>
                <p style={{fontSize:12,color:"#6b7280",marginTop:4}}>{form.story_text.length} chars</p>
              </div>
              {formError && <p className="auth-error">{formError}</p>}
              <div style={{display:"flex",gap:10,marginTop:16}}>
                <button className="primary-btn" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : editingStory ? "Update Story" : "Save Story"}
                </button>
                <button className="secondary-btn" onClick={closeForm}>Cancel</button>
              </div>
              <div className="guidelines" style={{marginTop:20}}>
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

        {/* Stories list */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              Annotated Stories&nbsp;
              <span style={{fontSize:14,fontWeight:400,color:"#6b7280"}}>({total})</span>
            </h2>
            {stories.length > 0 && (
              <label style={{fontSize:13,color:"#6b7280",display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                <input type="checkbox" checked={selectedIds.size===stories.length} onChange={toggleAll}/>
                Select all
              </label>
            )}
          </div>
          <div className="card-body">
            {loading ? (
              <div className="empty-state">
                <div style={{width:32,height:32,margin:"0 auto 12px",border:"3px solid #e5e7eb",borderTopColor:"#4f46e5",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>
                Loading stories…
              </div>
            ) : stories.length === 0 ? (
              <div className="empty-state">
                {search||ageFilter!=="all"
                  ? "No stories match your search or filter."
                  : 'No stories yet. Click "+ Add Story" to get started.'}
              </div>
            ) : (
              stories.map(s => (
                <div key={s.story_id} className="story-item">
                  <div className="story-header">
                    <div style={{display:"flex",alignItems:"flex-start",gap:10,flex:1,minWidth:0}}>
                      <input type="checkbox" checked={selectedIds.has(s.story_id)} onChange={()=>toggleOne(s.story_id)} style={{marginTop:3,flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <p className="story-title">{s.entity}</p>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:4}}>
                          {s.age_group && <span className="badge age">{s.age_group}</span>}
                          {s.virtues   && <span className="badge virtue">{s.virtues.split(",")[0].trim()}</span>}
                        </div>
                        <p style={{fontSize:12,color:"#9ca3af",marginTop:4}}>
                          {s.story_text?.length ?? 0} chars
                        </p>
                      </div>
                    </div>
                    <div className="story-actions">
                      <button className="btn-ghost" onClick={()=>setExpanded(expandedId===s.story_id?null:s.story_id)}>
                        {expandedId===s.story_id?"▲ Hide":"▼ Read"}
                      </button>
                      <button className="btn-ghost" onClick={()=>openEdit(s)}>Edit</button>
                      <button className="btn-ghost danger" onClick={()=>handleDelete(s.story_id)}>Delete</button>
                    </div>
                  </div>
                  {expandedId===s.story_id && (
                    <div>
                      <hr style={{margin:"10px 0",border:"none",borderTop:"1px solid #e5e7eb"}}/>
                      <p className="story-text">{s.story_text}</p>
                      {s.virtues  && <p style={{fontSize:13,color:"#6b7280",marginTop:6}}><strong>Virtues:</strong> {s.virtues}</p>}
                      {s.keywords && <p style={{fontSize:13,color:"#6b7280",marginTop:2}}><strong>Keywords:</strong> {s.keywords}</p>}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

      </div>

      <Toast toasts={toasts}/>

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}