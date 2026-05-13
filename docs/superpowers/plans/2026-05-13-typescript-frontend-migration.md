# TypeScript Frontend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Streamlit frontend with a polished Claude-inspired TypeScript SPA while preserving the existing FastAPI backend and chat/session behavior.

**Architecture:** Keep Python FastAPI as the API server for `/chat`, `/ws/speech`, `/ws/tts`, and `/health`. Add a `frontend/` Vite React TypeScript app that stores conversations in browser `localStorage`, calls the backend via a Vite proxy, renders Plotly figures, and provides a custom voice-enabled composer. Remove the failed Streamlit UI helper package and make `src/datamedic/app.py` a compatibility notice rather than the main frontend.

**Tech Stack:** Vite, React, TypeScript, Vitest, Testing Library, Plotly.js, FastAPI, Pytest.

---

## Tasks

### Task 1: Cleanup Failed Streamlit UI Path

**Files:**
- Modify: `src/datamedic/app.py`
- Delete: `src/datamedic/ui/__init__.py`
- Delete: `src/datamedic/ui/chat_client.py`
- Delete: `src/datamedic/ui/conversation_store.py`
- Delete: `src/datamedic/ui/styles.py`
- Delete: `src/datamedic/ui/voice_component.py`
- Delete: `tests/test_chat_client.py`
- Delete: `tests/test_conversation_store.py`
- Delete: `tests/test_ui_design_contract.py`

- [ ] Replace `src/datamedic/app.py` with a short Streamlit compatibility page telling users to run the TypeScript frontend.
- [ ] Remove Python UI helper modules and tests that only applied to the failed Streamlit redesign.
- [ ] Keep backend route helper refactor and `tests/test_api.py`.

### Task 2: Frontend Scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/index.html`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/vite-env.d.ts`

- [ ] Add Vite React TypeScript scripts: `dev`, `build`, `preview`, `test`.
- [ ] Configure Vite proxy for `/chat`, `/health`, `/ws/speech`, and `/ws/tts` to `http://localhost:8000`.
- [ ] Configure Vitest with jsdom.

### Task 3: Frontend Core Logic

**Files:**
- Create: `frontend/src/types.ts`
- Create: `frontend/src/storage.ts`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/voice.ts`
- Create: `frontend/src/storage.test.ts`
- Create: `frontend/src/api.test.ts`

- [ ] Define typed `Conversation`, `ChatMessage`, `ChatResponse`, and app state.
- [ ] Implement localStorage-backed session CRUD with default session, create, switch, delete, append.
- [ ] Implement API client for `/chat` with friendly error handling.
- [ ] Implement a `SpeechRecognizer` class that streams 16-bit PCM frames to `/ws/speech` and returns recognized text callbacks.
- [ ] Test storage and API behavior with Vitest.

### Task 4: Claude-Inspired UI

**Files:**
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/App.css`

- [ ] Build a warm Claude-inspired layout: left conversation rail, polished brand mark, main message canvas, welcome prompts, Plotly chart panels, and bottom composer.
- [ ] Place the microphone button inside the composer on the left side of the input.
- [ ] Support create/switch/delete conversations, send messages, loading state, backend errors, and Plotly figures.
- [ ] Use responsive CSS so the sidebar collapses gracefully on narrow screens.

### Task 5: Verification

**Commands:**
- `cd frontend && npm install`
- `cd frontend && npm test -- --run`
- `cd frontend && npm run build`
- `.venv/bin/python -m pytest -q`
- Run backend: `.venv/bin/python -m uvicorn datamedic.server:app --host 127.0.0.1 --port 8000`
- Run frontend: `cd frontend && npm run dev -- --host 127.0.0.1`

- [ ] Verify tests and build pass.
- [ ] Use browser automation to inspect `http://localhost:5173`.
- [ ] Screenshot desktop and narrow viewport.
- [ ] Confirm visible Claude-inspired layout, left mic composer, session CRUD, and no console errors.

## Self-Review

- The plan replaces Streamlit for the main frontend instead of attempting more Streamlit visual work.
- The existing backend API remains compatible.
- The failed Python UI helper modules are explicitly removed to avoid duplicate frontends.
- TypeScript tests cover state and API behavior; browser verification covers visual quality.
