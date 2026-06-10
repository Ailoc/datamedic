"""API 路由定义。

提供以下端点:
- POST /chat: 同步对话（等待完整回复）
- POST /chat/stream: 流式对话（NDJSON 格式逐 token 推送）
- WS /ws/speech: 实时语音识别（PCM 音频流 → 文本）
- WS /ws/tts: 文本转语音（文本 → MP3 音频流）
"""

import json
import logging
import asyncio
import threading
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from datamedic.api.schemas import ChatRequest, ChatResponse, ConversationRecord
from datamedic.chat_store import (
    _extract_figure_metadata,
    append_message,
    build_model_messages,
    create_conversation,
    delete_conversation,
    list_conversations,
    load_conversation,
)
from datamedic.tools.department_overview import (
    build_department_overview,
    detect_department_overview_request,
    detect_single_department_without_metric,
)

logger = logging.getLogger(__name__)

router = APIRouter()
OVERVIEW_STREAM_DELAY_SECONDS = 0.04
AGENT_RECURSION_LIMIT = 200
RECURSION_ERROR_TEXT = (
    "抱歉，此问题的分析链路较长，处理时超出步数限制。"
    "请尝试更具体地描述您想分析的内容，例如："
    "'请分析心血管内科2025年门诊人次变化的原因'。"
)
GENERIC_CHAT_ERROR_TEXT = "抱歉，处理您的问题时出现错误。请稍后重试或换一种方式提问。"

_agent = None
_agent_lock = threading.Lock()


def get_agent():
    """延迟初始化 Agent，避免模块导入时加载模型和数据。"""
    global _agent
    if _agent is None:
        with _agent_lock:
            if _agent is None:
                logger.info("Initializing agent (first request)")
                from datamedic.agent.agent import create_agent_graph
                _agent = create_agent_graph()
    return _agent


def _extract_ai_text(messages) -> str:
    """从消息列表中提取最后一条 AI 回复的文本内容。"""
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "ai" and msg.content:
            return _content_to_text(msg.content)
    return ""


def _extract_visualize_tool_args(messages) -> list[dict]:
    tool_args = []
    for msg in messages:
        if hasattr(msg, "tool_calls"):
            for tool_call in msg.tool_calls:
                if tool_call.get("name") == "visualize_tool":
                    tool_args.append(tool_call.get("args", {}))
    return tool_args


def _message_type(message) -> str:
    if isinstance(message, dict):
        return str(message.get("type") or message.get("role") or "")
    return str(getattr(message, "type", ""))


def _latest_turn_messages(messages):
    """返回最新用户消息之后的消息，避免重建历史轮次的图表。"""
    latest_human_index = None
    for index, message in enumerate(messages):
        if _message_type(message) in {"human", "user"}:
            latest_human_index = index

    if latest_human_index is None:
        return messages
    return messages[latest_human_index + 1:]


def _build_figures(messages) -> list[dict]:
    """重新执行 visualize_tool 调用以获取完整的 Plotly figure JSON。

    LangGraph 的 tool message 只包含摘要文本，需要根据保存的参数重新生成图表。
    带记忆会话会返回历史消息，因此这里只重建最新用户轮次中的图表。
    """
    figures = []
    tool_args_list = _extract_visualize_tool_args(_latest_turn_messages(messages))
    if not tool_args_list:
        return figures

    from datamedic.tools.viz_tool import visualize_metric

    for tool_args in tool_args_list:
        try:
            viz_result = visualize_metric(**tool_args)
            if viz_result.get("figure_json"):
                figures.append(json.loads(viz_result["figure_json"]))
        except Exception:
            logger.warning("Failed to rebuild figure from tool args: %s", tool_args, exc_info=True)
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


def _agent_config(session_id: str, message_id: str) -> dict:
    return {
        "configurable": {"thread_id": f"{session_id}:{message_id}"},
        "recursion_limit": AGENT_RECURSION_LIMIT,
    }


def _is_recursion_limit_error(error: Exception) -> bool:
    raw_error = str(error)
    return any(
        marker in raw_error
        for marker in ("GRAPH_RECURSION_LIMIT", "Recursion limit", "recursion_limit")
    )


def _safe_error_text(error: Exception) -> str:
    if _is_recursion_limit_error(error):
        return RECURSION_ERROR_TEXT
    return GENERIC_CHAT_ERROR_TEXT


def _department_overview_for_message(message: str) -> dict | None:
    department = detect_department_overview_request(message)
    if not department:
        return None
    return build_department_overview(department)


