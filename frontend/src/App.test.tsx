import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type MockSpeechCallbacks = {
  onError: (message: string) => void;
  onText: (text: string, isFinal: boolean) => void;
};

const {
  createBackendSessionMock,
  deleteBackendSessionMock,
  fetchSessionsMock,
  loadPlotlyMock,
  plotlyPurgeMock,
  plotlyReactMock,
  speechPlayerMock,
  speechRecognizerMock,
  streamChatMessageMock,
} = vi.hoisted(
  () => {
    const plotlyReact = vi.fn(() => Promise.resolve());
    const plotlyPurge = vi.fn();
    return {
      createBackendSessionMock: vi.fn(),
      deleteBackendSessionMock: vi.fn(),
      fetchSessionsMock: vi.fn(),
      loadPlotlyMock: vi.fn(() =>
        Promise.resolve({
          purge: plotlyPurge,
          react: plotlyReact,
        }),
      ),
      plotlyPurgeMock: plotlyPurge,
      plotlyReactMock: plotlyReact,
      speechPlayerMock: vi.fn(),
      speechRecognizerMock: vi.fn(),
      streamChatMessageMock: vi.fn(),
    };
  },
);

vi.mock("./api", () => ({
  BACKEND_CONNECTION_ERROR: "无法连接到后端服务，请确认 FastAPI 已启动。",
  isNonEmptyDelta: (accumulated: string, delta: string) => accumulated.trim() || delta.trim(),
  createBackendSession: createBackendSessionMock,
  deleteBackendSession: deleteBackendSessionMock,
  fetchSession: vi.fn(),
  fetchSessions: fetchSessionsMock,
  streamChatMessage: streamChatMessageMock,
}));

vi.mock("./plotly", () => ({
  loadPlotly: loadPlotlyMock,
  default: {
    purge: plotlyPurgeMock,
    react: plotlyReactMock,
  },
}));

vi.mock("./voice", () => ({
  SpeechPlayer: speechPlayerMock,
  SpeechRecognizer: speechRecognizerMock,
}));

const DEFAULT_SESSION = {
  id: "default-session",
  title: "新的运营问答",
  summary: "还没有消息",
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
  messages: [],
};

