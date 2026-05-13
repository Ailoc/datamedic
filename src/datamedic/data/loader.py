"""数据加载层，负责读取 CSV 指标数据并提供科室/指标元信息查询。

所有数据在首次访问时加载并缓存于模块级变量中，后续调用直接返回缓存。
"""

import pandas as pd
from datamedic.config import METRIC_DATA_PATH

_df_cache = None
_departments_cache = None
_metrics_cache = None


def load_metric_data() -> pd.DataFrame:
    global _df_cache
    if _df_cache is None:
        df = pd.read_csv(METRIC_DATA_PATH)
        df["date"] = df.apply(
            lambda row: f"{int(row['年份'])}-{int(row['月份']):02d}", axis=1
        )
        _df_cache = df
    return _df_cache


def get_departments() -> list[str]:
    global _departments_cache
    if _departments_cache is None:
        df = load_metric_data()
        _departments_cache = sorted(df["科室"].unique().tolist())
    return _departments_cache


def get_metrics() -> list[dict]:
    global _metrics_cache
    if _metrics_cache is None:
        df = load_metric_data()
        metrics_df = df[["指标编码", "指标名称", "指标单位"]].drop_duplicates()
        _metrics_cache = [
            {"code": row["指标编码"], "name": row["指标名称"], "unit": row["指标单位"]}
            for _, row in metrics_df.iterrows()
        ]
    return _metrics_cache
