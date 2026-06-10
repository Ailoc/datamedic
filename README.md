<p align="center">
  <img src="imgs/logo.jpg" alt="DataMedic Logo" width="360" />
</p>

# DataMedic — 医院运营指标智能分析助手

DataMedic 是一个面向医院运营数据分析的智能问答应用。用户用中文描述分析需求（科室指标查询、趋势变化、异常原因、多指标关系），系统通过 LangGraph Agent 驱动本地数据工具完成查询、统计、图表生成和因果解释，结果以流式对话、Plotly 图表和语音朗读的形式呈现在 React 前端。

项目内置 2022 年 1 月至 2025 年 12 月的医院运营指标样例数据，覆盖 **20 个科室**、**51 项指标**和 **48,960 条**指标记录，并附带一张包含 51 个节点、49 条边的指标因果关系表用于波动解释。

## 运行效果

![对话与图表展示](imgs/img2.png)

![多轮分析与因果追踪](imgs/img3.png)

---

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 自然语言查询 | 门诊人次、出院人次、手术人次、住院收入、床位使用率等 51 项指标的科室级查询 |
| 多维分析 | 任意科室组合 × 时间范围 × 聚合方式（合计/均值/最大/最小）× 排名 |
| 图表体系 | 趋势折线、面积、柱状对比、分组柱状、堆叠构成、饼图占比、热力分布、散点关系、气泡关系、箱线分布、直方分布、瀑布环比、KPI 指标卡、明细表 |
| 流式输出 | NDJSON 逐 token 推送，前端打字机渲染，图表在文本完成后一次性展示 |
| 会话持久化 | 后端 JSON 文件持久化，原子写入防损坏；刷新页面或重启服务后会话不丢失 |
| 上下文控制 | 每次模型调用只携带最近 10 轮文本对话，历史图表 JSON 不传入模型，避免上下文爆炸 |
| 语音输入 | 浏览器麦克风 → PCM 音频流 → WebSocket → DashScope Paraformer 实时识别 → 文本追加到输入框 |
| 语音输出 | 流式文本按标点断句 → 持久 WebSocket → DashScope CosyVoice TTS → MP3 音频块 → Web Audio API 流水线化播放 |
| 因果分析 | 基于 NetworkX 有向图，自动查找上游因子指标并计算环比变化率，解释波动原因 |
| 科室概览 | 对"分析一下儿科的数据"等宽泛请求，直接生成多指标趋势折线图 + 核心指标汇总表 |

---

## 技术栈

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| 前端框架 | React 19、TypeScript、Vite | SPA 应用壳、组件化 UI |
| 前端图表 | Plotly.js（按需注册 trace 模块） | 渲染后端生成的 Plotly figure JSON |
| 前端语音 | Web Audio API、MediaStream | 麦克风采集、音频解码与播放 |
| 后端框架 | FastAPI、Pydantic、Uvicorn | REST API、WebSocket、请求校验 |
| Agent 框架 | LangGraph（create_agent）、LangChain | LLM 工具编排、对话记忆管理 |
| LLM | OpenAI-compatible Chat API | gpt-4o / 任意兼容模型 |
| 数据分析 | Pandas、Plotly、NetworkX、OpenPyXL | CSV 数据查询、图表生成、因果图遍历 |
| 语音服务 | DashScope Paraformer（ASR）、CosyVoice（TTS） | 实时语音识别与合成 |
| 测试 | Pytest（124 用例）、Vitest + Testing Library + jsdom（55 用例） | 后端单元测试、前端组件测试 |

---

## 项目结构

