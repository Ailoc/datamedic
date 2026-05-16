"""Deterministic department overview analysis for broad chart requests."""

from __future__ import annotations

import json
from dataclasses import dataclass

import pandas as pd
import plotly.graph_objects as go

from datamedic.data.loader import get_departments, get_metrics, load_metric_data

OVERVIEW_TERMS = {
    "相关数据",
    "相关的数据",
    "整体",
    "总体",
    "综合",
    "总览",
    "概况",
    "画像",
    "分析",
    "看一下",
    "看看",
    "数据",
    "情况",
    "表现",
    "运营",
    "最适合",
    "合适的图表",
}

TREND_METRICS = ["门急诊人次", "门诊人次", "出院人次", "住院人次", "手术人次"]
SUMMARY_METRICS = [
    "门急诊人次",
    "门诊人次",
    "出院人次",
    "住院人次",
    "手术人次",
    "床位使用率",
    "平均住院日",
    "住院患者手术率",
]
AVERAGE_SUMMARY_METRICS = {"床位使用率", "平均住院日", "住院患者手术率"}


@dataclass(frozen=True)
class MetricSummary:
    name: str
    unit: str
    annual_label: str
    annual_value: float
    latest_month: str
    latest_value: float
    peak_month: str
    peak_value: float
    low_month: str
    low_value: float


def _find_single_department_in_message(message: str) -> str | None:
    """Return one mentioned department when the message does not name a metric."""
    compact = "".join(message.split())
    if not compact:
        return None

    departments = [department for department in get_departments() if department in compact]
    if len(departments) != 1:
        return None

    metric_names = [str(metric["name"]) for metric in get_metrics()]
    if any(metric_name and metric_name in compact for metric_name in metric_names):
        return None
    return departments[0]


def detect_department_overview_request(message: str) -> str | None:
    """Return the requested department for broad overview prompts.

    Requests that name a concrete metric should continue through the Agent so
    the normal tool planner can answer the specific analytical intent.
    """
    department = _find_single_department_in_message(message)
    if department is None:
        return None
    compact = "".join(message.split())
    if "这个" in compact and "图表" in compact:
        return None
    if any(term in compact for term in OVERVIEW_TERMS):
        return department
    return None


def detect_single_department_without_metric(message: str) -> str | None:
    """Return one mentioned department when the prompt does not name a metric."""
    return _find_single_department_in_message(message)


def build_department_overview(department: str) -> dict | None:
    """Build a deterministic overview with Plotly figures for one department."""
    df = load_metric_data()
    dept_df = df[df["科室"] == department].copy()
    if dept_df.empty:
        return None

    latest_year = int(dept_df["年份"].max())
    year_df = dept_df[dept_df["年份"] == latest_year].sort_values(["指标名称", "年份", "月份"])
    if year_df.empty:
        return None

    summaries = _build_summaries(year_df)
    trend_fig = _build_trend_figure(year_df, department, latest_year)
    table_fig = _build_table_figure(summaries, department, latest_year)
    text = _build_analysis_text(summaries, department, latest_year)

    return {
        "text": text,
        "figures": [
            json.loads(trend_fig.to_json()),
            json.loads(table_fig.to_json()),
        ],
    }


def _build_summaries(year_df: pd.DataFrame) -> list[MetricSummary]:
    summaries = []
    for metric_name in SUMMARY_METRICS:
        metric_df = year_df[year_df["指标名称"] == metric_name].sort_values(["年份", "月份"])
        if metric_df.empty:
            continue

        values = metric_df["数值"]
        annual_label = "年度均值" if metric_name in AVERAGE_SUMMARY_METRICS else "年度合计"
        annual_value = float(values.mean() if metric_name in AVERAGE_SUMMARY_METRICS else values.sum())
        latest = metric_df.iloc[-1]
        peak = metric_df.loc[values.idxmax()]
        low = metric_df.loc[values.idxmin()]
        summaries.append(
            MetricSummary(
                name=metric_name,
                unit=str(metric_df["指标单位"].iloc[0]),
                annual_label=annual_label,
                annual_value=annual_value,
                latest_month=_format_month(latest),
                latest_value=float(latest["数值"]),
                peak_month=_format_month(peak),
                peak_value=float(peak["数值"]),
                low_month=_format_month(low),
                low_value=float(low["数值"]),
            )
        )
    return summaries


