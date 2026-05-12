import json
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_react_agent
from langchain.memory import ConversationSummaryBufferMemory
from langchain_core.tools import tool
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from config import OPENAI_API_KEY, OPENAI_BASE_URL, MODEL_NAME
from agent.prompts import build_system_prompt
from tools.query_tool import query_metric
from tools.pandas_tool import run_pandas_code
from tools.viz_tool import visualize_metric
from tools.causal_tool import analyze_cause


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
    return query_metric(
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
    return run_pandas_code(code)


@tool
def visualize_tool(
    departments: list[str],
    metric_name: str,
    year_start: int = 2022,
    year_end: int = 2025,
    month_start: int = 1,
    month_end: int = 12,
    chart_type: str = "line",
) -> str:
    """生成可视化图表。chart_type: line(折线图) 或 bar(柱状图)。
    返回图表摘要文本，图表会自动展示给用户。"""
    result = visualize_metric(
        departments=departments,
        metric_name=metric_name,
        year_start=year_start,
        year_end=year_end,
        month_start=month_start,
        month_end=month_end,
        chart_type=chart_type,
    )
    return result["summary"]


@tool
def causal_analysis_tool(
    department: str,
    metric_name: str,
    year: int,
    month: int,
) -> str:
    """分析指标变化的原因。当用户问"为什么XX指标下降/上升"时使用。
    返回因子指标的变化情况，帮助解释原因。"""
    return analyze_cause(
        department=department,
        metric_name=metric_name,
        year=year,
        month=month,
    )


def create_agent_executor() -> AgentExecutor:
    llm = ChatOpenAI(
        model=MODEL_NAME,
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_BASE_URL,
        temperature=0,
    )

    tools = [query_metric_tool, pandas_code_tool, visualize_tool, causal_analysis_tool]
    system_prompt = build_system_prompt()

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        MessagesPlaceholder(variable_name="chat_history"),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    agent = create_react_agent(llm, tools, prompt)

    memory = ConversationSummaryBufferMemory(
        llm=llm,
        max_token_limit=2000,
        memory_key="chat_history",
        return_messages=True,
    )

    return AgentExecutor(
        agent=agent,
        tools=tools,
        memory=memory,
        max_iterations=10,
        handle_parsing_errors=True,
        verbose=False,
    )
