import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from fastapi.testclient import TestClient
from datamedic.server import app
from types import SimpleNamespace

from datamedic.api.routes import (
    _build_figures,
    _extract_ai_text,
    _extract_visualize_tool_args,
    _resolve_tts_voice,
)

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_cors_does_not_allow_wildcard_origins_with_credentials():
    from starlette.middleware.cors import CORSMiddleware

    cors = next(
        middleware
        for middleware in app.user_middleware
        if middleware.cls is CORSMiddleware
    )

    assert cors.kwargs["allow_credentials"] is True
    assert cors.kwargs["allow_origins"] != ["*"]


def test_chat_request_rejects_blank_message():
    response = client.post(
        "/chat",
        json={"session_id": "session-1", "message": "   "},
    )

    assert response.status_code == 422


def test_chat_request_rejects_blank_session_id():
    response = client.post(
        "/chat",
        json={"session_id": "   ", "message": "问题"},
    )

    assert response.status_code == 422


def test_sessions_api_creates_lists_and_deletes_backend_conversations(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))

    create_response = client.post("/sessions")
    assert create_response.status_code == 200
    conversation = create_response.json()
    assert conversation["id"]
    assert conversation["messages"] == []

    list_response = client.get("/sessions")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [conversation["id"]]

    delete_response = client.delete(f"/sessions/{conversation['id']}")
    assert delete_response.status_code == 200
    assert client.get("/sessions").json() == []


def test_extract_ai_text_returns_last_ai_message():
    messages = [
        SimpleNamespace(type="ai", content="旧回答"),
        SimpleNamespace(type="human", content="问题"),
        SimpleNamespace(type="ai", content="新回答"),
    ]

    assert _extract_ai_text(messages) == "新回答"


def test_extract_visualize_tool_args_returns_matching_calls():
    messages = [
        SimpleNamespace(tool_calls=[{"name": "query_metric", "args": {"x": 1}}]),
        SimpleNamespace(tool_calls=[{"name": "visualize_tool", "args": {"department": "骨科"}}]),
    ]

    assert _extract_visualize_tool_args(messages) == [{"department": "骨科"}]


def test_build_figures_rebuilds_from_ai_tool_calls_without_tool_message(monkeypatch):
    figure = {"data": [{"type": "bar", "x": ["骨科"], "y": [12]}], "layout": {"title": "骨科指标"}}

    def fake_visualize_metric(**kwargs):
        assert kwargs == {
            "departments": ["骨科"],
            "metric_name": "门诊量",
            "year_start": 2024,
            "year_end": 2024,
            "month_start": 1,
            "month_end": 12,
            "chart_type": "bar",
        }
        return {"summary": "已生成柱状图", "figure_json": json.dumps(figure)}

    monkeypatch.setattr("datamedic.tools.viz_tool.visualize_metric", fake_visualize_metric)

    messages = [
        SimpleNamespace(
            type="ai",
            content="",
            tool_calls=[
                {
                    "name": "visualize_tool",
                    "args": {
                        "departments": ["骨科"],
                        "metric_name": "门诊量",
                        "year_start": 2024,
                        "year_end": 2024,
                        "month_start": 1,
                        "month_end": 12,
                        "chart_type": "bar",
                    },
                }
            ],
        ),
        SimpleNamespace(type="ai", content="已生成图表"),
    ]

    assert _build_figures(messages) == [figure]


def test_build_figures_passes_expanded_visualize_tool_args(monkeypatch):
    figure = {"data": [{"type": "scatter", "x": [1], "y": [2]}], "layout": {"title": "关系图"}}

    def fake_visualize_metric(**kwargs):
        assert kwargs == {
            "departments": ["骨科"],
            "metric_name": "门诊人次",
            "year_start": 2024,
            "year_end": 2024,
            "month_start": 1,
            "month_end": 12,
            "chart_type": "bubble",
            "secondary_metric_name": "出院人次",
            "size_metric_name": "手术人次",
            "aggregation": "avg",
            "group_by": "month",
            "top_n": 5,
        }
        return {"summary": "已生成气泡图", "figure_json": json.dumps(figure)}

    monkeypatch.setattr("datamedic.tools.viz_tool.visualize_metric", fake_visualize_metric)

    messages = [
        SimpleNamespace(
            type="ai",
            content="",
            tool_calls=[
                {
                    "name": "visualize_tool",
                    "args": {
                        "departments": ["骨科"],
                        "metric_name": "门诊人次",
                        "year_start": 2024,
                        "year_end": 2024,
                        "month_start": 1,
                        "month_end": 12,
                        "chart_type": "bubble",
                        "secondary_metric_name": "出院人次",
                        "size_metric_name": "手术人次",
                        "aggregation": "avg",
                        "group_by": "month",
                        "top_n": 5,
                    },
                }
            ],
        )
    ]

    assert _build_figures(messages) == [figure]


