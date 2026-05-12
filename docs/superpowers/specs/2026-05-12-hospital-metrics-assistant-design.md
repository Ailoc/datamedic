# 医院运营指标智能分析助手 — 设计文档

## 概述

构建一个交互式智能分析助手，能够理解用户自然语言提出的问题，从医院运营数据中查询指标、生成可视化图表，并结合因果关系对指标变化做出解读。

## 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 大模型 | OpenAI GPT API (通过 langchain_openai) | 意图理解 + 回答生成 |
| Agent 框架 | LangChain v1.x ReAct Agent | Tool calling + 记忆管理 |
| 前端 | Streamlit | 对话式 UI + 内嵌可交互 Plotly 图表 |
| 数据处理 | Pandas | 指标查询与计算 |
| 可视化 | Plotly | 交互式图表 |
| 因果关系 | NetworkX | 有向图存储与遍历 |
| 配置 | python-dotenv | .env 文件管理 API Key/Base URL/Model |

## 功能覆盖

- **P0（必须完成）**：指标查询、数据可视化、多轮对话
- **P1（建议完成）**：因果分析（单层 + 可选下钻）
- **P2（加分项）**：Agent 框架应用（ReAct Agent）、语音输入/输出（Paraformer STT + CosyVoice TTS）
- **暂不实现**：效果量化评估

## 数据概况

- `metric_data.csv`：20 个科室 × 51 项指标 × 48 个月（2022.1-2025.12），共 48,960 条记录，无缺失值
- `causal_relations.xlsx`：49 条因果关系，涉及 12 个结果指标，5 个指标存在多层嵌套

## 整体架构

前后端分离：FastAPI 后端提供 Agent API 和语音服务（STT + TTS），Streamlit 前端负责 UI 交互。

```
┌─────────────────────┐              ┌──────────────────────────────────┐
│   Streamlit 前端     │    HTTP      │         FastAPI 后端              │
│                     │  ─────────→  │                                  │
│ • 对话 UI           │              │ • POST /chat                     │
│ • Plotly 图表渲染    │  ←─────────  │   → Agent 处理 → 返回结果         │
│ • 语音录入(JS组件)   │              │                                  │
│ • 语音播放(Web Audio)│  WebSocket   │ • WS /ws/speech                  │
│ • 会话状态管理       │  ←────────→  │   → Paraformer STT → 实时文字     │
│                     │              │ • WS /ws/tts                     │
│                     │  ←────────→  │   → CosyVoice TTS → 实时音频     │
└─────────────────────┘              │                                  │
                                     │ • Agent + Tools + Memory         │
                                     │ • DashScope (Paraformer + Cosy)  │
                                     └──────────────────────────────────┘
```

## 项目结构

```
vibe_coding_data_analyst/
├── app.py                    # Streamlit 前端入口
├── server.py                 # FastAPI 后端入口
├── config.py                 # 配置管理 (.env)
├── .env                      # API Key, Base URL, Model Name
├── requirements.txt          # 依赖
│
├── api/
│   ├── routes.py             # FastAPI 路由定义 (/chat, /speech-to-text)
│   └── schemas.py            # 请求/响应数据模型 (Pydantic)
│
├── data/
│   ├── loader.py             # 数据加载与预处理
│   └── causal_graph.py       # NetworkX 因果关系图
│
├── agent/
│   ├── agent.py              # ReAct Agent 组装
│   └── prompts.py            # System Prompt 模板
│
├── tools/
│   ├── query_tool.py         # 预定义数据查询
│   ├── pandas_tool.py        # 复杂查询（代码生成）
│   ├── viz_tool.py           # Plotly 可视化
│   └── causal_tool.py        # 因果分析
│
├── metric_data.csv           # 原始数据
├── causal_relations.xlsx     # 因果关系定义
└── sample.csv                # 测试用例
```

---

## 模块设计

### 1. 数据层（data/）

#### data/loader.py

