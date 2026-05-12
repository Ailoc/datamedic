import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from api.schemas import ChatRequest, ChatResponse

router = APIRouter()

sessions: dict = {}


def get_or_create_agent(session_id: str):
    from agent.agent import create_agent_executor

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
            if hasattr(step[0], "tool") and step[0].tool == "visualize_tool":
                from tools.viz_tool import visualize_metric

                tool_input = step[0].tool_input
                if isinstance(tool_input, str):
                    tool_input = json.loads(tool_input)
                viz_result = visualize_metric(**tool_input)
                if viz_result.get("figure_json"):
                    figures.append(json.loads(viz_result["figure_json"]))

        return ChatResponse(text=output_text, figures=figures)

    except Exception as e:
        return ChatResponse(
            text=f"抱歉，处理您的问题时出现错误：{str(e)}。请尝试换一种方式提问。",
            figures=[],
        )


@router.websocket("/ws/speech")
async def websocket_speech(websocket: WebSocket):
    await websocket.accept()

    try:
        import dashscope
        from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
        from config import DASHSCOPE_API_KEY

        dashscope.api_key = DASHSCOPE_API_KEY

        class MyCallback(RecognitionCallback):
            def __init__(self, ws):
                self._ws = ws

            def on_event(self, result: RecognitionResult):
                sentence = result.get_sentence()
                if sentence:
                    text = sentence.get("text", "")
                    is_final = sentence.get("end_time", 0) > 0
                    try:
                        asyncio.run(self._ws.send_json({
                            "text": text,
                            "is_final": is_final,
                        }))
                    except Exception:
                        pass

            def on_error(self, result: RecognitionResult):
                try:
                    asyncio.run(self._ws.send_json({
                        "error": str(result),
                    }))
                except Exception:
                    pass

        callback = MyCallback(websocket)
        recognition = Recognition(
            model="paraformer-realtime-v2",
            format="pcm",
            sample_rate=16000,
            callback=callback,
        )
        recognition.start()

        while True:
            audio_data = await websocket.receive_bytes()
            recognition.send_audio_frame(audio_data)

    except WebSocketDisconnect:
        try:
            recognition.stop()
        except Exception:
            pass
    except ImportError:
        await websocket.send_json({"error": "DashScope SDK not configured"})
        await websocket.close()


@router.websocket("/ws/tts")
async def websocket_tts(websocket: WebSocket):
    await websocket.accept()

    try:
        import dashscope
        from dashscope.audio.tts_v2 import SpeechSynthesizer, ResultCallback, AudioFormat
        from config import DASHSCOPE_API_KEY

        dashscope.api_key = DASHSCOPE_API_KEY

        class TTSCallback(ResultCallback):
            def __init__(self, ws):
                self._ws = ws

            def on_data(self, data: bytes):
                try:
                    asyncio.run(self._ws.send_bytes(data))
                except Exception:
                    pass

            def on_complete(self):
                try:
                    asyncio.run(self._ws.send_json({"status": "complete"}))
                except Exception:
                    pass

            def on_error(self, message: str):
                try:
                    asyncio.run(self._ws.send_json({"error": message}))
                except Exception:
                    pass

        while True:
            message = await websocket.receive_json()
            text = message.get("text", "")
            if text:
                callback = TTSCallback(websocket)
                synthesizer = SpeechSynthesizer(
                    model="cosyvoice-v2",
                    voice="longxiaochun",
                    format=AudioFormat.MP3_22050HZ_MONO_256KBPS,
                    callback=callback,
                )
                synthesizer.streaming_call(text)
                synthesizer.streaming_complete()

    except WebSocketDisconnect:
        pass
    except ImportError:
        await websocket.send_json({"error": "DashScope TTS SDK not configured"})
        await websocket.close()
