"""LangGraph Agent 组装模块。

将 LLM、工具集和系统提示词组合为一个带记忆的对话 Agent。
使用带 LRU 淘汰的 MemorySaver，防止会话无限增长导致 OOM。
"""

import logging
import time
from collections import OrderedDict
from typing import Any

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver

from datamedic.config import OPENAI_API_KEY, OPENAI_BASE_URL, MODEL_NAME
from datamedic.agent.prompts import build_system_prompt
from datamedic.tools.query_tool import query_metric
from datamedic.tools.pandas_tool import run_pandas_code
from datamedic.tools.viz_tool import visualize_metric
from datamedic.tools.causal_tool import analyze_cause

logger = logging.getLogger(__name__)

MAX_SESSIONS = 200


def _timed_tool(name: str, fn, **kwargs: Any) -> Any:
    start = time.perf_counter()
    result = fn(**kwargs)
    logger.info("%s completed in %.1fms", name, (time.perf_counter() - start) * 1000)
    return result


class LRUMemorySaver(MemorySaver):
    """带 LRU 淘汰的 MemorySaver，限制最大会话数防止内存无限增长。"""

    def __init__(self, max_sessions: int = MAX_SESSIONS):
        super().__init__()
        self._max_sessions = max_sessions
        self._access_order: OrderedDict[str, None] = OrderedDict()

    def put(self, config, checkpoint, metadata=None, new_versions=None):
        thread_id = config.get("configurable", {}).get("thread_id", "")
        self._access_order[thread_id] = None
        self._access_order.move_to_end(thread_id)
        self._evict()
        return super().put(config, checkpoint, metadata, new_versions)

    def get_tuple(self, config):
        thread_id = config.get("configurable", {}).get("thread_id", "")
        if thread_id in self._access_order:
            self._access_order.move_to_end(thread_id)
        return super().get_tuple(config)

    def _evict(self):
        while len(self._access_order) > self._max_sessions:
            evicted_id, _ = self._access_order.popitem(last=False)
            if hasattr(self, "delete_thread"):
                self.delete_thread(evicted_id)
            else:
                if hasattr(self, "storage") and evicted_id in self.storage:
                    del self.storage[evicted_id]
                if hasattr(self, "writes"):
                    for key in list(self.writes.keys()):
                        if key[0] == evicted_id:
                            del self.writes[key]
                if hasattr(self, "blobs"):
                    for key in list(self.blobs.keys()):
                        if key[0] == evicted_id:
                            del self.blobs[key]
            logger.debug("Evicted session from memory: %s", evicted_id)


@tool
def query_metric_tool(
    departments: list[str],
    metric_name: str,
    year_start: int = 2022,
    year_end: int = 2025,
    month_start: int = 1,
    month_end: int = 12,
    aggregation: str = "none",
    sort_by: str = "none",
    top_n: int = 0,
) -> str:
    """查询医院运营指标数据。支持单值查询、多科室对比、聚合统计、排名。
    departments: 科室列表，空列表表示全部科室
    metric_name: 指标名称（必须从可用指标列表中选择）
    aggregation: none/sum/avg/max/min
    sort_by: none/value_asc/value_desc
    top_n: 返回前N名，0表示不排名"""
    return _timed_tool("query_metric_tool", query_metric,
        departments=departments,
        metric_name=metric_name,
        year_start=year_start,
        year_end=year_end,
        month_start=month_start,
        month_end=month_end,
        aggregation=aggregation,
        sort_by=sort_by,
        top_n=top_n,
    )


@tool
def pandas_code_tool(code: str) -> str:
    """执行Pandas代码进行复杂数据分析。当query_metric_tool无法满足需求时使用。
    代码中可用变量：df（完整数据DataFrame）、pd（pandas模块）。
    必须将最终结果赋值给 result 变量。
    禁止使用import、文件操作等危险操作。"""
    return _timed_tool("pandas_code_tool", run_pandas_code, code)


@tool
def visualize_tool(
    departments: list[str],
    metric_name: str,
    year_start: int = 2022,
    year_end: int = 2025,
    month_start: int = 1,
    month_end: int = 12,
    chart_type: str = "line",
    aggregation: str = "none",
    group_by: str = "month",
    secondary_metric_name: str | None = None,
    size_metric_name: str | None = None,
    top_n: int = 0,
) -> str:
    """生成可视化图表，图表会自动展示给用户。

    chart_type 可选：
    line(趋势), area(面积趋势), bar(对比), grouped_bar(分组对比),
    stacked_bar(构成堆叠), pie(占比), heatmap(热力分布),
    scatter(双指标关系), bubble(双指标关系+规模), box(波动分布),
    histogram(数值分布), waterfall(环比变化), indicator(KPI卡片), table(明细表)。

    aggregation: none/sum/avg/max/min。group_by: month/year/department。
    scatter 和 bubble 必须提供 secondary_metric_name。
    bubble 可选 size_metric_name，不提供时使用主指标作为气泡大小。
    top_n 用于限制排名、占比或表格输出行数，0表示不限制。"""
    result = _timed_tool("visualize_tool", visualize_metric,
        departments=departments,
        metric_name=metric_name,
        year_start=year_start,
        year_end=year_end,
        month_start=month_start,
        month_end=month_end,
        chart_type=chart_type,
        aggregation=aggregation,
        group_by=group_by,
        secondary_metric_name=secondary_metric_name,
        size_metric_name=size_metric_name,
        top_n=top_n,
    )
    return result["summary"]


@tool
def causal_analysis_tool(
    department: str,
    metric_name: str,
    year: int | None = None,
    month: int | None = None,
) -> str:
    """分析指标变化的原因。当用户问"为什么XX指标下降/上升"时使用。
    返回因子指标的变化情况，帮助解释原因。
    year和month可选，不提供时自动使用最新可用数据，无需先用其他工具查询时间。"""
    return _timed_tool("causal_analysis_tool", analyze_cause,
        department=department,
        metric_name=metric_name,
        year=year,
        month=month,
    )


checkpointer = LRUMemorySaver(max_sessions=MAX_SESSIONS)


def create_agent_graph():
    logger.info("Creating agent graph: model=%s base_url=%s", MODEL_NAME, OPENAI_BASE_URL)
    llm = ChatOpenAI(
        model=MODEL_NAME,
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_BASE_URL,
        temperature=0,
        request_timeout=60,
        max_retries=2,
    )

    tools = [query_metric_tool, pandas_code_tool, visualize_tool, causal_analysis_tool]
    system_prompt = build_system_prompt()

    agent = create_agent(
        model=llm,
        tools=tools,
        system_prompt=system_prompt,
        checkpointer=checkpointer,
    )

    logger.info("Agent graph created with %d tools", len(tools))
    return agent
