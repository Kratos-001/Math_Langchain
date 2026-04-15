import os
import json
import uuid
import sqlite3
import threading
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from langchain_core.tools import tool
from langchain_core.prompts import PromptTemplate
from langchain_classic.agents import AgentExecutor, create_react_agent
from langchain_openai import ChatOpenAI

load_dotenv()

app = FastAPI(title="Math Agent with HITL")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LOG_FILE = "math_qa_log.txt"
DB_FILE  = "sessions.db"


# ══════════════════════════════════════════════════════════
# DATABASE SETUP — SQLite, stores every session permanently
# ══════════════════════════════════════════════════════════

def init_db():
    con = sqlite3.connect(DB_FILE)
    con.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id   TEXT PRIMARY KEY,
            question     TEXT,
            status       TEXT,
            result       TEXT,
            pending_tool TEXT,
            pending_input TEXT,
            created_at   TEXT,
            updated_at   TEXT
        )
    """)
    con.commit()
    con.close()

init_db()


def db_insert_session(session_id: str, question: str):
    """Called when /ask creates a new session."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    con = sqlite3.connect(DB_FILE)
    con.execute(
        "INSERT INTO sessions (session_id, question, status, created_at, updated_at) VALUES (?,?,?,?,?)",
        (session_id, question, "running", now, now)
    )
    con.commit()
    con.close()