def _build_trend_figure(year_df: pd.DataFrame, department: str, latest_year: int) -> go.Figure:
    fig = go.Figure()
    for metric_name in TREND_METRICS:
        metric_df = year_df[year_df["指标名称"] == metric_name].sort_values(["年份", "月份"])
        if metric_df.empty:
            continue

        unit = str(metric_df["指标单位"].iloc[0])
        fig.add_trace(
            go.Scatter(
                x=metric_df["date"].tolist(),
                y=metric_df["数值"].tolist(),
                mode="lines+markers",
                name=metric_name,
                hovertemplate=f"{metric_name}<br>%{{x}}<br>%{{y:,.0f}} {unit}<extra></extra>",
            )
        )

    fig.update_layout(
        title=f"{department} {latest_year}年核心运营指标多指标趋势折线图",
        xaxis_title="月份",
        yaxis_title="人次",
        hovermode="x unified",
        legend={"orientation": "h", "y": -0.24},
        margin={"l": 56, "r": 24, "t": 72, "b": 96},
    )
    return fig


def _build_table_figure(
    summaries: list[MetricSummary],
    department: str,
    latest_year: int,
) -> go.Figure:
    headers = ["指标", "统计口径", "年度值", "最近月份", "最近值", "峰值月份", "峰值", "低值月份", "低值"]
    rows = [
        [
            summary.name,
            summary.annual_label,
            _format_value(summary.annual_value, summary.unit),
            summary.latest_month,
            _format_value(summary.latest_value, summary.unit),
            summary.peak_month,
            _format_value(summary.peak_value, summary.unit),
            summary.low_month,
            _format_value(summary.low_value, summary.unit),
        ]
        for summary in summaries
    ]
    columns = list(map(list, zip(*rows, strict=False))) if rows else [[] for _ in headers]

    fig = go.Figure(
        data=[
            go.Table(
                header={
                    "values": headers,
                    "fill_color": "#eef2ff",
                    "align": "left",
                    "font": {"size": 13, "color": "#111827"},
                },
                cells={
                    "values": columns,
                    "fill_color": "#ffffff",
                    "align": "left",
                    "height": 28,
                    "font": {"size": 12, "color": "#1f2937"},
                },
            )
        ]
    )
    fig.update_layout(
        title=f"{department} {latest_year}年核心指标汇总表",
        margin={"l": 12, "r": 12, "t": 56, "b": 12},
    )
    return fig


def _build_analysis_text(summaries: list[MetricSummary], department: str, latest_year: int) -> str:
    summary_by_name = {summary.name: summary for summary in summaries}
    outpatient = summary_by_name.get("门急诊人次") or summary_by_name.get("门诊人次")
    discharge = summary_by_name.get("出院人次")
    surgery = summary_by_name.get("手术人次")
    bed_use = summary_by_name.get("床位使用率")
    alos = summary_by_name.get("平均住院日")

    lines = [
        f"已按“科室整体概览”口径分析{department}{latest_year}年的相关数据，并选择多指标趋势折线图 + 核心指标汇总表作为最适合的展示方式。",
        "多指标趋势折线图用于同时观察门急诊、门诊、住院、出院和手术等核心业务量的月度变化，汇总表用于补充效率类指标和峰谷月份。",
    ]
    if outpatient:
        lines.append(
            f"{department}{latest_year}年{outpatient.name}{outpatient.annual_label.replace('年度', '全年')}"
            f"{_format_value(outpatient.annual_value, outpatient.unit)}，最近月份为"
            f"{outpatient.latest_month}（{_format_value(outpatient.latest_value, outpatient.unit)}）。"
        )
    if discharge and surgery:
        lines.append(
            f"住院端全年出院{_format_value(discharge.annual_value, discharge.unit)}，"
            f"手术{_format_value(surgery.annual_value, surgery.unit)}，可结合峰值月份判断资源排班压力。"
        )
    if bed_use or alos:
        efficiency_parts = []
        if bed_use:
            efficiency_parts.append(f"床位使用率最近值{_format_value(bed_use.latest_value, bed_use.unit)}")
        if alos:
            efficiency_parts.append(f"平均住院日最近值{_format_value(alos.latest_value, alos.unit)}")
        lines.append("效率指标方面，" + "，".join(efficiency_parts) + "。")
    return "\n".join(lines)


def _format_month(row: pd.Series) -> str:
    return f"{int(row['年份'])}-{int(row['月份']):02d}"


def _format_value(value: float, unit: str) -> str:
    if unit == "%":
        return f"{value:.1f}%"
    if unit == "天":
        return f"{value:.1f}天"
    return f"{value:,.0f}{unit}"
