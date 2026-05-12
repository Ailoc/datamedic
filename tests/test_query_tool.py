import pytest


def test_query_single_value():
    from datamedic.tools.query_tool import query_metric
    result = query_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        year_start=2024,
        year_end=2024,
        month_start=12,
        month_end=12,
    )
    assert "8,772" in result


def test_query_multiple_departments():
    from datamedic.tools.query_tool import query_metric
    result = query_metric(
        departments=["心内科", "心外科"],
        metric_name="门诊人次",
        year_start=2024,
        year_end=2024,
        month_start=12,
        month_end=12,
    )
    assert "心内科" in result
    assert "心外科" in result


def test_query_with_aggregation_sum():
    from datamedic.tools.query_tool import query_metric
    result = query_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        year_start=2025,
        year_end=2025,
        month_start=1,
        month_end=12,
        aggregation="sum",
    )
    assert "胸外科" in result


def test_query_top_n():
    from datamedic.tools.query_tool import query_metric
    result = query_metric(
        departments=[],
        metric_name="手术人次",
        year_start=2024,
        year_end=2024,
        aggregation="avg",
        sort_by="value_desc",
        top_n=3,
    )
    assert "骨科" in result
