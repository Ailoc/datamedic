import { describe, expect, it } from "vitest";
import { extractSpeakableSegments, mergeShortSpeechSegments } from "./speechSegments";

describe("extractSpeakableSegments", () => {
  it("splits at strong punctuation and keeps the trailing draft", () => {
    const result = extractSpeakableSegments("第一句。第二句", false);

    expect(result.segments).toEqual(["第一句。"]);
    expect(result.remaining).toBe("第二句");
  });

  it("flushes the remaining text when requested", () => {
    const result = extractSpeakableSegments("还没结束", true);

    expect(result.segments).toEqual(["还没结束"]);
    expect(result.remaining).toBe("");
  });

  it("waits for longer clauses before soft punctuation breaks", () => {
    const shortClause = "这是一个较短的从句，下一句";
    const result = extractSpeakableSegments(shortClause, false);

    expect(result.segments).toEqual([]);
    expect(result.remaining).toBe(shortClause);
  });
});

describe("mergeShortSpeechSegments", () => {
  it("merges short fragments to reduce choppy playback", () => {
    expect(mergeShortSpeechSegments(["好的", "我们继续分析下一段内容"])).toEqual([
      "好的我们继续分析下一段内容",
    ]);
  });
});