```text
datamedic/
├── data/
│   ├── metric_data.csv              # 医院运营指标样例数据（48,960 行）
│   └── causal_relations.xlsx        # 指标因果关系定义（51 节点 / 49 边）
│
├── src/datamedic/
│   ├── server.py                    # FastAPI 应用入口：CORS、日志中间件、lifespan
│   ├── config.py                    # 环境变量加载：LLM、语音、数据路径、CORS 白名单
│   ├── chat_store.py                # 后端 JSON 会话持久化（CRUD + 锁 + LRU）
│   │
│   ├── api/
│   │   ├── routes.py                # /chat、/chat/stream、/sessions、/ws/speech、/ws/tts
│   │   └── schemas.py               # Pydantic 请求/响应模型（ChatRequest、ChatResponse 等）
│   │
│   ├── agent/
│   │   ├── agent.py                 # LangGraph Agent 组装：LLM + 4 工具 + LRU MemorySaver
│   │   └── prompts.py               # 系统提示词：动态注入科室列表、指标列表、当前日期
│   │
│   ├── tools/
│   │   ├── query_tool.py            # 结构化指标查询：多科室筛选、聚合、排序、排名
│   │   ├── pandas_tool.py           # 受限 Pandas 代码执行：AST 白名单校验 + ProcessPoolExecutor 超时
│   │   ├── viz_tool.py              # Plotly 图表生成：14 种图表类型，JSON 序列化
│   │   ├── causal_tool.py           # 因果分析：环比变化计算、因子分类归因
│   │   ├── department_overview.py   # 科室概览：多指标趋势 + 汇总表
│   │   └── validation.py            # 共享参数校验：科室、指标、时间、聚合、图表类型
│   │
│   └── data/
│       ├── loader.py                # CSV 数据加载与缓存（RLock 双检锁）
│       └── causal_graph.py          # NetworkX 因果图构建与查询
│
├── frontend/src/
│   ├── App.tsx                      # 应用壳：侧边栏、聊天线程、输入区、语音控制
│   ├── App.css                      # 全局样式（CSS 变量 + 响应式）
│   ├── api.ts                       # HTTP/NDJSON 客户端：fetch、stream、session CRUD
│   ├── storage.ts                   # 前端内存状态管理 + localStorage 降级兜底
│   ├── voice.ts                     # 语音客户端：SpeechRecognizer（STT）、SpeechPlayer（TTS）
│   ├── speechSegments.ts            # 文本断句：强/弱标点符号分段，用于 TTS 排队
│   ├── plotly.ts                    # Plotly.js 按需加载：仅注册项目使用的 8 种 trace
│   ├── chartTheme.ts                # 图表主题适配：透明背景、统一配色、hover 样式
│   ├── format.ts                    # 时间格式化工具
│   ├── types.ts                     # 核心类型定义 + isRecord 类型守卫
│   │
│   ├── components/
│   │   ├── Sidebar.tsx              # 侧边栏：会话列表、新建、删除确认
│   │   ├── Composer.tsx             # 消息输入区：文本输入 + 语音按钮
│   │   ├── MessageList.tsx          # 消息列表：过滤空消息、渲染图表面板
│   │   ├── PlotlyPanel.tsx          # 图表面板：异步挂载、主题注入、卸载清理
│   │   ├── Welcome.tsx              # 欢迎页：示例问题快捷输入
│   │   └── StatusPill.tsx           # 状态标签：数据范围、科室数、指标数
│   │
│   └── hooks/
│       └── useChatSession.ts        # 聊天会话 Hook：流式消息、语音分段、状态更新
│
├── tests/                           # 后端测试（124 用例）
│   ├── test_api.py                  # API 端点、流式响应、会话、错误处理
│   ├── test_agent.py                # 系统提示词、LRU MemorySaver
│   ├── test_chat_store.py           # 会话持久化 CRUD
│   ├── test_query_tool.py           # 指标查询工具
│   ├── test_viz_tool.py             # 图表生成工具（14 种类型全覆盖）
│   ├── test_causal_tool.py          # 因果分析工具
│   ├── test_pandas_tool.py          # Pandas 代码执行沙箱
│   ├── test_validation.py           # 参数校验函数
│   ├── test_loader.py               # 数据加载与缓存
│   ├── test_causal_graph.py         # 因果图构建与查询
│   ├── test_department_overview.py  # 科室概览
│   └── conftest.py                  # 共享 fixtures（按需扩展）
│
└── frontend/src/                    # 前端测试（55 用例，与源码同目录）
    ├── App.test.tsx                 # App 组件集成测试
    ├── api.test.ts                  # API 客户端测试
    ├── storage.test.ts              # 存储层测试
    ├── voice.test.ts                # 语音客户端测试
    ├── speechSegments.test.ts       # 断句逻辑测试
    ├── plotly.test.ts               # Plotly 加载器测试
    ├── chartTheme.test.ts           # 图表主题测试
    └── viteConfig.test.ts           # Vite 代理配置测试
```

---

## 系统架构

```mermaid
flowchart LR
  User["用户"] --> UI["React 前端"]
  UI --> Sessions["GET/POST/DELETE /sessions"]
  UI --> Chat["POST /chat/stream (NDJSON)"]
  UI --> Speech["WS /ws/speech (PCM)"]
  UI --> TTS["WS /ws/tts (MP3)"]

  Sessions --> API["FastAPI"]
  Chat --> API
  Speech --> API
  TTS --> API

  API --> Store["chat_store.py<br/>JSON 会话持久化"]
  API --> Agent["LangGraph Agent"]
  Agent --> LLM["OpenAI-compatible 模型<br/>gpt-4o / 任意兼容"]
  Agent --> Query["query_metric_tool"]
  Agent --> Pandas["pandas_code_tool"]
  Agent --> Viz["visualize_tool"]
  Agent --> Cause["causal_analysis_tool"]

  Query --> MetricData["metric_data.csv"]
  Pandas --> MetricData
  Viz --> MetricData
  Cause --> MetricData
  Cause --> Graph["causal_relations.xlsx → NetworkX"]

  API --> ASR["DashScope Paraformer ASR"]
  API --> Voice["DashScope CosyVoice TTS"]
```

