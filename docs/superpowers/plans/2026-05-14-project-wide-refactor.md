# Project-Wide Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve DataMedic's reliability and maintainability without changing the application's intended behavior or visual design.

**Architecture:** Add a small backend validation layer, harden Pandas execution guardrails, and decompose the large React app into focused modules. Keep API contracts, CSS class names, and user workflows stable.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, Pandas, Plotly, React 19, TypeScript, Vite, Vitest, Pytest.

---

## File Structure

- Create: `src/datamedic/tools/validation.py` for shared tool input normalization and validation.
- Modify: `src/datamedic/api/schemas.py` for request validation.
- Modify: `src/datamedic/tools/query_tool.py` to use shared validation.
- Modify: `src/datamedic/tools/viz_tool.py` to use shared validation and support empty departments.
- Modify: `src/datamedic/tools/causal_tool.py` to validate department, metric, and month inputs.
- Modify: `src/datamedic/tools/pandas_tool.py` to add AST validation and thread-safe timeout handling.
- Modify: backend tests under `tests/` to cover new behavior.
- Create: `frontend/src/chartTheme.ts` for Plotly theme payload creation.
- Create: `frontend/src/speechSegments.ts` for speech text splitting helpers.
- Create: `frontend/src/hooks/useChatSession.ts` for streaming submit flow.
- Create: `frontend/src/components/Sidebar.tsx`, `Composer.tsx`, `MessageList.tsx`, `Welcome.tsx`, `PlotlyPanel.tsx`.
- Modify: `frontend/src/App.tsx` to orchestrate extracted modules.
- Create or modify frontend tests under `frontend/src/`.

### Task 1: Backend Validation Tests

**Files:**
- Modify: `tests/test_api.py`
- Modify: `tests/test_query_tool.py`
- Modify: `tests/test_viz_tool.py`
- Modify: `tests/test_causal_tool.py`
- Modify: `tests/test_pandas_tool.py`

- [ ] **Step 1: Write failing tests for request and tool validation**

Add tests equivalent to:

```python
def test_chat_request_rejects_blank_message():
    response = client.post("/chat", json={"session_id": "session-1", "message": "   "})
    assert response.status_code == 422

def test_query_rejects_invalid_month():
    result = query_metric(["胸外科"], "门诊人次", month_start=0)
    assert "月份必须在1到12之间" in result

def test_query_rejects_reversed_period():
    result = query_metric(["胸外科"], "门诊人次", year_start=2025, month_start=2, year_end=2025, month_end=1)
    assert "开始时间不能晚于结束时间" in result

def test_query_rejects_invalid_aggregation():
    result = query_metric(["胸外科"], "门诊人次", aggregation="median")
    assert "不支持的聚合方式" in result

def test_visualize_empty_departments_defaults_to_all_departments():
    result = visualize_metric([], "门诊人次", year_start=2024, year_end=2024, month_start=12, month_end=12)
    figure = json.loads(result["figure_json"])
    assert len(figure["data"]) == 20

def test_visualize_rejects_invalid_chart_type():
    result = visualize_metric(["胸外科"], "门诊人次", chart_type="pie")
    assert result["figure_json"] is None
    assert "不支持的图表类型" in result["summary"]

def test_analyze_cause_rejects_unknown_department():
    result = analyze_cause("不存在科室", "门诊人次", 2025, 6)
    assert "未找到科室" in result
```

- [ ] **Step 2: Run tests and verify they fail for missing behavior**

Run:

```bash
.venv/bin/python -m pytest tests/test_api.py tests/test_query_tool.py tests/test_viz_tool.py tests/test_causal_tool.py -q
```

Expected: at least one failure showing validation/default behavior is not implemented.

### Task 2: Backend Validation Implementation

**Files:**
- Create: `src/datamedic/tools/validation.py`
- Modify: `src/datamedic/api/schemas.py`
- Modify: `src/datamedic/tools/query_tool.py`
- Modify: `src/datamedic/tools/viz_tool.py`
- Modify: `src/datamedic/tools/causal_tool.py`

- [ ] **Step 1: Add shared validation helpers**

Implement:

