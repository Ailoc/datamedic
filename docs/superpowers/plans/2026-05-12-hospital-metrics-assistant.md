# 医院运营指标智能分析助手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive hospital metrics analysis assistant with natural language querying, Plotly visualization, causal analysis, and real-time voice I/O.

**Architecture:** FastAPI backend serves a LangChain ReAct Agent with 4 tools (query, pandas, viz, causal). Streamlit frontend provides chat UI with embedded Plotly charts. DashScope handles real-time STT (Paraformer) and TTS (CosyVoice) via WebSocket.

**Tech Stack:** Python, FastAPI, Streamlit, LangChain v1.x, langchain_openai, Plotly, NetworkX, Pandas, DashScope SDK

---

## File Structure

```
vibe_coding_data_analyst/
├── app.py                    # Streamlit frontend
├── server.py                 # FastAPI backend entry
├── config.py                 # Environment config loader
├── .env                      # Secrets (not committed)
├── .env.example              # Template for .env
├── requirements.txt          # Dependencies
├── api/
│   ├── __init__.py
│   ├── routes.py             # HTTP + WebSocket endpoints
│   └── schemas.py            # Pydantic request/response models
├── data/
│   ├── __init__.py
│   ├── loader.py             # CSV/Excel loading + metadata
│   └── causal_graph.py       # NetworkX causal graph
├── agent/
│   ├── __init__.py
│   ├── agent.py              # ReAct Agent assembly
│   └── prompts.py            # System prompt template
├── tools/
│   ├── __init__.py
│   ├── query_tool.py         # Structured metric query
│   ├── pandas_tool.py        # Dynamic code execution
│   ├── viz_tool.py           # Plotly chart generation
│   └── causal_tool.py        # Causal factor analysis
└── tests/
    ├── __init__.py
    ├── test_loader.py
    ├── test_causal_graph.py
    ├── test_query_tool.py
    ├── test_pandas_tool.py
    ├── test_viz_tool.py
    ├── test_causal_tool.py
    ├── test_agent.py
    └── test_api.py
```

---

## Task 1: Project Scaffolding & Configuration

**Files:**
- Create: `vibe_coding_data_analyst/requirements.txt`
- Create: `vibe_coding_data_analyst/.env.example`
- Create: `vibe_coding_data_analyst/config.py`

- [ ] **Step 1: Create requirements.txt**

```
streamlit>=1.28.0
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
langchain>=0.3.0
langchain-openai>=0.2.0
openai>=1.0.0
pandas>=2.0.0
plotly>=5.18.0
networkx>=3.0
openpyxl>=3.1.0
python-dotenv>=1.0.0
dashscope>=1.10.0
websockets>=12.0
requests>=2.31.0
pytest>=7.4.0
```

- [ ] **Step 2: Create .env.example**

```
OPENAI_API_KEY=sk-your-openai-key
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o
DASHSCOPE_API_KEY=sk-your-dashscope-key
```

- [ ] **Step 3: Create config.py**

```python
import os
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o")
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
METRIC_DATA_PATH = os.path.join(DATA_DIR, "metric_data.csv")
CAUSAL_RELATIONS_PATH = os.path.join(DATA_DIR, "causal_relations.xlsx")
```

- [ ] **Step 4: Create __init__.py files**

Create empty `__init__.py` in: `api/`, `data/`, `agent/`, `tools/`, `tests/`

- [ ] **Step 5: Install dependencies and verify**

Run: `cd vibe_coding_data_analyst && pip install -r requirements.txt`
Expected: All packages install successfully

- [ ] **Step 6: Commit**

```bash
git init
git add requirements.txt .env.example config.py api/__init__.py data/__init__.py agent/__init__.py tools/__init__.py tests/__init__.py
git commit -m "feat: project scaffolding with config and dependencies"
```

---

## Task 2: Data Loader

**Files:**
- Create: `vibe_coding_data_analyst/data/loader.py`
- Create: `vibe_coding_data_analyst/tests/test_loader.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_loader.py
import pytest
import pandas as pd


def test_load_metric_data_returns_dataframe():
    from data.loader import load_metric_data
    df = load_metric_data()
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 48960
    assert "date" in df.columns


def test_load_metric_data_has_correct_columns():
    from data.loader import load_metric_data
    df = load_metric_data()
    expected_cols = {"科室", "指标编码", "指标名称", "年份", "月份", "数值", "指标单位", "date"}
    assert expected_cols.issubset(set(df.columns))


def test_get_departments_returns_list():
    from data.loader import get_departments
    depts = get_departments()
    assert isinstance(depts, list)
    assert len(depts) == 20
    assert "胸外科" in depts


def test_get_metrics_returns_list_of_dicts():
    from data.loader import get_metrics
    metrics = get_metrics()
    assert isinstance(metrics, list)
    assert len(metrics) == 51
    assert all("name" in m and "code" in m and "unit" in m for m in metrics)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_loader.py -v`
