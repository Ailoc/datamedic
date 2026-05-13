/**
 * 主应用组件，包含侧边栏会话管理、聊天线程、消息输入和 Plotly 图表渲染。
 * 支持流式文本输出和实时语音输入/输出。
 */

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  MessageCircle,
  Mic,
  Plus,
  SendHorizontal,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { streamChatMessage } from "./api";
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getActiveConversation,
  loadConversationState,
  setActiveConversation,
  updateMessage,
} from "./storage";
import type { ChatMessage, Conversation, ConversationState, PlotlyFigure } from "./types";
import { SpeechPlayer, SpeechRecognizer } from "./voice";

const examples = [
  "展示 2025 年骨科出院人次趋势",
  "比较心内科与心外科手术人次",
  "找出门诊人次下降最明显的科室",
  "分析住院收入与出院人次的关系",
];

// 语音分段策略：在强断句符号处立即切分，在弱断句符号处需累积足够长度后切分，
// 以平衡 TTS 延迟和语音自然度。
const strongSpeechBreaks = new Set(["。", "！", "？", "!", "?", "；", ";"]);
const softSpeechBreaks = new Set(["，", ",", "、", "：", ":"]);
const minSoftSpeechSegmentLength = 22;

const transparentBackground = "rgba(0,0,0,0)";

const chartTheme = {
  axisLine: "rgba(69, 55, 40, 0.24)",
  font: "#26211c",
  grid: "rgba(69, 55, 40, 0.10)",
  hoverBackground: "rgba(255, 253, 248, 0.94)",
  hoverBorder: "rgba(69, 55, 40, 0.14)",
  tableCellBackground: "rgba(255, 253, 248, 0.34)",
  tableHeaderBackground: "rgba(47, 117, 106, 0.12)",
};

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(
    2,
    "0",
  )} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeRecord = (
  base: Record<string, unknown>,
  override: unknown,
): Record<string, unknown> => ({
  ...base,
  ...(isRecord(override) ? override : {}),
});

const withThemedAxis = (axis: unknown) =>
  mergeRecord(
    {
      gridcolor: chartTheme.grid,
      linecolor: chartTheme.axisLine,
      tickcolor: chartTheme.axisLine,
      zerolinecolor: chartTheme.grid,
    },
    axis,
  );

const withThemedTableFill = (section: unknown, fallbackColor: string) => {
  const sectionRecord = isRecord(section) ? section : {};
  const sourceFill = isRecord(sectionRecord.fill) ? sectionRecord.fill : {};
  return {
    ...sectionRecord,
    fill: {
      ...sourceFill,
      color: fallbackColor,
    },
    font: mergeRecord({ color: chartTheme.font }, sectionRecord.font),
    line: mergeRecord({ color: chartTheme.grid }, sectionRecord.line),
  };
};

const withThemedTrace = (trace: unknown) => {
  if (!isRecord(trace) || trace.type !== "table") return trace;

  return {
    ...trace,
    cells: withThemedTableFill(trace.cells, chartTheme.tableCellBackground),
    header: withThemedTableFill(trace.header, chartTheme.tableHeaderBackground),
  };
};