def test_build_figures_ignores_visualize_calls_before_latest_human_message(monkeypatch):
    rebuilt_metrics = []

    def fake_visualize_metric(**kwargs):
        rebuilt_metrics.append(kwargs["metric_name"])
        return {
            "summary": "历史图",
            "figure_json": json.dumps({"data": [{"type": "scatter"}], "layout": {}}),
        }

    monkeypatch.setattr("datamedic.tools.viz_tool.visualize_metric", fake_visualize_metric)

    messages = [
        SimpleNamespace(type="human", content="展示 2024 年骨科门诊人次趋势"),
        SimpleNamespace(
            type="ai",
            content="",
            tool_calls=[
                {
                    "name": "visualize_tool",
                    "args": {
                        "departments": ["骨科"],
                        "metric_name": "门诊人次",
                        "year_start": 2024,
                        "year_end": 2024,
                        "chart_type": "line",
                    },
                }
            ],
        ),
        SimpleNamespace(type="ai", content="已生成图表"),
        SimpleNamespace(type="human", content="这张图说明了什么？"),
        SimpleNamespace(type="ai", content="这张图显示门诊人次整体上升。"),
    ]

    assert _build_figures(messages) == []
    assert rebuilt_metrics == []


def test_build_figures_rebuilds_only_current_turn_visualize_calls(monkeypatch):
    current_figure = {"data": [{"type": "bar", "x": ["骨科"], "y": [20]}], "layout": {"title": "当前图"}}
    rebuilt_metrics = []

    def fake_visualize_metric(**kwargs):
        rebuilt_metrics.append(kwargs["metric_name"])
        return {"summary": "已生成图表", "figure_json": json.dumps(current_figure)}

    monkeypatch.setattr("datamedic.tools.viz_tool.visualize_metric", fake_visualize_metric)

    messages = [
        SimpleNamespace(type="human", content="展示旧图"),
        SimpleNamespace(
            type="ai",
            content="",
            tool_calls=[
                {
                    "name": "visualize_tool",
                    "args": {
                        "departments": ["骨科"],
                        "metric_name": "旧指标",
                        "chart_type": "line",
                    },
                }
            ],
        ),
        SimpleNamespace(type="human", content="展示新图"),
        SimpleNamespace(
            type="ai",
            content="",
            tool_calls=[
                {
                    "name": "visualize_tool",
                    "args": {
                        "departments": ["骨科"],
                        "metric_name": "新指标",
                        "chart_type": "bar",
                    },
                }
            ],
        ),
    ]

    assert _build_figures(messages) == [current_figure]
    assert rebuilt_metrics == ["新指标"]


def test_resolve_tts_voice_upgrades_legacy_cosyvoice_v2_voice():
    assert _resolve_tts_voice("cosyvoice-v2", "longxiaochun") == "longxiaochun_v2"
    assert _resolve_tts_voice("cosyvoice-v2", "longxiaochun_v2") == "longxiaochun_v2"
    assert _resolve_tts_voice("cosyvoice-v1", "longxiaochun") == "longxiaochun"


