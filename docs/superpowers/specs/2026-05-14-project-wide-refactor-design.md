# Project-Wide Refactor Design

## Goal

Improve DataMedic's reliability and maintainability across the Python API, analysis tools, and React frontend while preserving existing user-facing behavior and current visual design.

## Current Findings

- Backend pytest passes: 33 tests.
- Frontend Vitest passes: 27 tests.
- Frontend production build passes.
- The repository has many existing uncommitted changes. This work treats those changes as the current project state and avoids reverting unrelated edits.
- The main structural risk is size and coupling: `frontend/src/App.tsx` owns state, streaming, speech, Plotly theming, layout components, and rendering.
- The main backend risks are weak request/tool input validation, inconsistent behavior between query and visualization tools, and a Pandas sandbox that relies on substring blocking plus `signal.alarm`.

## Scope

This refactor covers four areas:

1. Backend request and tool validation.
2. Safer and clearer Pandas execution guardrails.
3. Frontend module decomposition without visual redesign.
4. Regression tests and full verification.

Out of scope:

- Replacing LangGraph or changing the agent orchestration model.
- Redesigning the application UI.
- Changing data files or generated metric content.
- Adding authentication, persistence services, or deployment infrastructure.

## Backend Design

### Request Validation

`ChatRequest` will validate:

- `session_id`: non-empty after trimming, bounded length.
- `message`: non-empty after trimming, bounded length.

This keeps invalid calls from reaching the agent and gives FastAPI a consistent 422 response for malformed requests.

### Tool Parameter Normalization

Add a focused helper module under `src/datamedic/tools/validation.py` for reusable tool input checks:

- Normalize department lists. Empty department lists mean all known departments.
- Reject unknown departments with a clear message.
- Reject unknown metrics with a clear message.
- Validate month range is 1-12.
- Validate the period start is not after the period end.
- Validate aggregation, sort, and chart type values.

`query_metric`, `visualize_metric`, and `analyze_cause` will call these helpers before filtering data. This aligns query and visualization behavior, especially for empty department lists.

### Pandas Guardrails

Replace substring-only blocking with AST validation:

- Parse submitted code with `ast.parse`.
- Reject imports, function/class definitions, lambdas, global/nonlocal, with-statements, try/raise, async constructs, and access to dunder attributes.
- Reject calls to dangerous names such as `open`, `exec`, `eval`, `compile`, `breakpoint`, `globals`, `locals`, `vars`, and `__import__`.
- Continue executing with restricted builtins and copied data.

Timeout behavior will be preserved where the platform supports it. Because `signal.alarm` only works in the main thread, non-main-thread execution will skip the alarm instead of crashing. The sandbox is not a security boundary for hostile users; it is a guardrail for model-generated analysis code.

## Frontend Design

Split `frontend/src/App.tsx` into focused modules:

- `components/Sidebar.tsx`: session rail, delete confirmation, footer stats.
- `components/Composer.tsx`: text input, send button, voice input button.
- `components/MessageList.tsx`: message rendering and thinking indicator.
- `components/Welcome.tsx`: empty-state examples.
- `components/PlotlyPanel.tsx`: Plotly rendering.
- `chartTheme.ts`: Plotly theme helpers.
- `speechSegments.ts`: speech segmentation helpers.
- `hooks/useChatSession.ts`: submit flow, stream state, assistant updates, speech queuing.

The refactor keeps the current CSS class names so existing tests and visual layout remain stable. `App.tsx` becomes an orchestrator that wires state, active conversation, voice output, and the extracted components.

## Testing Design

Backend tests will cover:

- Empty chat message validation.
- Empty visualization department list defaults to all departments.
- Unknown department and unknown metric messages.
- Invalid month and reversed period handling.
- Invalid aggregation, sort, and chart type handling.
- Pandas AST rejection for imports, dunder access, and dangerous calls.
- Pandas execution in a non-main thread does not crash because of `signal.alarm`.

Frontend tests will cover:

- Existing app behavior continues to pass after component extraction.
- Stream handling behavior remains unchanged.
- New pure helper tests for speech segmentation and Plotly theme payloads where extraction makes them directly testable.

## Verification

The final verification commands are:

```bash
.venv/bin/python -m pytest -q
cd frontend && npm test -- --run
cd frontend && npm run build
```

Completion means these commands pass in the current workspace after the refactor.
