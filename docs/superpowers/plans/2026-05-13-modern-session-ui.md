# Modern Session UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modern Streamlit "conversation suite" UI with a designed brand area, responsive layout, local JSON session persistence, and session create/switch/delete behavior.

**Architecture:** Add a focused `datamedic.ui` package for local session storage, API client behavior, and CSS. Keep FastAPI `/chat` compatible while extracting chart-figure parsing into a testable helper. Refactor `app.py` into Streamlit orchestration that uses these modules and persists each session by `session_id`.

**Tech Stack:** Python 3.11, Streamlit, FastAPI, Requests, Plotly, Pytest, local JSON storage.

---

## Baseline

- Current branch: `main`
- Existing unrelated dirty file: `pyproject.toml`; do not edit or stage it.
- Baseline verification already run:

```bash
.venv/bin/python -m pytest -q
```

Expected and observed:

```text
27 passed
```

## File Structure

- Create `src/datamedic/ui/__init__.py`: marks UI helper package.
- Create `src/datamedic/ui/conversation_store.py`: local JSON conversation state, normalization, create/switch/delete/append operations.
- Create `src/datamedic/ui/chat_client.py`: `/chat` client wrapper and user-friendly failure messages.
- Create `src/datamedic/ui/styles.py`: CSS for the modern Streamlit interface, brand mark, responsive layout, session cards, chat bubbles, and input polish.
- Modify `src/datamedic/api/routes.py`: extract AI text and Plotly figure parsing helpers from the route function.
- Modify `src/datamedic/app.py`: replace usage-hint sidebar with session sidebar and use UI helper modules.
- Create `tests/test_conversation_store.py`: TDD coverage for local session behavior.
- Create `tests/test_chat_client.py`: TDD coverage for HTTP failure handling and success parsing.
- Modify `tests/test_api.py`: add focused tests for extracted route helpers.

## Task 1: Conversation Store

**Files:**
- Create: `src/datamedic/ui/__init__.py`
- Create: `src/datamedic/ui/conversation_store.py`
- Test: `tests/test_conversation_store.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_conversation_store.py`:

```python
import json
from pathlib import Path

from datamedic.ui.conversation_store import ConversationStore


def test_load_state_creates_first_session(tmp_path):
    store = ConversationStore(tmp_path / "conversations.json")

    state = store.load_state()

    assert state["active_session_id"]
    assert len(state["sessions"]) == 1
    assert state["sessions"][0]["id"] == state["active_session_id"]
    assert state["sessions"][0]["title"] == "新的运营问答"
    assert state["sessions"][0]["messages"] == []


def test_create_session_sets_active_and_persists(tmp_path):
    store = ConversationStore(tmp_path / "conversations.json")
    state = store.load_state()
    first_id = state["active_session_id"]

    session = store.create_session(state)
    store.save_state(state)
    reloaded = store.load_state()

    assert session["id"] != first_id
    assert reloaded["active_session_id"] == session["id"]
    assert [item["id"] for item in reloaded["sessions"]] == [session["id"], first_id]


def test_append_first_user_message_updates_title_and_summary(tmp_path):
    store = ConversationStore(tmp_path / "conversations.json")
    state = store.load_state()
    session_id = state["active_session_id"]

    store.append_message(
        state,
        session_id,
        {"role": "user", "text": "展示2025年骨科出院人次趋势并分析变化", "figures": []},
    )

    session = store.get_session(state, session_id)
    assert session["title"] == "展示2025年骨科出院人次趋势并分析..."
    assert session["summary"] == "展示2025年骨科出院人次趋势并分析变化"
    assert session["message_count"] == 1


def test_append_assistant_message_keeps_existing_title(tmp_path):
    store = ConversationStore(tmp_path / "conversations.json")
    state = store.load_state()
    session_id = state["active_session_id"]
    store.append_message(state, session_id, {"role": "user", "text": "心内科手术人次", "figures": []})

    store.append_message(state, session_id, {"role": "assistant", "text": "这是结果", "figures": [{"data": []}]})

    session = store.get_session(state, session_id)
    assert session["title"] == "心内科手术人次"
    assert session["summary"] == "这是结果"
    assert session["message_count"] == 2


def test_delete_active_session_switches_to_remaining_session(tmp_path):
    store = ConversationStore(tmp_path / "conversations.json")
    state = store.load_state()
    first_id = state["active_session_id"]
    second = store.create_session(state)

    store.delete_session(state, second["id"])

    assert state["active_session_id"] == first_id
    assert [item["id"] for item in state["sessions"]] == [first_id]


def test_delete_last_session_creates_replacement(tmp_path):
    store = ConversationStore(tmp_path / "conversations.json")
    state = store.load_state()
    only_id = state["active_session_id"]

    store.delete_session(state, only_id)

    assert state["active_session_id"] != only_id
    assert len(state["sessions"]) == 1
    assert state["sessions"][0]["messages"] == []


def test_corrupt_json_is_backed_up_and_recovered(tmp_path):
    path = tmp_path / "conversations.json"
    path.write_text("{broken", encoding="utf-8")
    store = ConversationStore(path)

    state = store.load_state()

    assert len(state["sessions"]) == 1
    backups = list(tmp_path.glob("conversations.json.*.bak"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "{broken"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_conversation_store.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'datamedic.ui'`.

