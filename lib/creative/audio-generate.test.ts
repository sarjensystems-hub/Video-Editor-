import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMusicBytes, generateSpeechBytes } from "./audio-generate";
import { runWithOpenRouterKey } from "../openrouter-key";

/**
 * Generation always runs on some account's key, so these transport tests run
 * inside a key scope the way a real request does. There is no environment
 * variable to stand in for one.
 */
const asUser = <T>(call: () => Promise<T>) => runWithOpenRouterKey(async () => "test-key", call);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("music generation transport", () => {
  it("requests streaming text+audio and joins OpenRouter SSE audio deltas", async () => {
    const sse = [
      ': OPENROUTER PROCESSING',
      'data: {"id":"gen-1","choices":[{"delta":{"audio":{"data":"aGVs","format":"wav"}}}]}',
      'data: {"id":"gen-1","choices":[{"delta":{"audio":{"data":"bG8="}}}]}',
      'data: [DONE]',
      '',
    ].join("\n");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await asUser(() => generateMusicBytes({ prompt: "restrained premium automotive instrumental" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body.stream).toBe(true);
    expect(body.modalities).toEqual(["text", "audio"]);
    expect(result.bytes.toString("utf8")).toBe("hello");
    expect(result.contentType).toBe("audio/wav");
    expect(result.generationId).toBe("gen-1");
  });

  it("fails clearly when a successful SSE response contains no audio chunks", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      'data: {"id":"gen-empty","choices":[{"delta":{"content":"no audio"}}]}\n\ndata: [DONE]\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    )));

    await expect(asUser(() => generateMusicBytes({ prompt: "silence" }))).rejects.toThrow(/no audio/i);
  });
});

describe("speech generation transport", () => {
  it("requests the chosen ElevenLabs model as mp3 through OpenRouter's speech endpoint", async () => {
    const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(new Uint8Array(mp3), { status: 200, headers: { "content-type": "audio/mpeg", "x-generation-id": "gen-speech" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await asUser(() => generateSpeechBytes({ text: "नमस्ते", voice: "george", model: "eleven-flash-v2.5" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/audio/speech");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ model: "elevenlabs/eleven-flash-v2.5", input: "नमस्ते", voice: "george", response_format: "mp3" });
    expect(result.contentType).toBe("audio/mpeg");
    expect(result.generationId).toBe("gen-speech");
  });

  it("retries one transient server failure", async () => {
    const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("upstream connect error", { status: 502 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(mp3), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(asUser(() => generateSpeechBytes({ text: "Hello", voice: "sarah" }))).resolves.toMatchObject({
      contentType: "audio/mpeg",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not spend the retry on an empty audio stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "Provider returned an empty audio stream after returning HTTP 200", code: 502 } }),
      { status: 502 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(asUser(() => generateSpeechBytes({ text: "Hello", voice: "sarah" })))
      .rejects.toThrow(/^Speech generation returned no audio\.$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ElevenLabs is the default speech model", () => {
  it("requests Eleven v4 as mp3 and keeps the mp3 as it is", async () => {
    const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(new Uint8Array(mp3), { status: 200, headers: { "content-type": "audio/mpeg", "x-generation-id": "gen-11" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await asUser(() => generateSpeechBytes({ text: "[excited] Open WhatsApp.", voice: "sarah" }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ model: "elevenlabs/eleven-v4", input: "[excited] Open WhatsApp.", voice: "sarah", response_format: "mp3" });
    expect(result.contentType).toBe("audio/mpeg");
    expect(result.bytes.byteLength).toBe(mp3.byteLength);
    expect(result.generationId).toBe("gen-11");
  });

  it("fails plainly when a 200 carries a zero-length body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(0), { status: 200 })));
    await expect(asUser(() => generateSpeechBytes({ text: "Hello", voice: "sarah" })))
      .rejects.toThrow(/^Speech generation returned no audio\.$/);
  });
});
