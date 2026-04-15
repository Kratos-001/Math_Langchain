# Math Agent — LangChain + OpenAI + HITL

A math and file agent built with **LangChain** and **OpenAI**, served through a **FastAPI** backend with **Human-in-the-Loop (HITL)** approval, and a **React** frontend to manage everything.

---

## What it does

- Answers **math questions** using tools (add, subtract, multiply, divide, expressions)
- **Writes / appends files** — but pauses and asks for your approval first (HITL)
- Supports **multiple concurrent users** — each gets their own isolated session
- Stores every session in a **local SQLite database**
- Full **React UI** — no need to touch Swagger or the terminal for normal usage

---

## Project Structure

```
Math_Langchain/
├── main.py            # FastAPI backend — all API endpoints + HITL logic
├── test_hitl.py       # Automated test suite (5 tests)
├── requirements.txt   # Python dependencies
├── .env               # Your OpenAI API key (you create this)
├── sessions.db        # SQLite database — auto-created on first run
├── math_qa_log.txt    # Text log of all Q&A — auto-created on first run
└── ui/                # React frontend (Vite)
    └── src/
        ├── App.jsx
        └── App.css
```

---

## Prerequisites

- **Python 3.9+**
- **Node.js 18+**
- An **OpenAI API key** — get one at [platform.openai.com](https://platform.openai.com)

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/Kratos-001/Math_Langchain.git
cd Math_Langchain
```

### 2. Create a virtual environment and install Python dependencies

```bash
python -m venv .venv
source .venv/bin/activate        # Mac / Linux
# .venv\Scripts\activate         # Windows

pip install -r requirements.txt
```

### 3. Add your OpenAI API key

Create a `.env` file in the root folder:

```bash
OPENAI_API_KEY=sk-your-key-here
```

### 4. Install frontend dependencies

```bash
cd ui
npm install
cd ..
```

---

## Running the project

You need **two terminals** — one for the backend, one for the frontend.

### Terminal 1 — Backend

```bash
source .venv/bin/activate
uvicorn main:app --reload
```

Backend runs at: **http://localhost:8000**

### Terminal 2 — Frontend

```bash
cd ui
npm run dev
```

Frontend runs at: **http://localhost:5173**

Open **http://localhost:5173** in your browser.

---

## Using the UI

The UI has three sections in the sidebar:

### Chat
- Type a question and press **Send** or hit **Enter**
- Use the **quick test buttons** (Math / File write / Expression) to fire test requests instantly
- Stats bar at the top shows Total / Math / Approved / Rejected / Pending counts
- File write requests appear as **approval cards** — click Approve or Reject

### History
- Shows all past requests with colour-coded badges
- Green = Approved, Red = Rejected, Grey = Math
- Persists across browser refreshes (saved in localStorage)
- **Clear all** button to wipe the history

### Dev Tools
- **Server health** — live ping every 5 seconds, shows if backend is up or down
- **Quick tests** — fire test requests without typing
- **Session lookup** — enter any session ID to see its full database record
- **Live sessions** — all active in-memory sessions with their current status
- **DB sessions** — all past sessions from SQLite (last 200)

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/ask` | Send a question to the agent |
| POST | `/resume` | Approve or reject a pending HITL request |
| GET | `/sessions` | List all active in-memory sessions |
| GET | `/history` | List all past sessions from SQLite |
| GET | `/docs` | Swagger UI |

### POST /ask
```json
{ "question": "What is 45 multiplied by 13?" }
```

**Response (math — completes immediately):**
```json
{ "status": "completed", "answer": "585", "session_id": "abc12345" }
```

**Response (file write — pauses for approval):**
```json
{
  "status": "waiting_for_approval",
  "session_id": "abc12345",
  "pending_action": "write_to_file",
  "pending_input": { "filename": "notes.txt", "content": "Hello" }
}
```

### POST /resume
```json
{ "session_id": "abc12345", "approved": true }
```

**Response:**
```json
{ "status": "completed", "answer": "Done! Written to 'notes.txt' successfully." }
```

---

## Running the automated tests

Make sure the backend is running first, then:

```bash
python test_hitl.py
```

This runs 5 tests:
1. **Math only** — no HITL, returns immediately
2. **File write + approve** — approves the request, file gets created
3. **File write + reject** — rejects the request, file does NOT get created
4. **Concurrent sessions** — 3 users at the same time, proves session isolation
5. **Invalid session ID** — returns 404

---

## How HITL works

```
User asks "Write X to file.txt"
        ↓
Agent thread starts, hits write_to_file tool
        ↓
Backend FREEZES the thread, returns "waiting_for_approval" to UI
        ↓
UI shows an approval card with file details
        ↓
User clicks Approve or Reject
        ↓
Backend UNFREEZES the thread, agent continues or skips
        ↓
Final answer returned to UI
```

Each user gets a unique `session_id` (e.g. `abc12345`). Multiple users can be paused at the same time — each approval goes only to the correct session.

All sessions are saved to `sessions.db` (SQLite) so you can look them up even after the server restarts.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| LLM | OpenAI gpt-4o-mini |
| Agent framework | LangChain (langchain-classic) |
| Backend | FastAPI + Uvicorn |
| HITL | Python threading.Event() |
| Database | SQLite (built into Python) |
| Frontend | React + Vite |
| Styling | Plain CSS (Inter font) |
