import { memo } from "react";
import { Activity } from "lucide-react";

import { formatDisplayTime } from "../format";
import type { ChatMessage } from "../types";
import { PlotlyPanel } from "./PlotlyPanel";

export const MessageList = memo(function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="message-list">
      {messages
        .filter((message) => message.role === "user" || message.text.trim() || message.figures.length > 0)
        .map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="avatar" aria-hidden="true">
              {message.role === "assistant" ? <Activity size={17} /> : "你"}
            </div>
            <div className="message-body">
              <div className="message-meta">
                <span>{message.role === "assistant" ? "DataMedic" : "你"}</span>
                <time>{formatDisplayTime(message.createdAt)}</time>
              </div>
              <div className="bubble">
                {message.text.trim() && <p>{message.text}</p>}
                {message.figures.map((figure, index) => (
                  <PlotlyPanel figure={figure} key={`${message.id}-${index}`} />
                ))}
              </div>
            </div>
          </article>
        ))}
    </div>
  );
});

export const ThinkingIndicator = memo(function ThinkingIndicator() {
  return (
    <article className="message assistant thinking-message" aria-label="DataMedic 正在分析" aria-live="polite">
      <div className="avatar" aria-hidden="true">
        <Activity size={17} />
      </div>
      <div className="message-body">
        <div className="message-meta">
          <span>DataMedic</span>
        </div>
        <div className="bubble thinking-bubble">
          <span />
          <span />
          <span />
          <p>正在分析</p>
        </div>
      </div>
    </article>
  );
});
