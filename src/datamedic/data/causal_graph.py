"""因果关系图构建与查询。

从 Excel 文件加载指标间的因果关系，构建有向图（因子 → 结果）。
支持查询某指标的上游因子（按类别分组）以及可下钻的中间指标。
"""

import networkx as nx
import pandas as pd
from datamedic.config import CAUSAL_RELATIONS_PATH

_graph_cache = None


def build_causal_graph() -> nx.DiGraph:
    """构建并缓存因果关系有向图。边方向: 因子指标 → 结果指标。"""
    global _graph_cache
    if _graph_cache is not None:
        return _graph_cache

    df = pd.read_excel(CAUSAL_RELATIONS_PATH)
    G = nx.DiGraph()

    for _, row in df.iterrows():
        result_name = row["结果指标名称"]
        factor_name = row["因子指标名称"]
        category = row["类别"] if pd.notna(row["类别"]) else "未分类"

        G.add_node(result_name, code=row["结果指标编码"])
        G.add_node(factor_name, code=row["因子指标编码"])
        G.add_edge(factor_name, result_name, category=category)

    _graph_cache = G
    return G


def get_factors(G: nx.DiGraph, metric_name: str) -> dict[str, list[str]]:
    """获取指定指标的所有上游因子，按类别分组返回。"""
    if metric_name not in G:
        return {}

    factors = {}
    for predecessor in G.predecessors(metric_name):
        edge_data = G[predecessor][metric_name]
        category = edge_data.get("category", "未分类")
        if category not in factors:
            factors[category] = []
        factors[category].append(predecessor)

    return factors


def get_drilldown(G: nx.DiGraph, metric_name: str) -> list[str]:
    """找出可进一步下钻的因子（即同时作为其他指标的结果指标的中间节点）。"""
    if metric_name not in G:
        return []

    result_metrics = {n for n in G.nodes() if G.out_degree(n) > 0 and G.in_degree(n) > 0}
    drillable = []
    for predecessor in G.predecessors(metric_name):
        if predecessor in result_metrics:
            drillable.append(predecessor)

    return drillable
