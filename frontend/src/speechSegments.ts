const strongSpeechBreaks = new Set(["。", "！", "？", "!", "?", "；", ";", "\n"]);
const softSpeechBreaks = new Set(["，", ",", "、", "：", ":"]);
const minSoftSpeechSegmentLength = 36;
const minSpeakableSegmentLength = 10;

export const compactSpeechText = (text: string) => text.replace(/\s+/g, " ").trim();

const isStrongBreak = (character: string) => strongSpeechBreaks.has(character);
const isSoftBreak = (character: string) => softSpeechBreaks.has(character);

const pushSegment = (segments: string[], text: string) => {
  const content = compactSpeechText(text);
  if (content.length >= minSpeakableSegmentLength) {
    segments.push(content);
    return "";
  }
  return content;
};

export const extractSpeakableSegments = (buffer: string, flush = false) => {
  const segments: string[] = [];
  let segmentStart = 0;
  let pendingShort = "";

  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index];
    const candidate = compactSpeechText(buffer.slice(segmentStart, index + 1));
    const canBreakAtSoftPunctuation =
      isSoftBreak(character) && candidate.length >= minSoftSpeechSegmentLength;

    if (isStrongBreak(character)) {
      const merged = compactSpeechText(`${pendingShort}${candidate}`);
      if (merged) {
        segments.push(merged);
      }
      pendingShort = "";
      segmentStart = index + 1;
      continue;
    }

    if (canBreakAtSoftPunctuation) {
      pendingShort = pushSegment(segments, compactSpeechText(`${pendingShort}${candidate}`));
      segmentStart = index + 1;
    }
  }

  let remaining = buffer.slice(segmentStart);
  if (pendingShort) {
    remaining = `${pendingShort}${remaining}`;
  }

  if (flush) {
    const tail = compactSpeechText(remaining);
    if (tail) {
      segments.push(tail);
    }
    return { remaining: "", segments };
  }

  return { remaining, segments };
};

export const mergeShortSpeechSegments = (segments: string[]) => {
  if (segments.length <= 1) {
    return segments;
  }
  const merged: string[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && previous.length < minSpeakableSegmentLength) {
      merged[merged.length - 1] = compactSpeechText(`${previous}${segment}`);
      continue;
    }
    merged.push(segment);
  }
  return merged;
};
