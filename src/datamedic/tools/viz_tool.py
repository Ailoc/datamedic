import json
import plotly.graph_objects as go
from datamedic.data.loader import load_metric_data


def visualize_metric(
    departments: list[str],
    metric_name: str,
    year_start: int = 2022,
    year_end: int = 2025,
    month_start: int = 1,
    month_end: int = 12,
    chart_type: str = "line",
) -> dict:
    df = load_metric_data()

    mask = (
        df["科室"].isin(departments)
        & (df["指标名称"] == metric_name)
        & (df["年份"] >= year_start)
        & (df["年份"] <= year_end)
    )
    if year_start == year_end:
        mask = mask & (df["月份"] >= month_start) & (df["月份"] <= month_end)

    result_df = df[mask].sort_values(["科室", "年份", "月份"])

    if result_df.empty:
        return {
            "summary": f"未找到数据：{departments} {metric_name}",
            "figure_json": None,
        }

    unit = result_df["指标单位"].iloc[0]
    fig = go.Figure()

    for dept in departments:
        dept_data = result_df[result_df["科室"] == dept]
        if chart_type == "line":
            fig.add_trace(go.Scatter(
                x=dept_data["date"].tolist(),
                y=dept_data["数值"].tolist(),
                mode="lines+markers",
                name=dept,
            ))
        else:
            fig.add_trace(go.Bar(
                x=dept_data["date"].tolist(),
                y=dept_data["数值"].tolist(),
                name=dept,
            ))

    time_desc = f"{year_start}年" if year_start == year_end else f"{year_start}-{year_end}年"
    title = f"{'、'.join(departments)} {time_desc} {metric_name}趋势"
    fig.update_layout(
        title=title,
        xaxis_title="时间",
        yaxis_title=f"{metric_name}（{unit}）",
        hovermode="x unified",
    )

    max_val = result_df["数值"].max()
    min_val = result_df["数值"].min()
    summary = f"已生成{chart_type}图：{title}。数据范围 {min_val:,.0f} ~ {max_val:,.0f} {unit}。"

    return {
        "summary": summary,
        "figure_json": fig.to_json(),
    }