Expected: FAIL with ImportError

- [ ] **Step 3: Write implementation**

```python
# data/loader.py
import pandas as pd
from config import METRIC_DATA_PATH


_df_cache = None
_departments_cache = None
_metrics_cache = None


def load_metric_data() -> pd.DataFrame:
    global _df_cache
    if _df_cache is None:
        df = pd.read_csv(METRIC_DATA_PATH)
        df["date"] = df.apply(
            lambda row: f"{int(row['年份'])}-{int(row['月份']):02d}", axis=1
        )
        _df_cache = df
    return _df_cache


def get_departments() -> list[str]:
    global _departments_cache
    if _departments_cache is None:
        df = load_metric_data()
        _departments_cache = sorted(df["科室"].unique().tolist())
    return _departments_cache


def get_metrics() -> list[dict]:
    global _metrics_cache
    if _metrics_cache is None:
        df = load_metric_data()
        metrics_df = df[["指标编码", "指标名称", "指标单位"]].drop_duplicates()
        _metrics_cache = [
            {"code": row["指标编码"], "name": row["指标名称"], "unit": row["指标单位"]}
            for _, row in metrics_df.iterrows()
        ]
    return _metrics_cache
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_loader.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add data/loader.py tests/test_loader.py
git commit -m "feat: data loader with metric_data.csv parsing and metadata extraction"
```

---

## Task 3: Causal Graph

**Files:**
- Create: `vibe_coding_data_analyst/data/causal_graph.py`
- Create: `vibe_coding_data_analyst/tests/test_causal_graph.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_causal_graph.py
import pytest


def test_build_graph_has_correct_edge_count():
    from data.causal_graph import build_causal_graph
    G = build_causal_graph()
    assert G.number_of_edges() == 49


def test_get_factors_returns_grouped_dict():
    from data.causal_graph import build_causal_graph, get_factors
    G = build_causal_graph()
    factors = get_factors(G, "门诊人次")
    assert isinstance(factors, dict)
    assert "分类二" in factors
    assert "普通门诊就诊人次" in factors["分类二"]
    assert "专家门诊就诊人次" in factors["分类二"]
    assert "特需门诊就诊人次" in factors["分类二"]


def test_get_factors_no_category():
    from data.causal_graph import build_causal_graph, get_factors
    G = build_causal_graph()
    factors = get_factors(G, "日均手术台次")
    assert "未分类" in factors
    assert "首台刀准时率" in factors["未分类"]


def test_get_drilldown_identifies_nested_metrics():
    from data.causal_graph import build_causal_graph, get_drilldown
    G = build_causal_graph()
    drillable = get_drilldown(G, "出院人次")
    assert "门急诊人次" in drillable


def test_get_factors_unknown_metric_returns_empty():
    from data.causal_graph import build_causal_graph, get_factors
    G = build_causal_graph()
    factors = get_factors(G, "不存在的指标")
    assert factors == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_causal_graph.py -v`
Expected: FAIL with ImportError

- [ ] **Step 3: Write implementation**

```python
# data/causal_graph.py
import networkx as nx
import pandas as pd
from config import CAUSAL_RELATIONS_PATH


_graph_cache = None


def build_causal_graph() -> nx.DiGraph:
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
    if metric_name not in G:
        return []

    result_metrics = {n for n in G.nodes() if G.out_degree(n) > 0 and G.in_degree(n) > 0}
    drillable = []
    for predecessor in G.predecessors(metric_name):
        if predecessor in result_metrics:
            drillable.append(predecessor)

    return drillable
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_causal_graph.py -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add data/causal_graph.py tests/test_causal_graph.py
git commit -m "feat: causal graph with NetworkX, get_factors and get_drilldown APIs"
```

---

## Task 4: Query Tool

**Files:**
- Create: `vibe_coding_data_analyst/tools/query_tool.py`
- Create: `vibe_coding_data_analyst/tests/test_query_tool.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_query_tool.py
import pytest


def test_query_single_value():
    from tools.query_tool import query_metric
    result = query_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        year_start=2024,
        year_end=2024,
        month_start=12,
        month_end=12,
    )
    assert "8772" in result or "8,772" in result


def test_query_multiple_departments():
    from tools.query_tool import query_metric
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
    from tools.query_tool import query_metric
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
    from tools.query_tool import query_metric
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_query_tool.py -v`
Expected: FAIL with ImportError

- [ ] **Step 3: Write implementation**

