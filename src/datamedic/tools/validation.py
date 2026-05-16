"""共享工具参数校验与规范化逻辑。"""

from dataclasses import dataclass

from datamedic.data.loader import get_departments, get_metrics

VALID_AGGREGATIONS = {"none", "sum", "avg", "max", "min"}
VALID_CHART_TYPES = {
    "area",
    "bar",
    "box",
    "bubble",
    "grouped_bar",
    "heatmap",
    "histogram",
    "indicator",
    "line",
    "pie",
    "scatter",
    "stacked_bar",
    "table",
    "waterfall",
}
VALID_GROUP_BY = {"department", "month", "year"}
VALID_SORTS = {"none", "value_asc", "value_desc"}
AGGREGATION_FUNCS = {
    "none": "mean",
    "sum": "sum",
    "avg": "mean",
    "max": "max",
    "min": "min",
}
AGGREGATION_LABELS = {
    "none": "数值",
    "sum": "合计",
    "avg": "平均",
    "max": "最大",
    "min": "最小",
}


@dataclass(frozen=True)
class ToolValidationResult:
    departments: list[str]
    error: str | None = None


def validate_period(year_start: int, year_end: int, month_start: int, month_end: int) -> str | None:
    if month_start < 1 or month_start > 12 or month_end < 1 or month_end > 12:
        return "月份必须在1到12之间。"

    if period_key(year_start, month_start) > period_key(year_end, month_end):
        return "开始时间不能晚于结束时间。"

    return None


def period_key(year: int, month: int) -> int:
    return year * 100 + month


def period_mask(df, year_start: int, year_end: int, month_start: int, month_end: int):
    period = df["年份"] * 100 + df["月份"]
    return (period >= period_key(year_start, month_start)) & (period <= period_key(year_end, month_end))


def normalize_departments(departments: list[str] | None) -> ToolValidationResult:
    available_departments = get_departments()
    available = set(available_departments)
    normalized = [department.strip() for department in departments or [] if department.strip()]

    if not normalized:
        return ToolValidationResult(departments=available_departments)

    unknown = [department for department in normalized if department not in available]
    if unknown:
        return ToolValidationResult(
            departments=[],
            error=f"未找到科室：{'、'.join(unknown)}。",
        )

    return ToolValidationResult(departments=normalized)


def validate_department_name(department: str) -> str | None:
    name = department.strip()
    if not name or name not in set(get_departments()):
        return f"未找到科室：{department}。"
    return None


def validate_metric(metric_name: str) -> str | None:
    name = metric_name.strip()
    available = {metric["name"] for metric in get_metrics()}
    if name not in available:
        return f"未找到指标：{metric_name}。"
    return None


def validate_aggregation(aggregation: str) -> str | None:
    if aggregation not in VALID_AGGREGATIONS:
        return f"不支持的聚合方式：{aggregation}。可选值：none、sum、avg、max、min。"
    return None


def validate_sort(sort_by: str) -> str | None:
    if sort_by not in VALID_SORTS:
        return f"不支持的排序方式：{sort_by}。可选值：none、value_asc、value_desc。"
    return None


def validate_chart_type(chart_type: str) -> str | None:
    if chart_type not in VALID_CHART_TYPES:
        options = "、".join(sorted(VALID_CHART_TYPES))
        return f"不支持的图表类型：{chart_type}。可选值：{options}。"
    return None


def validate_group_by(group_by: str) -> str | None:
    if group_by not in VALID_GROUP_BY:
        return f"不支持的分组方式：{group_by}。可选值：month、year、department。"
    return None


def validate_top_n(top_n: int) -> str | None:
    if top_n < 0:
        return "top_n不能为负数。"
    return None