- [ ] **Step 3: Implement minimal conversation store**

Create `src/datamedic/ui/__init__.py`:

```python
"""Streamlit UI helpers for DataMedic."""
```

Create `src/datamedic/ui/conversation_store.py`:

```python
from __future__ import annotations

import json
import os
import shutil
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_TITLE = "新的运营问答"
DEFAULT_STORE_PATH = Path(".datamedic") / "conversations.json"


class ConversationStore:
    def __init__(self, path: str | Path = DEFAULT_STORE_PATH):
        self.path = Path(path)

    def load_state(self) -> dict[str, Any]:
        if not self.path.exists():
            state = self._empty_state()
            self.ensure_active_session(state)
            self.save_state(state)
            return state

        try:
            raw_state = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            self._backup_corrupt_file()
            state = self._empty_state()
            self.ensure_active_session(state)
            self.save_state(state)
            return state

        state = self._normalize_state(raw_state)
        self.ensure_active_session(state)
        return state

    def save_state(self, state: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(tmp_path, self.path)

    def ensure_active_session(self, state: dict[str, Any]) -> dict[str, Any]:
        sessions = state.setdefault("sessions", [])
        active_id = state.get("active_session_id")
        if sessions and any(session["id"] == active_id for session in sessions):
            return self.get_session(state, active_id)
        if sessions:
            state["active_session_id"] = sessions[0]["id"]
            return sessions[0]
        session = self._new_session()
        sessions.append(session)
        state["active_session_id"] = session["id"]
        return session

    def create_session(self, state: dict[str, Any]) -> dict[str, Any]:
        session = self._new_session()
        state.setdefault("sessions", []).insert(0, session)
        state["active_session_id"] = session["id"]
        return session

    def delete_session(self, state: dict[str, Any], session_id: str) -> None:
        state["sessions"] = [
            session for session in state.get("sessions", []) if session["id"] != session_id
        ]
        if state.get("active_session_id") == session_id:
            state["active_session_id"] = state["sessions"][0]["id"] if state["sessions"] else ""
        self.ensure_active_session(state)

    def set_active_session(self, state: dict[str, Any], session_id: str) -> None:
        if any(session["id"] == session_id for session in state.get("sessions", [])):
            state["active_session_id"] = session_id

    def append_message(self, state: dict[str, Any], session_id: str, message: dict[str, Any]) -> None:
        session = self.get_session(state, session_id)
        normalized = {
            "role": message.get("role", "assistant"),
            "text": str(message.get("text", "")),
            "figures": deepcopy(message.get("figures", [])),
        }
        session.setdefault("messages", []).append(normalized)
        session["message_count"] = len(session["messages"])
        session["summary"] = normalized["text"]
        session["updated_at"] = self._now()
        if session.get("title") == DEFAULT_TITLE and normalized["role"] == "user":
            session["title"] = self._title_from_text(normalized["text"])
        self._move_session_to_top(state, session_id)

    def get_session(self, state: dict[str, Any], session_id: str) -> dict[str, Any]:
        for session in state.get("sessions", []):
            if session["id"] == session_id:
                return session
        raise KeyError(f"Unknown session: {session_id}")

    def _empty_state(self) -> dict[str, Any]:
        return {"active_session_id": "", "sessions": []}

    def _new_session(self) -> dict[str, Any]:
        now = self._now()
        return {
            "id": str(uuid.uuid4()),
            "title": DEFAULT_TITLE,
            "summary": "还没有消息",
            "created_at": now,
            "updated_at": now,
            "message_count": 0,
            "messages": [],
        }

    def _normalize_state(self, raw_state: Any) -> dict[str, Any]:
        if not isinstance(raw_state, dict):
            return self._empty_state()

        state = {
            "active_session_id": str(raw_state.get("active_session_id") or ""),
            "sessions": [],
        }
        for raw_session in raw_state.get("sessions", []):
            if not isinstance(raw_session, dict):
                continue
            session_id = str(raw_session.get("id") or uuid.uuid4())
            messages = [
                {
                    "role": str(message.get("role", "assistant")),
                    "text": str(message.get("text", "")),
                    "figures": deepcopy(message.get("figures", [])),
                }
                for message in raw_session.get("messages", [])
                if isinstance(message, dict)
            ]
            state["sessions"].append(
                {
                    "id": session_id,
                    "title": str(raw_session.get("title") or DEFAULT_TITLE),
                    "summary": str(raw_session.get("summary") or self._summary_from_messages(messages)),
                    "created_at": str(raw_session.get("created_at") or self._now()),
                    "updated_at": str(raw_session.get("updated_at") or raw_session.get("created_at") or self._now()),
                    "message_count": len(messages),
                    "messages": messages,
                }
            )
        return state

    def _move_session_to_top(self, state: dict[str, Any], session_id: str) -> None:
        sessions = state.get("sessions", [])
        sessions.sort(key=lambda session: session["id"] != session_id)

    def _backup_corrupt_file(self) -> None:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        backup_path = self.path.with_name(f"{self.path.name}.{timestamp}.bak")
        shutil.move(str(self.path), str(backup_path))

    def _title_from_text(self, text: str) -> str:
        compact = " ".join(text.split())
        if len(compact) <= 18:
            return compact or DEFAULT_TITLE
        return f"{compact[:18]}..."

    def _summary_from_messages(self, messages: list[dict[str, Any]]) -> str:
        if not messages:
            return "还没有消息"
        return str(messages[-1].get("text") or "还没有消息")

    def _now(self) -> str:
        return datetime.now().astimezone().isoformat(timespec="seconds")
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
.venv/bin/python -m pytest tests/test_conversation_store.py -q
```

