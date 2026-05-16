# Project Audit Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified yearly chart grouping bug, remove low-risk frontend duplication, harden chart cleanup and conversation storage, and verify the full project.

**Architecture:** Keep changes local to existing module boundaries. Backend chart grain logic remains in `viz_tool.py`; frontend lifecycle and formatting fixes stay in small utilities/components; storage normalization is strengthened without changing the persisted schema.

**Tech Stack:** Python 3.11, Pytest, FastAPI, Pandas, Plotly, React 19, TypeScript, Vite, Vitest, Testing Library.

---

## File Structure

- Modify: `tests/test_viz_tool.py` to add yearly grouping regression coverage.
- Modify: `src/datamedic/tools/viz_tool.py` to aggregate yearly period charts correctly.
- Create: `frontend/src/format.ts` for shared display time formatting.
- Modify: `frontend/src/components/Sidebar.tsx` and `frontend/src/components/MessageList.tsx` to use the shared formatter.
- Modify: `frontend/src/components/PlotlyPanel.tsx` to purge Plotly charts on cleanup.
- Modify: `frontend/src/App.test.tsx` to cover Plotly cleanup.
- Modify: `frontend/src/storage.ts` and `frontend/src/storage.test.ts` to repair malformed persisted records.

### Task 1: Backend Yearly Chart Grouping

**Files:**
- Modify: `tests/test_viz_tool.py`
- Modify: `src/datamedic/tools/viz_tool.py`

- [ ] **Step 1: Write the failing regression test**

Add this test to `tests/test_viz_tool.py`:

```python
def test_visualize_year_grouping_returns_one_point_per_year():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=["骨科"],
        metric_name="出院人次",
        year_start=2024,
        year_end=2025,
        chart_type="line",
        aggregation="sum",
        group_by="year",
    )

    figure = json.loads(result["figure_json"])
    assert figure["data"][0]["x"] == ["2024", "2025"]
    assert len(figure["data"][0]["y"]) == 2
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
.venv/bin/python -m pytest tests/test_viz_tool.py::test_visualize_year_grouping_returns_one_point_per_year -q
```

Expected before implementation: failure showing repeated yearly x labels.

- [ ] **Step 3: Implement period grouping helpers**

In `src/datamedic/tools/viz_tool.py`, add helpers that choose group fields by grain:

```python
def _period_group_fields(group_by: str) -> list[str]:
    if group_by == "year":
        return ["年份"]
    return ["date", "年份", "月份"]

def _group_by_period(df: pd.DataFrame, aggregation: str, group_by: str) -> pd.DataFrame:
    return _sort_periods(_aggregate(df, _period_group_fields(group_by), aggregation))
```

Then replace period chart builders that currently group by `[period_field, "年份", "月份"]` with `_group_by_period(...)`.

- [ ] **Step 4: Run focused and full backend tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_viz_tool.py -q
.venv/bin/python -m pytest -q
```

Expected: all backend tests pass.

### Task 2: Frontend Formatting and Plotly Lifecycle

**Files:**
- Create: `frontend/src/format.ts`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/components/MessageList.tsx`
- Modify: `frontend/src/components/PlotlyPanel.tsx`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write failing Plotly cleanup coverage**

Extend the existing app Plotly rendering test or add a new one that renders a figure and unmounts:

```typescript
const { unmount } = render(<App />);
// submit a prompt that returns a figure
await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());
unmount();
await waitFor(() => expect(plotlyPurgeMock).toHaveBeenCalled());
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
cd frontend && npm test -- --run src/App.test.tsx
```

Expected before implementation: cleanup assertion fails because `purge` is not called.

- [ ] **Step 3: Extract display time formatting**

Create `frontend/src/format.ts`:

```typescript
export const formatDisplayTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(
    2,
    "0",
  )} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
```

Import and use it from `Sidebar.tsx` and `MessageList.tsx`.

- [ ] **Step 4: Purge Plotly on cleanup**

In `PlotlyPanel.tsx`, capture the rendered element and call `Plotly.purge(element)` in the effect cleanup after the loader promise resolves.

- [ ] **Step 5: Run frontend tests**

Run:

```bash
cd frontend && npm test -- --run src/App.test.tsx
```

Expected: app tests pass.

### Task 3: Storage Normalization Hardening

**Files:**
- Modify: `frontend/src/storage.test.ts`
- Modify: `frontend/src/storage.ts`

- [ ] **Step 1: Write malformed persistence test**

Add a test that stores a malformed conversation and verifies normalization:

```typescript
localStorage.setItem(
  STORAGE_KEY,
  JSON.stringify({
    activeId: "bad",
    conversations: [
      {
        id: "valid",
        title: 123,
        summary: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "bad-date",
        messages: [{ id: "m1", role: "assistant", text: 42, figures: "bad", createdAt: "bad" }],
      },
      null,
    ],
  }),
);

const state = loadConversationState();
expect(state.activeId).toBe("valid");
expect(state.conversations[0].title).toBe("新的运营问答");
expect(state.conversations[0].messages[0]).toMatchObject({
  id: "m1",
  role: "assistant",
  text: "",
  figures: [],
});
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
cd frontend && npm test -- --run src/storage.test.ts
```

Expected before implementation: normalization keeps invalid scalar values.

- [ ] **Step 3: Implement record guards**

Add small `isRecord`, `stringOr`, `dateOrNow`, `normalizeMessage`, and `normalizeConversation` helpers in `storage.ts`. Filter invalid roles to `"assistant"` or discard invalid messages, keep valid IDs, and always return a valid active conversation.

- [ ] **Step 4: Run storage tests**

Run:

```bash
cd frontend && npm test -- --run src/storage.test.ts
```

Expected: storage tests pass.

### Task 4: Full Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run backend verification**

```bash
.venv/bin/python -m pytest -q
```

Expected: all backend tests pass.

- [ ] **Step 2: Run frontend verification**

```bash
cd frontend && npm test -- --run
cd frontend && npm run build
```

Expected: all frontend tests and production build pass.

- [ ] **Step 3: Run diff hygiene check**

```bash
git diff --check
```

Expected: no whitespace errors.