- 启动时一次性加载 `metric_data.csv` 到 DataFrame
- 添加 `date` 列（格式 "YYYY-MM"）便于时间轴绘图
- 构建元数据：科室列表、指标列表（含编码和单位），供 System Prompt 使用
- 使用 `@st.cache_data` 缓存，避免重复加载

#### data/causal_graph.py

- 加载 `causal_relations.xlsx`，构建 NetworkX 有向图
- 边：因子指标 → 结果指标（属性：category=类别）
- 节点：指标名称（属性：code=编码）
- 核心 API：
  - `get_factors(metric_name)` → 返回 `{类别: [因子列表]}` 字典
  - `get_drilldown(metric_name)` → 返回可下钻的因子（既是因子又是结果指标的）
- 5 个多层嵌套指标：门诊人次、门急诊人次、出院人次、出院患者手术人次、每出诊单元门诊人次

### 2. Agent 核心（agent/）

#### agent/agent.py

组装方式：
```
ChatOpenAI(model=MODEL_NAME, base_url=BASE_URL)
  + System Prompt
  + 4 个 Tool
  + ConversationSummaryBufferMemory(max_token_limit=2000)
  → create_react_agent → AgentExecutor(max_iterations=10)
```

记忆策略：`ConversationSummaryBufferMemory`
- 最近对话保留原文（保证上下文精确）
- 超出 token 限制的早期对话自动压缩为摘要
- 兼顾完整性和上下文窗口限制

#### agent/prompts.py

System Prompt 结构：
1. 角色定义：医院运营指标分析助手
2. 能力说明：查询数据、生成图表、分析因果
3. 完整科室列表（20 个）
4. 完整指标列表（51 个，含编码和单位）
5. 数据范围：2022 年 1 月 - 2025 年 12 月
6. 行为约束：超范围引导、时间范围提示、诚实说明局限
7. 多轮对话指导：从上下文推断省略的实体
8. 因果分析指导：选择最相关类别重点分析，提示可下钻

### 3. 工具层（tools/）

#### tools/query_tool.py — 预定义数据查询

- 输入参数：科室列表、指标名称、时间范围、聚合方式(sum/avg/max/min)、排序(value_asc/value_desc)、TopN
- 覆盖场景：单值查询、多科室对比、极值查询、年度汇总、排名
- 返回：格式化文本结果

#### tools/pandas_tool.py — 复杂代码查询

- 输入：LLM 生成的 Pandas 代码字符串
- 执行环境：受限 exec()，只暴露 `df` 和 `pd`
- 安全措施：禁止 import、禁止文件操作、5 秒执行超时
- 覆盖场景：环比增长率、多指标交叉分析等 query_tool 无法处理的复杂计算

#### tools/viz_tool.py — Plotly 可视化

- 输入：科室、指标、时间范围、图表类型(line/bar)、是否多科室对比
- 输出：工具返回文本描述（如"已生成折线图"），同时将 Plotly Figure 序列化为 JSON 存入 Agent 响应
- 支持：单指标趋势折线图、多科室对比柱状图、因子对比图
- 前端接收 Plotly JSON 后用 `st.plotly_chart(fig)` 渲染，天然可交互

#### tools/causal_tool.py — 因果分析

- 输入：科室、结果指标名称、目标年月
- 执行逻辑：
  1. 从因果图获取该指标的所有因子（按类别分组）
  2. 查询目标月和上月数据，计算每个因子的环比变化
  3. 由 LLM 智能选择最相关的 1-2 个类别重点展示
  4. 标识可下钻的因子，在回答末尾提示用户
- 输出：结构化 JSON 分析结果，由 Agent 综合生成自然语言回答

### 4. FastAPI 后端（server.py + api/）

#### server.py

- 启动 FastAPI 应用，挂载路由
- 启动时加载数据和初始化因果图（全局单例）
- 管理多会话的 Agent 实例（按 session_id 隔离）

