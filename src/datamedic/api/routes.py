"""API 路由定义。

提供以下端点:
- POST /chat: 同步对话（等待完整回复）
- POST /chat/stream: 流式对话（NDJSON 格式逐 token 推送）
- WS /ws/speech: 实时语音识别（PCM 音频流 → 文本）
- WS /ws/tts: 文本转语音（文本 → MP3 音频流）
"""

import json
import asyncio
from collections.abc import AsyncIterator
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from datamedic.api.schemas import ChatRequest, ChatResponse

router = APIRouter()

_agent = None


def get_agent():
    """延迟初始化 Agent，避免模块导入时加载模型和数据。"""
    global _agent
    if _agent is None:
        from datamedic.agent.agent import create_agent_graph
        _agent = create_agent_graph()
    return _agent


def _extract_ai_text(messages) -> str:
    """从消息列表中提取最后一条 AI 回复的文本内容。"""
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "ai" and msg.content:
            return msg.content
    return ""


def _extract_visualize_tool_args(messages) -> list[dict]:
    tool_args = []
    for msg in messages:
        if hasattr(msg, "tool_calls"):
            for tool_call in msg.tool_calls:
                if tool_call.get("name") == "visualize_tool":
                    tool_args.append(tool_call.get("args", {}))
    return tool_args


def _build_figures(messages) -> list[dict]:
    """重新执行 visualize_tool 调用以获取完整的 Plotly figure JSON。

    LangGraph 的 tool message 只包含摘要文本，需要根据保存的参数重新生成图表。
    """
    figures = []
    if not any(
        hasattr(msg, "type") and msg.type == "tool" and getattr(msg, "name", "") == "visualize_tool"
        for msg in messages
    ):
        return figures

    from datamedic.tools.viz_tool import visualize_metric

    for tool_args in _extract_visualize_tool_args(messages):
        try:
            viz_result = visualize_metric(**tool_args)
            if viz_result.get("figure_json"):
                figures.append(json.loads(viz_result["figure_json"]))
        except Exception:
            continue
    return figures


