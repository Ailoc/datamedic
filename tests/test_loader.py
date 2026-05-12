import pytest
import pandas as pd
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_load_metric_data_returns_dataframe():
    from data.loader import load_metric_data
    df = load_metric_data()
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 48960
    assert "date" in df.columns


def test_load_metric_data_has_correct_columns():
    from data.loader import load_metric_data
    df = load_metric_data()
    expected_cols = {"科室", "指标编码", "指标名称", "年份", "月份", "数值", "指标单位", "date"}
    assert expected_cols.issubset(set(df.columns))


def test_get_departments_returns_list():
    from data.loader import get_departments
    depts = get_departments()
    assert isinstance(depts, list)
    assert len(depts) == 20
    assert "胸外科" in depts


def test_get_metrics_returns_list_of_dicts():
    from data.loader import get_metrics
    metrics = get_metrics()
    assert isinstance(metrics, list)
    assert len(metrics) == 51
    assert all("name" in m and "code" in m and "unit" in m for m in metrics)