describe("DataMedic app shell", () => {
  beforeEach(() => {
    fetchSessionsMock.mockReset();
    fetchSessionsMock.mockResolvedValue([DEFAULT_SESSION]);
    createBackendSessionMock.mockReset();
    createBackendSessionMock.mockResolvedValue({
      id: "backend-new",
      title: "新的运营问答",
      summary: "还没有消息",
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      messages: [],
    });
    deleteBackendSessionMock.mockReset();
    deleteBackendSessionMock.mockResolvedValue(undefined);
    loadPlotlyMock.mockClear();
    plotlyPurgeMock.mockClear();
    plotlyReactMock.mockClear();
    speechPlayerMock.mockReset();
    speechPlayerMock.mockImplementation(() => ({
      destroy: vi.fn(),
      enqueue: vi.fn(() => Promise.resolve()),
      unlock: vi.fn(() => Promise.resolve()),
      play: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
    }));
    speechRecognizerMock.mockReset();
    speechRecognizerMock.mockImplementation(() => ({
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
    }));
    streamChatMessageMock.mockReset();
    streamChatMessageMock.mockImplementation(
      async (_sessionId: string, _message: string, options = {}) => {
        const callbacks = options as { onDelta?: (text: string) => void };
        callbacks.onDelta?.("已完成");
        callbacks.onDelta?.("分析");
        return { ok: true, text: "已完成分析", figures: [] };
      },
    );
  });

  it("renders a branded conversation workspace", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(fetchSessionsMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("DataMedic")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "新建会话" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "消息输入" })).toBeInTheDocument();
  });

  it("hydrates conversations from the backend when sessions are available", async () => {
    fetchSessionsMock.mockResolvedValueOnce([
      {
        id: "backend-1",
        title: "后端会话",
        summary: "已恢复",
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            text: "历史回答",
            figures: [{ data: [{ type: "bar" }], layout: { title: "历史图表" } }],
            createdAt: "2026-05-15T00:00:00.000Z",
          },
        ],
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "后端会话" })).toBeInTheDocument();
    expect(screen.getByText("历史回答")).toBeInTheDocument();
    expect(fetchSessionsMock).toHaveBeenCalled();
  });

  it("creates conversations and requires confirmation before deleting one", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("DataMedic");
    await user.click(screen.getByRole("button", { name: "新建会话" }));
    await waitFor(() => expect(createBackendSessionMock).toHaveBeenCalled());

    const sessionList = screen.getByRole("list", { name: "会话列表" });
    expect(within(sessionList).getAllByRole("listitem")).toHaveLength(2);

    const firstSession = within(sessionList).getAllByRole("listitem")[0];
    const sessionButton = within(firstSession).getByRole("button", {
      name: /切换到/,
    });
    expect(within(sessionButton).queryByRole("button", { name: /删除会话/ })).not.toBeInTheDocument();

    await user.click(within(firstSession).getByRole("button", { name: /删除会话/ }));

    expect(within(firstSession).getByRole("button", { name: /确认删除/ })).toBeInTheDocument();
    expect(within(sessionList).getAllByRole("listitem")).toHaveLength(2);

    await user.click(within(firstSession).getByRole("button", { name: /确认删除/ }));
    await waitFor(() => expect(deleteBackendSessionMock).toHaveBeenCalled());

    expect(within(sessionList).getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps the voice control before the text input inside the composer", async () => {
    render(<App />);

    const composer = await screen.findByRole("form", { name: "消息发送区" });
    const controls = within(composer)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(controls[0]).toBe("语音输入");
  });

  it("appends final voice segments instead of replacing previous dictation", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("DataMedic");
    await user.click(screen.getByRole("button", { name: "语音输入" }));

    const callbacks = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
    act(() => {
      callbacks.onText("第一句", true);
      callbacks.onText("第二句", true);
    });

    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("第一句 第二句");
  });

  it("keeps typed text when voice dictation starts", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("DataMedic");
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "分析");
    await user.click(screen.getByRole("button", { name: "语音输入" }));

    const callbacks = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
    act(() => {
      callbacks.onText("门诊趋势", true);
    });

    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("分析 门诊趋势");
  });

  it("starts a fresh voice session after the previous dictation was sent", async () => {
    const user = userEvent.setup();
    const stopMock = vi.fn();
    speechRecognizerMock.mockImplementation(() => ({
      start: vi.fn(() => Promise.resolve()),
      stop: stopMock,
    }));
    render(<App />);

    await screen.findByText("DataMedic");
    await user.click(screen.getByRole("button", { name: "语音输入" }));

    let callbacks = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
    act(() => {
      callbacks.onText("查询门诊量", true);
    });
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("查询门诊量");

    await user.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue(""),
    );
    expect(stopMock).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "语音输入" }));
    callbacks = speechRecognizerMock.mock.calls[1][0] as MockSpeechCallbacks;
    act(() => {
      callbacks.onText("查询住院量", true);
    });

    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("查询住院量");
  });

  it("appends new dictation to previous voice output when mic pressed again without sending", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("DataMedic");
    await user.click(screen.getByRole("button", { name: "语音输入" }));

    let callbacks = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
    act(() => {
      callbacks.onText("第一句", true);
    });
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("第一句");

    await user.click(screen.getByRole("button", { name: "语音输入" }));
    await user.click(screen.getByRole("button", { name: "语音输入" }));

    callbacks = speechRecognizerMock.mock.calls[1][0] as MockSpeechCallbacks;
    act(() => {
      callbacks.onText("第二句", true);
    });

    // Previous voice text is preserved as prefix; new dictation appends.
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("第一句 第二句");
  });

  it("stops voice recognition resources when recognition reports an error", async () => {
    const user = userEvent.setup();
    const stopMock = vi.fn();
    speechRecognizerMock.mockImplementation(() => ({
      start: vi.fn(() => Promise.resolve()),
      stop: stopMock,
    }));

    render(<App />);

    await screen.findByText("DataMedic");
    await user.click(screen.getByRole("button", { name: "语音输入" }));
    const callbacks = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
    act(() => {
      callbacks.onError("语音连接失败");
    });

    expect(stopMock).toHaveBeenCalled();
    expect(screen.getByText("语音连接失败")).toBeInTheDocument();
  });

  it("queues completed assistant replies only when voice output is enabled", async () => {
    const user = userEvent.setup();
    const unlockMock = vi.fn(() => Promise.resolve());
    const enqueueMock = vi.fn(() => Promise.resolve());
    const playMock = vi.fn(() => Promise.resolve());
    speechPlayerMock.mockImplementation(() => ({
      destroy: vi.fn(),
      enqueue: enqueueMock,
      unlock: unlockMock,
      play: playMock,
      stop: vi.fn(),
    }));
    render(<App />);

    await screen.findByText("DataMedic");
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "分析门诊趋势");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    await within(screen.getByRole("region", { name: "对话内容" })).findByText("已完成分析");

    expect(enqueueMock).not.toHaveBeenCalled();
    expect(playMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "开启语音输出" }));
    expect(unlockMock).toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "继续分析");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledWith("已完成分析"));
    expect(playMock).not.toHaveBeenCalled();
  });

  it("queues speech as soon as stream deltas form a speakable segment", async () => {
    const user = userEvent.setup();
    const enqueueMock = vi.fn(() => Promise.resolve());
    let resolveStream: (
      value: { ok: boolean; text: string; figures: never[] },
    ) => void = () => undefined;
    speechPlayerMock.mockImplementation(() => ({
      destroy: vi.fn(),
      enqueue: enqueueMock,
      unlock: vi.fn(() => Promise.resolve()),
      play: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
    }));
    streamChatMessageMock.mockImplementationOnce(
      async (_sessionId: string, _message: string, options = {}) => {
        const callbacks = options as { onDelta?: (text: string) => void };
        callbacks.onDelta?.("第一句。");
        return new Promise((resolve) => {
          resolveStream = resolve;
        });
      },
    );

    render(<App />);

    await screen.findByText("DataMedic");
    await user.click(screen.getByRole("button", { name: "开启语音输出" }));
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "继续分析");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledWith("第一句。"));
    resolveStream({ ok: true, text: "第一句。第一句", figures: [] });
  });

  it("stops queued speech when the stream finishes with an error", async () => {
    const user = userEvent.setup();
    const enqueueMock = vi.fn(() => Promise.resolve());
    const stopMock = vi.fn();
    let resolveStream: (
      value: { ok: boolean; text: string; figures: never[] },
    ) => void = () => undefined;
    speechPlayerMock.mockImplementation(() => ({
      destroy: vi.fn(),
      enqueue: enqueueMock,
      unlock: vi.fn(() => Promise.resolve()),
      play: vi.fn(() => Promise.resolve()),
      stop: stopMock,
    }));
    streamChatMessageMock.mockImplementationOnce(
      async (_sessionId: string, _message: string, options = {}) => {
        const callbacks = options as { onDelta?: (text: string) => void };
        callbacks.onDelta?.("第一句。");
        return new Promise((resolve) => {
          resolveStream = resolve;
        });
      },
    );

    render(<App />);

    await screen.findByText("DataMedic");
    await user.click(screen.getByRole("button", { name: "开启语音输出" }));
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "继续分析");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(enqueueMock).toHaveBeenCalledWith("第一句。"));
    stopMock.mockClear();

    await act(async () => {
      resolveStream({ ok: false, text: "模型服务异常", figures: [] });
    });

    expect(stopMock).toHaveBeenCalled();
  });

  it("updates the assistant message from streamed deltas", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("DataMedic");
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "分析门诊趋势");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    const thread = screen.getByRole("region", { name: "对话内容" });
    expect(await within(thread).findByText("已完成分析")).toBeInTheDocument();
  });

  it("does not render a blank assistant bubble while only whitespace has streamed", async () => {
    const user = userEvent.setup();
    let resolveStream: (
      value: { ok: boolean; text: string; figures: never[] },
    ) => void = () => undefined;
    streamChatMessageMock.mockImplementationOnce(
      async (_sessionId: string, _message: string, options = {}) => {
        const callbacks = options as { onDelta?: (text: string) => void };
        callbacks.onDelta?.("   ");
        return new Promise((resolve) => {
          resolveStream = resolve;
        });
      },
    );

    const { container } = render(<App />);

    await screen.findByText("DataMedic");
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "分析门诊趋势");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    const thread = screen.getByRole("region", { name: "对话内容" });
    await within(thread).findByText("正在分析");
    expect(container.querySelector(".message-list .message.assistant")).toBeNull();

    await act(async () => {
      resolveStream({ ok: true, text: "分析完成", figures: [] });
    });

    expect(await within(thread).findByText("分析完成")).toBeInTheDocument();
  });

  it("shows the assistant avatar while the model is thinking", async () => {
    const user = userEvent.setup();
    let resolveStream: (
      value: { ok: boolean; text: string; figures: never[] },
    ) => void = () => undefined;
    streamChatMessageMock.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        }),
    );

    const { container } = render(<App />);

    await screen.findByText("DataMedic");
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "分析门诊趋势");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    const thinkingMessage = container.querySelector(".thinking-message");
    expect(thinkingMessage).not.toBeNull();
    expect(thinkingMessage?.querySelector(".avatar svg")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "对话内容" })).getByText("正在分析")).toBeInTheDocument();

    await act(async () => {
      resolveStream({ ok: true, text: "分析完成", figures: [] });
    });
  });

  it("keeps conversations created while a stream is still pending", async () => {
    const user = userEvent.setup();
    let resolveStream: (
      value: { ok: boolean; text: string; figures: never[] },
    ) => void = () => undefined;
    streamChatMessageMock.mockImplementationOnce(
      async (_sessionId: string, _message: string, options = {}) => {
        const callbacks = options as { onDelta?: (text: string) => void };
        callbacks.onDelta?.("处理中");
        return new Promise((resolve) => {
          resolveStream = resolve;
        });
      },
    );

    render(<App />);

    await screen.findByText("DataMedic");
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "分析门诊趋势");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    await within(screen.getByRole("region", { name: "对话内容" })).findByText("处理中");

    await user.click(screen.getByRole("button", { name: "新建会话" }));
    await waitFor(() => expect(createBackendSessionMock).toHaveBeenCalled());

    const sessionList = screen.getByRole("list", { name: "会话列表" });
    expect(within(sessionList).getAllByRole("listitem")).toHaveLength(2);

    await act(async () => {
      resolveStream({ ok: true, text: "处理完成", figures: [] });
    });

    expect(within(sessionList).getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders Plotly figures with an immersive transparent theme", async () => {
    const user = userEvent.setup();
    streamChatMessageMock.mockImplementationOnce(
      async (_sessionId: string, _message: string, options = {}) => {
        const callbacks = options as { onDelta?: (text: string) => void };
        callbacks.onDelta?.("已生成");
        return {
          ok: true,
          text: "已生成图表",
          figures: [
            {
              data: [
                { type: "scatter", name: "趋势" },
                {
                  type: "table",
                  header: { fill: { color: "#ffffff" }, values: [["科室"], ["数值"]] },
                  cells: { fill: { color: "#ffffff" }, values: [["心内科"], [120]] },
                },
              ],
              layout: {
                paper_bgcolor: "#ffffff",
                plot_bgcolor: "#ffffff",
                title: "运营指标",
              },
            },
          ],
        };
      },
    );

    render(<App />);

    await screen.findByText("DataMedic");
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "展示表格");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());
    expect(loadPlotlyMock).toHaveBeenCalledOnce();
    const [, data, layout, config] = plotlyReactMock.mock.calls[0];
    const tableTrace = (data as Array<Record<string, unknown>>)[1] as {
      cells: { fill: { color: string }; font: { color: string } };
      header: { fill: { color: string }; font: { color: string } };
    };

    expect(layout).toMatchObject({
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#26211c" },
      title: "运营指标",
    });
    expect(tableTrace.header.fill.color).toBe("rgba(47, 117, 106, 0.12)");
    expect(tableTrace.cells.fill.color).toBe("rgba(255, 253, 248, 0.34)");
    expect(config).toMatchObject({
      displayModeBar: false,
      responsive: true,
    });
  });

  it("absorbs manual edit during continuous recording and resumes dictation on next ASR result", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("DataMedic");

    // Step 1: Start recording.
    await user.click(screen.getByRole("button", { name: "语音输入" }));
    expect(screen.getByRole("button", { name: "语音输入" })).toHaveClass("is-recording");

    // Step 2: Voice fills first sentence.
    const cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
    act(() => {
      cb.onText("今天门诊量是多少", true);
    });
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("今天门诊量是多少");

    // Step 3: User manually deletes "是多少" while recording stays on.
    // This triggers Composer.onChange → App.onInput → markManualInput → setInput.
    const textarea = screen.getByRole("textbox", { name: "消息输入" });
    await user.clear(textarea);
    await user.type(textarea, "今天门诊量");
    expect(textarea).toHaveValue("今天门诊量");

    // Step 4: User continues speaking — edit becomes the new prefix.
    act(() => {
      cb.onText("和出院人数", true);
    });

    // The deleted "是多少" should NOT reappear.
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("今天门诊量 和出院人数");
  });

  it("appends new dictation to partially-edited voice text without reverting the edit", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("DataMedic");

    // Voice fills text.
    await user.click(screen.getByRole("button", { name: "语音输入" }));
    const cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
    act(() => {
      cb.onText("查询住院人数和门诊人数", true);
    });
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("查询住院人数和门诊人数");

    // User deletes "和门诊人数".
    const textarea = screen.getByRole("textbox", { name: "消息输入" });
    await user.clear(textarea);
    await user.type(textarea, "查询住院人数");
    expect(textarea).toHaveValue("查询住院人数");

    // Multiple ASR results arrive while recording stays on.
    act(() => {
      cb.onText("以及手术人数", false);
    });
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("查询住院人数 以及手术人数");

    act(() => {
      cb.onText("以及手术人数和出院人数", true);
    });
    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("查询住院人数 以及手术人数和出院人数");
  });

  it("purges Plotly figures when chart panels unmount", async () => {
    const user = userEvent.setup();
    streamChatMessageMock.mockImplementationOnce(
      async (_sessionId: string, _message: string, options = {}) => {
        const callbacks = options as { onDelta?: (text: string) => void };
        callbacks.onDelta?.("已生成");
        return {
          ok: true,
          text: "已生成图表",
          figures: [
            {
              data: [{ type: "scatter", name: "趋势" }],
              layout: { title: "运营指标" },
            },
          ],
        };
      },
    );

    const { unmount } = render(<App />);

    await screen.findByText("DataMedic");
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "展示趋势");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());

    unmount();

    await waitFor(() => expect(plotlyPurgeMock).toHaveBeenCalled());
  });
});
