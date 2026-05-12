import json
from data.loader import load_metric_data
from data.causal_graph import build_causal_graph, get_factors, get_drilldown


def analyze_cause(department: str, metric_name: str, year: int, month: int) -> str:
    G = build_causal_graph()
    factors_by_category = get_factors(G, metric_name)

    if not factors_by_category:
        return f"未找到指标「{metric_name}」的因果关系定义，无法进行因果分析。"

    df = load_metric_data()

    current_val = _get_value(df, department, metric_name, year, month)
    if current_val is None:
        return f"未找到{department}{year}年{month}月的{metric_name}数据。"

    prev_year, prev_month = (year, month - 1) if month > 1 else (year - 1, 12)
    prev_val = _get_value(df, department, metric_name, prev_year, prev_month)

    if prev_val is None or prev_val == 0:
        change_pct = 0.0
    else:
        change_pct = (current_val - prev_val) / prev_val * 100

    categories_analysis = []
    for category, factor_list in factors_by_category.items():
        factor_details = []
        for factor_name in factor_list:
            f_current = _get_value(df, department, factor_name, year, month)
            f_prev = _get_value(df, department, factor_name, prev_year, prev_month)

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
        "change_pct": round(change_pct, 1),
        "categories": categories_analysis,
        "drilldown_available": drillable,
    }

    return json.dumps(result, ensure_ascii=False)


def _get_value(df, department: str, metric_name: str, year: int, month: int):
    mask = (
        (df["科室"] == department)
        & (df["指标名称"] == metric_name)
        & (df["年份"] == year)
        & (df["月份"] == month)
    )
    rows = df[mask]
    if rows.empty:
        return None
    return rows.iloc[0]["数值"]