```python
# tools/query_tool.py
import pandas as pd
from data.loader import load_metric_data, get_departments


def query_metric(
    departments: list[str],
    metric_name: str,
    year_start: int = 2022,
    year_end: int = 2025,
    month_start: int = 1,
    month_end: int = 12,
    aggregation: str = "none",
    sort_by: str = "none",
    top_n: int = 0,
    group_by: str = "month",
) -> str:
    df = load_metric_data()

    if not departments:
        departments = get_departments()

    mask = (
        df["科室"].isin(departments)
        & (df["指标名称"] == metric_name)
        & (df["年份"] >= year_start)
        & (df["年份"] <= year_end)
    )

    if not (year_start == year_end and month_start == 1 and month_end == 12):
        if year_start == year_end:
            mask = mask & (df["月份"] >= month_start) & (df["月份"] <= month_end)

    result_df = df[mask]

    if result_df.empty:
        return f"未找到数据：科室={departments}, 指标={metric_name}, 时间={year_start}.{month_start}-{year_end}.{month_end}"

    unit = result_df["指标单位"].iloc[0]

    if aggregation == "none" and top_n == 0:
        if len(result_df) == 1:
            row = result_df.iloc[0]
            return f"{row['科室']}{int(row['年份'])}年{int(row['月份'])}月{metric_name}为{row['数值']:,.0f}{unit}"
        lines = []
        for _, row in result_df.iterrows():
            lines.append(f"{row['科室']} {int(row['年份'])}年{int(row['月份'])}月: {row['数值']:,.0f}{unit}")
        return "\n".join(lines)

    if aggregation != "none":
        agg_func = {"sum": "sum", "avg": "mean", "max": "max", "min": "min"}[aggregation]
        grouped = result_df.groupby("科室")["数值"].agg(agg_func).reset_index()
    else:
        grouped = result_df.groupby("科室")["数值"].mean().reset_index()

    if sort_by == "value_desc":
        grouped = grouped.sort_values("数值", ascending=False)
    elif sort_by == "value_asc":
        grouped = grouped.sort_values("数值", ascending=True)

    if top_n > 0:
        grouped = grouped.head(top_n)

    agg_label = {"sum": "合计", "avg": "平均", "max": "最大", "min": "最小", "none": "平均"}
    label = agg_label.get(aggregation, "")

    lines = []
    for i, (_, row) in enumerate(grouped.iterrows(), 1):
        prefix = f"第{i}名 " if top_n > 0 else ""
        lines.append(f"{prefix}{row['科室']}: {label}{row['数值']:,.0f}{unit}")

    time_desc = f"{year_start}年" if year_start == year_end else f"{year_start}-{year_end}年"
    header = f"{metric_name} {time_desc} {label}排名：" if top_n > 0 else f"{metric_name} {time_desc}："
    return header + "\n" + "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_query_tool.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/query_tool.py tests/test_query_tool.py
git commit -m "feat: query_tool with structured metric querying, aggregation, and TopN"
```

---

## Task 5: Pandas Tool (Sandboxed Code Execution)

**Files:**
- Create: `vibe_coding_data_analyst/tools/pandas_tool.py`
- Create: `vibe_coding_data_analyst/tests/test_pandas_tool.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pandas_tool.py
import pytest


def test_run_pandas_simple_query():
    from tools.pandas_tool import run_pandas_code
    code = "result = df[(df['科室']=='胸外科') & (df['指标名称']=='门诊人次') & (df['年份']==2024) & (df['月份']==12)]['数值'].values[0]"
    result = run_pandas_code(code)
    assert "8772" in result


def test_run_pandas_calculation():
    from tools.pandas_tool import run_pandas_code
    code = """
subset = df[(df['科室']=='胸外科') & (df['指标名称']=='门诊人次') & (df['年份']==2025)]
result = subset.loc[subset['数值'].idxmax(), '月份']
"""
    result = run_pandas_code(code)
    assert "12" in result


def test_run_pandas_blocks_import():
    from tools.pandas_tool import run_pandas_code
    code = "import os; result = os.listdir('.')"
    result = run_pandas_code(code)
    assert "禁止" in result or "不允许" in result or "error" in result.lower()


def test_run_pandas_timeout():
    from tools.pandas_tool import run_pandas_code
    code = """
import time
time.sleep(10)
result = 'done'
"""
    result = run_pandas_code(code)
    assert "超时" in result or "禁止" in result or "error" in result.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_pandas_tool.py -v`
Expected: FAIL with ImportError

- [ ] **Step 3: Write implementation**

```python
# tools/pandas_tool.py
import signal
import pandas as pd
from data.loader import load_metric_data

FORBIDDEN_KEYWORDS = ["import ", "open(", "exec(", "eval(", "__", "os.", "sys.", "subprocess"]
TIMEOUT_SECONDS = 5


class TimeoutError(Exception):
    pass


def _timeout_handler(signum, frame):
    raise TimeoutError("代码执行超时")


def run_pandas_code(code: str) -> str:
    for keyword in FORBIDDEN_KEYWORDS:
        if keyword in code:
            return f"错误：代码中包含禁止的操作（{keyword.strip()}），不允许执行。"

    df = load_metric_data()
    local_vars = {"df": df, "pd": pd}

    old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(TIMEOUT_SECONDS)

    try:
        exec(code, {"__builtins__": {}}, local_vars)
        signal.alarm(0)
    except TimeoutError:
        return "错误：代码执行超时（超过5秒），请简化查询逻辑。"
    except Exception as e:
        signal.alarm(0)
        return f"代码执行错误：{type(e).__name__}: {str(e)}"
    finally:
        signal.signal(signal.SIGALRM, old_handler)

    if "result" in local_vars:
        return str(local_vars["result"])
    return "代码执行完成，但未设置 result 变量。请将最终结果赋值给 result。"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_pandas_tool.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/pandas_tool.py tests/test_pandas_tool.py
git commit -m "feat: pandas_tool with sandboxed code execution and safety guards"
```

