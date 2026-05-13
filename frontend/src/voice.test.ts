import { describe, expect, it, vi } from "vitest";
import { SpeechPlayer } from "./voice";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  binaryType = "";
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close = vi.fn();
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

  it("queues speech segments without opening the next websocket until playback finishes", async () => {
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
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.onopen?.();
    firstSocket.onmessage?.({ data: new Uint8Array([1]).buffer } as MessageEvent);
    firstSocket.onmessage?.({ data: JSON.stringify({ status: "complete" }) } as MessageEvent);

    expect(MockWebSocket.instances).toHaveLength(1);
    await vi.waitFor(() => expect(firstSource.start).toHaveBeenCalled());
    firstSource.onended?.();
    await first;

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const secondSocket = MockWebSocket.instances[1];
    secondSocket.onopen?.();
    secondSocket.onmessage?.({ data: new Uint8Array([2]).buffer } as MessageEvent);
    secondSocket.onmessage?.({ data: JSON.stringify({ status: "complete" }) } as MessageEvent);
    await vi.waitFor(() => expect(secondSource.start).toHaveBeenCalled());
    secondSource.onended?.();
    await second;

    expect(firstSocket.send).toHaveBeenCalledWith(JSON.stringify({ text: "第一句。" }));
    expect(secondSocket.send).toHaveBeenCalledWith(JSON.stringify({ text: "第二句。" }));
  });
});
