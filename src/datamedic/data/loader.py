"""数据加载层，负责读取 CSV 指标数据并提供科室/指标元信息查询。

所有数据在首次访问时加载并缓存于模块级变量中，后续调用直接返回缓存。
"""

import logging
import threading
import pandas as pd
from datamedic.config import METRIC_DATA_PATH

logger = logging.getLogger(__name__)

_df_cache = None
_departments_cache = None
_metrics_cache = None
_cache_lock = threading.RLock()


def load_metric_data() -> pd.DataFrame:
    global _df_cache
    if _df_cache is None:
        with _cache_lock:
            if _df_cache is None:
                logger.info("Loading metric data from %s", METRIC_DATA_PATH)
                df = pd.read_csv(METRIC_DATA_PATH)
                df["date"] = df["年份"].astype(int).astype(str) + "-" + df["月份"].astype(int).map("{:02d}".format)
                _df_cache = df
                logger.info(
                    "Metric data loaded: %d rows, %d departments, %d metrics",
                    len(df), df["科室"].nunique(), df["指标名称"].nunique(),
                )
    return _df_cache


def get_departments() -> list[str]:
    global _departments_cache
    if _departments_cache is None:
        with _cache_lock:
            if _departments_cache is None:
                df = load_metric_data()
                _departments_cache = sorted(df["科室"].unique().tolist())
    return _departments_cache


def get_metrics() -> list[dict]:
    global _metrics_cache
    if _metrics_cache is None:
        with _cache_lock:
            if _metrics_cache is None:
                df = load_metric_data()
                metrics_df = df[["指标编码", "指标名称", "指标单位"]].drop_duplicates()
                _metrics_cache = [
                    {"code": row.指标编码, "name": row.指标名称, "unit": row.指标单位}
                    for row in metrics_df.itertuples()
                ]
    return _metrics_cache
