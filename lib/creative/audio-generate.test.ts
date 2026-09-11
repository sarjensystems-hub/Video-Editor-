import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMusicBytes, generateSpeechBytes } from "./audio-generate";
import { pcmDurationMs, sniffAudioContainer, wrapPcmInWav } from "./audio-format";
import { SPEECH_PCM_FORMAT } from "./audio-workers";
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
  it("requests Gemini 3.1 Flash TTS through OpenRouter's speech endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(Buffer.from("speech"), {
      status: 200,
      headers: { "content-type": "audio/mpeg", "x-generation-id": "gen-speech" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await asUser(() => generateSpeechBytes({ text: "Hello", voice: "Kore" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/audio/speech");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      model: "google/gemini-3.1-flash-tts-preview",
      input: "Hello",
      voice: "Kore",
      response_format: "pcm",
    });
    // The body has no magic number, so it is treated as the headerless pcm
    // Gemini returns and comes back wrapped - the original bytes intact after
    // the 44-byte header, not passed through raw.
    expect(result.bytes.subarray(44).toString()).toBe("speech");
    expect(result.generationId).toBe("gen-speech");
  });

  it("retries one transient Gemini server failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(960), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    // Headerless pcm on the retry too, so it comes back as a wrapped container
    // rather than the audio/mpeg the pre-Gemini version of this test asserted.
    await expect(asUser(() => generateSpeechBytes({ text: "Hello", voice: "Kore" }))).resolves.toMatchObject({
      contentType: "audio/wav",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("speech transport speaks the format Gemini actually accepts", () => {
  /**
   * The regression this exists for: the swap from Kokoro to Gemini kept
   * response_format "mp3", and every voiceover failed with
   * `Gemini TTS only supports response_format="pcm". Got "mp3"` - which no test
   * caught, because nothing asserted the wire format.
   */
  it("requests pcm, not mp3", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(new Uint8Array(4800), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await asUser(() => generateSpeechBytes({ text: "Test.", voice: "Kore" }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.response_format).toBe("pcm");
    expect(body.model).toBe("google/gemini-3.1-flash-tts-preview");
  });

  it("wraps headerless pcm in a real container rather than mislabelling it", async () => {
    // One second of 24kHz 16-bit mono, all zeroes: valid PCM, no magic number.
    const pcm = new Uint8Array(48000);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(pcm, { status: 200 })));

    const result = await asUser(() => generateSpeechBytes({ text: "Test.", voice: "Kore" }));

    // Without the wrapper this would sniff as nothing and default to audio/mpeg
    // over bytes that are not MP3 - stored happily, unplayable everywhere.
    expect(result.contentType).toBe("audio/wav");
    expect(result.bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(result.bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(result.bytes.byteLength).toBe(pcm.byteLength + 44);
  });

  it("leaves a real container alone if the provider ignores the pcm request", async () => {
    const alreadyWav = wrapPcmInWav(new Uint8Array(960), SPEECH_PCM_FORMAT);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(new Uint8Array(alreadyWav), { status: 200 })));

    const result = await asUser(() => generateSpeechBytes({ text: "Test.", voice: "Kore" }));

    // Double-wrapping would bury the real header inside a second one.
    expect(result.bytes.byteLength).toBe(alreadyWav.byteLength);
  });
});

describe("pcm container helpers", () => {
  it("writes a header the sniffer recognises", () => {
    const wav = wrapPcmInWav(new Uint8Array(1000), SPEECH_PCM_FORMAT);
    expect(sniffAudioContainer(wav)).toBe("wav");
    expect(wav.readUInt32LE(4)).toBe(36 + 1000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(1000);
  });

  it("computes exact duration rather than estimating it", () => {
    // 24000 frames of 16-bit mono is exactly one second.
    expect(pcmDurationMs(48000, SPEECH_PCM_FORMAT)).toBe(1000);
    expect(pcmDurationMs(24000, SPEECH_PCM_FORMAT)).toBe(500);
  });
});

describe("an empty audio stream is diagnosed, not retried", () => {
  /**
   * Measured against the live model: `[deadpan] White. Black. Still.` returns
   * HTTP 200 with no audio frames on every attempt, while the same words
   * introduced as a line to speak return three seconds of it. The failure is
   * deterministic, so the transient-5xx retry above spends a second call to
   * learn the same thing.
   *
   * The first agent to hit this read the provider's message - "empty audio
   * stream after returning HTTP 200" - as a flake and asked for a bounded
   * retry, which was already there and had already run. That is the cost of an
   * error that names the symptom instead of the cause.
   */
  const emptyStream = () => new Response(
    JSON.stringify({ error: { message: "Provider returned an empty audio stream after returning HTTP 200", code: 502 } }),
    { status: 502 },
  );

  it("fails on the first call instead of spending the retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStream());
    vi.stubGlobal("fetch", fetchMock);

    await expect(asUser(() => generateSpeechBytes({ text: "[deadpan] White. Black. Still.", voice: "Gacrux" })))
      .rejects.toThrow(/read the whole prompt as performance direction/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tells the caller how to frame the line, not just that it failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyStream()));

    await expect(asUser(() => generateSpeechBytes({ text: "Dry, deadpan. Still.", voice: "Gacrux" })))
      .rejects.toThrow(/Say the following line/);
  });

  it("still retries a genuine transient 502 that is not an empty stream", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("upstream connect error", { status: 502 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(960), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(asUser(() => generateSpeechBytes({ text: "Hello", voice: "Kore" }))).resolves.toMatchObject({
      contentType: "audio/wav",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives the same diagnosis when a 200 carries a zero-length body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(0), { status: 200 })));

    await expect(asUser(() => generateSpeechBytes({ text: "[deadpan] Still.", voice: "Gacrux" })))
      .rejects.toThrow(/read the whole prompt as performance direction/);
  });
});
