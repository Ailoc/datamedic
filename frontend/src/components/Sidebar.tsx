import { MessageCircle, Plus, Trash2 } from "lucide-react";

import { formatDisplayTime } from "../format";
import type { Conversation } from "../types";

export function Sidebar({
  conversations,
  activeId,
  pendingDeleteId,
  totalMessages,
  onCreate,
  onDelete,
  onSwitch,
}: {
  conversations: Conversation[];
  activeId: string;
  pendingDeleteId: string | null;
  totalMessages: number;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onSwitch: (id: string) => void;
}) {
  return (
    <aside className="sidebar" aria-label="会话侧边栏">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <img src="/logo3.png" alt="" width={38} height={38} />
        </div>
        <div className="brand-copy">
          <strong>DataMedic</strong>
          <span>医院运营数据顾问</span>
        </div>
      </div>

      <button className="new-chat" onClick={onCreate}>
        <Plus size={18} />
        <span>新建会话</span>
      </button>

      <div className="rail-section">
        <div className="rail-heading">
          <span>会话</span>
          <small>{conversations.length}</small>
        </div>
        <ul className="session-list" aria-label="会话列表">
          {conversations.map((conversation) => {
            const isActive = conversation.id === activeId;
            const isPendingDelete = pendingDeleteId === conversation.id;

            return (
              <li
                className={`session-item${isActive ? " active" : ""}${
                  isPendingDelete ? " pending-delete" : ""
                }`}
                key={conversation.id}
              >
                <button
                  aria-label={`切换到 ${conversation.title}`}
                  className="session-main"
                  onClick={() => onSwitch(conversation.id)}
                >
                  <span className="session-icon">
                    <MessageCircle size={16} />
                  </span>
                  <span className="session-text">
                    <strong>{conversation.title}</strong>
                    <small>
                      {formatDisplayTime(conversation.updatedAt)} · {conversation.messages.length} 条
                    </small>
                    <em>{conversation.summary}</em>
                  </span>
                </button>
                {isPendingDelete ? (
                  <button
                    aria-label={`确认删除 ${conversation.title}`}
                    className="delete-confirm"
                    type="button"
                    onClick={() => onDelete(conversation.id)}
                  >
                    确认删除
                  </button>
                ) : (
                  <button
                    aria-label={`删除会话 ${conversation.title}`}
                    className="delete-chat"
                    type="button"
                    title="删除会话"
                    onClick={() => onDelete(conversation.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="sidebar-footer">
        <div className="footer-line">
          <span>数据集</span>
          <strong>本地</strong>
        </div>
        <div className="footer-line">
          <span>累计消息</span>
          <strong>{totalMessages}</strong>
        </div>
        <div className="footer-line">
          <span>语音输入</span>
          <strong>可用</strong>
        </div>
      </div>
    </aside>
  );
}
