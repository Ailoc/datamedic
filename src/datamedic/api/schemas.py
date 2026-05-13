"""API 请求/响应的 Pydantic 数据模型。"""

from pydantic import BaseModel


class ChatRequest(BaseModel):
    session_id: str  # 会话隔离标识，同一 session_id 共享对话记忆
    message: str


class ChatResponse(BaseModel):
    text: str
    figures: list[dict] = []  # Plotly figure JSON 列表，前端直接渲染
