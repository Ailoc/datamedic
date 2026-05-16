import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  appendMessage,
  createConversation,
  deleteConversation,
  loadConversationState,
  STORAGE_KEY,
  updateMessage,
} from "./storage";

describe("conversation storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates a default active conversation", () => {
    const state = loadConversationState();

    expect(state.activeId).toBeTruthy();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].title).toBe("新的运营问答");
  });

  it("creates new conversations at the top and persists them", () => {
    const state = loadConversationState();
    const firstId = state.activeId;
    const next = createConversation(state);

    expect(next.activeId).not.toBe(firstId);
    expect(next.conversations[0].id).toBe(next.activeId);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").activeId).toBe(next.activeId);
  });

  it("generates a title from the first user message", () => {
    const state = loadConversationState();
    const next = appendMessage(state, state.activeId, {
      role: "user",
      text: "展示2025年骨科出院人次趋势并分析变化",
      figures: [],
    });

    expect(next.conversations[0].title).toBe("展示2025年骨科出院人次趋势...");
    expect(next.conversations[0].summary).toBe("展示2025年骨科出院人次趋势并分析变化");
  });

  it("deleting the active final conversation creates a replacement", () => {
    const state = loadConversationState();
    const next = deleteConversation(state, state.activeId);

    expect(next.conversations).toHaveLength(1);
    expect(next.activeId).not.toBe(state.activeId);
  });

  it("updates an existing message while preserving its identity", () => {
    const state = loadConversationState();
    const withMessage = appendMessage(state, state.activeId, {
      role: "assistant",
      text: "",
      figures: [],
    });
    const messageId = withMessage.conversations[0].messages[0].id;

    const next = updateMessage(withMessage, state.activeId, messageId, {
      text: "正在生成",
      figures: [{ data: [] }],
    });

    expect(next.conversations[0].messages[0]).toMatchObject({
      id: messageId,
      text: "正在生成",
      figures: [{ data: [] }],
    });
  });

  it("repairs malformed persisted conversations and messages", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeId: "missing",
        conversations: [
          {
            id: "valid",
            title: 123,
            summary: null,
            createdAt: "2026-05-15T00:00:00.000Z",
            updatedAt: "bad-date",
            messages: [
              {
                id: "m1",
                role: "assistant",
                text: 42,
                figures: "bad",
                createdAt: "bad-date",
              },
              {
                id: "m2",
                role: "system",
                text: "ignore me",
                figures: [],
                createdAt: "2026-05-15T00:00:00.000Z",
              },
            ],
          },
          null,
        ],
      }),
    );

    const state = loadConversationState();

    expect(state.activeId).toBe("valid");
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]).toMatchObject({
      id: "valid",
      title: "新的运营问答",
      summary: "还没有消息",
    });
    expect(state.conversations[0].messages).toHaveLength(1);
    expect(state.conversations[0].messages[0]).toMatchObject({
      id: "m1",
      role: "assistant",
      text: "",
      figures: [],
    });
  });

  it("filters stale LangGraph recursion assistant errors from persisted conversations", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeId: "recursion-session",
        conversations: [
          {
            id: "recursion-session",
            title: "分析儿科",
            summary: "抱歉，处理您的问题时出现错误：Recursion limit of 25 reached without hitting a stop condition. For troubleshooting, visit: https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT。请尝试换一种方式提问。",
            createdAt: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:00.000Z",
            messages: [
              {
                id: "m1",
                role: "user",
                text: "分析一下儿科的数据",
                figures: [],
                createdAt: "2026-05-15T00:00:00.000Z",
              },
              {
                id: "m2",
                role: "assistant",
                text: "抱歉，处理您的问题时出现错误：Recursion limit of 25 reached without hitting a stop condition. For troubleshooting, visit: https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT。请尝试换一种方式提问。",
                figures: [],
                createdAt: "2026-05-15T00:00:01.000Z",
              },
            ],
          },
        ],
      }),
    );

    const state = loadConversationState();

    expect(state.conversations[0].messages).toHaveLength(1);
    expect(state.conversations[0].messages[0]).toMatchObject({
      role: "user",
      text: "分析一下儿科的数据",
    });
    expect(state.conversations[0].summary).toBe("分析一下儿科的数据");
  });

  it("keeps in-memory state when localStorage writes fail", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const state = loadConversationState();
    const next = appendMessage(state, state.activeId, {
      role: "user",
      text: "分析门诊趋势",
      figures: [],
    });

    expect(next.conversations[0].messages[0].text).toBe("分析门诊趋势");
    setItem.mockRestore();
  });
});
