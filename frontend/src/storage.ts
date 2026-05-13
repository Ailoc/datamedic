/**
 * 会话持久化层，基于 localStorage 实现多会话 CRUD。
 *
 * 数据结构: ConversationState { activeId, conversations[] }
 * 每次写操作都会同步持久化，页面刷新后自动恢复。
 */

import type { ChatMessage, Conversation, ConversationState, PlotlyFigure, Role } from "./types";

export const STORAGE_KEY = "datamedic.conversations.v1";

const DEFAULT_TITLE = "新的运营问答";

type MessageInput = {
  role: Role;
  text: string;
  figures?: PlotlyFigure[];
};

const nowIso = () => new Date().toISOString();

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createEmptyConversation = (): Conversation => {
  const now = nowIso();
  return {
    id: createId(),
    title: DEFAULT_TITLE,
    summary: "还没有消息",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
};

const normalize = (value: unknown): ConversationState => {
  if (!value || typeof value !== "object") {
    const conversation = createEmptyConversation();
    return { activeId: conversation.id, conversations: [conversation] };
  }
  const candidate = value as Partial<ConversationState>;
  const conversations = Array.isArray(candidate.conversations)
    ? candidate.conversations.filter(Boolean)
    : [];
  if (conversations.length === 0) {
    const conversation = createEmptyConversation();
    return { activeId: conversation.id, conversations: [conversation] };
  }
  const activeId =
    typeof candidate.activeId === "string" &&
    conversations.some((conversation) => conversation.id === candidate.activeId)
      ? candidate.activeId
      : conversations[0].id;
  return { activeId, conversations };
};

export const saveConversationState = (state: ConversationState): ConversationState => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
};

export const loadConversationState = (): ConversationState => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return saveConversationState(normalize(null));
  }
  try {
    return saveConversationState(normalize(JSON.parse(raw)));
  } catch {
    return saveConversationState(normalize(null));
  }
};

export const createConversation = (state: ConversationState): ConversationState => {
  const conversation = createEmptyConversation();
  return saveConversationState({
    activeId: conversation.id,
    conversations: [conversation, ...state.conversations],
  });
};

export const setActiveConversation = (
  state: ConversationState,
  conversationId: string,
): ConversationState => {
  if (!state.conversations.some((conversation) => conversation.id === conversationId)) {
    return state;
  }
  return saveConversationState({ ...state, activeId: conversationId });
};

export const deleteConversation = (
  state: ConversationState,
  conversationId: string,
): ConversationState => {
  const remaining = state.conversations.filter((conversation) => conversation.id !== conversationId);
  if (remaining.length === 0) {
    return saveConversationState(normalize(null));
  }
  return saveConversationState({
    activeId: state.activeId === conversationId ? remaining[0].id : state.activeId,
    conversations: remaining,
  });
};

export const appendMessage = (
  state: ConversationState,
  conversationId: string,
  input: MessageInput,
): ConversationState => {
  const message: ChatMessage = {
    id: createId(),
    role: input.role,
    text: input.text,
    figures: input.figures ?? [],
    createdAt: nowIso(),
  };
  const conversations = state.conversations.map((conversation) => {
    if (conversation.id !== conversationId) {
      return conversation;
    }
    const nextMessages = [...conversation.messages, message];
    const shouldRename = conversation.title === DEFAULT_TITLE && input.role === "user";
    return {
      ...conversation,
      title: shouldRename ? titleFromText(input.text) : conversation.title,
      summary: input.text || conversation.summary,
      updatedAt: message.createdAt,
      messages: nextMessages,
    };
  });
  return saveConversationState({
    activeId: conversationId,
    conversations: conversations.sort((a, b) =>
      a.id === conversationId ? -1 : b.id === conversationId ? 1 : 0,
    ),
  });
};

export const updateMessage = (
  state: ConversationState,
  conversationId: string,
  messageId: string,
  updates: Partial<Pick<ChatMessage, "text" | "figures">>,
): ConversationState => {
  const updatedAt = nowIso();
  const conversations = state.conversations.map((conversation) => {
    if (conversation.id !== conversationId) {
      return conversation;
    }
    return {
      ...conversation,
      summary: updates.text ?? conversation.summary,
      updatedAt,
      messages: conversation.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              ...updates,
              figures: updates.figures ?? message.figures,
            }
          : message,
      ),
    };
  });
  return saveConversationState({ ...state, conversations });
};

export const getActiveConversation = (state: ConversationState): Conversation => {
  return (
    state.conversations.find((conversation) => conversation.id === state.activeId) ??
    state.conversations[0]
  );
};

const titleFromText = (text: string): string => {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact) {
    return DEFAULT_TITLE;
  }
  if (compact.length <= 15) {
    return compact;
  }
  return `${compact.slice(0, 15)}...`;
};