---

## Task 6: Visualization Tool

**Files:**
- Create: `vibe_coding_data_analyst/tools/viz_tool.py`
- Create: `vibe_coding_data_analyst/tests/test_viz_tool.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_viz_tool.py
import pytest
import json


def test_visualize_line_chart():
    from tools.viz_tool import visualize_metric
    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        year_start=2025,
        year_end=2025,
        chart_type="line",
    )
    assert "figure_json" in result
    fig_data = json.loads(result["figure_json"])
    assert "data" in fig_data
    assert len(fig_data["data"]) > 0


def test_visualize_bar_chart_multi_dept():
    from tools.viz_tool import visualize_metric
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
    from tools.viz_tool import visualize_metric
    result = visualize_metric(
        departments=["胸外科"],
        metric_name="门诊人次",
        year_start=2025,
        year_end=2025,
        chart_type="line",
    )
    assert "summary" in result
    assert len(result["summary"]) > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_viz_tool.py -v`
Expected: FAIL with ImportError

- [ ] **Step 3: Write implementation**

```python
# tools/viz_tool.py
import json
import plotly.graph_objects as go
from data.loader import load_metric_data


def visualize_metric(
    departments: list[str],
    metric_name: str,
    year_start: int = 2022,
    year_end: int = 2025,
    month_start: int = 1,
    month_end: int = 12,
    chart_type: str = "line",
) -> dict:
    df = load_metric_data()

    mask = (
        df["科室"].isin(departments)
        & (df["指标名称"] == metric_name)
        & (df["年份"] >= year_start)
        & (df["年份"] <= year_end)
    )
    if year_start == year_end:
        mask = mask & (df["月份"] >= month_start) & (df["月份"] <= month_end)

    result_df = df[mask].sort_values(["科室", "年份", "月份"])

    if result_df.empty:
        return {
            "summary": f"未找到数据：{departments} {metric_name}",
            "figure_json": None,
        }

    unit = result_df["指标单位"].iloc[0]
    fig = go.Figure()

    for dept in departments:
        dept_data = result_df[result_df["科室"] == dept]
        if chart_type == "line":
            fig.add_trace(go.Scatter(
                x=dept_data["date"].tolist(),
                y=dept_data["数值"].tolist(),
                mode="lines+markers",
                name=dept,
            ))
        else:
            fig.add_trace(go.Bar(
                x=dept_data["date"].tolist(),
                y=dept_data["数值"].tolist(),
                name=dept,
            ))

    time_desc = f"{year_start}年" if year_start == year_end else f"{year_start}-{year_end}年"
    title = f"{'、'.join(departments)} {time_desc} {metric_name}趋势"
    fig.update_layout(
        title=title,
        xaxis_title="时间",
        yaxis_title=f"{metric_name}（{unit}）",
        hovermode="x unified",
    )

    max_val = result_df["数值"].max()
    min_val = result_df["数值"].min()
    summary = f"已生成{chart_type}图：{title}。数据范围 {min_val:,.0f} ~ {max_val:,.0f} {unit}。"

    return {
        "summary": summary,
        "figure_json": fig.to_json(),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_viz_tool.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/viz_tool.py tests/test_viz_tool.py
git commit -m "feat: viz_tool generating Plotly charts with line/bar support"
```

---

## Task 7: Causal Analysis Tool

**Files:**
- Create: `vibe_coding_data_analyst/tools/causal_tool.py`
- Create: `vibe_coding_data_analyst/tests/test_causal_tool.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_causal_tool.py
import pytest
import json


def test_analyze_cause_returns_structured_result():
    from tools.causal_tool import analyze_cause
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
    from tools.causal_tool import analyze_cause
    result = analyze_cause(
        department="胸外科",
        metric_name="门诊人次",
        year=2025,
        month=6,
    )
    data = json.loads(result)
    assert data["change_pct"] < 0


def test_analyze_cause_includes_drilldown_info():
    from tools.causal_tool import analyze_cause
    result = analyze_cause(
        department="胸外科",
        metric_name="出院人次",
        year=2025,
        month=6,
    )
    data = json.loads(result)
    assert "drilldown_available" in data


def test_analyze_cause_unknown_metric():
    from tools.causal_tool import analyze_cause
    result = analyze_cause(
        department="胸外科",
        metric_name="不存在指标",
        year=2025,
        month=6,
    )
    assert "无法" in result or "未找到" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_causal_tool.py -v`