VAGUE_REFERENCE_TERMS = {"这种", "这个", "该变化", "那个", "这些", "那些", "这样", "那样"}
VAGUE_CAUSAL_TERMS = {"原因", "为什么", "变化", "下降", "上升", "降低", "升高", "增长", "减少", "增加"}
VAGUE_CLARIFY_TEXT = (
    "抱歉，您的提问中缺少具体的分析对象，我无法确定您想分析的是哪项指标的变化。"
    "请指定科室、指标和时间范围，例如：'请分析心血管内科2025年门诊人次变化的原因'。"
)


def _has_prior_chart_context(session_id: str) -> bool:
    """检查对话历史中是否有图表上下文可供模型推断。"""
    try:
        conversation = load_conversation(session_id)
        if not conversation:
            return False
        for msg in reversed(conversation.get("messages", [])):
            if msg.get("role") == "assistant" and msg.get("figures"):
                return True
        return False
    except Exception:
        return False


def _detect_vague_reference_request(message: str, session_id: str) -> str | None:
    """检测无具体指标的指代追问，返回引导文案；否则返回 None。

    当用户使用"这种变化"等指代词，但未指明具体指标和科室，
    且历史中也无图表上下文时，直接拦截，不送入 Agent。
    """
    compact = "".join(message.split())
    if not compact:
        return None

    # 必须包含指代词
    has_reference = any(term in compact for term in VAGUE_REFERENCE_TERMS)
    if not has_reference:
        return None

    # 必须包含因果/变化类意图
    has_causal = any(term in compact for term in VAGUE_CAUSAL_TERMS)
    if not has_causal:
        return None

    # 如果消息中已包含具体指标名称，放行
    try:
        from datamedic.data.loader import get_metrics
        metric_names = {m["name"] for m in get_metrics()}
        if any(name and name in compact for name in metric_names):
            return None
    except Exception:
        pass

    # 如果历史中有图表上下文，放行（模型可以推断）
    if _has_prior_chart_context(session_id):
        return None

    return VAGUE_CLARIFY_TEXT


def _department_overview_after_recursion_error(message: str, error: Exception) -> dict | None:
    if not _is_recursion_limit_error(error):
        return None

    department = detect_single_department_without_metric(message)
    if not department:
        return None
    return build_department_overview(department)


def _build_recursion_error_with_context(session_id: str, message: str) -> str:
    """递归超限时尝试从对话历史中提取上下文，给出更精准的错误提示。"""
    try:
        conversation = load_conversation(session_id)
        if not conversation:
            return RECURSION_ERROR_TEXT

        last_figures: list[dict] = []
        for msg in reversed(conversation.get("messages", [])):
            if msg.get("role") == "assistant" and msg.get("figures"):
                last_figures = msg.get("figures", [])
                break

        if not last_figures:
            return RECURSION_ERROR_TEXT

        dept_names, metric_names = _extract_figure_metadata(last_figures)
        dept_name = sorted(dept_names)[0] if dept_names else ""
        metric_name = sorted(metric_names)[0] if metric_names else ""

        if dept_name and metric_name:
            return (
                f"抱歉，分析「{dept_name}的{metric_name}变化原因」时处理步数超限，未能完成。"
                f"请尝试更具体地描述，例如："
                f"'请分析{dept_name}2025年{metric_name}变化的原因'。"
            )
    except Exception:
        logger.debug("Failed to build contextual recursion error", exc_info=True)
    return RECURSION_ERROR_TEXT


def _text_stream_chunks(text: str) -> list[str]:
    chunks = [line for line in text.splitlines(keepends=True) if line]
    return chunks or ([text] if text else [])


