import { describe, expect, it } from "vitest";

import {
  applyVoiceFinal,
  applyVoicePartial,
  composeVoiceTranscript,
  createVoiceTranscript,
  finalizeVoiceTranscript,
  resolveVoiceSessionPrefix,
} from "./voiceTranscript";

describe("voiceTranscript", () => {
  describe("createVoiceTranscript", () => {
    it("starts with empty prefix, zero committed sentences, and empty partial", () => {
      const state = createVoiceTranscript();
      expect(state).toEqual({ prefix: "", committed: [], partial: "" });
    });

    it("preserves the given prefix", () => {
      const state = createVoiceTranscript("分析");
      expect(state.prefix).toBe("分析");
    });

    it("trims whitespace from the prefix", () => {
      const state = createVoiceTranscript("  分析  ");
      expect(state.prefix).toBe("分析");
    });
  });

  describe("applyVoicePartial", () => {
    it("replaces the current partial text instead of appending", () => {
      let state = createVoiceTranscript();
      state = applyVoicePartial(state, "查");
      state = applyVoicePartial(state, "查询");
      expect(composeVoiceTranscript(state)).toBe("查询");
    });

    it("places partial text after the prefix", () => {
      let state = createVoiceTranscript("分析");
      state = applyVoicePartial(state, "门诊");
      expect(composeVoiceTranscript(state)).toBe("分析 门诊");
    });

    it("replaces the partial while keeping committed sentences", () => {
      let state = createVoiceTranscript();
      state = applyVoiceFinal(state, "第一句");
      state = applyVoicePartial(state, "正在说第二");
      state = applyVoicePartial(state, "正在说第二句");
      expect(composeVoiceTranscript(state)).toBe("第一句 正在说第二句");
    });
  });

  describe("applyVoiceFinal", () => {
    it("commits a sentence and clears partial", () => {
      let state = createVoiceTranscript();
      state = applyVoiceFinal(state, "第一句");
      expect(state.committed).toEqual(["第一句"]);
      expect(state.partial).toBe("");
    });

    it("commits multiple sentences independently", () => {
      let state = createVoiceTranscript();
      state = applyVoiceFinal(state, "第一句");
      state = applyVoiceFinal(state, "第二句");
      expect(state.committed).toEqual(["第一句", "第二句"]);
      expect(composeVoiceTranscript(state)).toBe("第一句 第二句");
    });

    it("deduplicates when the same sentence arrives twice", () => {
      let state = createVoiceTranscript();
      state = applyVoiceFinal(state, "你好");
      state = applyVoiceFinal(state, "你好");
      expect(state.committed).toEqual(["你好"]);
    });

    it("clears partial when an empty final text arrives", () => {
      let state = applyVoicePartial(createVoiceTranscript(), "something");
      state = applyVoiceFinal(state, "");
      expect(state.partial).toBe("");
    });

    it("appends final text after the prefix and previous commits", () => {
      let state = createVoiceTranscript("分析");
      state = applyVoiceFinal(state, "门诊趋势");
      expect(composeVoiceTranscript(state)).toBe("分析 门诊趋势");
    });
  });

  describe("finalizeVoiceTranscript", () => {
    it("commits lingering partial text when recording stops", () => {
      let state = applyVoicePartial(createVoiceTranscript(), "还没结束的句子");
      state = finalizeVoiceTranscript(state);
      expect(composeVoiceTranscript(state)).toBe("还没结束的句子");
    });

    it("does not duplicate a partial that already matches the last commit", () => {
      let state = createVoiceTranscript();
      state = applyVoiceFinal(state, "完成了。");
      state = applyVoicePartial(state, "完成了。");
      state = finalizeVoiceTranscript(state);
      expect(state.committed).toEqual(["完成了。"]);
    });

    it("leaves state unchanged when partial is empty", () => {
      const state = createVoiceTranscript();
      const finalised = finalizeVoiceTranscript(state);
      expect(finalised).toEqual(state);
    });
  });

  describe("composeVoiceTranscript", () => {
    it("renders prefix followed by committed sentences and partial", () => {
      const state: Parameters<typeof composeVoiceTranscript>[0] = {
        prefix: "分析",
        committed: ["门诊趋势", "住院人数"],
        partial: "和",
      };
      expect(composeVoiceTranscript(state)).toBe("分析 门诊趋势 住院人数 和");
    });

    it("skips empty parts", () => {
      const state: Parameters<typeof composeVoiceTranscript>[0] = {
        prefix: "",
        committed: ["第一句", ""],
        partial: "",
      };
      expect(composeVoiceTranscript(state)).toBe("第一句");
    });
  });

  describe("resolveVoiceSessionPrefix", () => {
    // --- User manually edited ---

    it("keeps user-typed text as the prefix when manualEdited is true", () => {
      const resolved = resolveVoiceSessionPrefix("我今天想查", true);
      expect(resolved).toEqual({ prefix: "我今天想查", clearInput: false });
    });

    it("preserves user edits even when input is identical to what voice produced", () => {
      // The user may have typed the exact same text — still treat as manual.
      const resolved = resolveVoiceSessionPrefix("查询门诊量", true);
      expect(resolved).toEqual({ prefix: "查询门诊量", clearInput: false });
    });

    it("preserves empty input as empty prefix when user edited", () => {
      // User deleted everything.
      const resolved = resolveVoiceSessionPrefix("", true);
      expect(resolved).toEqual({ prefix: "", clearInput: false });
    });

    it("preserves whitespace-only input as empty prefix when user edited", () => {
      const resolved = resolveVoiceSessionPrefix("   ", true);
      expect(resolved).toEqual({ prefix: "", clearInput: false });
    });

    // --- Pure voice output (not manually touched) ---

    it("clears input when the composer only contains previous voice output", () => {
      const resolved = resolveVoiceSessionPrefix("查询门诊量", false);
      expect(resolved).toEqual({ prefix: "", clearInput: true });
    });

    it("clears input when the composer is empty and not edited", () => {
      const resolved = resolveVoiceSessionPrefix("", false);
      expect(resolved).toEqual({ prefix: "", clearInput: true });
    });
  });
});
