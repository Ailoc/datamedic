import type { FormEvent, KeyboardEvent } from "react";
import { Mic, SendHorizontal, Square } from "lucide-react";

export function Composer({
  input,
  loading,
  recording,
  voiceHint,
  onInput,
  onKeyDown,
  onSubmit,
  onToggleVoice,
}: {
  input: string;
  loading: boolean;
  recording: boolean;
  voiceHint: string;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent) => void;
  onToggleVoice: () => void;
}) {
  return (
    <form aria-label="消息发送区" className="composer" onSubmit={onSubmit}>
      <div className="composer-frame">
        <button
          aria-label="语音输入"
          className={`icon-button voice-button${recording ? " is-recording" : ""}`}
          type="button"
          onClick={onToggleVoice}
        >
          {recording ? <Square size={16} fill="currentColor" /> : <Mic size={18} />}
        </button>
        <textarea
          aria-label="消息输入"
          rows={1}
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="询问指标、趋势或异常原因..."
        />
        <button
          aria-label="发送消息"
          className="icon-button send-button"
          type="submit"
          disabled={!input.trim() || loading}
        >
          <SendHorizontal size={18} />
        </button>
      </div>
      {voiceHint && <div className="voice-hint">{voiceHint}</div>}
    </form>
  );
}
