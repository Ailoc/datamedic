import { describe, expect, it, beforeEach } from "vitest";
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
});