async def _stream_department_overview(
    session_id: str,
    overview: dict,
) -> AsyncIterator[str]:
    append_message(session_id, "assistant", overview["text"], overview["figures"])
    for chunk in _text_stream_chunks(overview["text"]):
        yield _ndjson_event({"type": "delta", "text": chunk})
        await asyncio.sleep(OVERVIEW_STREAM_DELAY_SECONDS)
    yield _ndjson_event(
        {
            "type": "done",
            "text": overview["text"],
            "figures": overview["figures"],
        }
    )


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
    try:
        conversation, user_message = append_message(request.session_id, "user", request.message)

        # 前置拦截：无上下文指代追问直接引导，不送入 Agent
        vague_hint = _detect_vague_reference_request(request.message, request.session_id)
        if vague_hint:
            append_message(request.session_id, "assistant", vague_hint, [])
            yield _ndjson_event({"type": "done", "text": vague_hint, "figures": []})
            return

        overview = _department_overview_for_message(request.message)
        if overview:
            async for event in _stream_department_overview(request.session_id, overview):
                yield event
            return

        agent = get_agent()
        input_data = {"messages": build_model_messages(conversation, max_rounds=10)}
        config = _agent_config(request.session_id, user_message["id"])
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

        output_text = _extract_ai_text(final_messages)
        figures = _build_figures(final_messages)
        append_message(request.session_id, "assistant", output_text, figures)
        yield _ndjson_event({"type": "done", "text": output_text, "figures": figures})
    except Exception as e:
        logger.error("Stream chat error session_id=%s", request.session_id, exc_info=True)
        fallback = _department_overview_after_recursion_error(request.message, e)
        if fallback:
            try:
                async for event in _stream_department_overview(request.session_id, fallback):
                    yield event
                return
            except Exception:
                logger.error("Fallback overview failed", exc_info=True)

        error_text = _safe_error_text(e)
        if _is_recursion_limit_error(e):
            error_text = _build_recursion_error_with_context(request.session_id, request.message)
        try:
            append_message(request.session_id, "assistant", error_text, [])
        except Exception:
            logger.warning("Failed to persist error message", exc_info=True)
        yield _ndjson_event(
            {
                "type": "error",
                "text": error_text,
            }
        )


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """同步对话端点，内部委托给流式处理器。"""
    final_text = ""
    final_figures: list[dict] = []
    async for line in _stream_chat_events(request):
        event = json.loads(line)
        if event["type"] == "done":
            final_text = str(event.get("text", ""))
            final_figures = event.get("figures", [])
        elif event["type"] == "error":
            final_text = str(event.get("text", ""))
    return ChatResponse(text=final_text, figures=final_figures)

@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    return StreamingResponse(
        _stream_chat_events(request),
        media_type="application/x-ndjson",
    )


@router.get("/sessions", response_model=list[ConversationRecord])
async def sessions():
    return list_conversations()


@router.post("/sessions", response_model=ConversationRecord)
async def create_session():
    return create_conversation()


@router.get("/sessions/{session_id}", response_model=ConversationRecord)
async def get_session(session_id: str):
    conversation = load_conversation(session_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return conversation


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    delete_conversation(session_id)
    return {"ok": True}


@asynccontextmanager
async def _handle_dashscope_ws(
    websocket: WebSocket,
    name: str,
    sdk_name: str,
    on_disconnect: Callable | None = None,
):
    """DashScope WebSocket 公共错误处理上下文管理器。"""
    try:
        yield
    except WebSocketDisconnect:
        logger.info("%s WebSocket disconnected", name)
        if on_disconnect:
            on_disconnect()
    except ImportError:
        logger.warning("DashScope %s SDK not available", sdk_name)
        try:
            await websocket.send_json({"error": f"DashScope {sdk_name} SDK not available"})
            await websocket.close()
        except Exception:
            pass
    except Exception as e:
        logger.error("%s WebSocket error", name, exc_info=True)
        try:
            await websocket.send_json({"error": f"{name} error: {str(e)}"})
            await websocket.close()
        except Exception:
            pass


@router.websocket("/ws/speech")
async def websocket_speech(websocket: WebSocket):
    await websocket.accept()
    logger.info("STT WebSocket connected")
    recognition = None

    async with _handle_dashscope_ws(
        websocket, "STT", "ASR",
        on_disconnect=lambda: recognition.stop() if recognition else None,
    ):
        import dashscope
        from dashscope.audio.asr import (
            Recognition,
            RecognitionCallback,
            RecognitionResult,
        )
        from datamedic.config import DASHSCOPE_API_KEY, STT_MODEL

        dashscope.api_key = DASHSCOPE_API_KEY
        loop = asyncio.get_running_loop()

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
                logger.warning("STT recognition error: %s", result)
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


@router.websocket("/ws/tts")
async def websocket_tts(websocket: WebSocket):
    await websocket.accept()
    logger.info("TTS WebSocket connected")

    async with _handle_dashscope_ws(websocket, "TTS", "TTS"):
        import dashscope
        from dashscope.audio.tts_v2 import (
            SpeechSynthesizer,
            ResultCallback,
            AudioFormat,
        )
        from datamedic.config import DASHSCOPE_API_KEY, TTS_MODEL, TTS_VOICE

        dashscope.api_key = DASHSCOPE_API_KEY
        loop = asyncio.get_running_loop()

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
                logger.warning("TTS synthesis error: %s", _tts_error_message(message))
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