Expected: PASS.

## Task 2: Chat Client

**Files:**
- Create: `src/datamedic/ui/chat_client.py`
- Test: `tests/test_chat_client.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_chat_client.py`:

```python
from unittest.mock import Mock

import requests

from datamedic.ui.chat_client import ChatClient


def test_send_message_returns_text_and_figures():
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"text": "分析完成", "figures": [{"data": []}]}
    post = Mock(return_value=response)
    client = ChatClient("http://api.example", post=post)

    result = client.send_message("session-1", "问题")

    assert result == {"text": "分析完成", "figures": [{"data": []}], "ok": True}
    post.assert_called_once_with(
        "http://api.example/chat",
        json={"session_id": "session-1", "message": "问题"},
        timeout=60,
    )


def test_connection_error_returns_friendly_message():
    client = ChatClient("http://api.example", post=Mock(side_effect=requests.exceptions.ConnectionError))

    result = client.send_message("session-1", "问题")

    assert result["ok"] is False
    assert "无法连接到后端服务" in result["text"]
    assert result["figures"] == []


def test_timeout_returns_friendly_message():
    client = ChatClient("http://api.example", post=Mock(side_effect=requests.exceptions.Timeout))

    result = client.send_message("session-1", "问题")

    assert result["ok"] is False
    assert "分析时间较长" in result["text"]


def test_bad_json_returns_friendly_message():
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.side_effect = ValueError("bad json")
    client = ChatClient("http://api.example", post=Mock(return_value=response))

    result = client.send_message("session-1", "问题")

    assert result["ok"] is False
    assert "后端返回格式异常" in result["text"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_chat_client.py -q
```

