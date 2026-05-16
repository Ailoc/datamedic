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

type SpeechSynthesisResult =
  | { status: "ready"; buffer: AudioBuffer | null }
  | { status: "error"; error: unknown };

type SpeechQueueItem = {
  content: string;
  playbackId: number;
  done: Promise<void>;
  resolveDone: () => void;
  rejectDone: (error: unknown) => void;
};

const parseSocketJson = (data: string): Record<string, unknown> | null => {
  try {
    const payload = JSON.parse(data);
    return typeof payload === "object" && payload !== null ? payload : null;
  } catch {
    return null;
  }
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
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1 },
      });
      this.socket = new WebSocket(websocketUrl("/ws/speech"));
      this.socket.onmessage = (event) => {
        const data = typeof event.data === "string" ? parseSocketJson(event.data) : null;
        if (!data) {
          this.callbacks.onError("语音识别响应格式异常");
          this.stop();
          return;
        }
        if (data.error) {
          this.callbacks.onError(String(data.error));
          this.stop();
          return;
        }
        this.callbacks.onText(String(data.text ?? ""), Boolean(data.is_final));
      };
      this.socket.onerror = () => {
        this.callbacks.onError("语音连接失败");
        this.stop();
      };

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
    } catch (error) {
      this.stop();
      throw error;
    }
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
  private audioContext: AudioContext | null = null;
  private playbackId = 0;
  private pendingQueue: SpeechQueueItem[] = [];
  private drainingQueue = false;
  private source: AudioBufferSourceNode | null = null;
  private finishPlayback: (() => void) | null = null;
  private ttsSocket: WebSocket | null = null;
  private preFetchedAudio: { buffer: AudioBuffer; playbackId: number } | null = null;

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

  private ensureSocket(): Promise<WebSocket> {
    if (this.ttsSocket?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ttsSocket);
    }
    this.ttsSocket?.close();
    this.ttsSocket = null;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl("/ws/tts"));
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        this.ttsSocket = socket;
        resolve(socket);
      };
      socket.onerror = () => {
        this.ttsSocket = null;
        reject(new Error("语音输出连接失败"));
      };
      socket.onclose = () => {
        this.ttsSocket = null;
      };
    });
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
    const playbackId = this.playbackId;

    const buffer = await this.synthesize(content, playbackId);
    if (buffer) {
      await this.playBuffer(buffer, playbackId);
    }
  }

  enqueue(text: string) {
    const content = text.trim();
    if (!content) return Promise.resolve();

    const playbackId = this.playbackId;
    const item = this.createQueueItem(content, playbackId);
    this.pendingQueue.push(item);
    this.startQueueDrain();
    return item.done;
  }

  private createQueueItem(content: string, playbackId: number): SpeechQueueItem {
    let resolveDone: () => void = () => undefined;
    let rejectDone: (error: unknown) => void = () => undefined;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    return {
      content,
      playbackId,
      done,
      resolveDone,
      rejectDone,
    };
  }

  private startQueueDrain() {
    if (this.drainingQueue) return;
    this.drainingQueue = true;
    void this.drainQueue();
  }

  private async drainQueue() {
    try {
      while (this.pendingQueue.length > 0) {
        const item = this.pendingQueue.shift();
        if (!item) continue;

        if (item.playbackId !== this.playbackId) {
          item.resolveDone();
          continue;
        }

        // Use pre-fetched audio if available, otherwise synthesize now.
        let audio: AudioBuffer | null = null;
        if (
          this.preFetchedAudio &&
          this.preFetchedAudio.playbackId === this.playbackId
        ) {
          audio = this.preFetchedAudio.buffer;
          this.preFetchedAudio = null;
        } else {
          this.preFetchedAudio = null;
          const result = await this.synthesize(item.content, item.playbackId).then(
            (buffer): SpeechSynthesisResult => ({ status: "ready", buffer }),
            (error: unknown): SpeechSynthesisResult => ({ status: "error", error }),
          );
          if (item.playbackId !== this.playbackId) {
            item.resolveDone();
            continue;
          }
          if (result.status === "error") {
            item.rejectDone(result.error);
            continue;
          }
          audio = result.buffer;
        }

        // Pre-fetch the next segment while playing this one.
        const nextItem = this.pendingQueue[0];
        const preFetchPromise =
          nextItem && nextItem.playbackId === this.playbackId
            ? this.synthesize(nextItem.content, nextItem.playbackId).then(
                (buffer) => {
                  if (nextItem.playbackId === this.playbackId && buffer) {
                    this.preFetchedAudio = { buffer, playbackId: nextItem.playbackId };
                  }
                },
                () => undefined,
              )
            : null;

        if (audio) {
          await this.playBuffer(audio, item.playbackId);
        }
        item.resolveDone();

        // Wait for pre-fetch to settle so the next iteration can use it.
        if (preFetchPromise) {
          await preFetchPromise;
        }
      }
    } finally {
      this.drainingQueue = false;
      if (this.pendingQueue.length > 0) {
        this.startQueueDrain();
      }
    }
  }

  private async synthesize(content: string, playbackId: number): Promise<AudioBuffer | null> {
    let socket: WebSocket;
    try {
      socket = await this.ensureSocket();
    } catch {
      return null;
    }
    if (playbackId !== this.playbackId) return null;

    const chunks: BlobPart[] = [];
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        callback();
      };

      socket.onmessage = (event) => {
        if (playbackId !== this.playbackId) {
          settle(resolve);
          return;
        }
        if (typeof event.data === "string") {
          const payload = parseSocketJson(event.data);
          if (!payload) {
            settle(() => reject(new Error("语音输出响应格式异常")));
            return;
          }
          if (payload.error) {
            settle(() => reject(new Error(String(payload.error))));
            return;
          }
          if (payload.status === "complete") {
            settle(resolve);
          }
          return;
        }
        chunks.push(event.data as BlobPart);
      };

      socket.onerror = () => {
        this.ttsSocket = null;
        settle(() => reject(new Error("语音输出连接失败")));
      };

      socket.onclose = () => {
        if (settled) return;
        this.ttsSocket = null;
        settle(() => reject(new Error("语音输出连接已断开")));
      };

      socket.send(JSON.stringify({ text: content }));
    });

    if (playbackId !== this.playbackId || chunks.length === 0) return null;
    const blob = new Blob(chunks, { type: "audio/mpeg" });
    const context = this.getAudioContext();
    const buffer = await context.decodeAudioData(await blobToArrayBuffer(blob));
    if (playbackId !== this.playbackId) return null;
    return buffer;
  }

  private async playBuffer(buffer: AudioBuffer, playbackId: number) {
    if (playbackId !== this.playbackId) return;
    const context = this.getAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }
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
    const pendingItems = this.pendingQueue.splice(0);
    pendingItems.forEach((item) => item.resolveDone());
    this.preFetchedAudio = null;
    this.ttsSocket?.close();
    this.ttsSocket = null;
    try {
      this.source?.stop();
    } catch {
      // The source may already have ended.
    }
    this.finishPlayback?.();
    this.finishPlayback = null;
    this.source?.disconnect();
    this.source = null;
  }

  destroy() {
    this.stop();
    void this.audioContext?.close();
    this.audioContext = null;
  }
}