Expected: FAIL with ImportError

- [ ] **Step 3: Write implementation**

```python
# tools/causal_tool.py
import json
from data.loader import load_metric_data
from data.causal_graph import build_causal_graph, get_factors, get_drilldown


def analyze_cause(department: str, metric_name: str, year: int, month: int) -> str:
    G = build_causal_graph()
    factors_by_category = get_factors(G, metric_name)

    if not factors_by_category:
        return f"未找到指标「{metric_name}」的因果关系定义，无法进行因果分析。"

    df = load_metric_data()

    current_val = _get_value(df, department, metric_name, year, month)
    if current_val is None:
        return f"未找到{department}{year}年{month}月的{metric_name}数据。"

    prev_year, prev_month = (year, month - 1) if month > 1 else (year - 1, 12)
    prev_val = _get_value(df, department, metric_name, prev_year, prev_month)

    if prev_val is None or prev_val == 0:
        change_pct = 0.0
    else:
        change_pct = (current_val - prev_val) / prev_val * 100

    categories_analysis = []
    for category, factor_list in factors_by_category.items():
        factor_details = []
        for factor_name in factor_list:
            f_current = _get_value(df, department, factor_name, year, month)
            f_prev = _get_value(df, department, factor_name, prev_year, prev_month)

            if f_current is not None and f_prev is not None and f_prev != 0:
                f_change = (f_current - f_prev) / f_prev * 100
            else:
                f_change = None

            factor_details.append({
                "name": factor_name,
                "current_value": f_current,
                "previous_value": f_prev,
                "change_pct": round(f_change, 1) if f_change is not None else None,
            })

        categories_analysis.append({
            "category": category,
            "factors": factor_details,
        })

    drillable = get_drilldown(G, metric_name)

    result = {
        "target_metric": metric_name,
        "department": department,
        "period": f"{year}年{month}月",
        "current_value": current_val,
        "previous_value": prev_val,
        "change_pct": round(change_pct, 1),
        "categories": categories_analysis,
        "drilldown_available": drillable,
    }

    return json.dumps(result, ensure_ascii=False)


def _get_value(df, department: str, metric_name: str, year: int, month: int):
    mask = (
        (df["科室"] == department)
        & (df["指标名称"] == metric_name)
        & (df["年份"] == year)
        & (df["月份"] == month)
    )
    rows = df[mask]
    if rows.empty:
        return None
    return rows.iloc[0]["数值"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_causal_tool.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/causal_tool.py tests/test_causal_tool.py
git commit -m "feat: causal_tool with factor analysis and drilldown detection"
```

---

## Task 8: Agent Prompts & Assembly

**Files:**
- Create: `vibe_coding_data_analyst/agent/prompts.py`
- Create: `vibe_coding_data_analyst/agent/agent.py`
- Create: `vibe_coding_data_analyst/tests/test_agent.py`

- [ ] **Step 1: Create prompts.py with system prompt template**

```python
# agent/prompts.py
from data.loader import get_departments, get_metrics

SYSTEM_PROMPT_TEMPLATE = """你是一个医院运营指标智能分析助手。你可以帮助用户查询医院各科室的运营数据、生成可视化图表、分析指标变化的原因。

## 你的能力
1. 查询指标数据（单值、多科室对比、排名、汇总）
2. 生成可视化图表（折线图、柱状图）
3. 分析指标变化原因（基于因果关系图）

## 可用科室（共20个）
{departments}

## 可用指标（共51个）
{metrics}

## 数据范围
2022年1月 至 2025年12月（共48个月）

## 行为约束
1. 当用户提问与医院运营无关时，礼貌引导回运营分析主题
2. 当查询时间超出2022-2025范围时，提示数据仅覆盖此范围
3. 当数据不足以支撑结论时，诚实说明局限性，不编造答案
4. 从对话上下文推断用户省略的科室、指标或时间信息

## 因果分析指导
- 当用户问"为什么XX指标变化"时，使用因果分析工具
- 智能选择最相关的1-2个类别重点展示
- 如果因子指标可以进一步下钻，在回答末尾提示用户

## 当前日期
2026年5月（用户说"去年"指2025年，"前年"指2024年）
"""


def build_system_prompt() -> str:
    departments = get_departments()
    metrics = get_metrics()

    dept_str = "、".join(departments)
    metrics_str = "\n".join(
        f"- {m['name']}（编码: {m['code']}，单位: {m['unit']}）"
        for m in metrics
    )

    return SYSTEM_PROMPT_TEMPLATE.format(
        departments=dept_str,
        metrics=metrics_str,
    )
```

- [ ] **Step 2: Create agent.py with ReAct Agent assembly**

```python
# agent/agent.py
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
```

- [ ] **Step 3: Write a basic integration test**

