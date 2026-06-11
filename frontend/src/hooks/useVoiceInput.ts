import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { SpeechRecognizer } from "../voice";
import {
  applyVoiceFinal,
  applyVoicePartial,
  composeVoiceTranscript,
  createVoiceTranscript,
  finalizeVoiceTranscript,
  type VoiceTranscript,
} from "../voiceTranscript";

type UseVoiceInputParams = {
  input: string;
  setInput: (value: string) => void;
};

/**
 * Manages the full lifecycle of push-to-talk voice dictation.
 *
 * Design decisions:
 * - `inputRef` is synced in the render phase (not inside useEffect) so it
 *   is never one frame behind when `toggleVoice` reads it.
 * - `manualEditedRef` is the single source of truth for whether the user
 *   has typed since the last voice output.  It alone drives
 *   `resolveVoiceSessionPrefix` – no fragile text-comparison heuristics.
 * - `voiceSessionIdRef` is a monotonic counter that invalidates stale
 *   callbacks from recognisers that belong to earlier sessions.
 */
export function useVoiceInput({ input, setInput }: UseVoiceInputParams) {
  const [recording, setRecording] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const recognizer = useRef<SpeechRecognizer | null>(null);
  const inputRef = useRef(input);
  const recordingRef = useRef(false);
  const transcriptRef = useRef<VoiceTranscript>(createVoiceTranscript());
  const voiceSessionIdRef = useRef(0);
  const manualEditedRef = useRef(false);
  /** Snapshot of the composer text captured when markManualInput is called.
   *  Used during ASR absorption to guarantee we use the user's actual edit
   *  rather than relying on inputRef (which may be one frame behind). */
  const manualEditSnapshotRef = useRef("");

  // Sync inputRef synchronously after every commit so toggleVoice never
  // reads a stale value (useLayoutEffect fires before the browser paints,
  // guaranteeing the ref is fresh for the next user interaction).
  useLayoutEffect(() => {
    inputRef.current = input;
  });

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  const publishTranscript = useCallback(
    (state: VoiceTranscript) => {
      transcriptRef.current = state;
      manualEditedRef.current = false;
      setInput(composeVoiceTranscript(state));
    },
    [setInput],
  );

  const markManualInput = useCallback((value: string) => {
    console.log("[voice] markManualInput", { value });
    manualEditedRef.current = true;
    manualEditSnapshotRef.current = value;
  }, []);

  const stopVoiceInput = useCallback(
    (options?: { resetComposeState?: boolean }) => {
      console.log("[voice] stopVoiceInput", { recording: recordingRef.current, manualEdited: manualEditedRef.current, reset: options?.resetComposeState });
      voiceSessionIdRef.current += 1;
      recognizer.current?.stop();
      recognizer.current = null;

      if (recordingRef.current) {
        if (manualEditedRef.current) {
          // User edited the text after the last voice update – keep it.
          manualEditedRef.current = false;
        } else {
          publishTranscript(finalizeVoiceTranscript(transcriptRef.current));
        }
      }

      transcriptRef.current = createVoiceTranscript();
      setRecording(false);
      setVoiceHint("");

      if (options?.resetComposeState) {
        manualEditedRef.current = false;
      }
    },
    [publishTranscript],
  );

  const toggleVoice = useCallback(async () => {
    if (recording) {
      stopVoiceInput();
      return;
    }

    const sessionId = voiceSessionIdRef.current + 1;
    voiceSessionIdRef.current = sessionId;

    const prefix = inputRef.current.trim();
    console.log("[voice] toggleVoice START", {
      sessionId,
      prefix,
      inputSnapshot: inputRef.current,
      manualEdited: manualEditedRef.current,
    });
    manualEditedRef.current = false;

    transcriptRef.current = createVoiceTranscript(prefix);

    const instance = new SpeechRecognizer({
      onText: (text, isFinal) => {
        console.log("[voice] onText", {
          sessionId,
          currentSessionId: voiceSessionIdRef.current,
          text,
          isFinal,
          manualEdited: manualEditedRef.current,
        });
        if (sessionId !== voiceSessionIdRef.current) {
          console.log("[voice] onText BLOCKED: stale session");
          return;
        }
        const nextText = text.trim();

        // If the user edited the input while recording, absorb their edit
        // as the new prefix and resume normal dictation from this point.
        // We use manualEditSnapshotRef (captured at markManualInput time)
        // instead of inputRef to avoid any timing dependency.
        if (manualEditedRef.current) {
          console.log("[voice] onText RESET: absorbing manual edit", {
            snapshot: manualEditSnapshotRef.current,
            inputRef: inputRef.current,
          });
          manualEditedRef.current = false;
          transcriptRef.current = createVoiceTranscript(manualEditSnapshotRef.current.trim());
        }

        transcriptRef.current = isFinal
          ? applyVoiceFinal(transcriptRef.current, nextText)
          : applyVoicePartial(transcriptRef.current, nextText);
        const composed = composeVoiceTranscript(transcriptRef.current);
        if (nextText || composed) {
          console.log("[voice] onText PUBLISH", { nextText, composed });
          publishTranscript(transcriptRef.current);
        }
      },
      onError: (message) => {
        console.log("[voice] onError", { sessionId, currentSessionId: voiceSessionIdRef.current, message });
        if (sessionId !== voiceSessionIdRef.current) {
          return;
        }
        instance.stop();
        recognizer.current = null;
        transcriptRef.current = createVoiceTranscript();
        setVoiceHint(message);
        setRecording(false);
      },
    });

    recognizer.current = instance;
    setRecording(true);
    setVoiceHint("正在聆听");
    try {
      await instance.start();
      console.log("[voice] start() SUCCESS");
    } catch (err) {
      console.log("[voice] start() FAILED", { sessionId, currentSessionId: voiceSessionIdRef.current, error: String(err) });
      if (sessionId !== voiceSessionIdRef.current) {
        return;
      }
      instance.stop();
      recognizer.current = null;
      transcriptRef.current = createVoiceTranscript();
      setRecording(false);
      setVoiceHint("无法使用麦克风");
    }
  }, [publishTranscript, recording, setInput, stopVoiceInput]);

  useEffect(() => {
    return () => {
      voiceSessionIdRef.current += 1;
      recognizer.current?.stop();
      recognizer.current = null;
    };
  }, []);

  return { recording, voiceHint, toggleVoice, stopVoiceInput, setVoiceHint, markManualInput };
}
