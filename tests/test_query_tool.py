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


def test_query_top_n_without_explicit_aggregation_labels_period_average():
    from datamedic.tools.query_tool import query_metric

    result = query_metric(
        departments=[],
        metric_name="手术人次",
        year_start=2024,
        year_end=2024,
        sort_by="value_desc",
        top_n=3,
    )

    assert "期间平均值" in result


def test_query_rejects_invalid_month():
    from datamedic.tools.query_tool import query_metric

    result = query_metric(["胸外科"], "门诊人次", month_start=0)

    assert "月份必须在1到12之间" in result


def test_query_rejects_reversed_period():
    from datamedic.tools.query_tool import query_metric

    result = query_metric(
        ["胸外科"],
        "门诊人次",
        year_start=2025,
        month_start=2,
        year_end=2025,
        month_end=1,
    )

    assert "开始时间不能晚于结束时间" in result


def test_query_rejects_invalid_aggregation():
    from datamedic.tools.query_tool import query_metric

    result = query_metric(["胸外科"], "门诊人次", aggregation="median")

    assert "不支持的聚合方式" in result


def test_query_rejects_unknown_department():
    from datamedic.tools.query_tool import query_metric

    result = query_metric(["不存在科室"], "门诊人次")

    assert "未找到科室" in result


def test_query_rejects_unknown_metric():
    from datamedic.tools.query_tool import query_metric

    result = query_metric(["胸外科"], "不存在指标")

    assert "未找到指标" in result
