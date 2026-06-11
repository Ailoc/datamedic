/**
 * 主应用组件，包含侧边栏会话管理、聊天线程、消息输入和 Plotly 图表渲染。
 * 支持流式文本输出和实时语音输入/输出。
 * 所有会话数据均来自后端 API，前端仅保留内存状态。
 */

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BarChart3, Clock3, Database, Volume2, VolumeX } from "lucide-react";
import {
  createBackendSession,
  deleteBackendSession,
  fetchSessions,
} from "./api";
import { Composer } from "./components/Composer";
import { MessageList, ThinkingIndicator } from "./components/MessageList";
import { Sidebar } from "./components/Sidebar";
import { StatusPill } from "./components/StatusPill";
import { Welcome } from "./components/Welcome";
import { useChatSession } from "./hooks/useChatSession";
import { useVoiceInput } from "./hooks/useVoiceInput";
import {
  createConversation,
  createInitialState,
  deleteConversation,
  getActiveConversation,
  setActiveConversation,
} from "./storage";
import type { ConversationState } from "./types";
import { SpeechPlayer } from "./voice";

function App() {
  const [state, setState] = useState<ConversationState>({ activeId: "", conversations: [] });
  const [initializing, setInitializing] = useState(true);
  const [input, setInput] = useState("");
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const player = useRef<SpeechPlayer | null>(null);
  const voiceOutputEnabledRef = useRef(false);
  const threadEnd = useRef<HTMLDivElement | null>(null);

  const { recording, voiceHint, toggleVoice, stopVoiceInput, setVoiceHint, markManualInput } =
    useVoiceInput({
      input,
      setInput,
    });

  const active = useMemo(() => getActiveConversation(state), [state]);
  const totalMessages = useMemo(
    () => state.conversations.reduce((total, conversation) => total + conversation.messages.length, 0),
    [state.conversations],
  );

  useEffect(() => {
    return () => {
      player.current?.destroy();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadBackendSessions = async () => {
      try {
        const conversations = await fetchSessions();
        if (cancelled) return;
        if (conversations.length > 0) {
          setState(createInitialState(conversations));
          return;
        }
        const conversation = await createBackendSession();
        if (!cancelled) {
          setState(createInitialState([conversation]));
        }
      } catch {
        if (!cancelled) {
          setState(createInitialState([]));
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    };

    void loadBackendSessions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled;
  }, [voiceOutputEnabled]);

  const getSpeechPlayer = () => {
    player.current ??= new SpeechPlayer();
    return player.current;
  };

  const { loading, submitMessage } = useChatSession({
    activeConversationId: active?.id ?? "",
    getSpeechPlayer,
    setInput,
    setPendingDeleteId,
    setState,
    setVoiceHint,
    state,
    stopVoiceInput,
    voiceOutputEnabledRef,
  });

  useEffect(() => {
    threadEnd.current?.scrollIntoView?.({ block: "end" });
  }, [active?.id, active?.messages.length, loading]);

  const handleCreate = () => {
    setPendingDeleteId(null);
    void createBackendSession()
      .then((conversation) => {
        setState((currentState) => ({
          activeId: conversation.id,
          conversations: [
            conversation,
            ...currentState.conversations.filter((item) => item.id !== conversation.id),
          ],
        }));
      })
      .catch(() => {
        setState((currentState) => createConversation(currentState));
      });
  };

  const handleDelete = (conversationId: string) => {
    if (pendingDeleteId !== conversationId) {
      setPendingDeleteId(conversationId);
      return;
    }
    void deleteBackendSession(conversationId)
      .catch(() => undefined)
      .finally(() => {
        setPendingDeleteId(null);
        setState((currentState) => deleteConversation(currentState, conversationId));
      });
  };

  const handleSwitch = (conversationId: string) => {
    setPendingDeleteId(null);
    if (conversationId === state.activeId) return;
    setState(setActiveConversation(state, conversationId));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitMessage(input);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitMessage(input);
    }
  };

  const toggleVoiceOutput = () => {
    setVoiceOutputEnabled((enabled) => {
      voiceOutputEnabledRef.current = !enabled;
      if (!enabled) {
        void getSpeechPlayer().unlock().catch(() => setVoiceHint("语音输出初始化失败"));
      } else {
        player.current?.stop();
      }
      return !enabled;
    });
  };

  if (initializing || !active) {
    return (
      <div className="app-shell">
        <main className="chat-workspace">
          <section className="thread-surface" aria-label="对话内容">
            <div className="thread-inner">
              <ThinkingIndicator />
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeId={state.activeId}
        conversations={state.conversations}
        pendingDeleteId={pendingDeleteId}
        totalMessages={totalMessages}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onSwitch={handleSwitch}
      />

      <main className="chat-workspace">
        <header className="workspace-header">
          <div className="header-copy">
            <span>当前会话</span>
            <h1>{active.title}</h1>
          </div>
          <div className="header-status" aria-label="数据范围">
            <button
              aria-label={voiceOutputEnabled ? "关闭语音输出" : "开启语音输出"}
              aria-pressed={voiceOutputEnabled}
              className={`voice-output-toggle${voiceOutputEnabled ? " is-on" : ""}`}
              type="button"
              onClick={toggleVoiceOutput}
            >
              {voiceOutputEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              <span>{voiceOutputEnabled ? "语音输出开" : "语音输出关"}</span>
            </button>
            <StatusPill icon={<Clock3 size={15} />} label="2022.1 - 2025.12" />
            <StatusPill icon={<Database size={15} />} label="20 个科室" />
            <StatusPill icon={<BarChart3 size={15} />} label="51 项指标" />
          </div>
        </header>

        <section className="thread-surface" aria-label="对话内容">
          <div className="thread-inner">
            {active.messages.length === 0 ? (
              <Welcome
                onPickExample={(example) => {
                  markManualInput(example);
                  setInput(example);
                }}
              />
            ) : (
              <MessageList messages={active.messages} />
            )}
            {loading && <ThinkingIndicator />}
            <div ref={threadEnd} />
          </div>
        </section>

        <Composer
          input={input}
          loading={loading}
          recording={recording}
          voiceHint={voiceHint}
          onInput={(value) => {
            markManualInput(value);
            setInput(value);
          }}
          onKeyDown={handleComposerKeyDown}
          onSubmit={handleSubmit}
          onToggleVoice={toggleVoice}
        />
      </main>
    </div>
  );
}
export default App;