```python
# tests/test_agent.py
import pytest
from unittest.mock import patch, MagicMock


def test_create_agent_executor_returns_executor():
    from agent.agent import create_agent_executor
    with patch("agent.agent.ChatOpenAI") as mock_llm:
        mock_llm.return_value = MagicMock()
        executor = create_agent_executor()
        assert executor is not None
        assert executor.max_iterations == 10


def test_build_system_prompt_contains_departments():
    from agent.prompts import build_system_prompt
    prompt = build_system_prompt()
    assert "胸外科" in prompt
    assert "心内科" in prompt
    assert "门诊人次" in prompt
```

- [ ] **Step 4: Run tests**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_agent.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add agent/prompts.py agent/agent.py tests/test_agent.py
git commit -m "feat: ReAct Agent with 4 tools, system prompt, and memory"
```

---

## Task 9: FastAPI Backend

**Files:**
- Create: `vibe_coding_data_analyst/api/schemas.py`
- Create: `vibe_coding_data_analyst/api/routes.py`
- Create: `vibe_coding_data_analyst/server.py`
- Create: `vibe_coding_data_analyst/tests/test_api.py`

- [ ] **Step 1: Create schemas.py**

```python
# api/schemas.py
from pydantic import BaseModel


class ChatRequest(BaseModel):
    session_id: str
    message: str


class ChatResponse(BaseModel):
    text: str
    figures: list[dict] = []
```

- [ ] **Step 2: Create routes.py**

```python
# api/routes.py
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from api.schemas import ChatRequest, ChatResponse
from agent.agent import create_agent_executor
from tools.viz_tool import visualize_metric

router = APIRouter()

sessions: dict = {}


def get_or_create_agent(session_id: str):
    if session_id not in sessions:
        sessions[session_id] = create_agent_executor()
    return sessions[session_id]


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    agent = get_or_create_agent(request.session_id)

    try:
        result = agent.invoke({"input": request.message})
        output_text = result.get("output", "")

        figures = []
        for step in result.get("intermediate_steps", []):
            tool_name = step[0].tool if hasattr(step[0], "tool") else ""
            if tool_name == "visualize_tool":
                tool_input = step[0].tool_input
                viz_result = visualize_metric(**tool_input)
                if viz_result.get("figure_json"):
                    figures.append(json.loads(viz_result["figure_json"]))

        return ChatResponse(text=output_text, figures=figures)

    except Exception as e:
        return ChatResponse(
            text=f"抱歉，处理您的问题时出现错误：{str(e)}。请尝试换一种方式提问。",
            figures=[],
        )
```

- [ ] **Step 3: Create server.py**

```python
# server.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router