const createPlotlyThemePayload = (figure: PlotlyFigure) => {
  const payload = figure as {
    data?: unknown[];
    layout?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
  const sourceLayout = payload.layout ?? {};
  const data = (payload.data ?? []).map(withThemedTrace);
  const layout = {
    ...sourceLayout,
    paper_bgcolor: transparentBackground,
    plot_bgcolor: transparentBackground,
    font: mergeRecord({ color: chartTheme.font }, sourceLayout.font),
    hoverlabel: mergeRecord(
      {
        bgcolor: chartTheme.hoverBackground,
        bordercolor: chartTheme.hoverBorder,
        font: { color: chartTheme.font },
      },
      sourceLayout.hoverlabel,
    ),
    margin: mergeRecord({ l: 44, r: 20, t: 52, b: 42 }, sourceLayout.margin),
    xaxis: withThemedAxis(sourceLayout.xaxis),
    yaxis: withThemedAxis(sourceLayout.yaxis),
  };
  const config = {
    responsive: true,
    displayModeBar: false,
    ...(payload.config ?? {}),
  };

  return { config, data, layout };
};

const compactSpeechText = (text: string) => text.replace(/\s+/g, " ").trim();

const extractSpeakableSegments = (buffer: string, flush = false) => {
  const segments: string[] = [];
  let segmentStart = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index];
    const candidate = compactSpeechText(buffer.slice(segmentStart, index + 1));
    const canBreakAtSoftPunctuation =
      softSpeechBreaks.has(character) && candidate.length >= minSoftSpeechSegmentLength;

    if (strongSpeechBreaks.has(character) || canBreakAtSoftPunctuation) {
      if (candidate) {
        segments.push(candidate);
      }
      segmentStart = index + 1;
    }
  }

  const remaining = buffer.slice(segmentStart);
  if (flush) {
    const tail = compactSpeechText(remaining);
    if (tail) {
      segments.push(tail);
    }
    return { remaining: "", segments };
  }

  return { remaining, segments };
};

function App() {
  const [state, setState] = useState<ConversationState>(() => loadConversationState());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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
    threadEnd.current?.scrollIntoView?.({ block: "end" });
  }, [active.id, active.messages.length, loading]);

  useEffect(() => {
    return () => {
      recognizer.current?.stop();
      player.current?.destroy();
    };
  }, []);

  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled;
  }, [voiceOutputEnabled]);

  const getSpeechPlayer = () => {
    player.current ??= new SpeechPlayer();
    return player.current;
  };

  const handleCreate = () => {
    setPendingDeleteId(null);
    setState(createConversation(state));
  };

  const handleDelete = (conversationId: string) => {
    if (pendingDeleteId !== conversationId) {
      setPendingDeleteId(conversationId);
      return;
    }
    setPendingDeleteId(null);
    setState(deleteConversation(state, conversationId));
  };

  const handleSwitch = (conversationId: string) => {
    setPendingDeleteId(null);
    setState(setActiveConversation(state, conversationId));
  };

  const submitMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setVoiceHint("");
    setPendingDeleteId(null);
    if (voiceOutputEnabledRef.current) {
      getSpeechPlayer().stop();
    }

    const conversationId = active.id;
    let nextState = appendMessage(state, conversationId, {
      role: "user",
      text: trimmed,
      figures: [],
    });
    nextState = appendMessage(nextState, conversationId, {
      role: "assistant",
      text: "",
      figures: [],
    });
    const assistantMessage = getActiveConversation(nextState).messages.at(-1);
    if (!assistantMessage) return;
    setState(nextState);
    setLoading(true);

    try {
      let streamedText = "";
      let speechBuffer = "";
      let queuedSpeechText = "";
      const enqueueSpeech = (speechText: string) => {
        const content = compactSpeechText(speechText);
        if (!content || !voiceOutputEnabledRef.current) return;
        queuedSpeechText += content;
        void getSpeechPlayer()
          .enqueue(content)
          .catch((error: unknown) =>
            setVoiceHint(`语音输出失败：${error instanceof Error ? error.message : "请检查服务配置"}`),
          );
      };
      const queueSpeakableDeltas = (delta: string) => {
        if (!voiceOutputEnabledRef.current) return;
        speechBuffer += delta;
        const extracted = extractSpeakableSegments(speechBuffer);
        speechBuffer = extracted.remaining;
        extracted.segments.forEach(enqueueSpeech);
      };
      const flushSpeech = (fallbackText: string) => {
        if (!voiceOutputEnabledRef.current) return;
        const extracted = extractSpeakableSegments(speechBuffer, true);
        speechBuffer = extracted.remaining;
        extracted.segments.forEach(enqueueSpeech);
        if (queuedSpeechText || !fallbackText) return;
        enqueueSpeech(fallbackText);
      };
      const result = await streamChatMessage(conversationId, trimmed, {
        onDelta: (delta) => {
          streamedText += delta;
          queueSpeakableDeltas(delta);
          nextState = updateMessage(nextState, conversationId, assistantMessage.id, {
            text: streamedText,
          });
          setState(nextState);
        },
      });
      if (result.text && result.text.startsWith(streamedText)) {
        speechBuffer += result.text.slice(streamedText.length);
      }
      nextState = updateMessage(nextState, conversationId, assistantMessage.id, {
        text: result.text || streamedText,
        figures: result.figures,
      });
      setState(nextState);
      flushSpeech(result.text || streamedText);
    } catch {
      nextState = updateMessage(nextState, conversationId, assistantMessage.id, {
        text: "无法连接到后端服务，请确认 FastAPI 已启动。",
        figures: [],
      });
      setState(nextState);
    } finally {
      setLoading(false);
    }
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

