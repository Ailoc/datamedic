import { describe, expect, it } from "vitest";
import {
  appendMessage,
  createConversation,
  createInitialState,
  deleteConversation,
  getActiveConversation,
  setActiveConversation,
  updateMessage,
} from "./storage";
import type { Conversation } from "./types";

const makeConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: "session-1",
  title: "测试会话",
  summary: "测试摘要",
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
  messages: [],
  ...overrides,
});

describe("createInitialState", () => {
  it("builds state from backend conversations", () => {
    const conversations = [
      makeConversation({ id: "s1", title: "第一个" }),
      makeConversation({ id: "s2", title: "第二个" }),
    ];
    const state = createInitialState(conversations);
    expect(state.activeId).toBe("s1");
    expect(state.conversations).toHaveLength(2);
  });

  it("creates a default empty conversation when list is empty", () => {
    const state = createInitialState([]);
    expect(state.activeId).toBeTruthy();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].title).toBe("新的运营问答");
  });
});

describe("createConversation", () => {
  it("adds a new conversation at the top and sets it active", () => {
    const state = createInitialState([makeConversation({ id: "existing" })]);
    const next = createConversation(state);
    expect(next.activeId).not.toBe("existing");
    expect(next.conversations[0].id).toBe(next.activeId);
    expect(next.conversations).toHaveLength(2);
  });
});

describe("setActiveConversation", () => {
  it("switches the active conversation", () => {
    const state = createInitialState([
      makeConversation({ id: "s1" }),
      makeConversation({ id: "s2" }),
    ]);
    const next = setActiveConversation(state, "s2");
    expect(next.activeId).toBe("s2");
  });

  it("returns unchanged state when conversationId does not exist", () => {
    const state = createInitialState([makeConversation({ id: "s1" })]);
    const next = setActiveConversation(state, "nonexistent");
    expect(next).toBe(state);
  });
});

describe("deleteConversation", () => {
  it("removes the conversation and switches to the remaining one", () => {
    const state = createInitialState([
      makeConversation({ id: "s1" }),
      makeConversation({ id: "s2" }),
    ]);
    const next = deleteConversation(state, "s1");
    expect(next.conversations).toHaveLength(1);
    expect(next.conversations[0].id).toBe("s2");
    expect(next.activeId).toBe("s2");
  });

  it("creates a replacement when deleting the last conversation", () => {
    const state = createInitialState([makeConversation({ id: "only" })]);
    const next = deleteConversation(state, "only");
    expect(next.conversations).toHaveLength(1);
    expect(next.activeId).not.toBe("only");
    expect(next.conversations[0].title).toBe("新的运营问答");
  });

  it("preserves activeId when deleting a non-active conversation", () => {
    const state = createInitialState([
      makeConversation({ id: "s1" }),
      makeConversation({ id: "s2" }),
    ]);
    const next = deleteConversation(state, "s2");
    expect(next.activeId).toBe("s1");
    expect(next.conversations).toHaveLength(1);
  });
});

describe("appendMessage", () => {
  it("appends a user message and updates title from first user message", () => {
    const state = createInitialState([
      makeConversation({ id: "s1", title: "\u65b0\u7684\u8fd0\u8425\u95ee\u7b54" }),
    ]);
    const next = appendMessage(state, "s1", {
      role: "user",
      text: "展示2025年骨科出院人次趋势并分析变化",
    });
    expect(next.conversations[0].title).toBe("展示2025年骨科出院人次趋势...");
    expect(next.conversations[0].summary).toBe("展示2025年骨科出院人次趋势并分析变化");
    expect(next.conversations[0].messages).toHaveLength(1);
    expect(next.conversations[0].messages[0].role).toBe("user");
  });

  it("does not rename a conversation that already has a custom title", () => {
    const state = createInitialState([
      makeConversation({ id: "s1", title: "已有标题" }),
    ]);
    const next = appendMessage(state, "s1", {
      role: "user",
      text: "新的问题",
    });
    expect(next.conversations[0].title).toBe("已有标题");
  });

  it("sorts the updated conversation to the top", () => {
    const state = createInitialState([
      makeConversation({ id: "s1" }),
      makeConversation({ id: "s2" }),
    ]);
    const next = appendMessage(state, "s2", { role: "user", text: "消息" });
    expect(next.conversations[0].id).toBe("s2");
    expect(next.activeId).toBe("s2");
  });
});

describe("updateMessage", () => {
  it("updates text and figures while preserving message id", () => {
    const state = appendMessage(
      createInitialState([makeConversation({ id: "s1" })]),
      "s1",
      { role: "assistant", text: "" },
    );
    const messageId = state.conversations[0].messages[0].id;
    const next = updateMessage(state, "s1", messageId, {
      text: "正在生成",
      figures: [{ data: [] }],
    });
    expect(next.conversations[0].messages[0]).toMatchObject({
      id: messageId,
      text: "正在生成",
      figures: [{ data: [] }],
    });
  });

  it("does not affect other conversations", () => {
    const state = createInitialState([
      makeConversation({ id: "s1" }),
      makeConversation({ id: "s2" }),
    ]);
    const withMsg = appendMessage(state, "s1", { role: "assistant", text: "" });
    const msgId = withMsg.conversations.find((c) => c.id === "s1")!.messages[0].id;
    const next = updateMessage(withMsg, "s1", msgId, { text: "更新后" });
    const s2 = next.conversations.find((c) => c.id === "s2");
    expect(s2?.messages).toHaveLength(0);
  });
});

describe("getActiveConversation", () => {
  it("returns the currently active conversation", () => {
    const state = createInitialState([
      makeConversation({ id: "s1", title: "第一个" }),
      makeConversation({ id: "s2", title: "第二个" }),
    ]);
    const switched = setActiveConversation(state, "s2");
    const active = getActiveConversation(switched);
    expect(active.id).toBe("s2");
    expect(active.title).toBe("第二个");
  });

  it("falls back to the first conversation when activeId is invalid", () => {
    const state = createInitialState([makeConversation({ id: "s1" })]);
    const badState = { ...state, activeId: "nonexistent" };
    const active = getActiveConversation(badState);
    expect(active.id).toBe("s1");
  });
});