def db_update_session(session_id: str, **kwargs):
    """Called whenever a session's status/result changes."""
    kwargs["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    fields = ", ".join(f"{k} = ?" for k in kwargs)
    values = list(kwargs.values()) + [session_id]
    con = sqlite3.connect(DB_FILE)
    con.execute(f"UPDATE sessions SET {fields} WHERE session_id = ?", values)
    con.commit()
    con.close()


# ══════════════════════════════════════════════════════════
# SESSION STORE
# Key   = session_id
# Value = {
#   "question"       : original question
#   "status"         : running | waiting_for_approval | completed | error
#   "result"         : final answer (set when done)
#   "pending_tool"   : which tool triggered HITL
#   "pending_input"  : what the tool wants to do
#   "approved"       : True/False (set by /resume)
#   "hitl_event"     : threading.Event — pauses agent thread
#   "response_ready" : threading.Event — signals /ask or /resume
# }
# ══════════════════════════════════════════════════════════
sessions: dict = {}

# Thread-local storage so each agent thread knows its own session_id
_thread_local = threading.local()


def get_session_id() -> str:
    return getattr(_thread_local, "session_id", None)


# ══════════════════════════════════════════════════════════
# HITL HELPER
# Called inside file tools — pauses the agent thread and
# waits for a human to call POST /resume
# ══════════════════════════════════════════════════════════
def hitl_approval(tool_name: str, pending_input: dict) -> bool:
    session_id = get_session_id()
    session = sessions[session_id]

    # Store what the agent wants to do
    session["pending_tool"]  = tool_name
    session["pending_input"] = pending_input
    session["status"]        = "waiting_for_approval"

    # Persist to DB
    db_update_session(session_id,
        status        = "waiting_for_approval",
        pending_tool  = tool_name,
        pending_input = json.dumps(pending_input)
    )

    # Signal /ask that HITL triggered — it can now return the response
    session["response_ready"].set()

    # BLOCK this agent thread until /resume calls hitl_event.set()
    session["hitl_event"].wait()
    session["hitl_event"].clear()  # reset for any subsequent HITL in same session

    return session["approved"]


# ══════════════════════════════════════════════════════════
# MATH TOOLS — run freely, no approval needed
# ══════════════════════════════════════════════════════════

@tool
def add(input: str) -> str:
    """Add two numbers. Input must be a JSON string like: {"a": 5, "b": 3}"""
    data = json.loads(input)
    return str(data["a"] + data["b"])

@tool
def subtract(input: str) -> str:
    """Subtract b from a. Input must be a JSON string like: {"a": 10, "b": 3}"""
    data = json.loads(input)
    return str(data["a"] - data["b"])

@tool
def multiply(input: str) -> str:
    """Multiply two numbers. Input must be a JSON string like: {"a": 4, "b": 5}"""
    data = json.loads(input)
    return str(data["a"] * data["b"])

@tool
def divide(input: str) -> str:
    """Divide a by b. Input must be a JSON string like: {"a": 10, "b": 2}"""
    data = json.loads(input)
    if data["b"] == 0:
        return "Error: Cannot divide by zero."
    return str(round(data["a"] / data["b"], 4))

@tool
def calculate_expression(expression: str) -> str:
    """
    Evaluate a math expression following BODMAS rules.
    Use this for expressions like: (5 + 3) * 12 or 100 / 4 - 3 * 2.
    Input is a plain math expression string.
    """
    try:
        result = eval(expression)
        return str(round(result, 4))
    except Exception as e:
        return f"Error evaluating expression: {str(e)}"


# ══════════════════════════════════════════════════════════
# FILE TOOLS — write/append trigger HITL, read is free
# ══════════════════════════════════════════════════════════

@tool
def write_to_file(input: str) -> str:
    """Write content to a file. Input must be JSON: {"filename": "test.txt", "content": "Hello"}"""
    data     = json.loads(input)
    filename = data["filename"]
    content  = data["content"]

    approved = hitl_approval("write_to_file", {"filename": filename, "content": content})
    if not approved:
        return "Action denied by human. Do NOT retry. Inform the user the action was rejected and stop."
    try:
        with open(filename, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Done! Written to '{filename}' successfully."
    except Exception as e:
        return f"Error writing file: {str(e)}"

@tool
def append_to_file(input: str) -> str:
    """Append content to a file. Input must be JSON: {"filename": "test.txt", "content": "Hello"}"""
    data     = json.loads(input)
    filename = data["filename"]
    content  = data["content"]

    approved = hitl_approval("append_to_file", {"filename": filename, "content": content})
    if not approved:
        return "Action denied by human. Do NOT retry. Inform the user the action was rejected and stop."
    try:
        with open(filename, "a", encoding="utf-8") as f:
            f.write(f"\n{content}")
        return f"Done! Appended to '{filename}' successfully."
    except Exception as e:
        return f"Error appending to file: {str(e)}"

@tool
def read_from_file(filename: str) -> str:
    """Read and return the full contents of a file. No approval needed."""
    try:
        with open(filename, "r", encoding="utf-8") as f:
            content = f.read()
        return content if content.strip() else "(File is empty)"
    except FileNotFoundError:
        return f"Error: File '{filename}' not found."
    except Exception as e:
        return f"Error reading file: {str(e)}"


# ══════════════════════════════════════════════════════════
# Q&A LOGGER
# ══════════════════════════════════════════════════════════

def log_qa(question: str, answer: str) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write("\n" + "=" * 50 + "\n")
        f.write(f"Time     : {timestamp}\n")
        f.write(f"Question : {question}\n")
        f.write(f"Answer   : {answer}\n")


# ══════════════════════════════════════════════════════════
# BUILD THE AGENT
# ══════════════════════════════════════════════════════════

tools_list = [
    add, subtract, multiply, divide, calculate_expression,
    write_to_file, append_to_file, read_from_file
]

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

react_template = """Answer the following questions as best you can. You have access to the following tools:

{tools}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Begin!

Question: {input}
Thought:{agent_scratchpad}"""

prompt = PromptTemplate.from_template(react_template)
agent  = create_react_agent(llm=llm, tools=tools_list, prompt=prompt)

agent_executor = AgentExecutor(
    agent=agent,
    tools=tools_list,
    verbose=True,
    handle_parsing_errors=True,
    return_intermediate_steps=True,
)


# ══════════════════════════════════════════════════════════
# AGENT RUNNER — runs in background thread
# ══════════════════════════════════════════════════════════

def run_agent(session_id: str, question: str) -> None:
    # Bind this thread to its session_id
    _thread_local.session_id = session_id
    session = sessions[session_id]
    try:
        result            = agent_executor.invoke({"input": question})
        answer            = result["output"]
        session["result"] = answer
        session["status"] = "completed"
        log_qa(question, answer)
        db_update_session(session_id, status="completed", result=answer)
    except Exception as e:
        session["result"] = f"Error: {str(e)}"
        session["status"] = "error"
        db_update_session(session_id, status="error", result=session["result"])
    finally:
        # Always signal response_ready so /ask or /resume can return
        session["response_ready"].set()


# ══════════════════════════════════════════════════════════
# REQUEST / RESPONSE MODELS
# ══════════════════════════════════════════════════════════

class AskRequest(BaseModel):
    question: str

class ResumeRequest(BaseModel):
    session_id: str
    approved: bool


# ══════════════════════════════════════════════════════════
# POST /ask
# Starts the agent. Returns immediately when:
#   a) Agent completes (math only)       → status: completed
#   b) Agent hits a file tool (HITL)     → status: waiting_for_approval
# ══════════════════════════════════════════════════════════

@app.post("/ask")
def ask(req: AskRequest):
    session_id = str(uuid.uuid4())[:8]

    sessions[session_id] = {
        "question"      : req.question,
        "status"        : "running",
        "result"        : None,
        "pending_tool"  : None,
        "pending_input" : None,
        "approved"      : None,
        "hitl_event"    : threading.Event(),
        "response_ready": threading.Event(),
    }

    # Persist new session to DB immediately
    db_insert_session(session_id, req.question)

    # Start agent in background thread — does NOT block the server
    thread = threading.Thread(target=run_agent, args=(session_id, req.question), daemon=True)
    sessions[session_id]["thread"] = thread
    thread.start()

    # Wait until agent either completes OR hits HITL (max 60s)
    sessions[session_id]["response_ready"].wait(timeout=60)

    session = sessions[session_id]

    if session["status"] == "waiting_for_approval":
        return {
            "session_id"    : session_id,
            "status"        : "waiting_for_approval",
            "pending_action": session["pending_tool"],
            "pending_input" : session["pending_input"],
            "message"       : "Agent paused. Call POST /resume with this session_id to approve or reject."
        }

    # Completed or errored — clean up session
    sessions.pop(session_id, None)
    return {
        "session_id": session_id,
        "status"    : session["status"],
        "answer"    : session["result"],
        "logged"    : True
    }


# ══════════════════════════════════════════════════════════
# POST /resume
# Unblocks the paused agent thread for a specific session.
# approved=true  → agent continues and writes the file
# approved=false → agent skips the file write
# ══════════════════════════════════════════════════════════

@app.post("/resume")
def resume(req: ResumeRequest):
    session = sessions.get(req.session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found. It may have already completed.")

    if session["status"] != "waiting_for_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Session is not waiting for approval. Current status: {session['status']}"
        )

    # Store the human's decision
    session["approved"] = req.approved

    # Reset response_ready so we can wait for the next state change
    session["response_ready"].clear()

    # UNBLOCK the specific agent thread — only this session's thread wakes up
    session["hitl_event"].set()

    # Wait for agent to complete or hit another HITL (max 60s)
    session["response_ready"].wait(timeout=60)

    # Agent hit another HITL in the same run (e.g. two file writes)
    if session["status"] == "waiting_for_approval":
        return {
            "session_id"    : req.session_id,
            "status"        : "waiting_for_approval",
            "pending_action": session["pending_tool"],
            "pending_input" : session["pending_input"],
            "message"       : "Agent paused again. Call POST /resume again."
        }

    # Done — clean up session
    result = session["result"]
    status = session["status"]
    sessions.pop(req.session_id, None)

    return {
        "status" : status,
        "answer" : result,
        "logged" : True
    }


# ══════════════════════════════════════════════════════════
# GET /sessions — active in-memory sessions (debug)
# ══════════════════════════════════════════════════════════

@app.get("/sessions")
def list_sessions():
    return {
        sid: {
            "question": s["question"],
            "status"  : s["status"]
        }
        for sid, s in sessions.items()
    }


# ══════════════════════════════════════════════════════════
# GET /history — all past sessions from SQLite
# ══════════════════════════════════════════════════════════

@app.get("/history")
def get_history():
    con  = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 200"
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]
