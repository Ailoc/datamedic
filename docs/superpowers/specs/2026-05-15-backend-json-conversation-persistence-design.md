# Backend JSON Conversation Persistence Design

## Goal

Persist every chat conversation on the backend as JSON files so sessions survive browser refreshes, browser changes, and backend restarts, while sending only the latest 10 rounds of text history to the model to prevent context growth. Persisted chart data must remain in the same Plotly figure JSON shape the frontend already renders.

## Current Behavior

- The frontend stores conversations in `localStorage` under `datamedic.conversations.v1`.
- The backend maps `session_id` to LangGraph `thread_id` through `MemorySaver`, which is in-memory and lost on backend restart.
- The chat API returns `figures` as Plotly figure JSON objects, and the frontend stores those figures inside assistant messages.
- The backend rebuilds current-turn figures from `visualize_tool` calls before returning a chat response.

## Target Behavior

- Backend conversation files become the durable source of truth.
- Each conversation is stored at `data/conversations/<session_id>/conversation.json`.
- The JSON structure mirrors the frontend conversation shape: `id`, `title`, `summary`, timestamps, and `messages`.
- Each message stores `id`, `role`, `text`, `figures`, and `createdAt`.
- `figures` stores raw Plotly figure JSON objects, not stringified JSON, so the frontend can render them without transformation.
- Model input contains only recent text history: the latest 10 complete or partial user/assistant rounds plus the current user message.
- Figure JSON is never sent to the model.

## Backend API Design

Add session management endpoints:

- `GET /sessions`: return all persisted conversations sorted by `updatedAt` descending.
- `POST /sessions`: create a new empty conversation and return it.
- `DELETE /sessions/{session_id}`: delete a conversation folder.

Keep existing chat endpoints:

- `POST /chat`
- `POST /chat/stream`

For chat requests:

1. Load or create the requested conversation.
2. Append the user message before invoking the model.
3. Build model input from the last 10 rounds of persisted text messages plus the current user message.
4. Invoke the agent without relying on persisted LangGraph memory for long-term history.
5. Rebuild current-turn Plotly figures from visualization tool calls.
6. Append the assistant message with final text and figure JSON.
7. Persist the full conversation atomically.
8. Return the same frontend-compatible response contract as today.

## Storage Design

Create `src/datamedic/chat_store.py` with focused responsibilities:

- Sanitize session IDs for path safety while preserving stable IDs.
- Create empty conversations.
- Load one conversation.
- List conversations.
- Append messages.
- Save JSON atomically using a temporary file and replace.
- Delete conversation folders.
- Build model history from text-only persisted messages.

`data/conversations` is configurable through `CONVERSATION_DATA_DIR`, defaulting to `DATA_DIR / "conversations"`.

## Context Window Design

A round is a user message followed by an optional assistant message. The store will keep full history on disk but expose only the last 10 rounds as model messages. The current user message is appended to the model input once, after historical messages are selected.

If the current user message has already been appended to disk before model invocation, the model-history helper excludes that final message before appending it again to the request payload.

## Frontend Design

The frontend keeps the current UI state shape. It adds API functions for backend sessions:

- `fetchSessions()`
- `createBackendSession()`
- `deleteBackendSession(id)`

On startup, `App` loads persisted sessions from the backend. If backend loading fails, it falls back to existing `localStorage` behavior so the UI remains usable during backend outages.

New conversation and delete conversation actions call backend session endpoints and then update local React state. Chat submission still passes the active conversation ID as `session_id`.

The existing local storage helpers remain as a fallback/cache, but backend JSON is the durable source once `/sessions` is available.

## Testing Design

Backend tests cover:

- Creating, loading, listing, and deleting conversation files.
- JSON files preserve assistant figures as objects.
- Model history includes only the latest 10 rounds of text and excludes figures.
- `/chat/stream` persists user and assistant messages with returned figures.
- `/sessions` endpoints return frontend-compatible conversation JSON.

Frontend tests cover:

- Startup loads conversations from `/sessions`.
- Backend outage falls back to local storage.
- New conversation calls `POST /sessions`.
- Delete conversation calls `DELETE /sessions/{id}`.
- Existing chart rendering still receives persisted `figures` arrays.

## Success Criteria

- Conversations survive backend restart because they are stored as JSON files.
- Frontend can refresh and recover messages plus chart figures from the backend.
- Model input is bounded to the latest 10 rounds of text history.
- No Plotly figure JSON is sent into model context.
- Existing chat and chart workflows keep working.
- Backend tests, frontend tests, frontend build, and diff checks pass.
