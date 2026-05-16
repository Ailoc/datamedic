/**
 * 会话持久化层，基于 localStorage 实现多会话 CRUD。
 *
 * 数据结构: ConversationState { activeId, conversations[] }
 * 每次写操作都会同步持久化，页面刷新后自动恢复。
 */

import { isRecord, type ChatMessage, type Conversation, type ConversationState, type PlotlyFigure, type Role } from "./types";

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

const stringOr = (value: unknown, fallback: string, allowBlank = false) => {
  if (typeof value !== "string") return fallback;
  if (!allowBlank && !value.trim()) return fallback;
  return value;
};

const dateOr = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;
  return Number.isNaN(new Date(value).getTime()) ? fallback : value;
};

const normalizeFigures = (value: unknown): PlotlyFigure[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
};

const normalizeMessage = (value: unknown): ChatMessage | null => {
  if (!isRecord(value)) return null;
  if (value.role !== "user" && value.role !== "assistant") return null;
  const text = stringOr(value.text, "", true);
  if (value.role === "assistant" && isStaleBackendErrorMessage(text)) return null;
  return {
    id: stringOr(value.id, createId()),
    role: value.role,
    text,
    figures: normalizeFigures(value.figures),
    createdAt: dateOr(value.createdAt, nowIso()),
  };
};

const isStaleBackendErrorMessage = (text: string): boolean => {
  const markers = [
    "Recursion limit of 25 reached",
    "GRAPH_RECURSION_LIMIT",
    "LangGraph",
    "docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT",
  ];
  return markers.some((marker) => text.includes(marker));
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

const normalizeConversation = (value: unknown): Conversation | null => {
  if (!isRecord(value)) return null;
  const createdAt = dateOr(value.createdAt, nowIso());
  const messages = Array.isArray(value.messages)
    ? value.messages
        .map(normalizeMessage)
        .filter((message): message is ChatMessage => Boolean(message))
    : [];
  const fallbackSummary = messages.at(-1)?.text || "还没有消息";
  const rawSummary = stringOr(value.summary, fallbackSummary);
  return {
    id: stringOr(value.id, createId()),
    title: stringOr(value.title, DEFAULT_TITLE),
    summary: isStaleBackendErrorMessage(rawSummary) ? fallbackSummary : rawSummary,
    createdAt,
    updatedAt: dateOr(value.updatedAt, createdAt),
    messages,
  };
};

const normalize = (value: unknown): ConversationState => {
  if (!isRecord(value)) {
    const conversation = createEmptyConversation();
    return { activeId: conversation.id, conversations: [conversation] };
  }
  const candidate = value as Partial<ConversationState>;
  const conversations = Array.isArray(candidate.conversations)
    ? candidate.conversations
        .map(normalizeConversation)
        .filter((conversation): conversation is Conversation => Boolean(conversation))
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return state;
  }
  return state;
};

export const loadConversationState = (): ConversationState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return saveConversationState(normalize(null));
    }
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
