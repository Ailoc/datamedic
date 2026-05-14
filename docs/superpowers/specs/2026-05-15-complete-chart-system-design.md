# Complete Chart System Design

## Goal

Enable the DataMedic agent to generate a full set of Plotly chart types for hospital operations analysis, beyond the current `line` and `bar` options.

## Current Constraints

- `visualize_tool` only documents `line` and `bar`.
- `VALID_CHART_TYPES` only accepts `line` and `bar`.
- `visualize_metric` has a two-branch implementation and cannot express relationships, composition, distribution, KPI cards, or tabular detail.
- The frontend already registers many Plotly trace modules, so the main work is backend tool capability and model guidance.

## Supported Chart Types

The full chart system supports:

- `line`: trends over time.
- `area`: filled trend over time.
- `bar`: aggregated comparison.
- `grouped_bar`: multi-series grouped comparison.
- `stacked_bar`: composition across time or departments.
- `pie`: share/composition.
- `heatmap`: department by period intensity.
- `scatter`: relationship between two metrics.
- `bubble`: relationship between two metrics plus a size metric.
- `box`: distribution and volatility.
- `histogram`: value distribution.
- `waterfall`: period-over-period change.
- `indicator`: KPI value card.
- `table`: structured detail.

## Tool Interface

`visualize_tool` and `visualize_metric` gain these parameters:

```python
aggregation: str = "none"
group_by: str = "month"
secondary_metric_name: str | None = None
size_metric_name: str | None = None
top_n: int = 0
```

Validation rules:

- `chart_type` must be one of the supported chart types.
- `aggregation` must be `none`, `sum`, `avg`, `max`, or `min`.
- `group_by` must be `month`, `year`, or `department`.
- `scatter` and `bubble` require `secondary_metric_name`.
- `bubble` can use `size_metric_name`; if omitted, bubble size falls back to the primary metric.
- Unknown departments, metrics, invalid months, and reversed periods return clear summaries with `figure_json=None`.

## Architecture

Use a chart builder registry:

```python
CHART_BUILDERS = {
    "line": build_line_chart,
    "area": build_area_chart,
    ...
}
```

`visualize_metric` handles shared validation, filtering, and dispatch. Each builder owns one chart shape and receives a `ChartContext` containing the filtered DataFrame, normalized departments, metric names, period label, unit, aggregation, group_by, and top_n.

This keeps chart-specific logic isolated and makes future chart additions small.

## Model Guidance

Update the system prompt and tool docstring with chart-selection rules:

- Trend/changes: `line`, `area`.
- Comparison/ranking: `bar`, `grouped_bar`.
- Composition/share: `pie`, `stacked_bar`.
- Hotspots/anomaly distribution: `heatmap`.
- Relationship/correlation: `scatter`, `bubble`.
- Volatility/distribution: `box`, `histogram`.
- Period-over-period contribution: `waterfall`.
- KPI overview: `indicator`.
- Detail listing: `table`.

## Frontend Impact

No UI redesign is required. The existing Plotly renderer accepts figure JSON and already registers the needed trace modules. The chart theme helper continues to apply transparent backgrounds and table styling.

## Testing

Backend tests cover:

- Every supported chart type returns valid Plotly JSON.
- `scatter` and `bubble` validate secondary metric requirements.
- `bubble` supports a size metric.
- Invalid `chart_type`, `aggregation`, and `group_by` return readable errors.
- `_build_figures` can rebuild figures when tool calls include the new arguments.

Frontend tests remain focused on generic Plotly rendering because the backend controls chart generation.