---

## 核心运行逻辑

### 1. 启动流程

```mermaid
sequenceDiagram
    participant Uvicorn
    participant FastAPI as FastAPI App
    participant Lifespan
    participant React as Vite Dev Server
    participant Browser

    Uvicorn->>FastAPI: 启动 uvicorn datamedic.server:app
    FastAPI->>Lifespan: lifespan() 上下文管理器
    Lifespan-->>FastAPI: yield（日志输出启动成功）
    Note over FastAPI: 注册 CORS 中间件<br/>挂载 APIRouter<br/>注册 /health 端点<br/>HTTP 日志中间件

    React->>Browser: 启动 npm run dev
    Note over React: Vite 代理 /chat、/sessions、<br/>/health、/ws/* → localhost:8000

    Browser->>React: 访问 http://localhost:5173
    Browser->>FastAPI: GET /sessions
    FastAPI-->>Browser: 返回所有会话列表 JSON
    Note over Browser: 渲染侧边栏会话列表<br/>选择最近一个会话为 activeId
```

后端采用**延迟初始化**策略——Agent 不在服务启动时创建，而是在第一次 `/chat/stream` 请求到达时才实例化 LLM 和工具集，避免空跑服务占用模型资源：

```python
# src/datamedic/api/routes.py
_agent = None
_agent_lock = threading.Lock()

def get_agent():
    global _agent
    if _agent is None:
        with _agent_lock:
            if _agent is None:
                from datamedic.agent.agent import create_agent_graph
                _agent = create_agent_graph()
    return _agent
```

---

### 2. 流式对话 — 完整调用链路

这是系统最核心的数据流，从用户输入到最终渲染，经历**前端发送 → 后端编排 → Agent 推理 → 流式回传 → 前端渲染**五个阶段：

```mermaid
sequenceDiagram
    participant User
    participant App as App.tsx
    participant Hook as useChatSession
    participant API as api.ts
    participant FastAPI as routes.py
    participant Store as chat_store.py
    participant Agent as LangGraph Agent
    participant LLM as ChatOpenAI
    participant Tools as Tools (query/viz/causal/pandas)
    participant VizTool as visualize_metric

    User->>App: 输入消息并提交
    App->>Hook: submitMessage(text)
    Hook->>Hook: 创建 AbortController<br/>本地追加 user + assistant 消息<br/>setLoading(true)

    Hook->>API: streamChatMessage(sessionId, message, {onDelta})
    API->>FastAPI: POST /chat/stream {session_id, message}

    Note over FastAPI: _stream_chat_events() 异步生成器

    FastAPI->>Store: append_message(session_id, "user", text)
    Store-->>FastAPI: 返回 conversation, user_message

    alt 无上下文指代追问
        FastAPI->>FastAPI: _detect_vague_reference_request()
        FastAPI-->>API: yield {type:"done", text:"引导文案"}
    else 科室概览请求
        FastAPI->>FastAPI: detect_department_overview_request()
        FastAPI->>FastAPI: build_department_overview(dept)
        loop 逐行流式推送
            FastAPI-->>API: yield {type:"delta", text:chunk}
        end
        FastAPI-->>API: yield {type:"done", text, figures}
    else 正常 Agent 路径
        FastAPI->>Store: build_model_messages(conversation, max_rounds=10)
        Store-->>FastAPI: 最近 10 轮文本消息

        FastAPI->>Agent: astream_events(input_data, config)

        loop Agent 推理循环
            Agent->>LLM: 发送消息（系统提示词 + 历史 + 用户消息）
            LLM-->>Agent: 决定调用工具
            Agent->>Tools: 执行工具（query_metric / visualize_metric / ...）
            Tools-->>Agent: 返回工具结果
            Agent->>LLM: 携带工具结果继续推理
            LLM-->>Agent: 生成回复文本（流式 token）

            Note over Agent,FastAPI: on_chat_model_stream 事件
            Agent-->>FastAPI: 增量文本 chunk
            FastAPI-->>API: yield {type:"delta", text:"..."}
            API->>Hook: onDelta(delta)
            Hook->>Hook: streamedText += delta<br/>setState() 更新 UI
            Hook->>Hook: queueSpeakableDeltas(delta) → TTS 队列
        end

        Note over Agent,FastAPI: on_chain_end 事件
        Agent-->>FastAPI: 最终消息列表 final_messages

        FastAPI->>FastAPI: _extract_ai_text(final_messages)
        FastAPI->>VizTool: _build_figures() 重建图表
        VizTool-->>FastAPI: Plotly figure JSON 列表

        FastAPI->>Store: append_message(session_id, "assistant", text, figures)
        FastAPI-->>API: yield {type:"done", text, figures}
    end

    API->>Hook: 返回 {ok, text, figures}
    Hook->>Hook: setState() 写入最终文本 + 图表
    Hook->>Hook: flushSpeech() 刷新剩余语音队列
    Hook->>App: setLoading(false)
    App->>User: 展示完整回复 + Plotly 图表
```

