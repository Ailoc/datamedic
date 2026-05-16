import { vi } from "vitest";
import type { Conversation } from "./types";

export const makeConversation = (
  overrides: Partial<Conversation> = {},
): Conversation => ({
  id: "conv-1",
  title: "测试会话",
  summary: "测试摘要",
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
  messages: [],
  ...overrides,
});

export const makeSpeechPlayer = () => ({
  destroy: vi.fn(),
  enqueue: vi.fn(() => Promise.resolve()),
  unlock: vi.fn(() => Promise.resolve()),
  play: vi.fn(() => Promise.resolve()),
  stop: vi.fn(),
});

export const makeSpeechRecognizer = (overrides?: { stop?: ReturnType<typeof vi.fn> }) => ({
  start: vi.fn(() => Promise.resolve()),
  stop: overrides?.stop ?? vi.fn(),
});