Expected: FAIL with `ModuleNotFoundError` or import error for `datamedic.ui.chat_client`.

- [ ] **Step 3: Implement chat client**

Create `src/datamedic/ui/chat_client.py`:

```python
from __future__ import annotations

from typing import Any, Callable

import requests


class ChatClient:
    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        post: Callable[..., requests.Response] | None = None,
        timeout: int = 60,
    ):
        self.base_url = base_url.rstrip("/")
        self.post = post or requests.post
        self.timeout = timeout

    def send_message(self, session_id: str, message: str) -> dict[str, Any]:
        try:
            response = self.post(
                f"{self.base_url}/chat",
                json={"session_id": session_id, "message": message},
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except requests.exceptions.ConnectionError:
            return self._error("无法连接到后端服务，请确认 FastAPI 已启动。")
        except requests.exceptions.Timeout:
            return self._error("分析时间较长，请稍后重试或缩小问题范围。")
        except requests.exceptions.RequestException as exc:
            return self._error(f"请求后端服务失败：{exc}")
        except ValueError:
            return self._error("后端返回格式异常，请稍后重试。")

        return {
            "ok": True,
            "text": str(payload.get("text", "")),
            "figures": payload.get("figures") or [],
        }

    def _error(self, text: str) -> dict[str, Any]:
        return {"ok": False, "text": text, "figures": []}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
.venv/bin/python -m pytest tests/test_chat_client.py -q
```

Expected: PASS.

## Task 3: API Route Helpers

**Files:**
- Modify: `src/datamedic/api/routes.py`
- Modify: `tests/test_api.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_api.py`:

```python
from types import SimpleNamespace

from datamedic.api.routes import _extract_ai_text, _extract_visualize_tool_args


def test_extract_ai_text_returns_last_ai_message():
    messages = [
        SimpleNamespace(type="ai", content="旧回答"),
        SimpleNamespace(type="human", content="问题"),
        SimpleNamespace(type="ai", content="新回答"),
    ]

    assert _extract_ai_text(messages) == "新回答"


def test_extract_visualize_tool_args_returns_matching_calls():
    messages = [
        SimpleNamespace(tool_calls=[{"name": "query_metric", "args": {"x": 1}}]),
        SimpleNamespace(tool_calls=[{"name": "visualize_tool", "args": {"department": "骨科"}}]),
    ]

    assert _extract_visualize_tool_args(messages) == [{"department": "骨科"}]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_api.py -q
```

Expected: FAIL because `_extract_ai_text` and `_extract_visualize_tool_args` do not exist.

- [ ] **Step 3: Extract helpers and use them in route**

Modify the top portion of `src/datamedic/api/routes.py` to include:

