import { describe, expect, it } from "vitest";
import { extractSpeakableSegments } from "./speechSegments";

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
});