#### 后端流式推送协议（NDJSON）

每行一个 JSON 对象，以 `\n` 分隔，共三种事件类型：

```json
{"type":"delta","text":"增量文本片段"}
{"type":"done","text":"完整回复文本","figures":[{"data":[...],"layout":{...}}]}
{"type":"error","text":"错误说明"}
```

#### 前端流式消费核心代码

```typescript
// frontend/src/api.ts — streamChatMessage
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";    // 保留不完整行
  lines.forEach(consumeLine);     // 逐行解析 StreamEvent
}
```

---

### 3. 会话持久化 — 保存与加载

会话数据以后端 JSON 文件为**唯一事实来源**，每个会话保存为独立文件：

```
data/conversations/<url-encoded-session-id>/conversation.json
```

#### JSON 文件结构

```json
{
  "id": "uuid",
  "title": "会话标题（取自首条用户消息前 15 字）",
  "summary": "最近一条消息文本",
  "createdAt": "2026-05-15T00:00:00.000Z",
  "updatedAt": "2026-05-15T00:00:00.000Z",
  "messages": [
    {
      "id": "uuid",
      "role": "user | assistant",
      "text": "消息内容",
      "figures": [{ "data": [], "layout": {} }],
      "createdAt": "2026-05-15T00:00:00.000Z"
    }
  ]
}
```

#### 保存流程（原子写入）

```mermaid
sequenceDiagram
    participant Route as routes.py
    participant Store as chat_store.py
    participant Lock as threading.Lock
    participant FS as 文件系统

    Route->>Store: append_message(session_id, role, text, figures)
    Store->>Store: _conversation_lock(session_id)
    Store->>Lock: 获取会话级锁

    Store->>Store: load_conversation(session_id)
    Store->>FS: 读取 conversation.json

    Store->>Store: 追加新消息到 messages 数组<br/>更新 title/summary/updatedAt

    Note over Store,FS: 原子写入：先写临时文件再替换
    Store->>FS: 写入 temp_path（临时文件）
    Store->>FS: temp_path.replace(path)（原子替换）

    Store->>Lock: 释放锁
    Store-->>Route: 返回更新后的 conversation
```

**核心安全设计**：

```python
# src/datamedic/chat_store.py — 原子写入防止半写损坏
def _save_conversation(conversation: dict, root: Path | None = None) -> None:
    path = _conversation_path(conversation["id"], root)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(conversation, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)  # POSIX 下为原子操作
```

**并发安全 — LRU 锁池**：每个会话拥有独立的 `threading.Lock`，锁池上限 500，超出时按 LRU 淘汰未被持有的锁；若所有锁均被持有则强制淘汰最旧的锁以防止死循环。

```python
# src/datamedic/chat_store.py — LRU 锁淘汰
while len(_lock_access_order) > MAX_LOCKS:
    evicted_key = _lock_access_order.pop(0)
    evicted_lock = _conversation_locks.get(evicted_key)
    if evicted_lock is not None and evicted_lock.locked() and len(_lock_access_order) >= MAX_LOCKS:
        _lock_access_order.append(evicted_key)  # 被持有的锁放回队列末尾
        continue
    _conversation_locks.pop(evicted_key, None)  # 安全淘汰
```

#### 加载流程