```python
def _extract_ai_text(messages) -> str:
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "ai" and msg.content:
            return msg.content
    return ""


def _extract_visualize_tool_args(messages) -> list[dict]:
    tool_args = []
    for msg in messages:
        if hasattr(msg, "tool_calls"):
            for tool_call in msg.tool_calls:
                if tool_call.get("name") == "visualize_tool":
                    tool_args.append(tool_call.get("args", {}))
    return tool_args


def _build_figures(messages) -> list[dict]:
    figures = []
    if not any(
        hasattr(msg, "type") and msg.type == "tool" and getattr(msg, "name", "") == "visualize_tool"
        for msg in messages
    ):
        return figures

    from datamedic.tools.viz_tool import visualize_metric

    for tool_args in _extract_visualize_tool_args(messages):
        try:
            viz_result = visualize_metric(**tool_args)
            if viz_result.get("figure_json"):
                figures.append(json.loads(viz_result["figure_json"]))
        except Exception:
            continue
    return figures
```

Then replace the duplicated text/figure extraction inside `chat()` with:

```python
        messages = result.get("messages", [])
        output_text = _extract_ai_text(messages)
        figures = _build_figures(messages)
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
.venv/bin/python -m pytest tests/test_api.py -q
```

Expected: PASS.

## Task 4: Streamlit Styles

**Files:**
- Create: `src/datamedic/ui/styles.py`

- [ ] **Step 1: Create CSS module**

Create `src/datamedic/ui/styles.py`:

