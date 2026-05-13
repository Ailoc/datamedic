"""指标数据查询工具，支持多科室筛选、时间范围过滤、聚合统计和排名。"""

import pandas as pd
from datamedic.data.loader import load_metric_data, get_departments


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
    group_by: str = "month",
) -> str:
    df = load_metric_data()

    if not departments:
        departments = get_departments()

    mask = (
        df["科室"].isin(departments)
        & (df["指标名称"] == metric_name)
        & (df["年份"] >= year_start)
        & (df["年份"] <= year_end)
    )

    if year_start == year_end:
        mask = mask & (df["月份"] >= month_start) & (df["月份"] <= month_end)

    result_df = df[mask]

    if result_df.empty:
        return f"未找到数据：科室={departments}, 指标={metric_name}, 时间={year_start}.{month_start}-{year_end}.{month_end}"

    unit = result_df["指标单位"].iloc[0]

    if aggregation == "none" and top_n == 0:
        if len(result_df) == 1:
            row = result_df.iloc[0]
            return f"{row['科室']}{int(row['年份'])}年{int(row['月份'])}月{metric_name}为{row['数值']:,.0f}{unit}"
        lines = []
        for _, row in result_df.iterrows():
            lines.append(f"{row['科室']} {int(row['年份'])}年{int(row['月份'])}月: {row['数值']:,.0f}{unit}")
        return "\n".join(lines)

    if aggregation != "none":
        agg_func = {"sum": "sum", "avg": "mean", "max": "max", "min": "min"}[aggregation]
        grouped = result_df.groupby("科室")["数值"].agg(agg_func).reset_index()
    else:
        grouped = result_df.groupby("科室")["数值"].mean().reset_index()

    if sort_by == "value_desc":
        grouped = grouped.sort_values("数值", ascending=False)
    elif sort_by == "value_asc":
        grouped = grouped.sort_values("数值", ascending=True)

    if top_n > 0:
        grouped = grouped.head(top_n)

    agg_label = {"sum": "合计", "avg": "平均", "max": "最大", "min": "最小", "none": "平均"}
    label = agg_label.get(aggregation, "")

    lines = []
    for i, (_, row) in enumerate(grouped.iterrows(), 1):
        prefix = f"第{i}名 " if top_n > 0 else ""
        lines.append(f"{prefix}{row['科室']}: {label}{row['数值']:,.0f}{unit}")

    time_desc = f"{year_start}年" if year_start == year_end else f"{year_start}-{year_end}年"
    header = f"{metric_name} {time_desc} {label}排名：" if top_n > 0 else f"{metric_name} {time_desc}："
    return header + "\n" + "\n".join(lines)