def _content_to_text(content) -> str:
    """将 LangChain 消息的 content 字段统一转为纯文本（兼容 str 和 list 格式）。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") in {"text", "output_text"}:
                parts.append(str(item.get("text", "")))
        return "".join(parts)
    return ""


def _ndjson_event(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


def _resolve_tts_voice(model: str, voice: str) -> str:
    """cosyvoice-v2 要求 voice 名称带 _v2 后缀，此处做兼容映射。"""
    if model == "cosyvoice-v2" and voice == "longxiaochun":
        return "longxiaochun_v2"
    return voice


def _tts_error_message(message) -> str:
    raw = str(message)
    try:
        payload = json.loads(raw)
        header = payload.get("header", {})
        code = header.get("error_code")
        detail = header.get("error_message")
        if code or detail:
            return f"{code or 'TTS error'}: {detail or raw}"
    except Exception:
        pass
    return raw


async def _stream_chat_events(request: ChatRequest) -> AsyncIterator[str]:
    agent = get_agent()
    input_data = {"messages": [{"role": "user", "content": request.message}]}
    config = {"configurable": {"thread_id": request.session_id}}

    try:
        final_messages = []
        async for event in agent.astream_events(input_data, config=config, version="v2"):
            event_type = event.get("event")
            if event_type == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                text = _content_to_text(getattr(chunk, "content", ""))
                if text:
                    yield _ndjson_event({"type": "delta", "text": text})
            elif event_type == "on_chain_end" and event.get("name") == "LangGraph":
                output = event.get("data", {}).get("output", {})
                if isinstance(output, dict):
                    final_messages = output.get("messages", [])

        yield _ndjson_event(
            {
                "type": "done",
                "text": _extract_ai_text(final_messages),
                "figures": _build_figures(final_messages),
            }
        )
    except Exception as e:
        yield _ndjson_event(
            {
                "type": "error",
                "text": f"抱歉，处理您的问题时出现错误：{str(e)}。请尝试换一种方式提问。",
            }
        )


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    agent = get_agent()

    try:
        result = agent.invoke(
            {"messages": [{"role": "user", "content": request.message}]},
            config={"configurable": {"thread_id": request.session_id}},
        )
        messages = result.get("messages", [])
        output_text = _extract_ai_text(messages)
        figures = _build_figures(messages)

        return ChatResponse(text=output_text, figures=figures)

    except Exception as e:
        return ChatResponse(
            text=f"抱歉，处理您的问题时出现错误：{str(e)}。请尝试换一种方式提问。",
            figures=[],
        )


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    return StreamingResponse(
        _stream_chat_events(request),
        media_type="application/x-ndjson",
    )


@router.websocket("/ws/speech")
async def websocket_speech(websocket: WebSocket):
    await websocket.accept()
    recognition = None

    try:
        import dashscope
        from dashscope.audio.asr import (
            Recognition,
            RecognitionCallback,
            RecognitionResult,
        )
        from datamedic.config import DASHSCOPE_API_KEY, STT_MODEL

        dashscope.api_key = DASHSCOPE_API_KEY
        loop = asyncio.get_event_loop()

        class MyCallback(RecognitionCallback):
            def on_event(self, result: RecognitionResult):
                sentence = result.get_sentence()
                if sentence:
                    text = sentence.get("text", "")
                    is_final = RecognitionResult.is_sentence_end(sentence)
                    asyncio.run_coroutine_threadsafe(
                        websocket.send_json({"text": text, "is_final": is_final}),
                        loop,
                    )

            def on_error(self, result: RecognitionResult):
                asyncio.run_coroutine_threadsafe(
                    websocket.send_json({"error": str(result)}),
                    loop,
                )

        recognition = Recognition(
            model=STT_MODEL,
            callback=MyCallback(),
            format="pcm",
            sample_rate=16000,
        )
        recognition.start()

        while True:
            audio_data = await websocket.receive_bytes()
            recognition.send_audio_frame(audio_data)

    except WebSocketDisconnect:
        if recognition:
            recognition.stop()
    except ImportError:
        await websocket.send_json({"error": "DashScope ASR SDK not available"})
        await websocket.close()
    except Exception as e:
        await websocket.send_json({"error": f"STT error: {str(e)}"})
        await websocket.close()


@router.websocket("/ws/tts")
async def websocket_tts(websocket: WebSocket):
    await websocket.accept()

    try:
        import dashscope
        from dashscope.audio.tts_v2 import (
            SpeechSynthesizer,
            ResultCallback,
            AudioFormat,
        )
        from datamedic.config import DASHSCOPE_API_KEY, TTS_MODEL, TTS_VOICE

        dashscope.api_key = DASHSCOPE_API_KEY
        loop = asyncio.get_event_loop()

        class TTSCallback(ResultCallback):
            def on_data(self, data: bytes) -> None:
                asyncio.run_coroutine_threadsafe(
                    websocket.send_bytes(data),
                    loop,
                )

            def on_complete(self) -> None:
                asyncio.run_coroutine_threadsafe(
                    websocket.send_json({"status": "complete"}),
                    loop,
                )

            def on_error(self, message) -> None:
                asyncio.run_coroutine_threadsafe(
                    websocket.send_json({"error": _tts_error_message(message)}),
                    loop,
                )

        while True:
            message = await websocket.receive_json()
            text = message.get("text", "")
            if text:
                synthesizer = SpeechSynthesizer(
                    model=TTS_MODEL,
                    voice=_resolve_tts_voice(TTS_MODEL, TTS_VOICE),
                    format=AudioFormat.MP3_22050HZ_MONO_256KBPS,
                    callback=TTSCallback(),
                )
                synthesizer.streaming_call(text)
                synthesizer.streaming_complete()

    except WebSocketDisconnect:
        pass
    except ImportError:
        await websocket.send_json({"error": "DashScope TTS SDK not available"})
        await websocket.close()
    except Exception as e:
        await websocket.send_json({"error": f"TTS error: {str(e)}"})
        await websocket.close()
