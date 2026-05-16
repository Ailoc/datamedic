# Backend JSON Conversation Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chat conversations as backend JSON files, recover them through the frontend, and bound model input to the latest 10 text rounds.

**Architecture:** Add a backend `chat_store` module as the durable conversation boundary, expose `/sessions` APIs, and change chat routes to load recent text history from JSON instead of relying on long-lived LangGraph memory. The frontend keeps its existing state shape but hydrates it from the backend first, with localStorage as fallback/cache.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, Pytest, React 19, TypeScript, Vite, Vitest, Testing Library.

---

### Task 1: Backend Store

**Files:**
- Create: `src/datamedic/chat_store.py`
- Create: `tests/test_chat_store.py`
- Modify: `src/datamedic/config.py`

- [ ] Write tests for create/load/list/delete, figure preservation, path-safe session IDs, and latest 10 text rounds.
- [ ] Implement JSON atomic saves under `CONVERSATION_DATA_DIR`.
- [ ] Run `pytest tests/test_chat_store.py -q`.

### Task 2: Backend API Integration

**Files:**
- Modify: `src/datamedic/api/schemas.py`
- Modify: `src/datamedic/api/routes.py`
- Modify: `tests/test_api.py`

- [ ] Add conversation/message response schemas.
- [ ] Add `GET /sessions`, `POST /sessions`, `DELETE /sessions/{session_id}`.
- [ ] Persist user and assistant messages in `/chat` and `/chat/stream`.
- [ ] Build model input from the store's latest 10 text rounds and use an ephemeral LangGraph thread ID per request.
- [ ] Add tests proving stream persistence preserves returned figures.
- [ ] Run `pytest tests/test_api.py -q`.

### Task 3: Frontend Session API and Hydration

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/api.test.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

- [ ] Add `fetchSessions`, `createBackendSession`, and `deleteBackendSession`.
- [ ] Hydrate app state from backend sessions on startup; fall back to localStorage on failure.
- [ ] Make new/delete conversation actions call backend endpoints and update local cache.
- [ ] Add tests for backend hydration, fallback, create, and delete.
- [ ] Run `npm test -- --run src/api.test.ts src/App.test.tsx`.

### Task 4: Full Verification

**Files:**
- All changed files.

- [ ] Run `.venv/bin/python -m pytest -q`.
- [ ] Run `cd frontend && npm test -- --run`.
- [ ] Run `cd frontend && npm run build`.
- [ ] Run `git diff --check`.