```mermaid
sequenceDiagram
    participant Browser
    participant App as App.tsx
    participant API as api.ts
    participant FastAPI as routes.py
    participant Store as chat_store.py
    participant FS as 文件系统

    Note over Browser: 页面刷新 / 首次加载
    Browser->>App: useEffect 触发
    App->>API: fetchSessions()
    API->>FastAPI: GET /sessions
    FastAPI->>Store: list_conversations()
    Store->>FS: 遍历 data/conversations/ 目录
    Store-->>FastAPI: 所有会话元数据列表
    FastAPI-->>API: JSON 数组
    API-->>App: Conversation[]

    Note over App: 设置 activeId = 最近更新的会话
    App->>Browser: 渲染侧边栏 + 加载会话消息

    Note over App,Browser: 切换会话时为纯内存操作<br/>（GET /sessions 已返回完整数据）
    App->>App: handleSwitch(conversationId)
    App->>App: setState(setActiveConversation(state, id))
```

---

### 4. Agent 工具编排

Agent 由 `src/datamedic/agent/agent.py` 使用 LangGraph 的 `create_agent()` 组装：

```
ChatOpenAI(LLM) + 4 个 @tool 工具 + 系统提示词 + LRUMemorySaver
```

```mermaid
sequenceDiagram
    participant Agent as LangGraph Agent
    participant LLM as ChatOpenAI
    participant QM as query_metric_tool
    participant VM as visualize_tool
    participant CA as causal_analysis_tool
    participant PC as pandas_code_tool
    participant CSV as metric_data.csv
    participant NX as NetworkX 因果图

    Agent->>LLM: 发送 system_prompt + 最近 10 轮消息
    LLM-->>Agent: 分析用户意图，选择工具

    alt 用户问"骨科2025年门诊人次趋势"
        Agent->>VM: visualize_tool(departments, metric, chart_type="line")
        VM->>CSV: load_metric_data() → 过滤 → 聚合
        VM-->>Agent: 返回文本摘要（不返回 figure JSON）
        Note over Agent: figure JSON 由 API 层重建
    end

    alt 用户问"为什么骨科出院人次下降"
        Agent->>CA: causal_analysis_tool(department, metric_name)
        CA->>NX: build_causal_graph() → get_factors()
        CA->>CSV: 查询当月 + 上月各因子数据
        CA-->>Agent: 返回 JSON（因子列表 + 环比变化率）
    end

    alt 用户问具体数值
        Agent->>QM: query_metric_tool(departments, metric, ...)
        QM->>CSV: load_metric_data() → 筛选 → 聚合
        QM-->>Agent: 返回自然语言描述或格式化列表
    end

    alt 标准工具无法满足
        Agent->>PC: pandas_code_tool(code)
        PC->>PC: AST 白名单校验
        PC->>PC: ProcessPoolExecutor 子进程执行
        PC-->>Agent: 返回 result 变量值
    end

    Agent->>LLM: 携带工具结果，生成最终回复
    LLM-->>Agent: 流式输出回复文本
```

#### 四个工具一览

| 工具 | 函数签名 | 能力 |
| --- | --- | --- |
| `query_metric_tool` | `(departments, metric_name, year_start, year_end, month_start, month_end, aggregation, sort_by, top_n)` | 单值查询、多科室对比、聚合统计、排名 |
| `pandas_code_tool` | `(code)` | 在受限环境中执行 Pandas 代码，变量 `df` 为完整 DataFrame |
| `visualize_tool` | `(departments, metric_name, ..., chart_type, group_by, secondary_metric_name, size_metric_name, top_n)` | 生成 14 种 Plotly 图表，给 LLM 只返回文本摘要 |
| `causal_analysis_tool` | `(department, metric_name, year?, month?)` | 因果图查找上游因子，计算环比变化率 |

每个工具调用通过 `_timed_tool` 包装，记录执行耗时日志。

#### Pandas 沙箱安全

`pandas_code_tool` 是安全最敏感的工具，采用多层防护：

```python
# src/datamedic/tools/pandas_tool.py — 三层防护

# 第一层：AST 白名单校验
def _validate_code(code: str) -> str | None:
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return "禁止使用 import 语句"
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            return "禁止定义函数或类"
        # ... 禁止文件 I/O、循环、异常处理等

# 第二层：受限 builtins
SAFE_BUILTINS = {"abs": abs, "len": len, "sum": sum, "sorted": sorted, ...}
exec(code, {"__builtins__": SAFE_BUILTINS, "df": df.copy(), "pd": pd, "result": None})

# 第三层：ProcessPoolExecutor 超时隔离
executor = ProcessPoolExecutor(max_workers=1)
future = executor.submit(_exec_in_subprocess, code)
result = future.result(timeout=TIMEOUT_SECONDS)  # 5 秒超时
executor.shutdown(wait=False, cancel_futures=True)  # 非阻塞清理
```

---

### 5. 图表生成与渲染

Agent 调用 `visualize_tool` 时的数据流有一个精妙的设计——**两次执行**：