app = FastAPI(title="医院运营指标智能分析助手 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Write API test**

```python
# tests/test_api.py
import pytest
from fastapi.testclient import TestClient
from server import app


client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_endpoint_returns_response():
    response = client.post("/chat", json={
        "session_id": "test-session",
        "message": "你好",
    })
    assert response.status_code == 200
    data = response.json()
    assert "text" in data
    assert "figures" in data
```

- [ ] **Step 5: Run tests**

Run: `cd vibe_coding_data_analyst && python -m pytest tests/test_api.py -v`
Expected: health test PASS (chat test may need mock for LLM)

- [ ] **Step 6: Commit**

```bash
git add api/schemas.py api/routes.py server.py tests/test_api.py
git commit -m "feat: FastAPI backend with /chat endpoint and session management"
```

---

## Task 10: Streamlit Frontend

**Files:**
- Create: `vibe_coding_data_analyst/app.py`

- [ ] **Step 1: Create app.py**

```python
# app.py
import uuid
import json
import requests
import streamlit as st
import plotly.io as pio

API_BASE_URL = "http://localhost:8000"

st.set_page_config(page_title="医院运营指标智能分析助手", layout="wide")
st.title("🏥 医院运营指标智能分析助手")

if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())
if "messages" not in st.session_state:
    st.session_state.messages = []

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["text"])
        if msg.get("figures"):
            for fig_json in msg["figures"]:
                fig = pio.from_json(json.dumps(fig_json))
                st.plotly_chart(fig, use_container_width=True)

if user_input := st.chat_input("请输入您的问题，例如：去年12月胸外科门诊人次是多少？"):
    st.session_state.messages.append({"role": "user", "text": user_input})
    with st.chat_message("user"):
        st.markdown(user_input)

    with st.chat_message("assistant"):
        with st.spinner("思考中..."):
            try:
                response = requests.post(
                    f"{API_BASE_URL}/chat",
                    json={
                        "session_id": st.session_state.session_id,
                        "message": user_input,
                    },
                    timeout=60,
                )
                data = response.json()
                st.markdown(data["text"])

                if data.get("figures"):
                    for fig_json in data["figures"]:
                        fig = pio.from_json(json.dumps(fig_json))
                        st.plotly_chart(fig, use_container_width=True)

                st.session_state.messages.append({
                    "role": "assistant",
                    "text": data["text"],
                    "figures": data.get("figures", []),
                })

            except requests.exceptions.ConnectionError:
                error_msg = "无法连接到后端服务，请确保已启动 FastAPI 服务器（uvicorn server:app --port 8000）"
                st.error(error_msg)
                st.session_state.messages.append({"role": "assistant", "text": error_msg})
            except Exception as e:
                error_msg = f"请求出错：{str(e)}"
                st.error(error_msg)
                st.session_state.messages.append({"role": "assistant", "text": error_msg})
```

- [ ] **Step 2: Manual verification**

Run in terminal 1: `cd vibe_coding_data_analyst && uvicorn server:app --reload --port 8000`
Run in terminal 2: `cd vibe_coding_data_analyst && streamlit run app.py`

Test these scenarios:
1. "去年12月胸外科门诊人次是多少？" → should return 8,772
2. "展示2025年胸外科门诊人次趋势" → should show line chart
3. "那专家门诊人次呢？" → should inherit context (胸外科, 2024年12月)

- [ ] **Step 3: Commit**

```bash
git add app.py
git commit -m "feat: Streamlit chat frontend with Plotly chart rendering"
```

---

## Task 11: Voice Input (Paraformer STT)

**Files:**
- Modify: `vibe_coding_data_analyst/api/routes.py` (add WebSocket endpoint)
- Modify: `vibe_coding_data_analyst/app.py` (add microphone component)

- [ ] **Step 1: Add STT WebSocket endpoint to routes.py**

Add to `api/routes.py`:

```python
import asyncio
import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
from config import DASHSCOPE_API_KEY

dashscope.api_key = DASHSCOPE_API_KEY


@router.websocket("/ws/speech")
async def websocket_speech(websocket: WebSocket):
    await websocket.accept()
    recognized_text = []

    class MyCallback(RecognitionCallback):
        def on_event(self, result: RecognitionResult):
            sentence = result.get_sentence()
            if sentence:
                text = sentence.get("text", "")
                is_final = sentence.get("end_time", 0) > 0
                asyncio.run(websocket.send_json({
                    "text": text,
                    "is_final": is_final,
                }))

        def on_error(self, result: RecognitionResult):
            asyncio.run(websocket.send_json({
                "error": str(result),
            }))

    recognition = Recognition(
        model="paraformer-realtime-v2",
        format="pcm",
        sample_rate=16000,
        callback=MyCallback(),
    )
    recognition.start()

    try:
        while True:
            audio_data = await websocket.receive_bytes()
            recognition.send_audio_frame(audio_data)
    except WebSocketDisconnect:
        recognition.stop()
```

- [ ] **Step 2: Add microphone JS component to app.py**

Add before the chat_input in `app.py`:

```python
# Voice input component
voice_html = """
<div id="voice-container">
    <button id="mic-btn" onclick="toggleRecording()" style="
        padding: 10px 20px; border-radius: 20px; border: 2px solid #4a9eff;
        background: transparent; color: #4a9eff; cursor: pointer; font-size: 14px;
    ">🎤 按住说话</button>
    <span id="voice-text" style="margin-left: 10px; color: #888;"></span>
</div>
<script>
let ws = null;
let mediaRecorder = null;
let isRecording = false;

async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1 }
    });

    ws = new WebSocket('ws://localhost:8000/ws/speech');
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        document.getElementById('voice-text').innerText = data.text;
        if (data.is_final) {
            window.parent.postMessage({type: 'voice_input', text: data.text}, '*');
        }
    };

    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const float32 = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
            }
            ws.send(int16.buffer);
        }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    isRecording = true;
    document.getElementById('mic-btn').style.background = '#ff4444';
    document.getElementById('mic-btn').style.color = '#fff';
    document.getElementById('mic-btn').innerText = '⏹ 停止录音';
}

function stopRecording() {
    if (ws) ws.close();
    isRecording = false;
    document.getElementById('mic-btn').style.background = 'transparent';
    document.getElementById('mic-btn').style.color = '#4a9eff';
    document.getElementById('mic-btn').innerText = '🎤 按住说话';
}
</script>
"""

import streamlit.components.v1 as components
components.html(voice_html, height=60)
```

- [ ] **Step 3: Commit**

```bash
git add api/routes.py app.py
git commit -m "feat: real-time voice input with Paraformer STT via WebSocket"
```

---

## Task 12: Voice Output (CosyVoice TTS)

**Files:**
- Modify: `vibe_coding_data_analyst/api/routes.py` (add TTS WebSocket)
- Modify: `vibe_coding_data_analyst/app.py` (add audio playback)

- [ ] **Step 1: Add TTS WebSocket endpoint to routes.py**

Add to `api/routes.py`:

```python
from dashscope.audio.tts_v2 import SpeechSynthesizer, ResultCallback, AudioFormat


@router.websocket("/ws/tts")
async def websocket_tts(websocket: WebSocket):
    await websocket.accept()

    class TTSCallback(ResultCallback):
        def on_data(self, data: bytes):
            asyncio.run(websocket.send_bytes(data))

        def on_complete(self):
            asyncio.run(websocket.send_json({"status": "complete"}))

        def on_error(self, message: str):
            asyncio.run(websocket.send_json({"error": message}))

    try:
        while True:
            message = await websocket.receive_json()
            text = message.get("text", "")
            if text:
                synthesizer = SpeechSynthesizer(
                    model="cosyvoice-v2",
                    voice="longxiaochun",
                    format=AudioFormat.MP3_22050HZ_MONO_256KBPS,
                    callback=TTSCallback(),
                )
                synthesizer.streaming_call(text)
                synthesizer.streaming_complete()
    except WebSocketDisconnect:
        pass
```

- [ ] **Step 2: Add audio playback to app.py**

Add TTS JavaScript to the voice_html component:

```python
# Add to the <script> section in voice_html
tts_script = """
let ttsWs = null;
let audioContext = null;
let audioQueue = [];

function initTTS() {
    ttsWs = new WebSocket('ws://localhost:8000/ws/tts');
    ttsWs.binaryType = 'arraybuffer';
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    ttsWs.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
            const audioBuffer = await audioContext.decodeAudioData(event.data);
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start();
        }
    };
}

function speakText(text) {
    if (!ttsWs || ttsWs.readyState !== WebSocket.OPEN) {
        initTTS();
        ttsWs.onopen = () => ttsWs.send(JSON.stringify({text: text}));
    } else {
        ttsWs.send(JSON.stringify({text: text}));
    }
}

window.addEventListener('message', (event) => {
    if (event.data.type === 'tts_speak') {
        speakText(event.data.text);
    }
});
"""
```

- [ ] **Step 3: Trigger TTS after agent response in app.py**

After receiving the agent response, add:

```python
# After st.markdown(data["text"]):
st.components.v1.html(
    f"<script>window.parent.postMessage({{type: 'tts_speak', text: '{data['text'][:500]}'}}, '*');</script>",
    height=0,
)
```

- [ ] **Step 4: Commit**

```bash
git add api/routes.py app.py
git commit -m "feat: real-time voice output with CosyVoice TTS via WebSocket"
```

---

## Task 13: End-to-End Testing & Polish

**Files:**
- Modify: `vibe_coding_data_analyst/app.py` (UI polish)

- [ ] **Step 1: Manual end-to-end test with sample.csv scenarios**

Start both servers and test each scenario from sample.csv:

| 测试 | 输入 | 期望 |
|------|------|------|
| P0 查询 | "去年12月胸外科门诊人次是多少？" | 返回 8,772 |
| P0 多轮 | 接着问 "那专家门诊人次呢？" | 继承胸外科+2024.12 |
| P0 可视化 | "展示2025年胸外科门诊人次趋势" | 折线图，6月低谷 |
| P1 因果 | "为什么2025年6月胸外科门诊人次下降？" | 分析普通/专家门诊下降 |
| P0 对比 | "心内科和心外科2024年12月门诊人次" | 7079 和 8735 |
| P0 排名 | "2024年哪个科室手术人次最多？前三名" | 骨科第一 |

- [ ] **Step 2: Fix any issues found during testing**

- [ ] **Step 3: Add sidebar with usage hints**

Add to `app.py` after `st.title`:

```python
with st.sidebar:
    st.markdown("### 💡 使用提示")
    st.markdown("""
    **你可以问我：**
    - 查询数据："去年12月胸外科门诊人次"
    - 看趋势："展示2025年骨科出院人次趋势"
    - 对比："心内科和心外科手术人次对比"
    - 分析原因："为什么门诊人次下降？"
    - 排名："哪个科室手术人次最多？"

    **支持多轮对话**，可以追问细节。
    """)
    st.markdown("---")
    st.markdown(f"📊 数据范围：2022.1 - 2025.12")
    st.markdown(f"🏥 覆盖科室：20个")
    st.markdown(f"📋 运营指标：51项")
```

- [ ] **Step 4: Final commit**

```bash
git add app.py
git commit -m "feat: UI polish with sidebar hints and end-to-end verification"
```

---

## Summary

| Task | Priority | Description |
|------|----------|-------------|
| 1 | Setup | Project scaffolding & config |
| 2 | P0 | Data loader |
| 3 | P1 | Causal graph |
| 4 | P0 | Query tool |
| 5 | P0 | Pandas tool (sandboxed) |
| 6 | P0 | Visualization tool |
| 7 | P1 | Causal analysis tool |
| 8 | P0/P2 | Agent prompts & assembly |
| 9 | P0 | FastAPI backend |
| 10 | P0 | Streamlit frontend |
| 11 | P2 | Voice input (Paraformer STT) |
| 12 | P2 | Voice output (CosyVoice TTS) |
| 13 | All | End-to-end testing & polish |