#### api/routes.py

两个核心端点：

**POST /chat**
- 请求：`{ session_id: str, message: str }`
- 处理：获取/创建对应 session 的 Agent → 调用 Agent → 返回结果
- 响应：`{ text: str, figures: list[dict] }`（figures 为 Plotly JSON 列表）

**WebSocket /ws/speech**
- 双向通信：前端发送音频帧，后端实时返回识别文字
- 后端通过 DashScope Paraformer-realtime-v2 处理
- 返回格式：`{ text: str, is_final: bool }`（is_final 区分中间结果和最终结果）

**WebSocket /ws/tts**
- 前端发送合成请求（含文字），后端流式返回音频数据
- 后端通过 DashScope CosyVoice-v2 处理
- 返回：二进制音频帧（PCM/MP3），前端实时播放

#### api/schemas.py

- Pydantic 模型定义请求和响应结构
- ChatRequest / ChatResponse / STTResponse

#### 会话管理

- 使用字典 `sessions: dict[str, AgentExecutor]` 存储各会话的 Agent 实例
- 每个 session 有独立的 ConversationSummaryBufferMemory
- Streamlit 端通过 `st.session_state.session_id` 标识会话

### 5. 语音输入/输出（P2）

#### 整体语音链路

```
用户说话 → Paraformer STT (实时识别) → 文字输入
    → Agent 处理 → 回答文字
        → CosyVoice TTS (实时合成) → 语音播放给用户
```

#### 5.1 语音输入：阿里云 DashScope Paraformer-realtime-v2

技术选型理由：
- 实时流式识别（边说边出文字），体验优于录完再识别
- 中文识别效果优秀（针对中文优化）
- 国内服务器，延迟低
- DashScope Python SDK 原生支持

架构：
```
浏览器麦克风 (MediaRecorder API)
    │ WebSocket 音频流
    ▼
FastAPI WebSocket 端点 (/ws/speech)
    │ 转发音频帧
    ▼
DashScope Paraformer-realtime-v2
    │ 实时返回识别文字
    ▼
FastAPI → WebSocket → 前端输入框（文字实时出现）
```

前端实现：
- 使用 Streamlit 自定义组件（`st.components.v1.html`）嵌入 JavaScript
- JavaScript 通过 `navigator.mediaDevices.getUserMedia()` 获取麦克风权限
- 使用 `MediaRecorder` 采集音频，通过 WebSocket 实时发送到后端
- 接收后端返回的识别文字，实时更新显示区域
- 用户点击"发送"按钮时，将最终识别文字作为消息发送给 Agent

后端实现：
- FastAPI WebSocket 端点：`/ws/speech`
- 使用 DashScope SDK 的 `Recognition` 类 + `RecognitionCallback`
- 模型：`paraformer-realtime-v2`
- 接收前端音频帧 → `recognition.send_audio_frame()` → 回调返回文字 → 推送给前端

#### 5.2 语音输出：阿里云 DashScope CosyVoice 实时语音合成

技术选型理由：
- 支持流式文本输入 + 流式音频输出（Agent 边生成文字，用户边听到语音）
- 中文语音自然度高
- 与 Paraformer 同属 DashScope 平台，共用 API Key

架构：
```
Agent 回答文字（流式输出）
    │ 逐句/逐段发送
    ▼
DashScope CosyVoice TTS (cosyvoice-v2)
    │ 流式返回音频数据
    ▼
FastAPI → WebSocket → 前端 <audio> 播放
```

后端实现：
- 使用 DashScope SDK 的 `SpeechSynthesizer` 类 + `ResultCallback`
- 模型：`cosyvoice-v2`
- Agent 回答文字逐句传入 → TTS 流式返回音频帧 → 通过 WebSocket 推送给前端
- 回调方法：`on_data` 接收音频数据块，`on_complete` 标识合成完成

