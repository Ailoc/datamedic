/**
 * 前端核心类型定义。
 * 与后端 API schemas 对应，同时定义本地会话持久化结构。
 */

export type Role = "user" | "assistant";

export type PlotlyFigure = Record<string, unknown>;

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  figures: PlotlyFigure[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ConversationState {
  activeId: string;
  conversations: Conversation[];
}

export interface ChatResponse {
  ok: boolean;
  text: string;
  figures: PlotlyFigure[];
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