```mermaid
sequenceDiagram
    participant Agent as Agent
    participant VizTool as visualize_metric
    participant API as routes.py
    participant Frontend as PlotlyPanel.tsx
    participant Plotly as Plotly.js

    Agent->>VizTool: 第一次调用（Agent 推理期间）
    VizTool->>VizTool: 数据查询 + 构建 Plotly Figure
    VizTool-->>Agent: 只返回 summary 文本<br/>"已生成趋势线图：..."
    Note over Agent: 减少 LLM 上下文负担<br/>不传入大量 figure JSON

    Note over API: Agent 推理结束后
    API->>API: _extract_visualize_tool_args(final_messages)
    Note over API: 只提取最新用户消息之后的调用<br/>避免重复历史图表
    API->>VizTool: 第二次调用（API 层重建）
    VizTool-->>API: 返回 figure_json
    API->>API: json.loads(figure_json)
    API-->>Frontend: done 事件携带 figures[]

    Frontend->>Plotly: requestAnimationFrame → 延迟加载
    Frontend->>Frontend: createPlotlyThemePayload() 注入主题
    Frontend->>Plotly: Plotly.react(div, data, layout)
    Note over Frontend: 卸载时 Plotly.purge() 清理
```

**Plotly 按需加载**（`plotly.ts`）：只注册 8 种 trace 模块（bar、box、heatmap、histogram、indicator、pie、table、waterfall），而非完整 Plotly.js，减少约 60% 的首屏加载体积。

---

### 6. 语音输入 — 语音转文字（STT）

语音输入采用浏览器端实时采集 + 后端 DashScope Paraformer 识别的架构：

```mermaid
sequenceDiagram
    participant Mic as 浏览器麦克风
    participant SR as SpeechRecognizer
    participant WS as WebSocket /ws/speech
    participant FastAPI as routes.py
    participant DashScope as Paraformer ASR
    participant Composer as Composer.tsx

    Composer->>SR: new SpeechRecognizer(callbacks)
    SR->>Mic: getUserMedia({audio: {sampleRate: 16000}})
    SR->>WS: new WebSocket("/ws/speech")
    SR->>SR: new AudioContext(16000Hz)
    SR->>SR: createScriptProcessor(4096, 1, 1)

    Note over SR: 音频管线建立完毕

    loop 实时音频采集
        Mic-->>SR: Float32 PCM 数据
        SR->>SR: Float32 → Int16 转换<br/>Math.max(-32768, min(32767, sample * 32768))
        SR->>WS: socket.send(Int16 PCM buffer)
        WS->>FastAPI: receive_bytes()
        FastAPI->>DashScope: recognition.send_audio_frame(audio)
    end

    loop 识别结果回调
        DashScope-->>FastAPI: RecognitionResult（sentence）
        FastAPI-->>WS: send_json({text, is_final})

        alt is_final = false（中间结果）
            WS-->>SR: callbacks.onText(text, false)
            SR->>Composer: 显示"正在聆听..."提示
        else is_final = true（最终结果）
            WS-->>SR: callbacks.onText(text, true)
            SR->>Composer: 追加识别文本到输入框末尾<br/>不覆盖用户已有输入
        end
    end

    Note over Composer: 用户点击停止
    Composer->>SR: stop()
    SR->>SR: 清理全部资源<br/>processor.disconnect()<br/>audioContext.close()<br/>stream.getTracks().forEach(stop)<br/>socket.close()
```

**关键实现细节**：

- `ScriptProcessorNode` 每次回调 4096 个采样点，前端将 Float32 归一化音频转为 Int16 PCM 格式
- DashScope 回调运行在 SDK 的内部线程中，通过 `asyncio.run_coroutine_threadsafe()` 安全地调度到 FastAPI 的事件循环
- `_handle_dashscope_ws` 上下文管理器统一处理 WebSocket 断连、SDK 缺失、运行时异常等错误场景

---

### 7. 语音输出 — 文字转语音（TTS）

语音输出是系统中最复杂的异步流水线，涉及**文本断句 → WebSocket 合成 → 音频缓冲 → 顺序播放**四个阶段：