前端实现：
- 通过 WebSocket 接收音频数据流
- 使用 Web Audio API (`AudioContext`) 实时播放音频
- 提供播放/暂停按钮，用户可控制是否播报

交互流程：
1. Agent 生成回答文字（可流式）
2. 后端将文字逐句发送给 CosyVoice
3. CosyVoice 流式返回音频数据
4. 前端实时播放语音，同时文字也在对话中显示
5. 用户可随时点击暂停语音播报

#### 5.3 WebSocket 端点汇总

| 端点 | 方向 | 用途 |
|------|------|------|
| `/ws/speech` | 前端→后端：音频流；后端→前端：识别文字 | 语音输入(STT) |
| `/ws/tts` | 前端→后端：触发合成；后端→前端：音频流 | 语音输出(TTS) |

#### 5.4 配置

```env
DASHSCOPE_API_KEY=sk-xxx  # 阿里云百炼 API Key（STT和TTS共用）
```

### 6. Streamlit 前端（app.py）

页面布局：单页对话式应用

核心组件：
- `st.title()` — 标题
- `st.chat_message()` — 对话气泡（支持内嵌 Plotly 图表）
- `st.chat_input()` — 用户输入框
- `st.spinner()` — 加载状态
- `audio_recorder_streamlit` — 麦克风录音按钮

交互流程：
1. 用户输入文字（或通过语音录入转为文字）
2. 前端调用 FastAPI `/chat` 端点
3. 显示"思考中..."加载状态
4. 接收响应：文字用 `st.markdown`，图表用 `st.plotly_chart`（从 Plotly JSON 还原）
5. 存入 `st.session_state.messages`

状态管理：
- `st.session_state.messages` — 对话历史（含图表 JSON）
- `st.session_state.session_id` — 会话标识（UUID）
- 前端不持有 Agent 实例，所有逻辑在后端

### 7. 配置与依赖

#### .env
```
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o
DASHSCOPE_API_KEY=sk-xxx
```

#### config.py
- 使用 python-dotenv 加载
- 启动时校验 API Key，缺失则在页面显示配置提示

#### requirements.txt
```
streamlit
fastapi
uvicorn[standard]
langchain
langchain-openai
openai
pandas
plotly
networkx
openpyxl
python-dotenv
dashscope>=1.10.0
websockets
requests
```

#### 启动
```bash
# 终端1：启动后端
uvicorn server:app --reload --port 8000

# 终端2：启动前端
streamlit run app.py
```

### 8. 错误处理与边界场景

通过 System Prompt 约束：
- 超范围问题 → 礼貌引导回运营分析主题
- 时间超出 2022-2025 → 提示数据覆盖范围
- 数据不足以支撑结论 → 诚实说明局限

代码层防护：
- `run_pandas` 执行出错 → 捕获异常返回给 Agent，Agent 可重试或换工具
- `run_pandas` 超时 → 5 秒限制，超时终止
- API 调用失败 → Streamlit 页面显示友好错误提示
- Agent 循环 → `max_iterations=10`，超出返回兜底回答

兜底回答："抱歉，我暂时无法回答这个问题。您可以尝试换一种方式提问，或者指定具体的科室和指标。"

---

## 数据检索策略：混合模式

日常查询使用 `query_tool`（预定义参数 → Pandas 执行），复杂查询回退到 `pandas_tool`（LLM 生成代码 → 沙箱执行）。Agent 自主判断使用哪个工具。

## 因果分析策略

- 深度：单层分析为主，回答末尾提示可下钻
- 展示：LLM 智能筛选最相关的 1-2 个类别重点展示
- 多层嵌套：标识可下钻因子，用户追问时递归分析下一层

## 多轮对话策略

- 记忆：ConversationSummaryBufferMemory（近期原文 + 早期摘要）
- 实体继承：通过 System Prompt 指导 LLM 从上下文推断省略的科室/指标/时间
- GPT-4o 在有对话历史时天然具备上下文理解能力
