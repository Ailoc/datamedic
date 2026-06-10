/**
 * 会话内存状态管理。
 *
 * 纯内存操作，不承担任何持久化职责。
 * 所有数据均来自后端 API，写操作也通过后端 API 完成。
 */

import type { ChatMessage, Conversation, ConversationState, PlotlyFigure, Role } from "./types";

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

/**
 * 用后端返回的会话列表构建前端内存初始状态。
 * 如果列表为空，则创建一个默认空会话。
 */
export const createInitialState = (conversations: Conversation[]): ConversationState => {
  if (conversations.length === 0) {
    const now = nowIso();
    const conversation: Conversation = {
      id: createId(),
      title: DEFAULT_TITLE,
      summary: "还没有消息",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    return { activeId: conversation.id, conversations: [conversation] };
  }
  return { activeId: conversations[0].id, conversations };
};

/**
 * 在内存状态中追加一个新的空会话，并将其设为激活会话。
 * 返回新状态（不修改入参）。
 */
export const createConversation = (state: ConversationState): ConversationState => {
  const now = nowIso();
  const conversation: Conversation = {
    id: createId(),
    title: DEFAULT_TITLE,
    summary: "还没有消息",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  return {
    activeId: conversation.id,
    conversations: [conversation, ...state.conversations],
  };
};

/**
 * 切换激活会话（纯内存操作）。
 */
export const setActiveConversation = (
  state: ConversationState,
  conversationId: string,
): ConversationState => {
  if (!state.conversations.some((conversation) => conversation.id === conversationId)) {
    return state;
  }
  return { ...state, activeId: conversationId };
};

/**
 * 删除指定会话；若删除的是当前激活会话，自动切换到剩余第一个。
 * 若全部删除完毕，创建一个新的空会话。
 */
export const deleteConversation = (
  state: ConversationState,
  conversationId: string,
): ConversationState => {
  const remaining = state.conversations.filter((conversation) => conversation.id !== conversationId);
  if (remaining.length === 0) {
    return createInitialState([]);
  }
  return {
    activeId: state.activeId === conversationId ? remaining[0].id : state.activeId,
    conversations: remaining,
  };
};

/**
 * 向指定会话追加一条消息（纯内存操作）。
 * 如果是第一条用户消息且会话标题为默认值，则自动更新标题。
 */
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
  return {
    activeId: conversationId,
    conversations: conversations.sort((a, b) =>
      a.id === conversationId ? -1 : b.id === conversationId ? 1 : 0,
    ),
  };
};

/**
 * 更新指定会话中指定消息的文本或图表（纯内存操作）。
 */
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
  return { ...state, conversations };
};

/**
 * 获取当前激活的会话对象。
 */
export const getActiveConversation = (state: ConversationState): Conversation => {
  return (
    state.conversations.find((conversation) => conversation.id === state.activeId) ??
    state.conversations[0]
  );
};
