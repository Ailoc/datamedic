/**
 * 语音输入/输出模块。
 *
 * SpeechRecognizer: 采集麦克风 PCM 音频流，通过 WebSocket 发送至后端 STT 服务，
 *   实时回调识别文本（中间结果 + 最终结果）。
 *
 * SpeechPlayer: 将文本通过 WebSocket 发送至后端 TTS 服务，接收 MP3 音频块，
 *   解码后使用 Web Audio API 的时间轴调度实现无缝连续播放。
 */

type SpeechCallbacks = {
  onText: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
};

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
  private stopping = false;

  constructor(private callbacks: SpeechCallbacks) {}

  async start() {
    try {
      // Step 1: Create WebSocket and wait for onopen before proceeding.
      // Without this, audio frames sent before the socket is ready are
      // silently dropped, causing incomplete audio input to the ASR model.
      this.socket = await this.connectWebSocket();

      // Step 2: Acquire microphone (only after WS is ready).
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1 },
      });

      // Step 3: Build the audio graph.
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      // Route processor through a zero-gain node instead of directly to
      // destination.  This keeps `onaudioprocess` firing while preventing
      // the microphone signal from being played back through the speakers
      // (which causes distracting echo / feedback).
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 0;

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
      this.processor.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /**
   * Open a WebSocket and resolve only after `onopen` fires (or after a
   * 5-second timeout).  During the in-flight period every error causes
   * the returned promise to reject so that the caller can distinguish
   * "connection failed" from runtime errors later on.
   */
  private connectWebSocket(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl("/ws/speech"));

      // Some test mocks set readyState === OPEN synchronously.
      if (socket.readyState === WebSocket.OPEN) {
        this.attachRuntimeHandlers(socket);
        resolve(socket);
        return;
      }

      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("语音服务连接超时"));
      }, 5000);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.attachRuntimeHandlers(socket);
        resolve(socket);
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("语音连接失败"));
      };
    });
  }

  /**
   * Replace the transient init-time handlers (onopen / onerror) with
   * runtime handlers that forward state changes to the user callbacks.
   */
  private attachRuntimeHandlers(socket: WebSocket) {
    socket.onmessage = (event) => {
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

    socket.onerror = () => {
      if (this.stopping) return;
      this.callbacks.onError("语音连接失败");
      this.stop();
    };

    socket.onclose = () => {
      if (this.stopping) return;
      this.callbacks.onError("语音连接已断开");
      this.stop();
    };
  }

  stop() {
    this.stopping = true;
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
    this.stopping = false;
  }
}

export class SpeechPlayer {
  private audioContext: AudioContext | null = null;
  private playbackId = 0;
  private pendingQueue: SpeechQueueItem[] = [];
  private drainingQueue = false;
  private scheduledEndTime = 0;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private ttsSocket: WebSocket | null = null;
  private synthesisCache = new Map<string, Promise<AudioBuffer | null>>();

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
      await this.scheduleBuffer(buffer, playbackId);
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

  private prefetchSynthesis(content: string, playbackId: number) {
    const cacheKey = `${playbackId}:${content}`;
    if (!this.synthesisCache.has(cacheKey)) {
      this.synthesisCache.set(cacheKey, this.synthesize(content, playbackId));
    }
    return this.synthesisCache.get(cacheKey)!;
  }

  private async drainQueue() {
    try {
      const playbackId = this.playbackId;
      let nextPrefetch: Promise<AudioBuffer | null> | null = null;

      while (this.pendingQueue.length > 0 || nextPrefetch) {
        if (this.playbackId !== playbackId) {
          break;
        }

        const item = this.pendingQueue.shift();
        if (!item) {
          if (nextPrefetch) {
            await nextPrefetch;
          }
          break;
        }

        if (item.playbackId !== playbackId) {
          item.resolveDone();
          continue;
        }

        try {
          const buffer = nextPrefetch
            ? await nextPrefetch
            : await this.prefetchSynthesis(item.content, item.playbackId);
          nextPrefetch = this.pendingQueue[0]
            ? this.prefetchSynthesis(this.pendingQueue[0].content, item.playbackId)
            : null;

          if (!buffer || item.playbackId !== playbackId) {
            item.resolveDone();
            continue;
          }

          await this.scheduleBuffer(buffer, item.playbackId);
          item.resolveDone();
        } catch (error) {
          item.rejectDone(error);
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

  private async scheduleBuffer(buffer: AudioBuffer, playbackId: number) {
    if (playbackId !== this.playbackId) return;
    const context = this.getAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }
    if (playbackId !== this.playbackId) return;

    const leadTime = 0.04;
    const now = context.currentTime;
    if (this.scheduledEndTime < now + leadTime) {
      this.scheduledEndTime = now + leadTime;
    }

    await new Promise<void>((resolve) => {
      const source = context.createBufferSource();
      const startAt = this.scheduledEndTime;
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        this.scheduledSources = this.scheduledSources.filter((active) => active !== source);
        try {
          source.disconnect();
        } catch {
          // The source may already be detached by a browser stop event.
        }
        resolve();
      };
      this.scheduledSources.push(source);
      source.start(startAt);
      this.scheduledEndTime = startAt + buffer.duration;
    });
  }

  stop() {
    this.playbackId += 1;
    const pendingItems = this.pendingQueue.splice(0);
    pendingItems.forEach((item) => item.resolveDone());
    this.synthesisCache.clear();
    this.scheduledEndTime = 0;
    this.ttsSocket?.close();
    this.ttsSocket = null;
    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      try {
        source.disconnect();
      } catch {
        // The source may already be detached.
      }
    }
    this.scheduledSources = [];
  }

  destroy() {
    this.stop();
    void this.audioContext?.close();
    this.audioContext = null;
  }
}
