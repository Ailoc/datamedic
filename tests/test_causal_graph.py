import pytest


def test_build_graph_has_correct_edge_count():
    from datamedic.data.causal_graph import build_causal_graph
    G = build_causal_graph()
    assert G.number_of_edges() == 49


def test_get_factors_returns_grouped_dict():
    from datamedic.data.causal_graph import build_causal_graph, get_factors
    G = build_causal_graph()
    factors = get_factors(G, "门诊人次")
    assert isinstance(factors, dict)
    assert "分类二" in factors
    assert "普通门诊就诊人次" in factors["分类二"]
    assert "专家门诊就诊人次" in factors["分类二"]
    assert "特需门诊就诊人次" in factors["分类二"]


def test_get_factors_no_category():
    from datamedic.data.causal_graph import build_causal_graph, get_factors
    G = build_causal_graph()
    factors = get_factors(G, "日均手术台次")
    assert "未分类" in factors
    assert "首台刀准时率" in factors["未分类"]


def test_get_drilldown_identifies_nested_metrics():
    from datamedic.data.causal_graph import build_causal_graph, get_drilldown
    G = build_causal_graph()
    drillable = get_drilldown(G, "出院人次")
    assert "门急诊人次" in drillable


def test_get_factors_unknown_metric_returns_empty():
    from datamedic.data.causal_graph import build_causal_graph, get_factors
    G = build_causal_graph()
    factors = get_factors(G, "不存在的指标")
    assert factors == {}