def test_chat_stream_returns_ndjson_events(tmp_path, monkeypatch):
    class FakeAgent:
        async def astream_events(self, input_data, config, version):
            assert input_data == {"messages": [{"role": "user", "content": "问题"}]}
            assert config["configurable"]["thread_id"].startswith("session-1:")
            assert config["recursion_limit"] == 200
            assert version == "v2"
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": SimpleNamespace(content="第一段")},
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": SimpleNamespace(content="第二段")},
            }
            yield {
                "event": "on_chain_end",
                "name": "LangGraph",
                "data": {"output": {"messages": [SimpleNamespace(type="ai", content="第一段第二段")]}},
            }

    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))
    monkeypatch.setattr("datamedic.api.routes.get_agent", lambda: FakeAgent())

    with client.stream(
        "POST",
        "/chat/stream",
        json={"session_id": "session-1", "message": "问题"},
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-ndjson")
        lines = [line for line in response.iter_lines() if line]

    assert lines == [
        '{"type":"delta","text":"第一段"}',
        '{"type":"delta","text":"第二段"}',
        '{"type":"done","text":"第一段第二段","figures":[]}',
    ]


def test_chat_stream_persists_messages_and_figures(tmp_path, monkeypatch):
    figure = {"data": [{"type": "bar", "x": ["骨科"], "y": [12]}], "layout": {"title": "骨科"}}
    captured_input = {}

    class FakeAgent:
        async def astream_events(self, input_data, config, version):
            captured_input["input_data"] = input_data
            captured_input["config"] = config
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": SimpleNamespace(content="已生成")},
            }
            yield {
                "event": "on_chain_end",
                "name": "LangGraph",
                "data": {
                    "output": {
                        "messages": [
                            SimpleNamespace(type="human", content="展示骨科图表"),
                            SimpleNamespace(
                                type="ai",
                                content="",
                                tool_calls=[
                                    {
                                        "name": "visualize_tool",
                                        "args": {
                                            "departments": ["骨科"],
                                            "metric_name": "门诊人次",
                                            "chart_type": "bar",
                                        },
                                    }
                                ],
                            ),
                            SimpleNamespace(type="ai", content="已生成图表"),
                        ]
                    }
                },
            }

    def fake_visualize_metric(**kwargs):
        return {"summary": "已生成图表", "figure_json": json.dumps(figure)}

    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))
    monkeypatch.setattr("datamedic.api.routes.get_agent", lambda: FakeAgent())
    monkeypatch.setattr("datamedic.tools.viz_tool.visualize_metric", fake_visualize_metric)

    with client.stream(
        "POST",
        "/chat/stream",
        json={"session_id": "persisted-session", "message": "展示骨科图表"},
    ) as response:
        assert response.status_code == 200
        lines = [json.loads(line) for line in response.iter_lines() if line]

    from datamedic.chat_store import load_conversation

    conversation = load_conversation("persisted-session")

    assert lines[-1] == {"type": "done", "text": "已生成图表", "figures": [figure]}
    assert [message["role"] for message in conversation["messages"]] == ["user", "assistant"]
    assert conversation["messages"][1]["figures"] == [figure]
    assert captured_input["input_data"]["messages"] == [
        {"role": "user", "content": "展示骨科图表"}
    ]
    assert captured_input["config"]["configurable"]["thread_id"].startswith("persisted-session:")
    assert captured_input["config"]["recursion_limit"] == 200


def test_chat_stream_handles_broad_department_overview_without_agent_loop(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))

    def fail_if_agent_is_loaded():
        raise AssertionError("broad department overview should not call the agent")

    monkeypatch.setattr("datamedic.api.routes.get_agent", fail_if_agent_is_loaded)

    with client.stream(
        "POST",
        "/chat/stream",
        json={
            "session_id": "overview-session",
            "message": "分析一下儿科的数据",
        },
    ) as response:
        assert response.status_code == 200
        lines = [json.loads(line) for line in response.iter_lines() if line]

    from datamedic.chat_store import load_conversation

    conversation = load_conversation("overview-session")

    deltas = [line for line in lines if line["type"] == "delta"]
    assert deltas
    assert "".join(line["text"] for line in deltas) == lines[-1]["text"]
    assert lines[-1]["type"] == "done"
    assert "儿科" in lines[-1]["text"]
    assert len(lines[-1]["figures"]) == 2
    assert conversation["messages"][1]["figures"] == lines[-1]["figures"]


def test_chat_handles_broad_department_overview_without_agent_loop(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))

    def fail_if_agent_is_loaded():
        raise AssertionError("broad department overview should not call the agent")

    monkeypatch.setattr("datamedic.api.routes.get_agent", fail_if_agent_is_loaded)

    response = client.post(
        "/chat",
        json={
            "session_id": "overview-session",
            "message": "分析一下儿科的数据",
        },
    )

    from datamedic.chat_store import load_conversation

    conversation = load_conversation("overview-session")

    assert response.status_code == 200
    payload = response.json()
    assert "儿科" in payload["text"]
    assert len(payload["figures"]) == 2
    assert conversation["messages"][1]["figures"] == payload["figures"]


