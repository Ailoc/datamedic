import pytest
import json


def test_visualize_line_chart():
    from datamedic.tools.viz_tool import visualize_metric
    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        year_start=2025,
        year_end=2025,
        chart_type="line",
    )
    assert "figure_json" in result
    assert result["figure_json"] is not None
    fig_data = json.loads(result["figure_json"])
    assert "data" in fig_data
    assert len(fig_data["data"]) > 0


def test_visualize_bar_chart_multi_dept():
    from datamedic.tools.viz_tool import visualize_metric
    result = visualize_metric(
        departments=["心内科", "心外科"],
        metric_name="门诊人次",
        year_start=2024,
        year_end=2024,
        month_start=12,
        month_end=12,
        chart_type="bar",
    )
    assert "figure_json" in result
    fig_data = json.loads(result["figure_json"])
    assert len(fig_data["data"]) >= 2


def test_visualize_returns_summary():
    from datamedic.tools.viz_tool import visualize_metric
    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        year_start=2025,
        year_end=2025,
        chart_type="line",
    )
    assert "summary" in result
    assert len(result["summary"]) > 0
