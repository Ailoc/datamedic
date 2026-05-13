import pytest

from fastapi.testclient import TestClient
from datamedic.server import app
from types import SimpleNamespace

from datamedic.api.routes import _extract_ai_text, _extract_visualize_tool_args, _resolve_tts_voice

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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


def test_resolve_tts_voice_upgrades_legacy_cosyvoice_v2_voice():
    assert _resolve_tts_voice("cosyvoice-v2", "longxiaochun") == "longxiaochun_v2"
    assert _resolve_tts_voice("cosyvoice-v2", "longxiaochun_v2") == "longxiaochun_v2"
    assert _resolve_tts_voice("cosyvoice-v1", "longxiaochun") == "longxiaochun"


def test_chat_stream_returns_ndjson_events(monkeypatch):
    class FakeAgent:
        async def astream_events(self, input_data, config, version):
            assert input_data == {"messages": [{"role": "user", "content": "问题"}]}
            assert config == {"configurable": {"thread_id": "session-1"}}
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