```mermaid
sequenceDiagram
    participant Hook as useChatSession
    participant Seg as speechSegments
    participant SP as SpeechPlayer
    participant WS as WebSocket /ws/tts
    participant FastAPI as routes.py
    participant DashScope as CosyVoice TTS
    participant Audio as Web Audio API

    Note over Hook: 流式 delta 事件到达
    Hook->>Seg: extractSpeakableSegments(delta)
    Note over Seg: 按强标点和弱标点断句，详见下方表格

    Seg-->>Hook: segments[] + remaining
    loop 每个可朗读片段
        Hook->>SP: enqueue(content)
        SP->>SP: 创建 SpeechQueueItem<br/>加入 pendingQueue
        SP->>SP: startQueueDrain()
    end

    Note over SP: drainQueue() 异步流水线

    loop 队列中的每个片段
        alt 有预取的音频
            SP->>SP: 使用 preFetchedAudio
        else 无预取
            SP->>WS: ensureSocket() → 持久 WebSocket
            WS->>FastAPI: receive_json({text})
            FastAPI->>DashScope: synthesizer.streaming_call(text)
            loop 音频数据回调
                DashScope-->>FastAPI: on_data(MP3 bytes)
                FastAPI-->>WS: send_bytes(MP3 chunk)
            end
            DashScope-->>FastAPI: on_complete()
            FastAPI-->>WS: send_json({status:"complete"})
            WS-->>SP: 收集 chunks → Blob → decodeAudioData
        end

        Note over SP: 播放当前片段的同时预取下一片段
        SP->>SP: 启动 preFetchPromise（后台合成下一段）

        SP->>Audio: playBuffer(audioBuffer)
        Audio->>Audio: createBufferSource()<br/>source.connect(destination)<br/>source.start()
        Audio-->>SP: onended 回调 → resolve

        SP->>SP: 等待 preFetchPromise 完成
    end

    Note over SP: 队列清空，播放结束

    alt 用户发送新消息
        Hook->>SP: stop()
        SP->>SP: playbackId += 1（使所有进行中的任务失效）
        SP->>SP: 清空 pendingQueue<br/>关闭 ttsSocket<br/>停止当前 source
    end
```

**关键设计**：

1. **持久 WebSocket**：整个播放周期只建立一个 TTS 连接（`ensureSocket()`），消除每段新建连接的握手开销
2. **合成与播放流水线化**：`drainQueue()` 中，当前片段通过 `playBuffer()` 播放时，同时通过 `preFetchPromise` 预合成下一片段的音频，存入 `preFetchedAudio`
3. **playbackId 打断机制**：`stop()` 递增 `playbackId`，所有异步操作在关键点检查 `playbackId !== this.playbackId` 时自动退出，实现无竞态打断
4. **断句策略**（`speechSegments.ts`）：

| 断句类型 | 触发标点 | 条件 |
| --- | --- | --- |
| 强断句 | `。！？!?；;` | 立即断句 |
| 弱断句 | `，,、：:` | 累积片段 ≥ 22 字符后断句 |

---

### 8. 前置拦截与降级

API 层在调用 Agent 前执行多层拦截，减少不必要的 LLM 调用：

```mermaid
flowchart TD
    A[用户消息] --> B{无上下文指代追问?}
    B -->|是| C[返回引导文案<br/>不送入 Agent]
    B -->|否| D{科室概览请求?}
    D -->|是| E[直接生成<br/>多指标趋势图 + 汇总表<br/>不经过 Agent]
    D -->|否| F[送入 LangGraph Agent]
    F --> G{Agent 执行成功?}
    G -->|是| H[返回回复 + 图表]
    G -->|递归超限| I{消息含单科室?}
    I -->|是| J[降级为科室概览]
    I -->|否| K[返回带上下文的错误提示]
    G -->|其他异常| L[返回安全错误文案]
```

**三层拦截逻辑**：

1. **无上下文指代追问检测**：消息含指代词（"这种"、"这个"）+ 因果意图（"为什么"、"下降"）但未指明具体指标，且历史无图表上下文 → 直接引导
2. **科室概览检测**：消息提到单一科室 + 宽泛术语（"分析"、"数据"、"看看"）但未指定具体指标 → 直接生成概览
3. **递归超限降级**：Agent 抛出 `GRAPH_RECURSION_LIMIT` 错误且消息含单科室 → 降级为科室概览

---

### 9. 数据层设计

#### CSV 数据加载（loader.py）

```python
# src/datamedic/data/loader.py — RLock 双检锁缓存
_cache: pd.DataFrame | None = None
_cache_lock = threading.RLock()

def load_metric_data() -> pd.DataFrame:
    global _cache
    if _cache is not None:
        return _cache
    with _cache_lock:
        if _cache is not None:    # 双检锁
            return _cache
        df = pd.read_csv(METRIC_DATA_PATH)
        df["date"] = df["年份"].astype(str) + "-" + df["月份"].astype(int).astype(str).str.zfill(2)
        _cache = df
        return _cache
```

- 首次访问时加载 `metric_data.csv`（48,960 行），生成 `date` 辅助列（如 "2025-06"）
- `get_departments()` 和 `get_metrics()` 从缓存 DataFrame 派生，无需重复 I/O

