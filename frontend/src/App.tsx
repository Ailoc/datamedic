/**
 * 主应用组件，包含侧边栏会话管理、聊天线程、消息输入和 Plotly 图表渲染。
 * 支持流式文本输出和实时语音输入/输出。
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
import { createBackendSession, deleteBackendSession, fetchSessions } from "./api";
import { Composer } from "./components/Composer";
import { MessageList, ThinkingIndicator } from "./components/MessageList";
import { Sidebar } from "./components/Sidebar";
import { StatusPill } from "./components/StatusPill";
import { Welcome } from "./components/Welcome";
import { useChatSession } from "./hooks/useChatSession";
import {
  createConversation,
  deleteConversation,
  getActiveConversation,
  loadConversationState,
  saveConversationState,
  setActiveConversation,
} from "./storage";
import type { ConversationState } from "./types";
import { SpeechPlayer, SpeechRecognizer } from "./voice";

function App() {
  const [state, setState] = useState<ConversationState>(() => loadConversationState());
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const player = useRef<SpeechPlayer | null>(null);
  const recognizer = useRef<SpeechRecognizer | null>(null);
  const voiceOutputEnabledRef = useRef(false);
  const voiceDraft = useRef("");
  const threadEnd = useRef<HTMLDivElement | null>(null);

  const active = useMemo(() => getActiveConversation(state), [state]);
  const totalMessages = useMemo(
    () => state.conversations.reduce((total, conversation) => total + conversation.messages.length, 0),
    [state.conversations],
  );

  useEffect(() => {
    return () => {
      recognizer.current?.stop();
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
          setState(saveConversationState({ activeId: conversations[0].id, conversations }));
          return;
        }
        const conversation = await createBackendSession();
        if (!cancelled) {
          setState(saveConversationState({ activeId: conversation.id, conversations: [conversation] }));
        }
      } catch {
        // Keep the localStorage state as an offline fallback.
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
    activeConversationId: active.id,
    getSpeechPlayer,
    setInput,
    setPendingDeleteId,
    setState,
    setVoiceHint,
    state,
    voiceOutputEnabledRef,
  });

  useEffect(() => {
    threadEnd.current?.scrollIntoView?.({ block: "end" });
  }, [active.id, active.messages.length, loading]);

  const handleCreate = () => {
    setPendingDeleteId(null);
    void createBackendSession()
      .then((conversation) => {
        setState((currentState) =>
          saveConversationState({
            activeId: conversation.id,
            conversations: [
              conversation,
              ...currentState.conversations.filter((item) => item.id !== conversation.id),
            ],
          }),
        );
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

  const toggleVoice = async () => {
    if (recording) {
      recognizer.current?.stop();
      recognizer.current = null;
      voiceDraft.current = "";
      setRecording(false);
      setVoiceHint("");
      return;
    }
    voiceDraft.current = input.trim();
    const instance = new SpeechRecognizer({
      onText: (text, isFinal) => {
        const nextText = text.trim();
        setVoiceHint(nextText || "正在聆听");
        if (isFinal && nextText) {
          voiceDraft.current = [voiceDraft.current, nextText].filter(Boolean).join(" ");
          setInput(voiceDraft.current);
        }
      },
      onError: (message) => {
        instance.stop();
        recognizer.current = null;
        voiceDraft.current = "";
        setVoiceHint(message);
        setRecording(false);
      },
    });
    recognizer.current = instance;
    setRecording(true);
    setVoiceHint("正在聆听");
    try {
      await instance.start();
    } catch {
      instance.stop();
      recognizer.current = null;
      voiceDraft.current = "";
      setRecording(false);
      setVoiceHint("无法使用麦克风");
    }
  };

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
              <Welcome onPickExample={(example) => setInput(example)} />
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
          onInput={setInput}
          onKeyDown={handleComposerKeyDown}
          onSubmit={handleSubmit}
          onToggleVoice={toggleVoice}
        />
      </main>
    </div>
  );
}
export default App;