```python
from dataclasses import dataclass
from datamedic.data.loader import get_departments, get_metrics

VALID_AGGREGATIONS = {"none", "sum", "avg", "max", "min"}
VALID_SORTS = {"none", "value_asc", "value_desc"}
VALID_CHART_TYPES = {"line", "bar"}

@dataclass(frozen=True)
class Period:
    year_start: int
    year_end: int
    month_start: int
    month_end: int

def validate_period(year_start: int, year_end: int, month_start: int, month_end: int) -> str | None:
    if month_start < 1 or month_start > 12 or month_end < 1 or month_end > 12:
        return "月份必须在1到12之间。"
    if year_start * 100 + month_start > year_end * 100 + month_end:
        return "开始时间不能晚于结束时间。"
    return None

def normalize_departments(departments: list[str]) -> tuple[list[str], str | None]:
    available = set(get_departments())
    normalized = [department for department in departments if department]
    if not normalized:
        return get_departments(), None
    unknown = [department for department in normalized if department not in available]
    if unknown:
        return [], f"未找到科室：{'、'.join(unknown)}。"
    return normalized, None

def validate_metric(metric_name: str) -> str | None:
    available = {metric["name"] for metric in get_metrics()}
    if metric_name not in available:
        return f"未找到指标：{metric_name}。"
    return None
```

- [ ] **Step 2: Use helpers in tools and schemas**

Add Pydantic field constraints and route tool calls through helper functions. Invalid tool input should return clear text, not raise uncaught exceptions.

- [ ] **Step 3: Run focused backend tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_api.py tests/test_query_tool.py tests/test_viz_tool.py tests/test_causal_tool.py -q
```

Expected: all selected tests pass.

### Task 3: Pandas Guardrail Refactor

**Files:**
- Modify: `src/datamedic/tools/pandas_tool.py`
- Modify: `tests/test_pandas_tool.py`

- [ ] **Step 1: Write failing tests for AST guardrails and non-main-thread execution**

Add tests equivalent to:

```python
def test_run_pandas_blocks_dunder_attribute_access():
    result = run_pandas_code("result = df.__class__")
    assert "禁止" in result or "不允许" in result

def test_run_pandas_blocks_dangerous_call_without_exact_substring():
    result = run_pandas_code("fn = getattr(pd, 'read_csv')\nresult = fn('data/sample.csv')")
    assert "禁止" in result or "不允许" in result or "错误" in result

def test_run_pandas_works_outside_main_thread():
    with ThreadPoolExecutor(max_workers=1) as executor:
        result = executor.submit(run_pandas_code, "result = len(df)").result(timeout=10)
    assert "48960" in result
```

- [ ] **Step 2: Run the tests and verify red**

Run:

```bash
.venv/bin/python -m pytest tests/test_pandas_tool.py -q
```

Expected: at least one new test fails before implementation.

- [ ] **Step 3: Implement AST validation and thread-safe timeout**

Use `ast.NodeVisitor` to reject unsafe syntax and only install `signal.alarm` on the main thread. Always restore the old signal handler if one was installed.

- [ ] **Step 4: Run Pandas tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_pandas_tool.py -q
```

Expected: all Pandas tests pass.

### Task 4: Frontend Module Extraction

**Files:**
- Create: `frontend/src/chartTheme.ts`
- Create: `frontend/src/speechSegments.ts`
- Create: `frontend/src/hooks/useChatSession.ts`
- Create: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/components/Composer.tsx`
- Create: `frontend/src/components/MessageList.tsx`
- Create: `frontend/src/components/Welcome.tsx`
- Create: `frontend/src/components/PlotlyPanel.tsx`
- Modify: `frontend/src/App.tsx`
- Create or modify: frontend tests.

- [ ] **Step 1: Extract pure helpers first**

Move Plotly theme helpers into `chartTheme.ts` and speech segmentation helpers into `speechSegments.ts`. Export the same behavior currently embedded in `App.tsx`.

- [ ] **Step 2: Add helper tests**

Add tests for:

```typescript
expect(extractSpeakableSegments("第一句。第二句", false).segments).toEqual(["第一句。"]);
expect(createPlotlyThemePayload({ data: [{ type: "table" }], layout: {} }).layout.paper_bgcolor).toBe("rgba(0,0,0,0)");
```

- [ ] **Step 3: Extract presentational components**

Move `Sidebar`, `Composer`, `MessageList`, `Welcome`, `ThinkingIndicator`, and `PlotlyPanel` into component files while preserving props and CSS class names.

- [ ] **Step 4: Extract chat submit orchestration**

Move `submitMessage` and its refs into `useChatSession.ts`. Keep the hook API small:

```typescript
const { loading, submitMessage, stopActiveStream } = useChatSession({
  activeConversationId,
  getState,
  setState,
  voiceOutputEnabledRef,
  getSpeechPlayer,
  setVoiceHint,
});
```

- [ ] **Step 5: Run frontend tests**

Run:

```bash
cd frontend && npm test -- --run
```

Expected: all frontend tests pass.

### Task 5: Full Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run backend suite**

Run:

```bash
.venv/bin/python -m pytest -q
```

Expected: all tests pass.

- [ ] **Step 2: Run frontend suite**

Run:

```bash
cd frontend && npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: Review git diff**

Run:

```bash
git diff --stat
git diff --name-status
```

Expected: changes match this plan and no unrelated files were reverted.
