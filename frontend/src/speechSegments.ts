const strongSpeechBreaks = new Set(["。", "！", "？", "!", "?", "；", ";"]);
const softSpeechBreaks = new Set(["，", ",", "、", "：", ":"]);
const minSoftSpeechSegmentLength = 22;

export const compactSpeechText = (text: string) => text.replace(/\s+/g, " ").trim();

export const extractSpeakableSegments = (buffer: string, flush = false) => {
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
