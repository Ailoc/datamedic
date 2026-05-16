"""可视化工具，基于 Plotly 生成多类型图表并序列化为 JSON 供前端渲染。"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass

import pandas as pd
import plotly.graph_objects as go

from datamedic.data.loader import load_metric_data
from datamedic.tools.validation import (
    AGGREGATION_FUNCS,
    normalize_departments,
    period_mask,
    validate_aggregation,
    validate_chart_type,
    validate_group_by,
    validate_metric,
    validate_period,
    validate_top_n,
)

logger = logging.getLogger(__name__)

RELATIONSHIP_CHARTS = {"bubble", "scatter"}


@dataclass(frozen=True)
class ChartContext:
    departments: list[str]
    metric_name: str
    unit: str
    year_start: int
    year_end: int
    month_start: int
    month_end: int
    chart_type: str
    aggregation: str
    group_by: str
    result_df: pd.DataFrame
    source_df: pd.DataFrame
    secondary_metric_name: str | None = None
    size_metric_name: str | None = None
    top_n: int = 0
    _paired_df: pd.DataFrame | None = None

    @property
    def time_desc(self) -> str:
        if self.year_start == self.year_end:
            return f"{self.year_start}年"
        return f"{self.year_start}-{self.year_end}年"

def visualize_metric(
    departments: list[str],
    metric_name: str,
    year_start: int = 2022,
    year_end: int = 2025,
    month_start: int = 1,
    month_end: int = 12,
    chart_type: str = "line",
    aggregation: str = "none",
    group_by: str = "month",
    secondary_metric_name: str | None = None,
    size_metric_name: str | None = None,
    top_n: int = 0,
) -> dict:
    logger.debug("visualize_metric: depts=%s metric=%s chart=%s", departments, metric_name, chart_type)

    validators = [
        validate_period(year_start, year_end, month_start, month_end),
        validate_metric(metric_name),
        validate_chart_type(chart_type),
        validate_aggregation(aggregation),
        validate_group_by(group_by),
        validate_top_n(top_n),
    ]
    if secondary_metric_name:
        validators.append(validate_metric(secondary_metric_name))
    if size_metric_name:
        validators.append(validate_metric(size_metric_name))
    for error in validators:
        if error:
            return _empty_result(error)

    if chart_type in RELATIONSHIP_CHARTS and not secondary_metric_name:
        return _empty_result(f"{chart_type} 图需要提供 secondary_metric_name 参数。")
    if chart_type == "waterfall" and len(departments) != 1:
        return _empty_result("waterfall 图需要选择单个科室，避免多科室数据被合并。")

    department_result = normalize_departments(departments)
    if department_result.error:
        return _empty_result(department_result.error)
    normalized_departments = department_result.departments

    df = load_metric_data()
    source_df = df[
        df["科室"].isin(normalized_departments)
        & period_mask(df, year_start, year_end, month_start, month_end)
    ].copy()
    result_df = source_df[source_df["指标名称"] == metric_name].sort_values(["科室", "年份", "月份"])

    if result_df.empty:
        logger.info("visualize_metric no data: metric=%s depts=%s", metric_name, normalized_departments)
        return _empty_result(f"未找到数据：{normalized_departments} {metric_name}")

    paired_df = None
    if chart_type in RELATIONSHIP_CHARTS:
        paired_df = _relationship_frame_from_source(
            source_df,
            metric_name,
            secondary_metric_name,
            size_metric_name,
        )
        if paired_df.empty:
            return _empty_result(f"未找到{metric_name}与{secondary_metric_name}在所选时间范围内的成对数据。")

    context = ChartContext(
        departments=normalized_departments,
        metric_name=metric_name,
        unit=str(result_df["指标单位"].iloc[0]),
        year_start=year_start,
        year_end=year_end,
        month_start=month_start,
        month_end=month_end,
        chart_type=chart_type,
        aggregation=aggregation,
        group_by=group_by,
        result_df=result_df,
        source_df=source_df,
        secondary_metric_name=secondary_metric_name,
        size_metric_name=size_metric_name,
        top_n=top_n,
        _paired_df=paired_df,
    )

    fig = CHART_BUILDERS[chart_type](context)
    _apply_common_layout(fig, context)

    max_val = result_df["数值"].max()
    min_val = result_df["数值"].min()
    summary = (
        f"已生成{chart_type}图：{fig.layout.title.text}。"
        f"数据范围 {min_val:,.0f} ~ {max_val:,.0f} {context.unit}。"
    )

    return {
        "summary": summary,
        "figure_json": fig.to_json(),
    }


def _empty_result(summary: str) -> dict:
    return {"summary": summary, "figure_json": None}


def _period_field(group_by: str) -> str:
    if group_by == "year":
        return "年份"
    return "date"


def _period_values(df: pd.DataFrame, group_by: str) -> list:
    field = _period_field(group_by)
    values = df[field].tolist()
    if field == "年份":
        return [str(int(value)) for value in values]
    return values


def _period_group_fields(group_by: str) -> list[str]:
    if group_by == "year":
        return ["年份"]
    return ["date", "年份", "月份"]


def _aggregate(df: pd.DataFrame, group_fields: list[str], aggregation: str) -> pd.DataFrame:
    agg_func = AGGREGATION_FUNCS[aggregation]
    return df.groupby(group_fields, as_index=False)["数值"].agg(agg_func)


def _sort_periods(df: pd.DataFrame) -> pd.DataFrame:
    sort_fields = [field for field in ["科室", "年份", "月份"] if field in df.columns]
    return df.sort_values(sort_fields) if sort_fields else df


def _limit_top(df: pd.DataFrame, top_n: int) -> pd.DataFrame:
    if top_n <= 0:
        return df
    return df.sort_values("数值", ascending=False).head(top_n)


def _aggregate_by_period(df: pd.DataFrame, aggregation: str, group_by: str) -> pd.DataFrame:
    return _sort_periods(_aggregate(df, _period_group_fields(group_by), aggregation))


def _iter_period_groups(context: ChartContext):
    for department in context.departments:
        dept_data = context.result_df[context.result_df["科室"] == department]
        yield department, _aggregate_by_period(dept_data, context.aggregation, context.group_by)


def _department_title(context: ChartContext) -> str:
    if len(context.departments) <= 4:
        return "、".join(context.departments)
    return f"{len(context.departments)}个科室"


def _base_title(context: ChartContext, label: str) -> str:
    return f"{_department_title(context)} {context.time_desc} {context.metric_name}{label}"


def _build_line_chart(context: ChartContext) -> go.Figure:
    fig = go.Figure()
    for department, grouped in _iter_period_groups(context):
        fig.add_trace(go.Scatter(
            x=_period_values(grouped, context.group_by),
            y=grouped["数值"].tolist(),
            mode="lines+markers",
            name=department,
        ))
    fig.update_layout(title=_base_title(context, "趋势"))
    return fig


def _build_area_chart(context: ChartContext) -> go.Figure:
    fig = go.Figure()
    for department, grouped in _iter_period_groups(context):
        fig.add_trace(go.Scatter(
            x=_period_values(grouped, context.group_by),
            y=grouped["数值"].tolist(),
            fill="tozeroy",
            mode="lines",
            name=department,
        ))
    fig.update_layout(title=_base_title(context, "面积趋势"))
    return fig


def _build_bar_chart(context: ChartContext) -> go.Figure:
    fig = go.Figure()
    if context.group_by == "department":
        grouped = _aggregate(context.result_df, ["科室"], context.aggregation)
        grouped = _limit_top(grouped, context.top_n)
        fig.add_trace(go.Bar(
            x=grouped["科室"].tolist(),
            y=grouped["数值"].tolist(),
            name=context.metric_name,
        ))
    else:
        for department, grouped in _iter_period_groups(context):
            fig.add_trace(go.Bar(
                x=_period_values(grouped, context.group_by),
                y=grouped["数值"].tolist(),
                name=department,
            ))
    fig.update_layout(title=_base_title(context, "对比"))
    return fig


def _build_grouped_bar_chart(context: ChartContext) -> go.Figure:
    fig = go.Figure()
    for department, grouped in _iter_period_groups(context):
        fig.add_trace(go.Bar(
            x=_period_values(grouped, context.group_by),
            y=grouped["数值"].tolist(),
            name=department,
        ))
    fig.update_layout(title=_base_title(context, "分组对比"), barmode="group")
    return fig


def _build_stacked_bar_chart(context: ChartContext) -> go.Figure:
    fig = _build_grouped_bar_chart(context)
    fig.update_layout(title=_base_title(context, "构成堆叠"), barmode="stack")
    return fig


def _build_pie_chart(context: ChartContext) -> go.Figure:
    group_field = "科室" if context.group_by == "department" else _period_field(context.group_by)
    grouped = _aggregate(context.result_df, [group_field], context.aggregation)
    grouped = _limit_top(grouped, context.top_n)
    labels = grouped[group_field].tolist()
    if group_field == "年份":
        labels = [str(int(value)) for value in labels]
    fig = go.Figure(go.Pie(labels=labels, values=grouped["数值"].tolist(), hole=0.32))
    fig.update_layout(title=_base_title(context, "占比"))
    return fig


def _build_heatmap_chart(context: ChartContext) -> go.Figure:
    period_field = _period_field(context.group_by)
    grouped = _aggregate(context.result_df, ["科室", period_field], context.aggregation)
    pivot = grouped.pivot(index="科室", columns=period_field, values="数值").fillna(0)
    columns = [str(int(value)) if period_field == "年份" else value for value in pivot.columns.tolist()]
    fig = go.Figure(go.Heatmap(
        x=columns,
        y=pivot.index.tolist(),
        z=pivot.values.tolist(),
        colorbar={"title": context.unit},
    ))
    fig.update_layout(title=_base_title(context, "热力分布"))
    return fig


def _relationship_frame_from_source(
    source_df: pd.DataFrame,
    metric_name: str,
    secondary_metric_name: str | None,
    size_metric_name: str | None,
) -> pd.DataFrame:
    metrics = [metric_name, secondary_metric_name]
    if size_metric_name:
        metrics.append(size_metric_name)
    data = source_df[source_df["指标名称"].isin(metrics)]
    pivot = data.pivot_table(
        index=["科室", "年份", "月份", "date"],
        columns="指标名称",
        values="数值",
        aggfunc="sum",
    ).reset_index()
    required = [metric_name, secondary_metric_name]
    if any(metric not in pivot.columns for metric in required):
        return pivot.iloc[0:0]
    return pivot.dropna(subset=required)


def _relationship_frame(context: ChartContext) -> pd.DataFrame:
    if context._paired_df is not None:
        return context._paired_df
    return _relationship_frame_from_source(
        context.source_df,
        context.metric_name,
        context.secondary_metric_name,
        context.size_metric_name,
    )


def _build_scatter_chart(context: ChartContext) -> go.Figure:
    relationship = _relationship_frame(context)
    fig = go.Figure()
    for department in context.departments:
        dept_data = relationship[relationship["科室"] == department]
        fig.add_trace(go.Scatter(
            x=dept_data[context.metric_name].tolist(),
            y=dept_data[context.secondary_metric_name].tolist(),
            mode="markers",
            name=department,
            text=dept_data["date"].tolist(),
        ))
    fig.update_layout(
        title=f"{_department_title(context)} {context.metric_name} 与 {context.secondary_metric_name}关系",
        xaxis_title=context.metric_name,
        yaxis_title=context.secondary_metric_name,
    )
    return fig


def _build_bubble_chart(context: ChartContext) -> go.Figure:
    relationship = _relationship_frame(context)
    size_metric = context.size_metric_name or context.metric_name
    fig = go.Figure()
    for department in context.departments:
        dept_data = relationship[relationship["科室"] == department]
        raw_sizes = dept_data[size_metric].fillna(0).astype(float)
        max_size = raw_sizes.max() or 1
        marker_sizes = (raw_sizes / max_size * 34 + 8).tolist()
        fig.add_trace(go.Scatter(
            x=dept_data[context.metric_name].tolist(),
            y=dept_data[context.secondary_metric_name].tolist(),
            marker={"size": marker_sizes, "sizemode": "diameter", "opacity": 0.72},
            mode="markers",
            name=department,
            text=dept_data["date"].tolist(),
        ))
    fig.update_layout(
        title=(
            f"{_department_title(context)} {context.metric_name}、"
            f"{context.secondary_metric_name} 与 {size_metric}气泡关系"
        ),
        xaxis_title=context.metric_name,
        yaxis_title=context.secondary_metric_name,
    )
    return fig


def _build_box_chart(context: ChartContext) -> go.Figure:
    fig = go.Figure()
    for department in context.departments:
        dept_data = context.result_df[context.result_df["科室"] == department]
        fig.add_trace(go.Box(y=dept_data["数值"].tolist(), name=department, boxpoints="outliers"))
    fig.update_layout(title=_base_title(context, "分布箱线图"))
    return fig


def _build_histogram_chart(context: ChartContext) -> go.Figure:
    fig = go.Figure()
    for department in context.departments:
        dept_data = context.result_df[context.result_df["科室"] == department]
        fig.add_trace(go.Histogram(x=dept_data["数值"].tolist(), name=department, opacity=0.72))
    fig.update_layout(title=_base_title(context, "直方分布"), barmode="overlay")
    return fig


def _build_waterfall_chart(context: ChartContext) -> go.Figure:
    grouped = _aggregate_by_period(context.result_df, context.aggregation, context.group_by)
    values = grouped["数值"].tolist()
    if len(values) <= 1:
        changes = values
        measures = ["absolute"] * len(values)
    else:
        changes = [values[0]] + [current - previous for previous, current in zip(values, values[1:])]
        measures = ["absolute"] + ["relative"] * (len(values) - 1)
    fig = go.Figure(go.Waterfall(
        x=_period_values(grouped, context.group_by),
        y=changes,
        measure=measures,
        name=context.metric_name,
    ))
    fig.update_layout(title=_base_title(context, "环比变化瀑布"))
    return fig


def _build_indicator_chart(context: ChartContext) -> go.Figure:
    grouped = _aggregate_by_period(context.result_df, context.aggregation, context.group_by)
    current = float(grouped["数值"].iloc[-1])
    previous = float(grouped["数值"].iloc[-2]) if len(grouped) > 1 else None
    indicator_kwargs = {
        "mode": "number+delta" if previous is not None else "number",
        "value": current,
        "title": {"text": f"{context.metric_name}（{context.unit}）"},
    }
    if previous is not None:
        indicator_kwargs["delta"] = {"reference": previous, "relative": True}
    fig = go.Figure(go.Indicator(**indicator_kwargs))
    fig.update_layout(title=_base_title(context, "KPI概览"))
    return fig


def _build_table_chart(context: ChartContext) -> go.Figure:
    table_df = context.result_df[["科室", "date", "指标名称", "数值", "指标单位"]].copy()
    table_df = table_df.sort_values(["科室", "date"])
    if context.top_n > 0:
        table_df = table_df.head(context.top_n)
    else:
        table_df = table_df.head(80)
    table_df["数值"] = table_df["数值"].map(lambda value: f"{value:,.0f}")
    fig = go.Figure(go.Table(
        header={"values": ["科室", "时间", "指标", "数值", "单位"]},
        cells={
            "values": [
                table_df["科室"].tolist(),
                table_df["date"].tolist(),
                table_df["指标名称"].tolist(),
                table_df["数值"].tolist(),
                table_df["指标单位"].tolist(),
            ]
        },
    ))
    fig.update_layout(title=_base_title(context, "明细表"))
    return fig


def _apply_common_layout(fig: go.Figure, context: ChartContext) -> None:
    fig.update_layout(
        hovermode="x unified" if context.chart_type not in {"pie", "indicator", "table"} else None,
        xaxis_title=fig.layout.xaxis.title.text or "时间",
        yaxis_title=fig.layout.yaxis.title.text or f"{context.metric_name}（{context.unit}）",
    )


CHART_BUILDERS: dict[str, Callable[[ChartContext], go.Figure]] = {
    "area": _build_area_chart,
    "bar": _build_bar_chart,
    "box": _build_box_chart,
    "bubble": _build_bubble_chart,
    "grouped_bar": _build_grouped_bar_chart,
    "heatmap": _build_heatmap_chart,
    "histogram": _build_histogram_chart,
    "indicator": _build_indicator_chart,
    "line": _build_line_chart,
    "pie": _build_pie_chart,
    "scatter": _build_scatter_chart,
    "stacked_bar": _build_stacked_bar_chart,
    "table": _build_table_chart,
    "waterfall": _build_waterfall_chart,
}
