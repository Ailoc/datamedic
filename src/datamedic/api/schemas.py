"""API 请求/响应的 Pydantic 数据模型。"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)  # 同一 session_id 共享对话记忆
    message: str = Field(min_length=1, max_length=8000)

    @field_validator("session_id", "message")
    @classmethod
    def strip_and_reject_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class ChatResponse(BaseModel):
    text: str
    figures: list[dict] = Field(default_factory=list)  # Plotly figure JSON 列表，前端直接渲染


class ConversationMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    text: str
    figures: list[dict] = Field(default_factory=list)
    createdAt: str


class ConversationRecord(BaseModel):
    id: str
    title: str
    summary: str
    createdAt: str
    updatedAt: str
    messages: list[ConversationMessage] = Field(default_factory=list)