```python
def app_css() -> str:
    return """
<style>
:root {
  --dm-bg: #fbfaf7;
  --dm-panel: #ffffff;
  --dm-panel-soft: #f7f3ed;
  --dm-border: #eadfce;
  --dm-border-strong: #d9cbb9;
  --dm-text: #172033;
  --dm-muted: #7b7168;
  --dm-green: #235b52;
  --dm-green-2: #2f756a;
  --dm-mint: #dff4ef;
  --dm-danger: #a9483f;
  --dm-shadow: 0 18px 44px rgba(117, 87, 42, 0.08);
}

.stApp {
  background:
    radial-gradient(circle at 20% 0%, rgba(223, 244, 239, 0.72), transparent 28rem),
    linear-gradient(180deg, #fbfaf7 0%, #f6f1ea 100%);
}

section[data-testid="stSidebar"] {
  background: #fffaf2;
  border-right: 1px solid var(--dm-border);
}

section[data-testid="stSidebar"] > div {
  padding-top: 1.25rem;
}

.block-container {
  max-width: min(1280px, calc(100vw - 2rem));
  padding-top: 1.25rem;
  padding-bottom: 6rem;
}

.dm-brand {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 1.2rem;
}

.dm-logo {
  position: relative;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 14px;
  background:
    linear-gradient(135deg, #2f756a 0%, #173d38 100%);
  box-shadow: 0 14px 28px rgba(35, 91, 82, 0.24);
}

.dm-logo::before {
  content: "";
  position: absolute;
  left: 10px;
  right: 10px;
  top: 21px;
  height: 2px;
  background: #f8f1e7;
  box-shadow: 7px -7px 0 -1px #f8f1e7, 14px 5px 0 -1px #f8f1e7;
}

.dm-logo::after {
  content: "";
  position: absolute;
  width: 8px;
  height: 8px;
  right: 9px;
  bottom: 9px;
  border-radius: 999px;
  background: #bfe2da;
}

.dm-brand-name {
  font-size: 1.28rem;
  font-weight: 850;
  line-height: 1.05;
  color: var(--dm-text);
  letter-spacing: 0;
}

.dm-brand-subtitle {
  margin-top: 0.2rem;
  font-size: 0.78rem;
  color: var(--dm-muted);
}

.dm-sidebar-card,
.dm-main-header,
.dm-empty-state {
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid var(--dm-border);
  border-radius: 14px;
  box-shadow: var(--dm-shadow);
}

.dm-sidebar-card {
  padding: 0.9rem;
  margin-top: 1rem;
}

.dm-session-meta {
  color: var(--dm-muted);
  font-size: 0.78rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.dm-session-title {
  color: var(--dm-text);
  font-weight: 780;
  overflow-wrap: anywhere;
}

.dm-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.dm-stat {
  background: var(--dm-panel-soft);
  border: 1px solid var(--dm-border);
  border-radius: 10px;
  padding: 0.65rem;
}

.dm-stat strong {
  display: block;
  color: var(--dm-text);
}

.dm-main-header {
  padding: 1rem 1.15rem;
  margin-bottom: 1rem;
}

.dm-eyebrow {
  color: var(--dm-muted);
  font-weight: 760;
  font-size: 0.78rem;
}

.dm-page-title {
  color: var(--dm-text);
  font-size: clamp(1.55rem, 2.5vw, 2.35rem);
  font-weight: 900;
  line-height: 1.12;
  margin: 0.15rem 0 0.7rem;
  overflow-wrap: anywhere;
}

.dm-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.dm-pill {
  border: 1px solid var(--dm-border);
  background: var(--dm-panel-soft);
  color: var(--dm-muted);
  border-radius: 999px;
  padding: 0.35rem 0.62rem;
  font-size: 0.78rem;
  white-space: nowrap;
}

.dm-empty-state {
  padding: 1.1rem;
  margin: 1rem 0;
}

.dm-empty-title {
  color: var(--dm-text);
  font-size: 1rem;
  font-weight: 820;
  margin-bottom: 0.4rem;
}

.dm-empty-copy {
  color: var(--dm-muted);
  font-size: 0.88rem;
  margin-bottom: 0.8rem;
}

.dm-chat-note {
  color: var(--dm-muted);
  font-size: 0.78rem;
  text-align: center;
  margin: 0.8rem 0;
}

div[data-testid="stChatMessage"] {
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(234, 223, 206, 0.82);
  border-radius: 16px;
  padding: 0.75rem;
  box-shadow: 0 10px 26px rgba(117, 87, 42, 0.055);
}

div[data-testid="stChatInput"] {
  background: rgba(255, 255, 255, 0.88);
  border-top: 1px solid var(--dm-border);
}

div[data-testid="stButton"] > button {
  border-radius: 10px;
  border: 1px solid var(--dm-border);
  min-height: 2.4rem;
  transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
}

div[data-testid="stButton"] > button:hover {
  border-color: var(--dm-green);
  color: var(--dm-green);
  transform: translateY(-1px);
}

@media (max-width: 760px) {
  .block-container {
    max-width: calc(100vw - 1rem);
    padding-left: 0.65rem;
    padding-right: 0.65rem;
  }

  .dm-brand-subtitle,
  .dm-pill.optional {
    display: none;
  }

  .dm-page-title {
    font-size: 1.45rem;
  }
}
</style>
"""
```

- [ ] **Step 2: Syntax check**

Run:

```bash
.venv/bin/python -m py_compile src/datamedic/ui/styles.py
```

Expected: no output and exit code 0.

## Task 5: Refactor Streamlit App

**Files:**
- Modify: `src/datamedic/app.py`

- [ ] **Step 1: Replace app with conversation-suite implementation**

Replace `src/datamedic/app.py` with:

