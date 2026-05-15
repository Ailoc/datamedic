# Project Audit Optimization Design

## Goal

Improve the current DataMedic frontend and backend code after the recent chart, speech, and refactor work by fixing verified functional issues, removing low-risk duplication, and tightening lifecycle handling without changing the product workflow or visual design.

## Current Findings

- Backend tests currently pass with 69 tests.
- The existing project-wide refactor has mostly landed: shared backend validation, Pandas AST guardrails, React component extraction, chart theming, speech segmentation, and pipelined speech playback are present.
- A verified chart bug remains: `visualize_metric(..., group_by="year")` labels the x-axis by year but still emits one point per month, producing repeated year labels instead of yearly aggregation.
- Frontend duplication remains in date formatting across `Sidebar` and `MessageList`.
- `PlotlyPanel` renders via `Plotly.react` but does not call `Plotly.purge` on unmount, which can leave Plotly-managed state behind when conversations or figures change.
- Conversation storage normalizes the top-level state but trusts stored conversation and message records too much. Corrupted localStorage can leak malformed objects into rendering.

## Scope

This optimization covers:

1. Fix yearly chart grouping so yearly views aggregate to one point per year per series.
2. Add backend regression tests for yearly chart grouping.
3. Extract shared frontend date formatting to a small utility and remove duplicated component-local helpers.
4. Purge Plotly instances on panel unmount and cover the lifecycle in tests.
5. Harden conversation storage normalization so malformed persisted conversations and messages are repaired or discarded consistently.
6. Run full backend tests, frontend tests, frontend build, and diff checks.

Out of scope:

- Large API route splitting.
- UI redesign.
- Changing data files.
- Replacing LangGraph, Plotly, FastAPI, or React.
- Adding authentication, database persistence, or deployment infrastructure.

## Backend Design

`viz_tool.py` already has helper boundaries around period fields, aggregation, and chart builders. The fix will stay inside that module:

- For `group_by="year"`, aggregate by `["年份"]`, not by `["年份", "月份"]`.
- For `group_by="month"`, preserve the current monthly behavior by grouping with date/year/month fields.
- For chart builders that share period-series behavior, introduce a focused helper that returns the correct group fields and sorted output for the selected period grain.
- Keep existing chart types and API arguments unchanged.

The regression test will assert that a yearly line chart over 2024-2025 returns exactly `["2024", "2025"]` for each department trace, with two y values.

## Frontend Design

Frontend changes stay small and local:

- Create `frontend/src/format.ts` with `formatDisplayTime(value: string): string`.
- Replace duplicated `formatTime` helpers in `Sidebar.tsx` and `MessageList.tsx`.
- Update `PlotlyPanel` cleanup to load Plotly if needed and call `Plotly.purge(element)` when the mounted chart is being replaced or removed.
- Extend the Plotly test double to verify `purge` is called on unmount.
- Update storage normalization to validate minimum conversation and message shape, repair missing scalar fields, preserve valid figures arrays, and guarantee a usable active conversation.

## Testing Design

Backend:

- Add a focused test in `tests/test_viz_tool.py` for yearly grouping.
- Run the full backend suite.

Frontend:

- Add or update tests around shared formatting where useful through existing component behavior.
- Add Plotly cleanup coverage.
- Add storage normalization coverage for corrupted localStorage.
- Run the full frontend suite and build.

## Success Criteria

- Yearly chart grouping produces one point per year.
- Existing chart types still pass.
- Frontend duplicated date formatting is removed.
- Plotly charts clean up after unmount.
- Malformed persisted conversations no longer break rendering assumptions.
- `.venv/bin/python -m pytest -q`, `npm test -- --run`, `npm run build`, and `git diff --check` pass.
