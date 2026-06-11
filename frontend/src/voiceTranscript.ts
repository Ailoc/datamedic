export type VoiceTranscript = {
  prefix: string;
  committed: string[];
  partial: string;
};

export const createVoiceTranscript = (prefix = ""): VoiceTranscript => ({
  prefix: prefix.trim(),
  committed: [],
  partial: "",
});

export const composeVoiceTranscript = (state: VoiceTranscript) =>
  [state.prefix, ...state.committed, state.partial].map((part) => part.trim()).filter(Boolean).join(" ");

export const applyVoicePartial = (state: VoiceTranscript, text: string): VoiceTranscript => ({
  ...state,
  partial: text.trim(),
});

export const applyVoiceFinal = (state: VoiceTranscript, text: string): VoiceTranscript => {
  const sentence = text.trim();
  if (!sentence) {
    return { ...state, partial: "" };
  }
  if (state.committed.at(-1) === sentence) {
    return { ...state, partial: "" };
  }
  return {
    ...state,
    committed: [...state.committed, sentence],
    partial: "",
  };
};

export const finalizeVoiceTranscript = (state: VoiceTranscript): VoiceTranscript => {
  const trailing = state.partial.trim();
  if (!trailing) {
    return { ...state, partial: "" };
  }
  if (state.committed.at(-1) === trailing) {
    return { ...state, partial: "" };
  }
  return {
    ...state,
    committed: [...state.committed, trailing],
    partial: "",
  };
};

/**
 * Decide how to seed the next voice-recognition session based on what the
 * user has in the composer right now.
 *
 * - If the user manually typed or edited text since the last voice output,
 *   preserve their work as the prefix and append new dictation to it.
 * - Otherwise (the input consists purely of previous voice output), clear
 *   the composer so the new voice session starts fresh.
 */
export const resolveVoiceSessionPrefix = (
  inputSnapshot: string,
  manualEdited: boolean,
): { prefix: string; clearInput: boolean } => {
  if (manualEdited) {
    return { prefix: inputSnapshot.trim(), clearInput: false };
  }
  return { prefix: "", clearInput: true };
};