```python
import json
import os
from datetime import datetime

import plotly.io as pio
import streamlit as st
import streamlit.components.v1 as components

from datamedic.ui.chat_client import ChatClient
from datamedic.ui.conversation_store import ConversationStore
from datamedic.ui.styles import app_css


API_BASE_URL = os.getenv("DATAMEDIC_API_BASE_URL", "http://localhost:8000")
STORE_PATH = os.getenv("DATAMEDIC_CONVERSATION_STORE", ".datamedic/conversations.json")


def format_time(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return ""
    return parsed.strftime("%m-%d %H:%M")


def render_brand() -> None:
    st.markdown(
        """
<div class="dm-brand">
  <div class="dm-logo" aria-hidden="true"></div>
  <div>
    <div class="dm-brand-name">DataMedic</div>
    <div class="dm-brand-subtitle">医院运营数据顾问</div>
  </div>
</div>
""",
        unsafe_allow_html=True,
    )


def render_sidebar(store: ConversationStore, state: dict) -> None:
    with st.sidebar:
        render_brand()

        if st.button("新建会话", use_container_width=True, type="primary"):
            store.create_session(state)
            store.save_state(state)
            st.rerun()

        st.markdown('<div class="dm-sidebar-card">', unsafe_allow_html=True)
        st.markdown("#### 最近会话")
        for session in state["sessions"]:
            is_active = session["id"] == state["active_session_id"]
            label = f"{'● ' if is_active else ''}{session['title']}"
            if st.button(label, key=f"session-{session['id']}", use_container_width=True):
                store.set_active_session(state, session["id"])
                store.save_state(state)
                st.rerun()
            st.markdown(
                f"""
<div class="dm-session-meta">
  {format_time(session.get("updated_at", ""))} · {session.get("message_count", 0)} 条消息<br>
  {session.get("summary", "还没有消息")}
</div>
""",
                unsafe_allow_html=True,
            )
            if st.button("删除", key=f"delete-{session['id']}", use_container_width=True):
                store.delete_session(state, session["id"])
                store.save_state(state)
                st.rerun()
        st.markdown("</div>", unsafe_allow_html=True)

        st.markdown(
            """
<div class="dm-sidebar-card">
  <div class="dm-session-title">数据范围</div>
  <div class="dm-stat-grid" style="margin-top:.7rem">
    <div class="dm-stat"><strong>2022-2025</strong><span class="dm-session-meta">时间跨度</span></div>
    <div class="dm-stat"><strong>20</strong><span class="dm-session-meta">覆盖科室</span></div>
    <div class="dm-stat"><strong>51</strong><span class="dm-session-meta">运营指标</span></div>
    <div class="dm-stat"><strong>AI</strong><span class="dm-session-meta">多轮问数</span></div>
  </div>
</div>
""",
            unsafe_allow_html=True,
        )


def render_header(session: dict) -> None:
    st.markdown(
        f"""
<div class="dm-main-header">
  <div class="dm-eyebrow">当前会话</div>
  <div class="dm-page-title">{session["title"]}</div>
  <div class="dm-pill-row">
    <span class="dm-pill">2022.1 - 2025.12</span>
    <span class="dm-pill">20 个科室</span>
    <span class="dm-pill optional">51 项运营指标</span>
    <span class="dm-pill optional">上下文独立</span>
  </div>
</div>
""",
        unsafe_allow_html=True,
    )


def render_empty_state() -> None:
    st.markdown(
        """
<div class="dm-empty-state">
  <div class="dm-empty-title">从一个运营问题开始</div>
  <div class="dm-empty-copy">可以查询指标、比较科室、观察趋势，也可以继续追问原因。</div>
</div>
""",
        unsafe_allow_html=True,
    )
    examples = [
        "展示 2025 年骨科出院人次趋势",
        "心内科和心外科手术人次对比",
        "哪个科室手术人次最多",
        "为什么门诊人次下降",
    ]
    cols = st.columns(2)
    for index, example in enumerate(examples):
        with cols[index % 2]:
            st.caption(example)


def render_messages(messages: list[dict]) -> None:
    for msg in messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["text"])
            for fig_json in msg.get("figures", []):
                try:
                    fig = pio.from_json(json.dumps(fig_json))
                    st.plotly_chart(fig, use_container_width=True)
                except ValueError:
                    st.warning("图表数据解析失败，但文字分析已保留。")


def render_voice_input() -> None:
    voice_path = os.path.join(os.path.dirname(__file__), "static", "voice_input.html")
    if os.path.exists(voice_path):
        with open(voice_path, "r", encoding="utf-8") as f:
            components.html(f.read(), height=54)


def main() -> None:
    st.set_page_config(page_title="DataMedic 医院运营数据顾问", layout="wide")
    st.markdown(app_css(), unsafe_allow_html=True)

    store = ConversationStore(STORE_PATH)
    state = store.load_state()
    active_session = store.ensure_active_session(state)
    store.save_state(state)

    render_sidebar(store, state)
    render_header(active_session)

    if active_session["messages"]:
        render_messages(active_session["messages"])
    else:
        render_empty_state()

    render_voice_input()
    st.markdown('<div class="dm-chat-note">语音输入可用于快速记录问题，发送前请确认识别文字。</div>', unsafe_allow_html=True)

    if user_input := st.chat_input("向 DataMedic 提问，例如：去年12月胸外科门诊人次是多少？"):
        session_id = state["active_session_id"]
        store.append_message(state, session_id, {"role": "user", "text": user_input, "figures": []})
        store.save_state(state)

        with st.chat_message("user"):
            st.markdown(user_input)

        client = ChatClient(API_BASE_URL)
        with st.chat_message("assistant"):
            with st.spinner("DataMedic 正在分析..."):
                result = client.send_message(session_id, user_input)
                if result["ok"]:
                    st.markdown(result["text"])
                else:
                    st.error(result["text"])

                for fig_json in result.get("figures", []):
                    try:
                        fig = pio.from_json(json.dumps(fig_json))
                        st.plotly_chart(fig, use_container_width=True)
                    except ValueError:
                        st.warning("图表数据解析失败，但文字分析已保留。")

        store.append_message(
            state,
            session_id,
            {
                "role": "assistant",
                "text": result["text"],
                "figures": result.get("figures", []),
            },
        )
        store.save_state(state)
        st.rerun()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Syntax check**

Run:

```bash
.venv/bin/python -m py_compile src/datamedic/app.py
```

Expected: no output and exit code 0.

## Task 6: Full Automated Verification

**Files:**
- All modified production and test files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_conversation_store.py tests/test_chat_client.py tests/test_api.py -q
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
.venv/bin/python -m pytest -q
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git status --short
git diff -- src/datamedic/app.py src/datamedic/api/routes.py src/datamedic/ui tests docs/superpowers/plans/2026-05-13-modern-session-ui.md
```

