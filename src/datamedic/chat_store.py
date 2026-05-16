"""Backend JSON conversation persistence.

The store keeps the full frontend-compatible conversation record on disk while
exposing a bounded text-only history for model calls.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from datamedic.config import CONVERSATION_DATA_DIR

logger = logging.getLogger(__name__)

MESSAGE_ROLES = {"user", "assistant"}
DEFAULT_TITLE = "新的运营问答"
MAX_LOCKS = 500
_locks_guard = threading.Lock()
_conversation_locks: dict[tuple[str, str], threading.Lock] = {}
_lock_access_order: list[tuple[str, str]] = []


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _conversation_root(root: Path | None = None) -> Path:
    if root is not None:
        return root
    return Path(os.getenv("CONVERSATION_DATA_DIR", str(CONVERSATION_DATA_DIR)))


def _folder_name(session_id: str) -> str:
    return quote(session_id, safe="")


def _conversation_dir(session_id: str, root: Path | None = None) -> Path:
    return _conversation_root(root) / _folder_name(session_id)


def _conversation_file(session_id: str, root: Path | None = None) -> Path:
    return _conversation_dir(session_id, root) / "conversation.json"


def _conversation_lock(session_id: str, root: Path | None = None) -> threading.Lock:
    key = (str(_conversation_root(root).resolve()), session_id)
    with _locks_guard:
        lock = _conversation_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _conversation_locks[key] = lock
            _lock_access_order.append(key)
            while len(_lock_access_order) > MAX_LOCKS:
                evicted_key = _lock_access_order.pop(0)
                _conversation_locks.pop(evicted_key, None)
        else:
            _lock_access_order.remove(key)
            _lock_access_order.append(key)
        return lock


def _new_id() -> str:
    return str(uuid4())


def _title_from_text(text: str) -> str:
    compact = " ".join(text.strip().split())
    if not compact:
        return DEFAULT_TITLE
    if len(compact) <= 15:
        return compact
    return f"{compact[:15]}..."


def _empty_conversation(session_id: str | None = None) -> dict:
    now = _now_iso()
    return {
        "id": session_id or _new_id(),
        "title": DEFAULT_TITLE,
        "summary": "还没有消息",
        "createdAt": now,
        "updatedAt": now,
        "messages": [],
    }


def _normalize_figures(figures: list[dict] | None) -> list[dict]:
    return [figure for figure in figures or [] if isinstance(figure, dict)]


def _save_conversation(conversation: dict, root: Path | None = None) -> dict:
    path = _conversation_file(str(conversation["id"]), root)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"conversation.{uuid4().hex}.json.tmp")
    temp_path.write_text(
        json.dumps(conversation, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_path.replace(path)
    return conversation


def create_conversation(session_id: str | None = None, root: Path | None = None) -> dict:
    conversation = _empty_conversation(session_id)
    return _save_conversation(conversation, root)


def load_conversation(session_id: str, root: Path | None = None) -> dict | None:
    path = _conversation_file(session_id, root)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def load_or_create_conversation(session_id: str, root: Path | None = None) -> dict:
    return load_conversation(session_id, root) or create_conversation(session_id, root)


def list_conversations(root: Path | None = None) -> list[dict]:
    base = _conversation_root(root)
    if not base.exists():
        return []

    conversations: list[dict] = []
    for path in base.glob("*/conversation.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and isinstance(payload.get("id"), str):
            conversations.append(payload)

    return sorted(conversations, key=lambda item: str(item.get("updatedAt", "")), reverse=True)


def delete_conversation(session_id: str, root: Path | None = None) -> None:
    shutil.rmtree(_conversation_dir(session_id, root), ignore_errors=True)


def append_message(
    session_id: str,
    role: str,
    text: str,
    figures: list[dict] | None = None,
    root: Path | None = None,
) -> tuple[dict, dict]:
    if role not in MESSAGE_ROLES:
        raise ValueError(f"Unsupported role: {role}")

    with _conversation_lock(session_id, root):
        conversation = load_or_create_conversation(session_id, root)
        now = _now_iso()
        message = {
            "id": _new_id(),
            "role": role,
            "text": text,
            "figures": _normalize_figures(figures),
            "createdAt": now,
        }
        conversation["messages"].append(message)
        if conversation.get("title") == DEFAULT_TITLE and role == "user":
            conversation["title"] = _title_from_text(text)
        conversation["summary"] = text or conversation.get("summary") or "还没有消息"
        conversation["updatedAt"] = now
        _save_conversation(conversation, root)
        return conversation, message


def _extract_figure_metadata(figures: list[dict]) -> tuple[set[str], set[str]]:
    """从 Plotly figure JSON 列表中提取科室名和指标名。"""
    try:
        from datamedic.data.loader import get_departments, get_metrics

        known_departments = set(get_departments())
        known_metrics = {m["name"] for m in get_metrics()}
    except Exception:
        logger.debug("Cannot load department/metric lists for figure metadata", exc_info=True)
        return set(), set()

    dept_names: set[str] = set()
    metric_names: set[str] = set()

    for fig in figures:
        title = fig.get("layout", {}).get("title", {})
        if isinstance(title, dict):
            title_text = str(title.get("text", ""))
        elif isinstance(title, str):
            title_text = title
        else:
            title_text = ""

        for dept in known_departments:
            if dept in title_text:
                dept_names.add(dept)

        for trace in fig.get("data", []):
            name = str(trace.get("name", ""))
            if name in known_metrics:
                metric_names.add(name)

    return dept_names, metric_names


def _build_figure_context(figures: list[dict]) -> str:
    """从 Plotly figure JSON 列表中提取摘要，帮助 LLM 理解上轮展示的图表内容。"""
    if not figures:
        return ""

    dept_names, metric_names = _extract_figure_metadata(figures)
    if not dept_names and not metric_names:
        return ""

    parts: list[str] = []
    if dept_names:
        parts.append("、".join(sorted(dept_names)))
    if metric_names:
        shown = sorted(metric_names)
        if len(shown) > 6:
            shown = shown[:5]
            parts.append("、".join(shown) + "等")
        else:
            parts.append("、".join(shown))

    return f"【上轮展示：{' 的 '.join(parts)}】\n"


def build_model_messages(conversation: dict, max_rounds: int = 10) -> list[dict]:
    messages = [
        message
        for message in conversation.get("messages", [])
        if isinstance(message, dict)
        and message.get("role") in MESSAGE_ROLES
        and isinstance(message.get("text"), str)
        and message.get("text")
    ]

    rounds_seen = 0
    start_index = 0
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "user":
            rounds_seen += 1
            if rounds_seen == max_rounds:
                start_index = index
                break

    selected = messages[start_index:]
    result: list[dict] = []
    for message in selected:
        content = str(message["text"])
        if message.get("role") == "assistant":
            ctx = _build_figure_context(message.get("figures", []))
            if ctx:
                content = ctx + content
        result.append({"role": str(message["role"]), "content": content})

    return result
