import { describe, expect, it, vi } from "vitest";
import {
  createBackendSession,
  deleteBackendSession,
  fetchSession,
  fetchSessions,
  sendChatMessage,
  streamChatMessage,
} from "./api";

describe("sendChatMessage", () => {
  it("returns backend text and figures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: "完成", figures: [{ data: [] }] }),
      }),
    );

    const result = await sendChatMessage("session-1", "问题");

    expect(result).toEqual({ ok: true, text: "完成", figures: [{ data: [] }] });
    expect(fetch).toHaveBeenCalledWith("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "session-1", message: "问题" }),
    });
  });

  it("returns friendly connection errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await sendChatMessage("session-1", "问题");

    expect(result.ok).toBe(false);
    expect(result.text).toContain("无法连接到后端服务");
  });
});

describe("streamChatMessage", () => {
  it("emits delta text as soon as stream lines arrive", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('{"type":"delta","text":"第一段"}\n'),
      encoder.encode('{"type":"delta","text":"第二段"}\n{"type":"done","text":"第一段第二段","figures":[]}\n'),
    ];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        },
      }),
      { status: 200 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const deltas: string[] = [];

    const result = await streamChatMessage("session-1", "问题", {
      onDelta: (text) => deltas.push(text),
    });

    expect(deltas).toEqual(["第一段", "第二段"]);
    expect(result).toEqual({ ok: true, text: "第一段第二段", figures: [] });
    expect(fetch).toHaveBeenCalledWith("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "session-1", message: "问题" }),
    });
  });

  it("ignores leading whitespace-only stream deltas", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"delta","text":"   "}\n'));
          controller.enqueue(encoder.encode('{"type":"delta","text":"第一段"}\n'));
          controller.enqueue(encoder.encode('{"type":"done","text":"第一段","figures":[]}\n'));
          controller.close();
        },
      }),
      { status: 200 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const deltas: string[] = [];

    const result = await streamChatMessage("session-1", "问题", {
      onDelta: (text) => deltas.push(text),
    });

    expect(deltas).toEqual(["第一段"]);
    expect(result).toEqual({ ok: true, text: "第一段", figures: [] });
  });

  it("returns an unsuccessful result when the stream emits an error event", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"delta","text":"已收到"}\n'));
          controller.enqueue(encoder.encode('{"type":"error","text":"模型服务异常"}\n'));
          controller.close();
        },
      }),
      { status: 200 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const deltas: string[] = [];

    const result = await streamChatMessage("session-1", "问题", {
      onDelta: (text) => deltas.push(text),
    });

    expect(deltas).toEqual(["已收到"]);
    expect(result.ok).toBe(false);
    expect(result.text).toBe("模型服务异常");
    expect(result.figures).toEqual([]);
  });

  it("returns an unsuccessful result when the stream ends before done", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"delta","text":"部分回答"}\n'));
          controller.close();
        },
      }),
      { status: 200 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await streamChatMessage("session-1", "问题");

    expect(result.ok).toBe(false);
    expect(result.text).toContain("部分回答");
    expect(result.text).toContain("流式响应中断");
    expect(result.figures).toEqual([]);
  });

  it("reports malformed stream lines without hiding already received text", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"delta","text":"第一段"}\n'));
          controller.enqueue(encoder.encode("{broken-json}\n"));
          controller.close();
        },
      }),
      { status: 200 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await streamChatMessage("session-1", "问题");

    expect(result.ok).toBe(false);
    expect(result.text).toContain("第一段");
    expect(result.text).toContain("流式响应格式异常");
  });

  it("passes abort signals to the streaming fetch request", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      { status: 200 },
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await streamChatMessage("session-1", "问题", { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      "/chat/stream",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe("session API", () => {
  it("fetches backend conversations", async () => {
    const conversations = [
      {
        id: "session-1",
        title: "会话",
        summary: "摘要",
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z",
        messages: [],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => conversations,
      }),
    );

    await expect(fetchSessions()).resolves.toEqual(conversations);
    expect(fetch).toHaveBeenCalledWith("/sessions");
  });

  it("creates a backend conversation", async () => {
    const conversation = {
      id: "session-2",
      title: "新的运营问答",
      summary: "还没有消息",
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      messages: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => conversation,
      }),
    );

    await expect(createBackendSession()).resolves.toEqual(conversation);
    expect(fetch).toHaveBeenCalledWith("/sessions", { method: "POST" });
  });

  it("deletes a backend conversation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
      }),
    );

    await expect(deleteBackendSession("session-3")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/sessions/session-3", { method: "DELETE" });
  });

  it("fetches a single backend conversation", async () => {
    const conversation = {
      id: "session-detail",
      title: "详情会话",
      summary: "摘要",
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      messages: [
        {
          id: "msg-1",
          role: "user",
          text: "你好",
          figures: [],
          createdAt: "2026-05-15T00:00:00.000Z",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => conversation,
      }),
    );

    await expect(fetchSession("session-detail")).resolves.toEqual(conversation);
    expect(fetch).toHaveBeenCalledWith("/sessions/session-detail");
  });
});
