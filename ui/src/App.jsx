import { useState, useEffect } from "react";
import "./App.css";

const BASE = "http://localhost:8000";

function timeStr() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const [question, setQuestion] = useState("");
  const [status, setStatus]     = useState("");
  const [loading, setLoading]   = useState(false);
  // Load history from localStorage on first render
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem("math_agent_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [active, setActive] = useState("chat");

  // List of pending HITL requests  { session_id, pending_action, pending_input, question }
  const [pending, setPending] = useState([]);

  // Per-card resuming state  { [session_id]: "approving" | "rejecting" | null }
  const [resuming, setResuming] = useState({});

  // Save history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("math_agent_history", JSON.stringify(history));
  }, [history]);

  const stats = {
    total   : history.length,
    approved: history.filter((h) => h.type === "approved").length,
    rejected: history.filter((h) => h.type === "rejected").length,
  };

  async function sendQuestion() {
    if (!question.trim()) return;
    const q = question.trim();
    setLoading(true);
    setStatus("Thinking...");
    setQuestion("");

    try {
      const res  = await fetch(`${BASE}/ask`, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({ question: q }),
      });
      const data = await res.json();

      if (data.status === "waiting_for_approval") {
        // Add to the pending list — keeps all previous ones too
        setPending((prev) => [
          ...prev,
          { ...data, question: q, time: timeStr() },
        ]);
        setStatus("");
      } else {
        addHistory(q, data.answer, "math");
        setStatus("");
      }
    } catch {
      setStatus("Cannot reach server. Make sure backend is running on port 8000.");
    }
    setLoading(false);
  }

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

      // Remove this card from pending list
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

        {[
          { id: "chat",    icon: "⌘", label: "Chat"    },
          { id: "history", icon: "≡", label: "History" },
          { id: "stats",   icon: "◈", label: "Stats"   },
        ].map((item) => (
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

        <div className="sidebar-footer">
          <div className="status-dot">
            <span className="dot-green" />
            Server running
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">

        {/* TOPBAR */}
        <div className="topbar">
          <span className="topbar-title">
            {active === "chat" ? "Chat" : active === "history" ? "History" : "Stats"}
          </span>
          <div className="topbar-right">
            {pending.length > 0 && (
              <span className="tag tag-warn">{pending.length} pending approval{pending.length > 1 ? "s" : ""}</span>
            )}
            <span className="tag">HITL enabled</span>
            <span className="tag">gpt-4o-mini</span>
          </div>
        </div>

        <div className="content">

          {/* ── CHAT VIEW */}
          {active === "chat" && (
            <>
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
                    <button
                      className="btn btn-primary"
                      onClick={sendQuestion}
                      disabled={loading || !question.trim()}
                    >
                      {loading ? "···" : "Send"}
                    </button>
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
                            <button
                              className="btn btn-approve"
                              onClick={() => resume(item, true)}
                              disabled={!!state}
                            >
                              {state === "approving" ? "···" : "Approve"}
                            </button>
                            <button
                              className="btn btn-reject"
                              onClick={() => resume(item, false)}
                              disabled={!!state}
                            >
                              {state === "rejecting" ? "···" : "Reject"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* RECENT — last 3 */}
              {history.length > 0 && (
                <div>
                  <p className="section-title">Recent</p>
                  <div className="history-list">
                    {history.slice(0, 3).map((h) => (
                      <HistoryCard key={h.id} h={h} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── HISTORY VIEW */}
          {active === "history" && (
            <div>
              <p className="section-title">All Requests</p>
              {history.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">≡</div>
                  <p>No history yet. Ask something in Chat.</p>
                </div>
              ) : (
                <div className="history-list">
                  {history.map((h) => (
                    <HistoryCard key={h.id} h={h} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── STATS VIEW */}
          {active === "stats" && (
            <div>
              <p className="section-title">Overview</p>
              <div className="stats-row">
                <div className="stat-card">
                  <div className="stat-value">{stats.total}</div>
                  <div className="stat-label">Total requests</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value" style={{ color: "#16a34a" }}>
                    {stats.approved}
                  </div>
                  <div className="stat-label">Approved</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value" style={{ color: "#dc2626" }}>
                    {stats.rejected}
                  </div>
                  <div className="stat-label">Rejected</div>
                </div>
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
