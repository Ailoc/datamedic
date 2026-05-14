# Complete Chart System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete Plotly chart system so the model can generate trend, comparison, composition, distribution, relationship, KPI, and table views.

**Architecture:** Keep one public `visualize_metric` function, add validation for the expanded chart interface, and dispatch chart creation through a registry of focused builder functions. Update Agent tool metadata and system prompt so the model can select chart types by user intent.

**Tech Stack:** Python 3.11+, FastAPI, LangChain tools, Pandas, Plotly graph_objects, Pytest, React Plotly renderer.

---

## File Structure

- Modify: `src/datamedic/tools/validation.py` for expanded chart and group-by validation.
- Modify: `src/datamedic/tools/viz_tool.py` for chart context, builders, and registry dispatch.
- Modify: `src/datamedic/agent/agent.py` for the expanded `visualize_tool` signature and docstring.
- Modify: `src/datamedic/agent/prompts.py` for chart-selection guidance.
- Modify: `tests/test_viz_tool.py` for all chart types and invalid argument coverage.
- Modify: `tests/test_api.py` for `_build_figures` with the expanded arguments.
- Modify: `README.md` to document the new chart system.

## Task 1: Red Tests For Expanded Chart System

- [ ] Add parametrized tests in `tests/test_viz_tool.py` that call `visualize_metric` for `line`, `area`, `bar`, `grouped_bar`, `stacked_bar`, `pie`, `heatmap`, `scatter`, `bubble`, `box`, `histogram`, `waterfall`, `indicator`, and `table`.
- [ ] Assert each call returns non-empty `figure_json` and that the returned Plotly trace type matches the requested chart family.
- [ ] Add tests for missing `secondary_metric_name` on `scatter` and `bubble`.
- [ ] Add tests for invalid `aggregation` and invalid `group_by`.
- [ ] Run `.venv/bin/python -m pytest tests/test_viz_tool.py -q` and confirm the new tests fail before implementation.

## Task 2: Validation And Tool Interface

- [ ] Expand `VALID_CHART_TYPES` in `src/datamedic/tools/validation.py`.
- [ ] Add `VALID_GROUP_BY` and `validate_group_by`.
- [ ] Update `visualize_metric` signature with `aggregation`, `group_by`, `secondary_metric_name`, `size_metric_name`, and `top_n`.
- [ ] Validate secondary and size metrics when present.
- [ ] Update `visualize_tool` in `src/datamedic/agent/agent.py` with the same parameters and guidance.
- [ ] Run `.venv/bin/python -m pytest tests/test_viz_tool.py -q` and use the remaining failures to guide chart builder implementation.

## Task 3: Chart Builder Registry

- [ ] Add `ChartContext` in `src/datamedic/tools/viz_tool.py`.
- [ ] Add helpers for period labels, aggregation functions, grouped values, and metric pivoting.
- [ ] Implement builders for the 14 supported chart types.
- [ ] Keep summaries clear, including chart type, title, data range, and metric units where applicable.
- [ ] Run `.venv/bin/python -m pytest tests/test_viz_tool.py -q` until all visualization tests pass.

## Task 4: Agent Guidance And API Rebuild Coverage

- [ ] Update `SYSTEM_PROMPT_TEMPLATE` with chart-selection rules.
- [ ] Update `tests/test_api.py` so `_build_figures` passes through new visualize args.
- [ ] Run `.venv/bin/python -m pytest tests/test_api.py tests/test_viz_tool.py -q`.

## Task 5: Documentation And Verification

- [ ] Update `README.md` with the new chart types and selection guidance.
- [ ] Run `.venv/bin/python -m pytest -q`.
- [ ] Run `cd frontend && npm test -- --run`.
- [ ] Run `cd frontend && npm run build`.
- [ ] Run `git diff --check` and review changed files.
