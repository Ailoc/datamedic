import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import { BACKEND_CONNECTION_ERROR, isNonEmptyDelta, streamChatMessage } from "../api";
import { appendMessage, getActiveConversation, updateMessage } from "../storage";
import type { ConversationState } from "../types";
import type { SpeechPlayer } from "../voice";
import { compactSpeechText, extractSpeakableSegments } from "../speechSegments";

type UseChatSessionParams = {
  activeConversationId: string;
  getSpeechPlayer: () => SpeechPlayer;
  setInput: (value: string) => void;
  setPendingDeleteId: (value: string | null) => void;
  setState: Dispatch<SetStateAction<ConversationState>>;
  setVoiceHint: (value: string) => void;
  state: ConversationState;
  voiceOutputEnabledRef: MutableRefObject<boolean>;
};

export function useChatSession({
  activeConversationId,
  getSpeechPlayer,
  setInput,
  setPendingDeleteId,
  setState,
  setVoiceHint,
  state,
  voiceOutputEnabledRef,
}: UseChatSessionParams) {
  const [loading, setLoading] = useState(false);
  const activeStream = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      activeStream.current?.abort();
    };
  }, []);

  const submitMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setVoiceHint("");
    setPendingDeleteId(null);
    if (voiceOutputEnabledRef.current) {
      getSpeechPlayer().stop();
    }
    activeStream.current?.abort();
    const streamController = new AbortController();
    activeStream.current = streamController;

    const conversationId = activeConversationId;
    let nextState = appendMessage(state, conversationId, {
      role: "user",
      text: trimmed,
      figures: [],
    });
    nextState = appendMessage(nextState, conversationId, {
      role: "assistant",
      text: "",
      figures: [],
    });
    const assistantMessage = getActiveConversation(nextState).messages.at(-1);
    if (!assistantMessage) return;
    setState(nextState);
    setLoading(true);

    try {
      let streamedText = "";
      let speechBuffer = "";
      let queuedSpeechText = "";
      const enqueueSpeech = (speechText: string) => {
        const content = compactSpeechText(speechText);
        if (!content || !voiceOutputEnabledRef.current) return;
        queuedSpeechText += content;
        void getSpeechPlayer()
          .enqueue(content)
          .catch((error: unknown) =>
            setVoiceHint(`语音输出失败：${error instanceof Error ? error.message : "请检查服务配置"}`),
          );
      };
      const queueSpeakableDeltas = (delta: string) => {
        if (!voiceOutputEnabledRef.current) return;
        speechBuffer += delta;
        const extracted = extractSpeakableSegments(speechBuffer);
        speechBuffer = extracted.remaining;
        extracted.segments.forEach(enqueueSpeech);
      };
      const flushSpeech = (fallbackText: string) => {
        if (!voiceOutputEnabledRef.current) return;
        const extracted = extractSpeakableSegments(speechBuffer, true);
        speechBuffer = extracted.remaining;
        extracted.segments.forEach(enqueueSpeech);
        if (queuedSpeechText || !fallbackText) return;
        enqueueSpeech(fallbackText);
      };
      const result = await streamChatMessage(conversationId, trimmed, {
        signal: streamController.signal,
        onDelta: (delta) => {
          if (!isNonEmptyDelta(streamedText, delta)) return;
          streamedText += delta;
          queueSpeakableDeltas(delta);
          setState((currentState) =>
            updateMessage(currentState, conversationId, assistantMessage.id, {
              text: streamedText,
            }),
          );
        },
      });
      if (result.text && result.text.startsWith(streamedText)) {
        speechBuffer += result.text.slice(streamedText.length);
      }
      setState((currentState) =>
        updateMessage(currentState, conversationId, assistantMessage.id, {
          text: result.text || streamedText,
          figures: result.ok ? result.figures : [],
        }),
      );
      if (result.ok) {
        flushSpeech(result.text || streamedText);
      } else if (voiceOutputEnabledRef.current) {
        getSpeechPlayer().stop();
      }
    } catch {
      setState((currentState) =>
        updateMessage(currentState, conversationId, assistantMessage.id, {
          text: BACKEND_CONNECTION_ERROR,
          figures: [],
        }),
      );
    } finally {
      if (activeStream.current === streamController) {
        activeStream.current = null;
      }
      setLoading(false);
    }
  };

  return { loading, submitMessage };
}
