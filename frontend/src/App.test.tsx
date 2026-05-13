import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { STORAGE_KEY } from "./storage";

type MockSpeechCallbacks = {
  onError: (message: string) => void;
  onText: (text: string, isFinal: boolean) => void;
};

const { plotlyReactMock, speechPlayerMock, speechRecognizerMock, streamChatMessageMock } = vi.hoisted(
  () => ({
    plotlyReactMock: vi.fn(() => Promise.resolve()),
    speechPlayerMock: vi.fn(),
    speechRecognizerMock: vi.fn(),
    streamChatMessageMock: vi.fn(),
  }),
);

vi.mock("./api", () => ({
  streamChatMessage: streamChatMessageMock,
}));

vi.mock("plotly.js-dist-min", () => ({
  default: {
    purge: vi.fn(),
    react: plotlyReactMock,
  },
}));

vi.mock("./voice", () => ({
  SpeechPlayer: speechPlayerMock,
  SpeechRecognizer: speechRecognizerMock,
}));

describe("DataMedic app shell", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("renders a branded conversation workspace", () => {
    render(<App />);

    expect(screen.getByText("DataMedic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建会话" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "消息输入" })).toBeInTheDocument();
  });

  it("creates conversations and requires confirmation before deleting one", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "新建会话" }));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(saved.conversations).toHaveLength(2);

    const sessionList = screen.getByRole("list", { name: "会话列表" });
    const firstSession = within(sessionList).getAllByRole("listitem")[0];
    const sessionButton = within(firstSession).getByRole("button", {
      name: /切换到/,
    });
    expect(within(sessionButton).queryByRole("button", { name: /删除会话/ })).not.toBeInTheDocument();

    await user.click(within(firstSession).getByRole("button", { name: /删除会话/ }));

    expect(within(firstSession).getByRole("button", { name: /确认删除/ })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").conversations).toHaveLength(2);

    await user.click(within(firstSession).getByRole("button", { name: /确认删除/ }));

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").conversations).toHaveLength(1);
  });

  it("keeps the voice control before the text input inside the composer", () => {
    render(<App />);

    const composer = screen.getByRole("form", { name: "消息发送区" });
    const controls = within(composer)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(controls[0]).toBe("语音输入");
  });

  it("appends final voice segments instead of replacing previous dictation", async () => {
    const user = userEvent.setup();
    render(<App />);

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

    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "分析");
    await user.click(screen.getByRole("button", { name: "语音输入" }));

    const callbacks = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
    act(() => {
      callbacks.onText("门诊趋势", true);
    });

    expect(screen.getByRole("textbox", { name: "消息输入" })).toHaveValue("分析 门诊趋势");
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

    await user.click(screen.getByRole("button", { name: "开启语音输出" }));
    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "继续分析");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledWith("第一句。"));
    resolveStream({ ok: true, text: "第一句。第二句", figures: [] });
  });

  it("updates the assistant message from streamed deltas", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "分析门诊趋势");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    const thread = screen.getByRole("region", { name: "对话内容" });
    expect(await within(thread).findByText("已完成分析")).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(saved.conversations[0].messages.at(-1).text).toBe("已完成分析");
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

    await user.type(screen.getByRole("textbox", { name: "消息输入" }), "展示表格");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());
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
});
