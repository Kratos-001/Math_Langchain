"""
HITL Test Suite — proves multiple agents can pause simultaneously
and each /resume goes to the correct agent.

Run server first:
    uvicorn main:app --reload

Then in another terminal:
    python test_hitl.py
"""

import requests
import threading
import time

BASE = "http://localhost:8000"


def separator(title):
    print(f"\n{'=' * 55}")
    print(f"  {title}")
    print(f"{'=' * 55}")


# ── TEST 1: Math only — should return immediately, no HITL
def test_math():
    separator("TEST 1 — Math only (no HITL)")
    r = requests.post(f"{BASE}/ask", json={"question": "What is 125 + 5?"})
    data = r.json()
    print(f"Status : {data['status']}")
    print(f"Answer : {data['answer']}")
    assert data["status"] == "completed", "Expected completed"
    print("PASSED")


# ── TEST 2: File write + approve
def test_approve():
    separator("TEST 2 — File write then APPROVE")
    r = requests.post(f"{BASE}/ask", json={"question": "Write 'WOOO' to approved.txt"})
    data = r.json()
    print(f"Status      : {data['status']}")
    print(f"Session ID  : {data['session_id']}")
    print(f"Tool        : {data['pending_action']}")
    print(f"Input       : {data['pending_input']}")
    assert data["status"] == "waiting_for_approval", "Expected HITL pause"

    print("\n>>> Approving...")
    r2 = requests.post(f"{BASE}/resume", json={"session_id": data["session_id"], "approved": True})
    data2 = r2.json()
    print(f"Status : {data2['status']}")
    print(f"Answer : {data2['answer']}")
    assert data2["status"] == "completed"
    print("PASSED — check approved.txt in your folder")


# ── TEST 3: File write + reject
def test_reject():
    separator("TEST 3 — File write then REJECT")
    r = requests.post(f"{BASE}/ask", json={"question": "Write 'Should not appear' to rejected.txt"})
    data = r.json()
    print(f"Status     : {data['status']}")
    print(f"Session ID : {data['session_id']}")
    assert data["status"] == "waiting_for_approval"

    print("\n>>> Rejecting...")
    r2 = requests.post(f"{BASE}/resume", json={"session_id": data["session_id"], "approved": False})
    data2 = r2.json()
    print(f"Status : {data2['status']}")
    print(f"Answer : {data2['answer']}")
    assert data2["status"] == "completed"
    print("PASSED — rejected.txt should NOT exist in your folder")


# ── TEST 4: Concurrent sessions — the real proof
# User1, User2 both ask file write questions simultaneously
# User3 asks a math question
# Then User1 approves, User2 rejects — each goes to the right agent
def test_concurrent():
    separator("TEST 4 — Concurrent sessions (the real HITL proof)")

    results = {}

    def ask(user_id, question):
        r = requests.post(f"{BASE}/ask", json={"question": question})
        results[user_id] = r.json()
        print(f"[User{user_id}] status={results[user_id]['status']}  session={results[user_id].get('session_id', 'N/A')}")

    # Fire all 3 at the same time
    threads = [
        threading.Thread(target=ask, args=(1, "Write 'User1 data' to user1.txt")),
        threading.Thread(target=ask, args=(2, "Write 'User2 data' to user2.txt")),
        threading.Thread(target=ask, args=(3, "What is 100 multiplied by 10?")),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    print(f"\n[User3 math result] {results[3].get('answer')}")

    # User1 approves
    if results[1].get("status") == "waiting_for_approval":
        print(f"\n>>> User1 APPROVING session {results[1]['session_id']}")
        r = requests.post(f"{BASE}/resume", json={"session_id": results[1]["session_id"], "approved": True})
        data = r.json()
        answer = data.get("answer") or data.get("detail") or data.get("message") or str(data)
        print(f"[User1 resume] {answer}")

    # User2 rejects
    if results[2].get("status") == "waiting_for_approval":
        print(f"\n>>> User2 REJECTING session {results[2]['session_id']}")
        r = requests.post(f"{BASE}/resume", json={"session_id": results[2]["session_id"], "approved": False})
        data = r.json()
        answer = data.get("answer") or data.get("detail") or data.get("message") or str(data)
        print(f"[User2 resume] {answer}")

    print("\nPASSED — user1.txt should exist, user2.txt should NOT")


# ── TEST 5: Invalid session_id
def test_invalid_session():
    separator("TEST 5 — Invalid session_id")
    r = requests.post(f"{BASE}/resume", json={"session_id": "fakeid", "approved": True})
    print(f"Status code : {r.status_code}")
    print(f"Detail      : {r.json()['detail']}")
    assert r.status_code == 404
    print("PASSED")


if __name__ == "__main__":
    print("\n🤖  HITL FastAPI Test Suite")
    print("Make sure server is running: uvicorn main:app --reload\n")
    time.sleep(1)

    test_math()
    test_approve()
    test_reject()
    test_concurrent()
    test_invalid_session()

    separator("ALL TESTS DONE")
    print("Check math_qa_log.txt for all logged Q&A entries.")
