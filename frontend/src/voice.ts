/**
 * 语音输入/输出模块。
 *
 * SpeechRecognizer: 采集麦克风 PCM 音频流，通过 WebSocket 发送至后端 STT 服务，
 *   实时回调识别文本（中间结果 + 最终结果）。
 *
 * SpeechPlayer: 将文本通过 WebSocket 发送至后端 TTS 服务，接收 MP3 音频块并
 *   使用 Web Audio API 顺序播放。支持队列化播放和中途打断。
 */

type SpeechCallbacks = {
  onText: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
};

const websocketUrl = (path: string) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${path}`;
};

const blobToArrayBuffer = (blob: Blob) => {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Response(blob).arrayBuffer();
};

export class SpeechRecognizer {
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;

  constructor(private callbacks: SpeechCallbacks) {}

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1 },
    });
    this.socket = new WebSocket(websocketUrl("/ws/speech"));
    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        this.callbacks.onError(String(data.error));
        return;
      }
      this.callbacks.onText(String(data.text ?? ""), Boolean(data.is_final));
    };
    this.socket.onerror = () => this.callbacks.onError("语音连接失败");

    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const output = new Int16Array(input.length);
      for (let index = 0; index < input.length; index += 1) {
        output[index] = Math.max(-32768, Math.min(32767, input[index] * 32768));
      }
      this.socket.send(output.buffer);
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop() {
    this.processor?.disconnect();
    this.source?.disconnect();
    void this.audioContext?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.socket?.close();
    this.processor = null;
    this.source = null;
    this.audioContext = null;
    this.stream = null;
    this.socket = null;
  }
}

export class SpeechPlayer {
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private playbackId = 0;
  private queue: Promise<void> = Promise.resolve();
  private source: AudioBufferSourceNode | null = null;
  private cancelSynthesis: (() => void) | null = null;
  private finishPlayback: (() => void) | null = null;

  private getAudioContext() {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("当前浏览器不支持语音播放");
    }
    this.audioContext ??= new AudioContextConstructor();
    return this.audioContext;
  }

  async unlock() {
    const context = this.getAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }
  }

  async play(text: string) {
    const content = text.trim();
    if (!content) return;
    this.stop();
    const playbackId = this.playbackId + 1;
    this.playbackId = playbackId;

    return this.synthesizeAndPlay(content, playbackId);
  }

  enqueue(text: string) {
    const content = text.trim();
    if (!content) return Promise.resolve();

    const playbackId = this.playbackId;
    const job = this.queue.then(() => {
      if (playbackId !== this.playbackId) return;
      return this.synthesizeAndPlay(content, playbackId);
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async synthesizeAndPlay(content: string, playbackId: number) {
    const chunks: BlobPart[] = [];
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(websocketUrl("/ws/tts"));
      this.socket = socket;
      socket.binaryType = "arraybuffer";

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (this.socket === socket) {
          this.socket = null;
        }
        if (this.cancelSynthesis === cancel) {
          this.cancelSynthesis = null;
        }
        callback();
      };

      const cancel = () => settle(resolve);
      this.cancelSynthesis = cancel;

      socket.onopen = () => {
        socket.send(JSON.stringify({ text: content }));
      };

      socket.onmessage = (event) => {
        if (playbackId !== this.playbackId) {
          return;
        }
        if (typeof event.data === "string") {
          const payload = JSON.parse(event.data) as { error?: string; status?: string };
          if (payload.error) {
            settle(() => reject(new Error(payload.error)));
            socket.close();
            return;
          }
          if (payload.status === "complete") {
            settle(resolve);
            socket.close();
          }
          return;
        }
        chunks.push(event.data as BlobPart);
      };

      socket.onerror = () => {
        settle(() => reject(new Error("语音输出连接失败")));
      };

      socket.onclose = () => {
        if (settled) return;
        if (playbackId !== this.playbackId) {
          settle(resolve);
          return;
        }
        settle(() => reject(new Error("语音输出连接已断开")));
      };
    });

    if (playbackId !== this.playbackId || chunks.length === 0) return;
    const blob = new Blob(chunks, { type: "audio/mpeg" });
    const context = this.getAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }
    const buffer = await context.decodeAudioData(await blobToArrayBuffer(blob));
    if (playbackId !== this.playbackId) return;
    await new Promise<void>((resolve) => {
      let finished = false;
      const source = context.createBufferSource();
      const finish = () => {
        if (finished) return;
        finished = true;
        if (this.source === source) {
          this.source = null;
        }
        if (this.finishPlayback === finish) {
          this.finishPlayback = null;
        }
        try {
          source.disconnect();
        } catch {
          // The source may already be detached by a browser stop event.
        }
        resolve();
      };

      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = finish;
      this.finishPlayback = finish;
      this.source = source;
      source.start();
    });
  }

  stop() {
    this.playbackId += 1;
    this.queue = Promise.resolve();
    this.cancelSynthesis?.();
    this.cancelSynthesis = null;
    this.socket?.close();
    try {
      this.source?.stop();
    } catch {
      // The source may already have ended.
    }
    this.finishPlayback?.();
    this.finishPlayback = null;
    this.source?.disconnect();
    this.source = null;
    this.socket = null;
  }

  destroy() {
    this.stop();
    void this.audioContext?.close();
    this.audioContext = null;
  }
}
