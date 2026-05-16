import pytest
import json


@pytest.mark.parametrize(
    ("chart_type", "expected_trace_type", "extra_kwargs"),
    [
        ("line", "scatter", {}),
        ("area", "scatter", {}),
        ("bar", "bar", {"aggregation": "sum", "group_by": "department"}),
        ("grouped_bar", "bar", {"aggregation": "sum", "group_by": "month"}),
        ("stacked_bar", "bar", {"aggregation": "sum", "group_by": "month"}),
        ("pie", "pie", {"aggregation": "sum", "group_by": "department"}),
        ("heatmap", "heatmap", {}),
        ("scatter", "scatter", {"secondary_metric_name": "出院人次"}),
        ("bubble", "scatter", {"secondary_metric_name": "出院人次", "size_metric_name": "手术人次"}),
        ("box", "box", {}),
        ("histogram", "histogram", {}),
        ("waterfall", "waterfall", {"departments": ["胸外科"]}),
        ("indicator", "indicator", {"aggregation": "sum"}),
        ("table", "table", {}),
    ],
)
def test_visualize_supported_chart_types(chart_type, expected_trace_type, extra_kwargs):
    from datamedic.tools.viz_tool import visualize_metric

    kwargs = {"departments": ["胸外科", "心内科"], **extra_kwargs}
    result = visualize_metric(
        metric_name="门诊人次",
        year_start=2024,
        year_end=2024,
        chart_type=chart_type,
        **kwargs,
    )

    assert result["figure_json"] is not None
    fig_data = json.loads(result["figure_json"])
    assert fig_data["data"][0]["type"] == expected_trace_type
    assert chart_type in result["summary"]


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


def test_visualize_empty_departments_defaults_to_all_departments():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=[],
        metric_name="门诊人次",
        year_start=2024,
        year_end=2024,
        month_start=12,
        month_end=12,
        chart_type="line",
    )

    assert result["figure_json"] is not None
    fig_data = json.loads(result["figure_json"])
    assert len(fig_data["data"]) == 20


def test_visualize_year_grouping_returns_one_point_per_year():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=["骨科"],
        metric_name="出院人次",
        year_start=2024,
        year_end=2025,
        chart_type="line",
        aggregation="sum",
        group_by="year",
    )

    fig_data = json.loads(result["figure_json"])
    assert fig_data["data"][0]["x"] == ["2024", "2025"]
    assert len(fig_data["data"][0]["y"]) == 2


def test_visualize_rejects_invalid_chart_type():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        chart_type="radar",
    )

    assert result["figure_json"] is None
    assert "不支持的图表类型" in result["summary"]


def test_visualize_rejects_invalid_aggregation():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        chart_type="bar",
        aggregation="median",
    )

    assert result["figure_json"] is None
    assert "不支持的聚合方式" in result["summary"]


def test_visualize_rejects_invalid_group_by():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        chart_type="bar",
        group_by="week",
    )

    assert result["figure_json"] is None
    assert "不支持的分组方式" in result["summary"]


def test_visualize_scatter_requires_secondary_metric():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        chart_type="scatter",
    )

    assert result["figure_json"] is None
    assert "secondary_metric_name" in result["summary"]


def test_visualize_bubble_requires_secondary_metric():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        chart_type="bubble",
    )

    assert result["figure_json"] is None
    assert "secondary_metric_name" in result["summary"]


def test_visualize_rejects_unknown_metric():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=["胸外科"],
        metric_name="不存在指标",
        chart_type="line",
    )

    assert result["figure_json"] is None
    assert "未找到指标" in result["summary"]


def test_visualize_rejects_waterfall_with_multiple_departments():
    from datamedic.tools.viz_tool import visualize_metric

    result = visualize_metric(
        departments=["胸外科", "心内科"],
        metric_name="门诊人次",
        chart_type="waterfall",
    )

    assert result["figure_json"] is None
    assert "单个科室" in result["summary"]


def test_visualize_relationship_chart_requires_paired_data(monkeypatch):
    import pandas as pd
    from datamedic.tools.viz_tool import visualize_metric

    monkeypatch.setattr(
        "datamedic.tools.viz_tool.load_metric_data",
        lambda: pd.DataFrame(
            [
                {
                    "科室": "胸外科",
                    "指标编码": "nb_of_outp",
                    "指标名称": "门诊人次",
                    "年份": 2024,
                    "月份": 1,
                    "数值": 100,
                    "指标单位": "人次",
                    "date": "2024-01",
                },
            ]
        ),
    )

    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        chart_type="scatter",
        secondary_metric_name="出院人次",
        year_start=2024,
        year_end=2024,
    )

    assert result["figure_json"] is None
    assert "成对数据" in result["summary"]
