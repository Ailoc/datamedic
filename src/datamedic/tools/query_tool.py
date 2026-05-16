"""指标数据查询工具，支持多科室筛选、时间范围过滤、聚合统计和排名。"""

import logging
import pandas as pd
from datamedic.data.loader import load_metric_data
from datamedic.tools.validation import (
    AGGREGATION_FUNCS,
    AGGREGATION_LABELS,
    normalize_departments,
    period_mask,
    validate_aggregation,
    validate_metric,
    validate_period,
    validate_sort,
    validate_top_n,
)

logger = logging.getLogger(__name__)


def query_metric(
    departments: list[str],
    metric_name: str,
    year_start: int = 2022,
    year_end: int = 2025,
    month_start: int = 1,
    month_end: int = 12,
    aggregation: str = "none",
    sort_by: str = "none",
    top_n: int = 0,
) -> str:
    logger.debug(
        "query_metric: depts=%s metric=%s period=%d.%d-%d.%d agg=%s",
        departments, metric_name, year_start, month_start, year_end, month_end, aggregation,
    )

    validators = [
        validate_period(year_start, year_end, month_start, month_end),
        validate_metric(metric_name),
        validate_aggregation(aggregation),
        validate_sort(sort_by),
        validate_top_n(top_n),
    ]
    for error in validators:
        if error:
            return error

    department_result = normalize_departments(departments)
    if department_result.error:
        return department_result.error
    departments = department_result.departments

    df = load_metric_data()

    mask = (
        df["科室"].isin(departments)
        & (df["指标名称"] == metric_name)
        & period_mask(df, year_start, year_end, month_start, month_end)
    )

    result_df = df[mask]

    if result_df.empty:
        logger.info("query_metric returned empty: metric=%s depts=%s", metric_name, departments)
        return f"未找到数据：科室={departments}, 指标={metric_name}, 时间={year_start}.{month_start}-{year_end}.{month_end}"

    unit = result_df["指标单位"].iloc[0]

    if aggregation == "none" and top_n == 0:
        if len(result_df) == 1:
            row = next(result_df.itertuples())
            return f"{row.科室}{int(row.年份)}年{int(row.月份)}月{metric_name}为{row.数值:,.0f}{unit}"
        lines = [
            f"{row.科室} {int(row.年份)}年{int(row.月份)}月: {row.数值:,.0f}{unit}"
            for row in result_df.itertuples()
        ]
        return "\n".join(lines)

    agg_func = AGGREGATION_FUNCS[aggregation]
    grouped = result_df.groupby("科室")["数值"].agg(agg_func).reset_index()

    if sort_by == "value_desc":
        grouped = grouped.sort_values("数值", ascending=False)
    elif sort_by == "value_asc":
        grouped = grouped.sort_values("数值", ascending=True)

    if top_n > 0:
        grouped = grouped.head(top_n)

    label = "期间平均值" if aggregation == "none" and top_n > 0 else AGGREGATION_LABELS.get(aggregation, "")

    lines = []
    for i, row in enumerate(grouped.itertuples(), 1):
        prefix = f"第{i}名 " if top_n > 0 else ""
        lines.append(f"{prefix}{row.科室}: {label}{row.数值:,.0f}{unit}")

    time_desc = f"{year_start}年" if year_start == year_end else f"{year_start}-{year_end}年"
    header = f"{metric_name} {time_desc} {label}排名：" if top_n > 0 else f"{metric_name} {time_desc}："
    return header + "\n" + "\n".join(lines)