def test_chat_stream_falls_back_to_department_overview_on_agent_recursion(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))

    class LoopingAgent:
        async def astream_events(self, input_data, config, version):
            raise RuntimeError("Recursion limit of 25 reached without hitting a stop condition.")
            yield

    monkeypatch.setattr("datamedic.api.routes.get_agent", lambda: LoopingAgent())

    with client.stream(
        "POST",
        "/chat/stream",
        json={"session_id": "recursion-fallback", "message": "分析一下儿科"},
    ) as response:
        assert response.status_code == 200
        lines = [json.loads(line) for line in response.iter_lines() if line]

    from datamedic.chat_store import load_conversation

    conversation = load_conversation("recursion-fallback")

    deltas = [line for line in lines if line["type"] == "delta"]
    assert deltas
    assert "".join(line["text"] for line in deltas) == lines[-1]["text"]
    assert lines[-1]["type"] == "done"
    assert "儿科" in lines[-1]["text"]
    assert "Recursion limit" not in lines[-1]["text"]
    assert len(lines[-1]["figures"]) == 2
    assert conversation["messages"][1]["figures"] == lines[-1]["figures"]


def test_chat_falls_back_to_department_overview_on_agent_recursion(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))

    class LoopingAgent:
        async def astream_events(self, input_data, config, version):
            raise RuntimeError("GRAPH_RECURSION_LIMIT: Recursion limit of 25 reached.")
            yield

    monkeypatch.setattr("datamedic.api.routes.get_agent", lambda: LoopingAgent())

    response = client.post(
        "/chat",
        json={"session_id": "recursion-fallback", "message": "分析一下儿科"},
    )

    from datamedic.chat_store import load_conversation

    conversation = load_conversation("recursion-fallback")

    assert response.status_code == 200
    payload = response.json()
    assert "儿科" in payload["text"]
    assert "GRAPH_RECURSION_LIMIT" not in payload["text"]
    assert len(payload["figures"]) == 2
    assert conversation["messages"][1]["figures"] == payload["figures"]


def test_get_agent_initializes_once_under_concurrency(monkeypatch):
    import datamedic.api.routes as routes

    class Agent:
        pass

    calls = []

    def fake_create_agent_graph():
        calls.append(1)
        return Agent()

    monkeypatch.setattr(routes, "_agent", None)
    monkeypatch.setattr("datamedic.agent.agent.create_agent_graph", fake_create_agent_graph)

    with ThreadPoolExecutor(max_workers=8) as executor:
        agents = list(executor.map(lambda _: routes.get_agent(), range(20)))

    try:
        assert len(calls) == 1
        assert len({id(agent) for agent in agents}) == 1
    finally:
        routes._agent = None


def test_chat_returns_safe_text_for_unclear_agent_recursion(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))

    class LoopingAgent:
        async def astream_events(self, input_data, config, version):
            raise RuntimeError(
                "GRAPH_RECURSION_LIMIT: Recursion limit of 25 reached. "
                "https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT"
            )
            yield

    monkeypatch.setattr("datamedic.api.routes.get_agent", lambda: LoopingAgent())

    response = client.post(
        "/chat",
        json={"session_id": "unclear-recursion", "message": "随便分析一下"},
    )

    payload = response.json()
    assert response.status_code == 200
    assert "处理时超出步数限制" in payload["text"]
    assert "GRAPH_RECURSION_LIMIT" not in payload["text"]
    assert "Recursion limit" not in payload["text"]

def test_chat_returns_safe_text_for_generic_agent_error(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))

    class FailingAgent:
        async def astream_events(self, input_data, config, version):
            raise RuntimeError("secret-token /private/path should not leak")
            yield

    monkeypatch.setattr("datamedic.api.routes.get_agent", lambda: FailingAgent())

    response = client.post(
        "/chat",
        json={"session_id": "generic-error", "message": "分析骨科门诊人次"},
    )

    payload = response.json()
    assert response.status_code == 200
    assert payload["text"] == "抱歉，处理您的问题时出现错误。请稍后重试或换一种方式提问。"
    assert "secret-token" not in payload["text"]
    assert "/private/path" not in payload["text"]


def test_chat_stream_returns_safe_text_for_generic_agent_error(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVERSATION_DATA_DIR", str(tmp_path))

    class FailingAgent:
        async def astream_events(self, input_data, config, version):
            raise RuntimeError("secret-token /private/path should not leak")
            yield

    monkeypatch.setattr("datamedic.api.routes.get_agent", lambda: FailingAgent())

    with client.stream(
        "POST",
        "/chat/stream",
        json={"session_id": "generic-stream-error", "message": "分析骨科门诊人次"},
    ) as response:
        lines = [json.loads(line) for line in response.iter_lines() if line]

    assert response.status_code == 200
    assert lines == [
        {
            "type": "error",
            "text": "抱歉，处理您的问题时出现错误。请稍后重试或换一种方式提问。",
        }
    ]
    assert "secret-token" not in lines[0]["text"]
    assert "/private/path" not in lines[0]["text"]
