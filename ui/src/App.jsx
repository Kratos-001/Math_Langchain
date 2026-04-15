import { useState, useEffect, useCallback } from "react";
import "./App.css";

const BASE = "http://localhost:8000";

const QUICK_TESTS = [
  { label: "Math",       question: "What is 125 multiplied by 4?"           },
  { label: "File write", question: "Write 'Hello from UI test' to test.txt" },
  { label: "Expression", question: "What is (100 + 25) * 2 - 50?"           },
];

function timeStr() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const [question, setQuestion] = useState("");
  const [status, setStatus]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [active, setActive]     = useState("chat");
  const [serverOk, setServerOk] = useState(null); // null=checking, true=up, false=down

  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("math_agent_history") || "[]"); }
    catch { return []; }
  });

  const [pending, setPending] = useState([]);
  const [resuming, setResuming] = useState({});

  // Dev panel state
  const [liveSessions, setLiveSessions]   = useState([]);
  const [dbSessions, setDbSessions]       = useState([]);
  const [devLoading, setDevLoading]       = useState(false);
  const [sessionLookup, setSessionLookup] = useState("");
  const [lookupResult, setLookupResult]   = useState(null);

  // ── Persist history to localStorage
  useEffect(() => {
    localStorage.setItem("math_agent_history", JSON.stringify(history));
  }, [history]);

  // ── Server health check every 5 seconds
  useEffect(() => {
    async function check() {
      try {
        const r = await fetch(`${BASE}/sessions`, { signal: AbortSignal.timeout(3000) });
        setServerOk(r.ok);
      } catch {
        setServerOk(false);
      }
    }
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  const stats = {
    total   : history.length,
    approved: history.filter((h) => h.type === "approved").length,
    rejected: history.filter((h) => h.type === "rejected").length,
    pending : pending.length,
    math    : history.filter((h) => h.type === "math").length,
  };

  // ── Send question
  async function sendQuestion(q) {
    const text = (q || question).trim();
    if (!text) return;
    setLoading(true);
    setStatus("Thinking...");
    setQuestion("");

    try {
      const res  = await fetch(`${BASE}/ask`, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({ question: text }),
      });
      const data = await res.json();

      if (data.status === "waiting_for_approval") {
        setPending((prev) => [...prev, { ...data, question: text, time: timeStr() }]);
      } else {
        addHistory(text, data.answer, "math");
      }
      setStatus("");
    } catch {
      setStatus("Cannot reach server. Make sure backend is running on port 8000.");
    }
    setLoading(false);
  }

  // ── Resume (approve / reject)
  async function resume(item, approved) {
    const sid = item.session_id;
    setResuming((prev) => ({ ...prev, [sid]: approved ? "approving" : "rejecting" }));

    try {
      const res  = await fetch(`${BASE}/resume`, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({ session_id: sid, approved }),
      });
      const data = await res.json();
      setPending((prev) => prev.filter((p) => p.session_id !== sid));
      setResuming((prev) => { const n = { ...prev }; delete n[sid]; return n; });
      addHistory(item.question, data.answer, approved ? "approved" : "rejected");
    } catch {
      setResuming((prev) => { const n = { ...prev }; delete n[sid]; return n; });
    }
  }

  function addHistory(q, a, type) {
    setHistory((prev) => [{ q, a, type, time: timeStr(), id: Date.now() }, ...prev]);
  }

  // ── Dev panel: fetch live + DB sessions
  const refreshDev = useCallback(async () => {
    setDevLoading(true);
    try {
      const [live, db] = await Promise.all([
        fetch(`${BASE}/sessions`).then((r) => r.json()),
        fetch(`${BASE}/history`).then((r) => r.json()),
      ]);
      setLiveSessions(Object.entries(live).map(([id, s]) => ({ session_id: id, ...s })));
      setDbSessions(db);
    } catch {
      setLiveSessions([]);
      setDbSessions([]);
    }
    setDevLoading(false);
  }, []);

  useEffect(() => {
    if (active === "dev") refreshDev();
  }, [active, refreshDev]);

  // ── Session lookup
  async function lookupSession() {
    if (!sessionLookup.trim()) return;
    try {
      const db = await fetch(`${BASE}/history`).then((r) => r.json());
      const found = db.find((s) => s.session_id === sessionLookup.trim());
      setLookupResult(found || "not_found");
    } catch {
      setLookupResult("error");
    }
  }

  // ── Clear history
  function clearHistory() {
    setHistory([]);
    localStorage.removeItem("math_agent_history");
  }

  const navItems = [
    { id: "chat",    icon: "⌘", label: "Chat"    },
    { id: "history", icon: "≡", label: "History" },
    { id: "dev",     icon: "⚙", label: "Dev"     },
  ];

  return (
    <div className="page">

      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="dot">✦</div>
          <div className="brand">
            Math Agent
            <span>LangChain + OpenAI</span>
          </div>
        </div>

        <p className="nav-label">Menu</p>

        {navItems.map((item) => (
          <div
            key={item.id}
            className={`nav-item ${active === item.id ? "active" : ""}`}
            onClick={() => setActive(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
            {item.id === "chat" && pending.length > 0 && (
              <span className="pending-badge">{pending.length}</span>
            )}
          </div>
        ))}

        {/* STATS MINI in sidebar */}
        <div className="sidebar-stats">
          <div className="sidebar-stat">
            <span className="ss-val">{stats.total}</span>
            <span className="ss-label">Total</span>
          </div>
          <div className="sidebar-stat">
            <span className="ss-val" style={{ color: "#22c55e" }}>{stats.approved}</span>
            <span className="ss-label">Approved</span>
          </div>
          <div className="sidebar-stat">
            <span className="ss-val" style={{ color: "#ef4444" }}>{stats.rejected}</span>
            <span className="ss-label">Rejected</span>
          </div>
          <div className="sidebar-stat">
            <span className="ss-val" style={{ color: "#f59e0b" }}>{stats.pending}</span>
            <span className="ss-label">Pending</span>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="status-dot">
            <span className={serverOk === false ? "dot-red" : "dot-green"} />
            {serverOk === null ? "Checking…" : serverOk ? "Server online" : "Server offline"}
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">

        {/* TOPBAR */}
        <div className="topbar">
          <span className="topbar-title">
            {active === "chat" ? "Chat" : active === "history" ? "History" : "Dev Tools"}
          </span>
          <div className="topbar-right">
            {pending.length > 0 && (
              <span className="tag tag-warn">{pending.length} pending</span>
            )}
            <span className="tag">HITL enabled</span>
            <span className="tag">gpt-4o-mini</span>
          </div>
        </div>

        <div className="content">

          {/* ══ CHAT VIEW ══ */}
          {active === "chat" && (
            <>
              {/* STATS BAR */}
              <div className="stats-bar">
                {[
                  { label: "Total",    val: stats.total,    color: "#6b7280" },
                  { label: "Math",     val: stats.math,     color: "#6b7280" },
                  { label: "Approved", val: stats.approved, color: "#16a34a" },
                  { label: "Rejected", val: stats.rejected, color: "#dc2626" },
                  { label: "Pending",  val: stats.pending,  color: "#d97706" },
                ].map(({ label, val, color }) => (
                  <div className="stats-bar-item" key={label}>
                    <span className="stats-bar-val" style={{ color }}>{val}</span>
                    <span className="stats-bar-label">{label}</span>
                  </div>
                ))}
              </div>

              {/* ASK */}
              <div>
                <p className="section-title">New Request</p>
                <div className="card">
                  <div className="ask-row">
                    <input
                      className="input"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !loading && sendQuestion()}
                      placeholder="What is 45 × 13?  or  Write 'Hello' to notes.txt"
                      disabled={loading}
                    />
                    <button className="btn btn-primary" onClick={() => sendQuestion()} disabled={loading || !question.trim()}>
                      {loading ? "···" : "Send"}
                    </button>
                  </div>

                  {/* QUICK TEST BUTTONS */}
                  <div className="quick-tests">
                    {QUICK_TESTS.map((t) => (
                      <button
                        key={t.label}
                        className="btn btn-ghost"
                        onClick={() => sendQuestion(t.question)}
                        disabled={loading}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {status && (
                    <p className="status">
                      {loading && <span className="spinner" />}
                      {status}
                    </p>
                  )}
                </div>
              </div>

              {/* PENDING HITL LIST */}
              {pending.length > 0 && (
                <div>
                  <p className="section-title">
                    Approval Required
                    <span className="section-count">{pending.length}</span>
                  </p>
                  <div className="hitl-list">
                    {pending.map((item) => {
                      const state = resuming[item.session_id];
                      return (
                        <div className="hitl-card" key={item.session_id}>
                          <div className="hitl-header">
                            <span className="hitl-heading">{item.question}</span>
                            <span className="hitl-badge">
                              {state === "approving" ? "Approving…" : state === "rejecting" ? "Rejecting…" : "Pending"}
                            </span>
                          </div>
                          <div className="hitl-detail">
                            {[
                              ["Session",  item.session_id],
                              ["Tool",     item.pending_action],
                              ["File",     item.pending_input?.filename],
                              ["Content",  item.pending_input?.content],
                              ["Received", item.time],
                            ].map(([key, val]) =>
                              val ? (
                                <div className="detail-row" key={key}>
                                  <span className="detail-key">{key}</span>
                                  <span className="detail-val">{val}</span>
                                </div>
                              ) : null
                            )}
                          </div>
                          <div className="hitl-btns">
                            <button className="btn btn-approve" onClick={() => resume(item, true)}  disabled={!!state}>
                              {state === "approving" ? "···" : "Approve"}
                            </button>
                            <button className="btn btn-reject"  onClick={() => resume(item, false)} disabled={!!state}>
                              {state === "rejecting" ? "···" : "Reject"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* RECENT */}
              {history.length > 0 && (
                <div>
                  <p className="section-title">Recent</p>
                  <div className="history-list">
                    {history.slice(0, 3).map((h) => <HistoryCard key={h.id} h={h} />)}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══ HISTORY VIEW ══ */}
          {active === "history" && (
            <div>
              <div className="section-header">
                <p className="section-title">All Requests</p>
                {history.length > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={clearHistory}>Clear all</button>
                )}
              </div>
              {history.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">≡</div>
                  <p>No history yet. Ask something in Chat.</p>
                </div>
              ) : (
                <div className="history-list">
                  {history.map((h) => <HistoryCard key={h.id} h={h} />)}
                </div>
              )}
            </div>
          )}

          {/* ══ DEV TOOLS VIEW ══ */}
          {active === "dev" && (
            <div className="dev-panel">

              {/* SERVER HEALTH */}
              <p className="section-title">Server Health</p>
              <div className="card dev-health">
                <div className="health-row">
                  <span className={`health-dot ${serverOk === false ? "red" : serverOk ? "green" : "grey"}`} />
                  <span className="health-label">
                    {serverOk === null ? "Checking…" : serverOk ? "Backend is online at " : "Backend is OFFLINE — start with: "}
                  </span>
                  <code className="health-code">
                    {serverOk ? BASE : "uvicorn main:app --reload"}
                  </code>
                </div>
                <div className="dev-links">
                  <a href={`${BASE}/docs`} target="_blank" rel="noreferrer" className="dev-link">Swagger UI ↗</a>
                  <a href={`${BASE}/history`} target="_blank" rel="noreferrer" className="dev-link">GET /history ↗</a>
                  <a href={`${BASE}/sessions`} target="_blank" rel="noreferrer" className="dev-link">GET /sessions ↗</a>
                </div>
              </div>

              {/* QUICK TESTS */}
              <p className="section-title" style={{ marginTop: 20 }}>Quick Tests</p>
              <div className="card">
                <p className="dev-hint">Fire a test request without typing. Results appear in Chat.</p>
                <div className="quick-tests">
                  {QUICK_TESTS.map((t) => (
                    <button
                      key={t.label}
                      className="btn btn-ghost"
                      onClick={() => { setActive("chat"); sendQuestion(t.question); }}
                      disabled={loading}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* SESSION LOOKUP */}
              <p className="section-title" style={{ marginTop: 20 }}>Session Lookup</p>
              <div className="card">
                <p className="dev-hint">Enter a session ID to see its full record from the database.</p>
                <div className="ask-row" style={{ marginTop: 10 }}>
                  <input
                    className="input"
                    placeholder="e.g. abc12345"
                    value={sessionLookup}
                    onChange={(e) => { setSessionLookup(e.target.value); setLookupResult(null); }}
                    onKeyDown={(e) => e.key === "Enter" && lookupSession()}
                  />
                  <button className="btn btn-primary" onClick={lookupSession}>Look up</button>
                </div>
                {lookupResult && (
                  <div className="lookup-result">
                    {lookupResult === "not_found" ? (
                      <p className="lookup-miss">No session found with that ID.</p>
                    ) : lookupResult === "error" ? (
                      <p className="lookup-miss">Error fetching — is the server running?</p>
                    ) : (
                      <table className="lookup-table">
                        <tbody>
                          {Object.entries(lookupResult).map(([k, v]) => (
                            <tr key={k}>
                              <td className="lt-key">{k}</td>
                              <td className="lt-val">{v ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              {/* LIVE SESSIONS */}
              <div className="dev-section-header" style={{ marginTop: 20 }}>
                <p className="section-title">Live Sessions (in memory)</p>
                <button className="btn btn-ghost btn-sm" onClick={refreshDev} disabled={devLoading}>
                  {devLoading ? "···" : "Refresh"}
                </button>
              </div>
              <div className="card">
                {liveSessions.length === 0 ? (
                  <p className="dev-empty">No active sessions right now.</p>
                ) : (
                  <table className="dev-table">
                    <thead>
                      <tr><th>Session ID</th><th>Question</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {liveSessions.map((s) => (
                        <tr key={s.session_id}>
                          <td><code>{s.session_id}</code></td>
                          <td>{s.question}</td>
                          <td><span className={`status-pill ${s.status}`}>{s.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* DB SESSIONS */}
              <p className="section-title" style={{ marginTop: 20 }}>All Sessions (database)</p>
              <div className="card">
                {dbSessions.length === 0 ? (
                  <p className="dev-empty">No sessions in database yet.</p>
                ) : (
                  <table className="dev-table">
                    <thead>
                      <tr><th>Session ID</th><th>Question</th><th>Status</th><th>Created</th></tr>
                    </thead>
                    <tbody>
                      {dbSessions.map((s) => (
                        <tr key={s.session_id}>
                          <td><code>{s.session_id}</code></td>
                          <td>{s.question}</td>
                          <td><span className={`status-pill ${s.status}`}>{s.status}</span></td>
                          <td className="dev-time">{s.created_at}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

            </div>
          )}

        </div>
      </main>
    </div>
  );
}

function HistoryCard({ h }) {
  return (
    <div className={`log-entry ${h.type}`}>
      <div className="log-top">
        <span className={`badge ${h.type}`}>
          {h.type === "approved" ? "Approved" : h.type === "rejected" ? "Rejected" : "Math"}
        </span>
        <span className="log-time">{h.time}</span>
      </div>
      <p className="log-q">{h.q}</p>
      <p className="log-a">{h.a}</p>
    </div>
  );
}
