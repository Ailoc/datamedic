import { describe, expect, it, vi } from "vitest";
import { SpeechPlayer, SpeechRecognizer } from "./voice";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  binaryType = "";
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close = vi.fn(function (this: MockWebSocket) {
    this.readyState = 3; // CLOSED
  });
  send = vi.fn((payload: string) => {
    this.sent.push(payload);
  });
}

describe("SpeechPlayer", () => {
  const createSourceMock = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    onended: null as (() => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
  });

  const createAudioContextMock = () => ({
    close: vi.fn(() => Promise.resolve()),
    createBufferSource: vi.fn(() => createSourceMock()),
    decodeAudioData: vi.fn(() => Promise.resolve({} as AudioBuffer)),
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    state: "suspended",
  });

  it("unlocks browser audio during the user gesture", async () => {
    const context = createAudioContextMock();
    const AudioContextMock = vi.fn(() => context);
    vi.stubGlobal("AudioContext", AudioContextMock);

    const player = new SpeechPlayer();
    await player.unlock();

    expect(AudioContextMock).toHaveBeenCalled();
    expect(context.resume).toHaveBeenCalled();
  });

  it("streams text to the TTS websocket and plays returned audio through Web Audio", async () => {
    MockWebSocket.instances = [];
    const source = createSourceMock();
    const context = {
      ...createAudioContextMock(),
      createBufferSource: vi.fn(() => source),
    };
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("AudioContext", vi.fn(() => context));

    const player = new SpeechPlayer();
    await player.unlock();
    const playing = player.play(" 已完成分析 ");
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();
    // Wait for synthesize to set up handlers and call send on the persistent socket.
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    socket.onmessage?.({ data: new Uint8Array([1, 2, 3]).buffer } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ status: "complete" }) } as MessageEvent);
    await vi.waitFor(() => expect(source.start).toHaveBeenCalled());
    source.onended?.();
    await playing;

    expect(socket.url).toBe("ws://localhost:3000/ws/tts");
    expect(socket.binaryType).toBe("arraybuffer");
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ text: "已完成分析" }));
    expect(context.decodeAudioData).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(source.connect).toHaveBeenCalledWith(context.destination);
    expect(source.start).toHaveBeenCalled();
  });

  it("synthesizes queued speech sequentially", async () => {
    MockWebSocket.instances = [];
    const firstSource = createSourceMock();
    const secondSource = createSourceMock();
    const context = {
      ...createAudioContextMock(),
      createBufferSource: vi.fn().mockReturnValueOnce(firstSource).mockReturnValueOnce(secondSource),
    };
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("AudioContext", vi.fn(() => context));

    const player = new SpeechPlayer();
    await player.unlock();
    const first = player.enqueue("第一句。");
    const second = player.enqueue("第二句。");
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();
    // Wait for synthesize to send the first text before delivering messages.
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    socket.onmessage?.({ data: new Uint8Array([1]).buffer } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ status: "complete" }) } as MessageEvent);

    await vi.waitFor(() => expect(firstSource.start).toHaveBeenCalled());
    expect(secondSource.start).not.toHaveBeenCalled();
    // Socket is reused — no new instance created.
    expect(MockWebSocket.instances).toHaveLength(1);

    firstSource.onended?.();
    await first;

    // Second synthesis reuses the same persistent socket.
    socket.onmessage?.({ data: new Uint8Array([2]).buffer } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ status: "complete" }) } as MessageEvent);

    await vi.waitFor(() => expect(secondSource.start).toHaveBeenCalled());
    secondSource.onended?.();
    await second;

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ text: "第一句。" }));
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ text: "第二句。" }));
  });

  it("closes the active synthesis websocket when playback is stopped before completion", async () => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("AudioContext", vi.fn(() => createAudioContextMock()));

    const player = new SpeechPlayer();
    const playing = player.play("正在合成的长句。");
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();

    player.stop();
    await playing;

    expect(socket.close).toHaveBeenCalled();
  });

  it("closes active synthesis websocket and resolves pending queued playback when stopped", async () => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("AudioContext", vi.fn(() => createAudioContextMock()));

    const player = new SpeechPlayer();
    const first = player.enqueue("第一句。");
    const second = player.enqueue("第二句。");
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();

    player.stop();
    await Promise.all([first, second]);

    expect(socket.close).toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("rejects malformed TTS control frames instead of leaving playback pending", async () => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("AudioContext", vi.fn(() => createAudioContextMock()));

    const player = new SpeechPlayer();
    const playing = player.play("异常响应测试");
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();
    // Wait for synthesize to set up handlers before sending malformed data.
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    expect(() => socket.onmessage?.({ data: "{broken-json" } as MessageEvent)).not.toThrow();
    await expect(playing).rejects.toThrow("语音输出响应格式异常");
  });
});

describe("SpeechRecognizer", () => {
  it("stops media and socket resources when speech websocket errors", async () => {
    MockWebSocket.instances = [];
    const track = { stop: vi.fn() };
    const gainNode = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } };
    const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const audioContext = {
      close: vi.fn(() => Promise.resolve()),
      createGain: vi.fn(() => gainNode),
      createMediaStreamSource: vi.fn(() => source),
      createScriptProcessor: vi.fn(() => processor),
      destination: {},
    };
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("AudioContext", vi.fn(() => audioContext));
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [track] })),
      },
    });
    const onError = vi.fn();
    const recognizer = new SpeechRecognizer({ onError, onText: vi.fn() });

    await recognizer.start();
    const socket = MockWebSocket.instances[0];
    socket.onerror?.();

    expect(onError).toHaveBeenCalledWith("语音连接失败");
    expect(socket.close).toHaveBeenCalled();
    expect(processor.disconnect).toHaveBeenCalled();
    expect(source.disconnect).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(audioContext.close).toHaveBeenCalled();
  });
});
