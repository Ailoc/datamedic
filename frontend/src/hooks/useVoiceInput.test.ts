import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useVoiceInput } from "./useVoiceInput";

const speechRecognizerMock = vi.hoisted(() => vi.fn());

vi.mock("../voice", () => ({
  SpeechRecognizer: speechRecognizerMock,
}));

type MockSpeechCallbacks = {
  onError: (message: string) => void;
  onText: (text: string, isFinal: boolean) => void;
};

describe("useVoiceInput", () => {
  beforeEach(() => {
    speechRecognizerMock.mockReset();
    speechRecognizerMock.mockImplementation(() => ({
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
    }));
  });

  describe("basic recording lifecycle", () => {
    it("starts recording and sets the voice hint on toggle", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      act(() => {
        void result.current.toggleVoice();
      });

      await waitFor(() => {
        expect(result.current.recording).toBe(true);
      });
      expect(result.current.voiceHint).toBe("正在聆听");
    });

    it("stops recording on toggle when already recording", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      act(() => {
        void result.current.toggleVoice();
      });
      await waitFor(() => {
        expect(result.current.recording).toBe(true);
      });

      act(() => {
        void result.current.toggleVoice();
      });

      await waitFor(() => {
        expect(result.current.recording).toBe(false);
      });
    });
  });

  describe("text accumulation", () => {
    it("fills the composer with partial recognition text", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      act(() => {
        void result.current.toggleVoice();
      });
      const cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;

      act(() => {
        cb.onText("今天门诊量", false);
      });

      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量");
      });
    });

    it("commits final sentences and keeps composing", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      act(() => {
        void result.current.toggleVoice();
      });
      const cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;

      act(() => {
        cb.onText("今天门诊量是多少", true);
      });

      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量是多少");
      });

      act(() => {
        cb.onText("和住院人数", false);
      });

      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量是多少 和住院人数");
      });
    });
  });

  describe("session isolation", () => {
    it("ignores late callbacks from a previous voice session", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      act(() => {
        void result.current.toggleVoice();
      });
      const firstCallbacks = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;

      act(() => {
        result.current.stopVoiceInput();
      });

      act(() => {
        void result.current.toggleVoice();
      });
      const secondCallbacks = speechRecognizerMock.mock.calls[1][0] as MockSpeechCallbacks;

      act(() => {
        firstCallbacks.onText("旧会话内容", true);
        secondCallbacks.onText("新会话内容", true);
      });

      await waitFor(() => {
        expect(result.current.input).toBe("新会话内容");
      });
    });
  });

  describe("manual edit during recording", () => {
    it("absorbs user edit as prefix and resumes dictation on next ASR result", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      act(() => {
        void result.current.toggleVoice();
      });
      const cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;

      // Voice fills first sentence.
      act(() => {
        cb.onText("今天门诊量是多少", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量是多少");
      });

      // User manually deletes "是多少" while mic stays on.
      act(() => {
        result.current.markManualInput("今天门诊量");
        result.current.setInput("今天门诊量");
      });
      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量");
      });

      // User continues speaking — the edit becomes the new prefix.
      act(() => {
        cb.onText("和出院人数", true);
      });

      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量 和出院人数");
      });
    });

    it("preserves user edit when stopping while recording", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      act(() => {
        void result.current.toggleVoice();
      });
      const cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;

      act(() => {
        cb.onText("今天门诊量是多少", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量是多少");
      });

      // Edit while recording.
      act(() => {
        result.current.markManualInput("今天门诊量");
        result.current.setInput("今天门诊量");
      });

      // Stop while recording.
      act(() => {
        result.current.stopVoiceInput();
      });

      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量");
      });
    });
  });

  describe("manual edit between sessions", () => {
    it("preserves purely typed text on first-ever mic press (no prior voice session)", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      // User types text manually — no voice session before this.
      act(() => {
        result.current.markManualInput("我想查询门诊数据");
        result.current.setInput("我想查询门诊数据");
      });
      await waitFor(() => {
        expect(result.current.input).toBe("我想查询门诊数据");
      });

      // User clicks the mic button for the first time.
      // The typed text MUST NOT be cleared.
      act(() => {
        void result.current.toggleVoice();
      });

      await waitFor(() => {
        expect(result.current.input).toBe("我想查询门诊数据");
      });
    });

    it("appends voice result after purely typed text on first mic press", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      // User types text manually.
      act(() => {
        result.current.markManualInput("我想查询");
        result.current.setInput("我想查询");
      });
      await waitFor(() => {
        expect(result.current.input).toBe("我想查询");
      });

      // User clicks mic.
      act(() => {
        void result.current.toggleVoice();
      });

      // Input should still be "我想查询".
      await waitFor(() => {
        expect(result.current.input).toBe("我想查询");
      });

      // Voice result arrives — should append.
      const cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
      act(() => {
        cb.onText("门诊数据", false);
      });

      await waitFor(() => {
        expect(result.current.input).toBe("我想查询 门诊数据");
      });
    });

    it("keeps user-typed text as prefix for the next voice session", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      // Session 1: voice fills text.
      act(() => {
        void result.current.toggleVoice();
      });
      const cb1 = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
      act(() => {
        cb1.onText("今天门诊量是多少", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量是多少");
      });

      act(() => {
        result.current.stopVoiceInput();
      });

      // User deletes "是多少".
      act(() => {
        result.current.markManualInput("今天门诊量");
        result.current.setInput("今天门诊量");
      });
      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量");
      });

      // Session 2: new voice result should append to "今天门诊量".
      act(() => {
        void result.current.toggleVoice();
      });
      const cb2 = speechRecognizerMock.mock.calls[1][0] as MockSpeechCallbacks;

      act(() => {
        cb2.onText("和出院人数", false);
      });

      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量 和出院人数");
      });
    });

    it("appends voice result to completely empty editor after user deleted everything", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      act(() => {
        void result.current.toggleVoice();
      });
      const cb1 = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
      act(() => {
        cb1.onText("今天门诊量是多少", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量是多少");
      });
      act(() => {
        result.current.stopVoiceInput();
      });

      // User deletes ALL text.
      act(() => {
        result.current.markManualInput("");
        result.current.setInput("");
      });
      await waitFor(() => {
        expect(result.current.input).toBe("");
      });

      // Session 2: new voice fills fresh (no prefix).
      act(() => {
        void result.current.toggleVoice();
      });
      const cb2 = speechRecognizerMock.mock.calls[1][0] as MockSpeechCallbacks;

      act(() => {
        cb2.onText("查住院人数", false);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("查住院人数");
      });
    });
  });

  describe("consecutive voice sessions without manual edit", () => {
    it("preserves previous voice output as prefix when starting new session without editing", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      // Session 1.
      act(() => {
        void result.current.toggleVoice();
      });
      const cb1 = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
      act(() => {
        cb1.onText("今天门诊量是多少", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量是多少");
      });
      act(() => {
        result.current.stopVoiceInput();
      });

      // Session 2 — no manual edit → previous output is preserved as prefix.
      act(() => {
        void result.current.toggleVoice();
      });

      // Previous voice text is kept (not cleared).
      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量是多少");
      });

      const cb2 = speechRecognizerMock.mock.calls[1][0] as MockSpeechCallbacks;
      act(() => {
        cb2.onText("查住院人数", false);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("今天门诊量是多少 查住院人数");
      });
    });
  });

  describe("multiple voice + edit cycles", () => {
    it("correctly handles alternating voice-then-edit cycles", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      // Cycle 1: Voice "A B C", then delete C.
      act(() => {
        void result.current.toggleVoice();
      });
      let cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
      act(() => {
        cb.onText("A B C", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("A B C");
      });
      act(() => {
        result.current.stopVoiceInput();
      });

      act(() => {
        result.current.markManualInput("A B");
        result.current.setInput("A B");
      });
      await waitFor(() => {
        expect(result.current.input).toBe("A B");
      });

      // Cycle 2: Append "D" via voice.
      act(() => {
        void result.current.toggleVoice();
      });
      cb = speechRecognizerMock.mock.calls[1][0] as MockSpeechCallbacks;
      act(() => {
        cb.onText("D", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("A B D");
      });
      act(() => {
        result.current.stopVoiceInput();
      });

      // Now delete "D", type "E".
      act(() => {
        result.current.markManualInput("A B E");
        result.current.setInput("A B E");
      });
      await waitFor(() => {
        expect(result.current.input).toBe("A B E");
      });

      // Cycle 3: Append "F G" via voice.
      act(() => {
        void result.current.toggleVoice();
      });
      cb = speechRecognizerMock.mock.calls[2][0] as MockSpeechCallbacks;
      act(() => {
        cb.onText("F", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("A B E F");
      });
      act(() => {
        cb.onText("G", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("A B E F G");
      });
    });
  });

  describe("error handling", () => {
    it("stops recording and shows error hint when connection fails", async () => {
      speechRecognizerMock.mockImplementation(() => ({
        start: vi.fn(() => Promise.reject(new Error("连接失败"))),
        stop: vi.fn(),
      }));

      const { result } = renderHook(() => {
        const [input, setInput] = useState("分析");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      // Simulate the real flow: user typed text, then clicks mic.
      act(() => {
        result.current.markManualInput("分析");
      });

      await act(async () => {
        await result.current.toggleVoice();
      });

      await waitFor(() => {
        expect(result.current.recording).toBe(false);
      });
      expect(result.current.voiceHint).toBe("无法使用麦克风");
      // User-typed prefix should be preserved even on error.
      expect(result.current.input).toBe("分析");
    });

    it("shows runtime error hint and stops recording", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      act(() => {
        void result.current.toggleVoice();
      });
      const cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;

      act(() => {
        cb.onError("语音识别服务异常");
      });

      await waitFor(() => {
        expect(result.current.recording).toBe(false);
      });
      expect(result.current.voiceHint).toBe("语音识别服务异常");
    });
  });

  describe("resetComposeState", () => {
    it("resets manual-edited flag without clearing input on next session", async () => {
      const { result } = renderHook(() => {
        const [input, setInput] = useState("");
        const voice = useVoiceInput({ input, setInput });
        return { input, setInput, ...voice };
      });

      // Voice fills text.
      act(() => {
        void result.current.toggleVoice();
      });
      const cb = speechRecognizerMock.mock.calls[0][0] as MockSpeechCallbacks;
      act(() => {
        cb.onText("查询门诊量", true);
      });
      await waitFor(() => {
        expect(result.current.input).toBe("查询门诊量");
      });

      act(() => {
        result.current.markManualInput("查询门诊量");
      });

      // stopVoiceInput with resetComposeState.
      act(() => {
        result.current.stopVoiceInput({ resetComposeState: true });
      });

      // Next session: input is preserved (no automatic clearing).
      act(() => {
        void result.current.toggleVoice();
      });

      await waitFor(() => {
        expect(result.current.input).toBe("查询门诊量");
      });
    });
  });
});
