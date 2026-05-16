import json


def test_detects_broad_department_overview_request_without_specific_metric():
    from datamedic.tools.department_overview import detect_department_overview_request

    assert detect_department_overview_request("分析一下儿科的数据") == "儿科"
    assert (
        detect_department_overview_request("分析一下儿科的相关的数据，使用最适合的图表绘制并分析")
        == "儿科"
    )
    assert detect_department_overview_request("分析儿科门诊人次趋势") is None
    assert detect_department_overview_request("展示骨科图表") is None
    assert detect_department_overview_request("分析一下这个骨科图表") is None


def test_build_department_overview_returns_analysis_and_plotly_figures():
    from datamedic.tools.department_overview import build_department_overview

    result = build_department_overview("儿科")

    assert result is not None
    assert "儿科" in result["text"]
    assert "多指标趋势折线图" in result["text"]
    assert len(result["figures"]) == 2
    trend = result["figures"][0]
    table = result["figures"][1]
    assert trend["data"][0]["type"] == "scatter"
    assert "儿科" in trend["layout"]["title"]["text"]
    assert table["data"][0]["type"] == "table"
    json.dumps(result["figures"], ensure_ascii=False)


def test_detects_single_department_without_metric_for_recursion_fallback():
    from datamedic.tools.department_overview import detect_single_department_without_metric

    assert detect_single_department_without_metric("分析一下儿科") == "儿科"
    assert detect_single_department_without_metric("分析儿科门诊人次趋势") is None
    assert detect_single_department_without_metric("分析儿科和骨科") is None