function Sidebar({
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
          <Activity size={22} strokeWidth={2.4} />
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
                      {formatTime(conversation.updatedAt)} · {conversation.messages.length} 条
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

function StatusPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="status-pill">
      {icon}
      {label}
    </span>
  );
}

function Welcome({ onPickExample }: { onPickExample: (example: string) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-mark" aria-hidden="true">
        <Activity size={28} />
      </div>
      <h2>今天想看哪组指标？</h2>
      <div className="example-grid">
        {examples.map((example) => (
          <button key={example} onClick={() => onPickExample(example)}>
            <span>{example}</span>
            <BarChart3 size={17} />
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="message-list">
      {messages.map((message) => (
        <article className={`message ${message.role}`} key={message.id}>
          <div className="avatar" aria-hidden="true">
            {message.role === "assistant" ? <Activity size={17} /> : "你"}
          </div>
          <div className="message-body">
            <div className="message-meta">
              <span>{message.role === "assistant" ? "DataMedic" : "你"}</span>
              <time>{formatTime(message.createdAt)}</time>
            </div>
            <div className="bubble">
              <p>{message.text}</p>
              {message.figures.map((figure, index) => (
                <PlotlyPanel figure={figure} key={`${message.id}-${index}`} />
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="thinking" aria-live="polite">
      <span />
      <span />
      <span />
      <p>正在分析</p>
    </div>
  );
}

function Composer({
  input,
  loading,
  recording,
  voiceHint,
  onInput,
  onKeyDown,
  onSubmit,
  onToggleVoice,
}: {
  input: string;
  loading: boolean;
  recording: boolean;
  voiceHint: string;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent) => void;
  onToggleVoice: () => void;
}) {
  return (
    <form aria-label="消息发送区" className="composer" onSubmit={onSubmit}>
      <div className="composer-frame">
        <button
          aria-label="语音输入"
          className={`icon-button voice-button${recording ? " is-recording" : ""}`}
          type="button"
          onClick={onToggleVoice}
        >
          {recording ? <Square size={16} fill="currentColor" /> : <Mic size={18} />}
        </button>
        <textarea
          aria-label="消息输入"
          rows={1}
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="询问指标、趋势或异常原因..."
        />
        <button
          aria-label="发送消息"
          className="icon-button send-button"
          type="submit"
          disabled={!input.trim() || loading}
        >
          <SendHorizontal size={18} />
        </button>
      </div>
      {voiceHint && <div className="voice-hint">{voiceHint}</div>}
    </form>
  );
}

function PlotlyPanel({ figure }: { figure: PlotlyFigure }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) return;
      const payload = createPlotlyThemePayload(figure);
      void import("plotly.js-dist-min").then(({ default: Plotly }) => {
        if (cancelled || !ref.current) return;
        void Plotly.react(ref.current, payload.data, payload.layout, payload.config);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [figure]);

  return <div className="plotly-panel" ref={ref} />;
}

export default App;