Expected: only planned files changed, plus existing unrelated `pyproject.toml` still unstaged.

## Task 7: Manual Streamlit Verification

**Files:**
- No new file changes expected unless visual bugs are found.

- [ ] **Step 1: Start backend**

Run:

```bash
.venv/bin/python -m uvicorn datamedic.server:app --host 127.0.0.1 --port 8000
```

Expected: server starts and `/health` is available.

- [ ] **Step 2: Start Streamlit**

Run in a second terminal:

```bash
DATAMEDIC_CONVERSATION_STORE=.datamedic/dev-conversations.json .venv/bin/python -m streamlit run src/datamedic/app.py --server.port 8501
```

Expected: Streamlit app starts at `http://localhost:8501`.

- [ ] **Step 3: Browser verify**

Open `http://localhost:8501` and check:

- Left brand mark and `DataMedic` name are visually distinct.
- Sidebar shows New Session, recent sessions, delete controls, and data stats.
- Main page shows current session header and example prompts for empty sessions.
- Creating, switching, and deleting sessions works.
- Refreshing the page preserves sessions from `.datamedic/dev-conversations.json`.
- Narrowing the browser does not cause overlapping text or unusable controls.

## Self-Review

- Spec coverage: local JSON persistence, session CRUD, `session_id` isolation, designed brand area, responsive UI, chart rendering, voice component preservation, and tests are covered by tasks.
- Placeholder scan: no placeholder implementation steps remain.
- Type consistency: tests and implementation use `ConversationStore`, `ChatClient`, `app_css`, `_extract_ai_text`, `_extract_visualize_tool_args`, and `_build_figures` consistently.
