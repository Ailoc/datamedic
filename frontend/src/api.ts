/**
 * 后端 API 客户端。
 *
 * sendChatMessage: 同步请求，等待完整回复。
 * streamChatMessage: 流式请求，通过 NDJSON 逐 token 回调，适用于打字机效果。
 */

import type { ChatResponse, Conversation } from "./types";

export const BACKEND_CONNECTION_ERROR = "无法连接到后端服务，请确认 FastAPI 已启动。";

export const isNonEmptyDelta = (accumulated: string, delta: string) =>
  accumulated.trim() || delta.trim();

type StreamOptions = {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
};

type StreamEvent =
  | { type: "delta"; text?: string }
  | { type: "done"; text?: string; figures?: unknown }
  | { type: "error"; text?: string };

const ensureOk = (response: Response, message: string) => {
  if (!response.ok) {
    throw new Error(`${message}: ${response.status}`);
  }
};

export const fetchSessions = async (): Promise<Conversation[]> => {
  const response = await fetch("/sessions");
  ensureOk(response, "加载后端会话失败");
  const payload = await response.json();
  return Array.isArray(payload) ? (payload as Conversation[]) : [];
};

export const createBackendSession = async (): Promise<Conversation> => {
  const response = await fetch("/sessions", { method: "POST" });
  ensureOk(response, "创建后端会话失败");
  return (await response.json()) as Conversation;
};

export const deleteBackendSession = async (sessionId: string): Promise<void> => {
  const response = await fetch(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  ensureOk(response, "删除后端会话失败");
};

export const sendChatMessage = async (
  sessionId: string,
  message: string,
): Promise<ChatResponse> => {
  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
    });
    if (!response.ok) {
      return { ok: false, text: `后端服务返回异常：${response.status}`, figures: [] };
    }
    const payload = await response.json();
    return {
      ok: true,
      text: String(payload.text ?? ""),
      figures: Array.isArray(payload.figures) ? payload.figures : [],
    };
  } catch {
    return {
      ok: false,
      text: BACKEND_CONNECTION_ERROR,
      figures: [],
    };
  }
};

export const streamChatMessage = async (
  sessionId: string,
  message: string,
  options: StreamOptions = {},
): Promise<ChatResponse> => {
  try {
    const response = await fetch("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
      signal: options.signal,
    });
    if (!response.ok || !response.body) {
      return { ok: false, text: `后端服务返回异常：${response.status}`, figures: [] };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";
    let finalText = "";
    let failed = false;
    let completed = false;
    let failureText = "";
    let figures: ChatResponse["figures"] = [];

    const failStream = (message: string) => {
      failed = true;
      failureText = accumulatedText ? `${accumulatedText}\n\n${message}` : message;
    };

    const consumeLine = (line: string) => {
      if (!line.trim()) return;
      let event: StreamEvent;
      try {
        event = JSON.parse(line) as StreamEvent;
      } catch {
        failStream("流式响应格式异常，请重试。");
        return;
      }
      if (event.type === "delta") {
        const text = String(event.text ?? "");
        if (!isNonEmptyDelta(accumulatedText, text)) return;
        accumulatedText += text;
        options.onDelta?.(text);
        return;
      }
      if (event.type === "done") {
        completed = true;
        finalText = String(event.text ?? accumulatedText);
        figures = Array.isArray(event.figures) ? event.figures : [];
        return;
      }
      if (event.type === "error") {
        failed = true;
        failureText = String(event.text ?? "处理请求时出现错误。");
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consumeLine);
    }
    buffer += decoder.decode();
    consumeLine(buffer);
    if (!failed && !completed) {
      failStream("流式响应中断，请重试。");
    }

    return {
      ok: !failed,
      text: failed ? failureText : finalText || accumulatedText,
      figures,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        text: "请求已取消。",
        figures: [],
      };
    }
    return {
      ok: false,
      text: BACKEND_CONNECTION_ERROR,
      figures: [],
    };
  }
};
