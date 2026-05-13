/**
 * 后端 API 客户端。
 *
 * sendChatMessage: 同步请求，等待完整回复。
 * streamChatMessage: 流式请求，通过 NDJSON 逐 token 回调，适用于打字机效果。
 */

import type { ChatResponse } from "./types";

type StreamOptions = {
  onDelta?: (text: string) => void;
};

type StreamEvent =
  | { type: "delta"; text?: string }
  | { type: "done"; text?: string; figures?: unknown }
  | { type: "error"; text?: string };

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
      text: "无法连接到后端服务，请确认 FastAPI 已启动。",
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
    });
    if (!response.ok || !response.body) {
      return { ok: false, text: `后端服务返回异常：${response.status}`, figures: [] };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";
    let finalText = "";
    let figures: ChatResponse["figures"] = [];

    const consumeLine = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "delta") {
        const text = String(event.text ?? "");
        accumulatedText += text;
        options.onDelta?.(text);
        return;
      }
      if (event.type === "done") {
        finalText = String(event.text ?? accumulatedText);
        figures = Array.isArray(event.figures) ? event.figures : [];
        return;
      }
      if (event.type === "error") {
        finalText = String(event.text ?? "处理请求时出现错误。");
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

    return {
      ok: true,
      text: finalText || accumulatedText,
      figures,
    };
  } catch {
    return {
      ok: false,
      text: "无法连接到后端服务，请确认 FastAPI 已启动。",
      figures: [],
    };
  }
};
