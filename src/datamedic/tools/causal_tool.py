"""因果分析工具，对比目标指标及其因子指标的环比变化来解释波动原因。"""

import logging
import json
from datamedic.data.loader import load_metric_data
from datamedic.data.causal_graph import build_causal_graph, get_factors, get_drilldown
from datamedic.tools.validation import validate_department_name, validate_metric, validate_period

logger = logging.getLogger(__name__)


def analyze_cause(department: str, metric_name: str, year: int | None = None, month: int | None = None) -> str:
    """分析指定科室某月指标变化的原因。

    通过因果图找到上游因子指标，对比当月与上月的值，
    计算各因子的环比变化率，帮助定位波动根因。

    year和month可选，不提供时自动使用数据中最新的月份。
    """
    logger.debug("analyze_cause: dept=%s metric=%s period=%s-%s", department, metric_name, year, month)

    # 在验证科室和指标前先加载数据，以便自动确定最新时间
    df = load_metric_data()

    if year is None or month is None:
        metric_data = df[(df["科室"] == department) & (df["指标名称"] == metric_name)]
        if not metric_data.empty:
            latest_row = metric_data.sort_values(["年份", "月份"]).iloc[-1]
            year = year or int(latest_row["年份"])
            month = month or int(latest_row["月份"])
            logger.info("Auto-selected latest period: %d-%d", year, month)
        else:
            return "未找到该科室和指标的任何数据，无法自动确定分析时间。请指定具体的年份和月份。"

    for error in (
        validate_period(year, year, month, month),
        validate_department_name(department),
        validate_metric(metric_name),
    ):
        if error:
            return error

    G = build_causal_graph()
    factors_by_category = get_factors(G, metric_name)

    if not factors_by_category:
        logger.info("No causal relations found for metric=%s", metric_name)
        return f"未找到指标「{metric_name}」的因果关系定义，无法进行因果分析。"

    prev_year, prev_month = (year, month - 1) if month > 1 else (year - 1, 12)

    # 预筛选当前科室、当月和上月的数据，避免每个因子都做全表过滤
    dept_df = df[
        (df["科室"] == department)
        & (
            ((df["年份"] == year) & (df["月份"] == month))
            | ((df["年份"] == prev_year) & (df["月份"] == prev_month))
        )
    ]
    lookup = dept_df.set_index(["指标名称", "年份", "月份"])["数值"]

    def get_val(name: str, y: int, m: int):
        try:
            return lookup.loc[(name, y, m)]
        except KeyError:
            return None

    current_val = get_val(metric_name, year, month)
    if current_val is None:
        return f"未找到{department}{year}年{month}月的{metric_name}数据。"

    prev_val = get_val(metric_name, prev_year, prev_month)

    if prev_val is None:
        change_pct = None
    elif prev_val == 0:
        change_pct = 0.0
    else:
        change_pct = (current_val - prev_val) / prev_val * 100

    categories_analysis = []
    for category, factor_list in factors_by_category.items():
        factor_details = []
        for factor_name in factor_list:
            f_current = get_val(factor_name, year, month)
            f_prev = get_val(factor_name, prev_year, prev_month)

            if f_current is not None and f_prev is not None and f_prev != 0:
                f_change = (f_current - f_prev) / f_prev * 100
            else:
                f_change = None

            factor_details.append({
                "name": factor_name,
                "current_value": f_current,
                "previous_value": f_prev,
                "change_pct": round(f_change, 1) if f_change is not None else None,
            })

        categories_analysis.append({
            "category": category,
            "factors": factor_details,
        })

    drillable = get_drilldown(G, metric_name)

    result = {
        "target_metric": metric_name,
        "department": department,
        "period": f"{year}年{month}月",
        "current_value": current_val,
        "previous_value": prev_val,
        "change_pct": round(change_pct, 1) if change_pct is not None else None,
        "categories": categories_analysis,
        "drilldown_available": drillable,
    }

    return json.dumps(result, ensure_ascii=False)