#### 因果图构建（causal_graph.py）

- 从 `causal_relations.xlsx` 读取 49 条因果关系
- 构建 NetworkX 有向图（因子 → 结果），边属性含类别
- `get_factors(G, metric_name)`：查询上游因子，按类别分组返回
- `get_drilldown(G, metric_name)`：识别可进一步下钻的中间节点
- 同样使用 RLock 双检锁缓存

---

## API 概览

| 方法 | 路径 | 请求体 | 响应 |
| --- | --- | --- | --- |
| `GET` | `/health` | - | `{"status": "ok"}` |
| `POST` | `/chat` | `ChatRequest` | `ChatResponse`（JSON） |
| `POST` | `/chat/stream` | `ChatRequest` | `application/x-ndjson` 流 |
| `GET` | `/sessions` | - | `list[ConversationRecord]` |
| `POST` | `/sessions` | - | `ConversationRecord` |
| `GET` | `/sessions/{id}` | - | `ConversationRecord` |
| `DELETE` | `/sessions/{id}` | - | `{"ok": true}` |
| `WS` | `/ws/speech` | 二进制 PCM 音频帧 | JSON 识别结果 |
| `WS` | `/ws/tts` | JSON `{"text": "..."}` | 二进制 MP3 + JSON 状态 |

**ChatRequest**：
```json
{
  "session_id": "conversation-uuid",
  "message": "展示 2025 年骨科出院人次趋势"
}
```

**NDJSON 流式事件**：
```json
{"type": "delta", "text": "增量文本"}
{"type": "done", "text": "完整回复文本", "figures": [{ "data": [...], "layout": {...} }]}
{"type": "error", "text": "错误说明"}
```

---

## 快速开始

### 环境要求

- Python 3.11+（推荐 3.12+）
- Node.js 18+、npm
- OpenAI-compatible 聊天模型服务（API Key + Base URL）
- DashScope API Key（语音输入/输出需要，文本分析不需要）

### 安装与配置

```bash
# 1. 克隆项目
git clone <repo-url> && cd datamedic

# 2. 后端依赖
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
# 或使用 uv: uv sync

# 3. 环境变量
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY、OPENAI_BASE_URL、MODEL_NAME
# 语音功能需填入 DASHSCOPE_API_KEY

# 4. 前端依赖
cd frontend && npm install
```

关键环境变量：

```bash
# LLM
OPENAI_API_KEY=sk-your-key
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o

# 语音（可选）
DASHSCOPE_API_KEY=sk-your-key
STT_MODEL=paraformer-realtime-v2
TTS_MODEL=cosyvoice-v2
TTS_VOICE=longxiaochun_v2

# 数据路径（可选）
CONVERSATION_DATA_DIR=data/conversations
CORS_ALLOW_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
LOG_LEVEL=INFO
```

### 启动

```bash
# 终端 1：后端
source .venv/bin/activate
uvicorn datamedic.server:app --host 127.0.0.1 --port 8000 --reload

# 终端 2：前端
cd frontend && npm run dev
```

访问 `http://localhost:5173`。Vite 开发服务器自动代理 `/chat`、`/sessions`、`/health`、`/ws/speech`、`/ws/tts` 到 `localhost:8000`。

### 测试

```bash
# 后端（124 用例）
python3 -m pytest tests/ -v

# 前端（55 用例）
cd frontend && npx vitest run
```

---

## 开发约定

- **分层原则**：API 层只做请求编排和前置拦截；业务逻辑在 `tools/`、`chat_store.py`、`data/` 中
- **图表协议**：图表始终以 Plotly figure JSON 格式保存和传输，前后端无需额外协议
- **会话事实来源**：后端 JSON 文件是持久化唯一事实来源
- **错误安全**：所有面向用户的错误消息不泄露内部路径、token 或技术细节
- **测试覆盖**：重点关注工具参数校验、图表生成、会话持久化、流式响应解析、语音队列、前端状态恢复
- **类型安全**：前端 TypeScript 严格类型检查（`tsc --noEmit`），后端 Pydantic 模型校验

---

## 示例提问

- "展示 2025 年骨科出院人次趋势。"
- "比较心内科和心外科 2024 年手术人次。"
- "找出 2025 年门诊人次最高的前 5 个科室。"
- "分析住院收入和出院人次之间的关系。"
- "为什么骨科 2025 年 6 月出院人次下降？"
- "分析一下儿科的数据。"
- "用热力图展示各科室 2025 年床位使用率分布。"
- "生成心血管内科 2025 年门诊人次的瀑布图。"
