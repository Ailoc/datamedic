import { describe, expect, it, vi } from "vitest";
import { sendChatMessage, streamChatMessage } from "./api";

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
});
