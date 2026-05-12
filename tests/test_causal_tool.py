import pytest
import json


def test_analyze_cause_returns_structured_result():
    from datamedic.tools.causal_tool import analyze_cause
    result = analyze_cause(
        department="胸外科",
        metric_name="门诊人次",
        year=2025,
        month=6,
    )
    data = json.loads(result)
    assert "target_metric" in data
    assert "change_pct" in data
    assert "categories" in data
    assert len(data["categories"]) > 0


def test_analyze_cause_detects_decline():
    from datamedic.tools.causal_tool import analyze_cause
    result = analyze_cause(
        department="胸外科",
        metric_name="门诊人次",
        year=2025,
        month=6,
    )
    data = json.loads(result)
    assert data["change_pct"] < 0


def test_analyze_cause_includes_drilldown_info():
    from datamedic.tools.causal_tool import analyze_cause
    result = analyze_cause(
        department="胸外科",
        metric_name="出院人次",
        year=2025,
        month=6,
    )
    data = json.loads(result)
    assert "drilldown_available" in data


def test_analyze_cause_unknown_metric():
    from datamedic.tools.causal_tool import analyze_cause
    result = analyze_cause(
        department="胸外科",
        metric_name="不存在指标",
        year=2025,
        month=6,
    )
    assert "未找到" in result
