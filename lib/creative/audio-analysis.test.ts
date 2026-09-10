import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeAudioUrl, computeRmsPeaks, detectTransients } from "./audio-analysis";

/**
 * `analyzeAudioUrl` sniffs the container before deciding how to read it, so
 * every test here has to serve bytes. WAV bytes take the PCM branch and hand
 * the URL to the mocked media parser; MP3 bytes take the granule branch and
 * are read directly.
 */
function serveBytes(bytes: Uint8Array) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })));
}

const WAV_HEADER = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, // "RIFF....WAVE"
]);

// MPEG-1 Layer III, 128kbps, 44.1kHz, mono, no CRC.
function mp3Frame(gain: number): Uint8Array {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0xc0], 0);
  // global_gain sits at bit 21 of each granule block, after a 18-bit preamble.
  for (const granule of [0, 1]) {
    const bitOffset = 4 * 8 + 18 + granule * 59 + 21;
    for (let i = 0; i < 8; i += 1) {
      const bit = (gain >> (7 - i)) & 1;
      const position = bitOffset + i;
      if (bit) frame[position >> 3] |= 1 << (7 - (position & 7));
    }
  }
  return frame;
}

function mp3Stream(gains: number[]): Uint8Array {
  const frames = gains.map(mp3Frame);
  const out = new Uint8Array(frames.length * 417);
  frames.forEach((frame, index) => out.set(frame, index * 417));
  return out;
}

beforeEach(() => serveBytes(WAV_HEADER));
afterEach(() => vi.unstubAllGlobals());

const { parseMediaMock } = vi.hoisted(() => ({
  parseMediaMock: vi.fn(),
}));

vi.mock("@remotion/media-parser", () => ({
  parseMedia: parseMediaMock,
}));

function silence(n: number) { return new Float32Array(n); }
function tone(n: number, amplitude: number) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.sin(i / 4) * amplitude;
  return out;
}

describe("computeRmsPeaks", () => {
  it("reports zero for silence", () => {
    expect(computeRmsPeaks(silence(1000), 100).every((p) => p === 0)).toBe(true);
  });

  it("normalizes so the loudest window is exactly one", () => {
    const samples = new Float32Array([...tone(400, 0.2), ...tone(400, 1)]);
    const peaks = computeRmsPeaks(samples, 100);
    expect(Math.max(...peaks)).toBeCloseTo(1, 5);
  });

  it("produces one peak per window, including a short trailing one", () => {
    expect(computeRmsPeaks(silence(250), 100)).toHaveLength(3);
  });

  it("rejects a non-positive window", () => {
    expect(() => computeRmsPeaks(silence(10), 0)).toThrow(/positive/i);
  });
});

describe("detectTransients", () => {
  it("finds nothing in a flat signal", () => {
    expect(detectTransients(new Array(200).fill(0.5), 20)).toEqual([]);
  });

  it("finds nothing in too short a signal", () => {
    expect(detectTransients([0.1, 0.9], 20)).toEqual([]);
  });

  it("finds a sharp energy rise", () => {
    const peaks = [...new Array(40).fill(0.1), 1, ...new Array(40).fill(0.1)];
    const found = detectTransients(peaks, 20);
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(40 * 20);
  });

  it("collapses a burst into one onset rather than several adjacent ones", () => {
    const peaks = [...new Array(40).fill(0.1), 1, 0.95, 0.9, ...new Array(40).fill(0.1)];
    // Without a minimum gap these three windows would all register.
    expect(detectTransients(peaks, 20, { minGapMs: 200 })).toHaveLength(1);
  });

  it("separates onsets that are genuinely far apart", () => {
    const quiet = new Array(40).fill(0.1);
    const peaks = [...quiet, 1, ...quiet, 1, ...quiet];
    expect(detectTransients(peaks, 20, { minGapMs: 120 }).length).toBe(2);
  });

  it("returns the strongest onsets first and honours the limit", () => {
    const quiet = new Array(30).fill(0.1);
    const peaks = [...quiet, 0.6, ...quiet, 1, ...quiet, 0.8, ...quiet];
    const found = detectTransients(peaks, 20, { limit: 2 });
    expect(found).toHaveLength(2);
  });

  it("finds fewer onsets as sensitivity rises", () => {
    const quiet = new Array(20).fill(0.1);
    const peaks = [...quiet, 0.3, ...quiet, 1, ...quiet, 0.35, ...quiet];
    const loose = detectTransients(peaks, 20, { sensitivity: 1.2 });
    const strict = detectTransients(peaks, 20, { sensitivity: 6 });
    expect(strict.length).toBeLessThanOrEqual(loose.length);
  });
});

describe("analyzeAudioUrl", () => {
  it("decodes PCM sample bytes instead of reinterpreting encoded packet bytes as Float32", async () => {
    parseMediaMock.mockImplementationOnce(async (options: {
      onAudioTrack: (input: { track: unknown }) => Promise<((sample: { data: Uint8Array }) => void | Promise<void>) | null> | ((sample: { data: Uint8Array }) => void | Promise<void>) | null;
    }) => {
      const onSample = await options.onAudioTrack({
        track: {
          type: "audio",
          codec: "pcm-s16",
          codecEnum: "pcm-s16",
          sampleRate: 1_000,
          numberOfChannels: 1,
          timescale: 1_000_000,
        },
      });

      // Three little-endian signed 16-bit PCM samples: 0, +32767, -32768.
      // Six bytes deliberately reproduces the production exception from trying
      // to construct Float32Array directly over encoded/sample packet bytes.
      await onSample?.({ data: new Uint8Array([0, 0, 0xff, 0x7f, 0x00, 0x80]) });
      return { durationInSeconds: 0.003 };
    });

    const result = await analyzeAudioUrl("https://example.test/generated.wav", { peakWindowMs: 1 });

    expect(result.durationMs).toBe(3);
    expect(result.sampleRate).toBe(1_000);
    expect(result.peaks).toHaveLength(3);
    expect(result.peaks[0]).toBe(0);
    expect(result.peaks[1]).toBeCloseTo(1, 4);
    expect(result.peaks[2]).toBeCloseTo(1, 4);
  });
});

/**
 * The failure this guards against: analysis worked, was tested, was shipped —
 * and was unreachable for every asset the product makes.
 *
 * `analyzeAudioUrl` decoded PCM packets and threw on any compressed codec,
 * while speech is requested as response_format "mp3" and the music model
 * returns MP3 too. So `analyze_audio_asset` rejected the entire generated
 * catalogue and beat-aligned editing worked only on an uploaded WAV. Every
 * test passed throughout, because none of them used the format the product
 * actually produces.
 */
describe("analysis reaches the format the product generates", () => {
  it("analyses MP3 rather than rejecting it as a compressed codec", async () => {
    serveBytes(mp3Stream([120, 130, 190, 190]));

    const result = await analyzeAudioUrl("https://example.test/generated-speech.mp3");

    expect(result.envelopeSource).toBe("mp3-granule-gain");
    expect(result.peaks).toHaveLength(8); // two granules per frame
    expect(result.sampleRate).toBe(44_100);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(Math.max(...result.peaks)).toBe(1);
  });

  it("finds transients in generated audio, which is the whole point", async () => {
    const quiet = Array.from({ length: 20 }, () => 120);
    const loud = Array.from({ length: 10 }, () => 190);
    serveBytes(mp3Stream([...quiet, ...loud]));

    const result = await analyzeAudioUrl("https://example.test/generated-music.mp3");
    expect(result.transientsMs.length).toBeGreaterThan(0);
  });

  it("reports a granule window, finer than the PCM default", async () => {
    serveBytes(mp3Stream([120, 130]));
    const result = await analyzeAudioUrl("https://example.test/generated.mp3");
    expect(result.peakWindowMs).toBeLessThan(20);
  });

  it("still takes the PCM path for a WAV, and says so", async () => {
    parseMediaMock.mockImplementationOnce(async (options: {
      onAudioTrack: (input: { track: unknown }) => Promise<((sample: { data: Uint8Array }) => void) | null>;
    }) => {
      const onSample = await options.onAudioTrack({
        track: { type: "audio", codec: "pcm-s16", codecEnum: "pcm-s16", sampleRate: 1_000, numberOfChannels: 1 },
      });
      onSample?.({ data: new Uint8Array([0, 0, 0xff, 0x7f]) });
      return { durationInSeconds: 0.002 };
    });

    const result = await analyzeAudioUrl("https://example.test/uploaded.wav", { peakWindowMs: 1 });
    expect(result.envelopeSource).toBe("pcm");
  });

  it("says what is wrong when the bytes are not readable audio", async () => {
    // An empty envelope returned as success would look like a silent asset.
    serveBytes(new Uint8Array([0xff, 0xfb, 0x90, 0xc0, ...new Array(64).fill(0)]));
    await expect(analyzeAudioUrl("https://example.test/broken.mp3")).rejects.toThrow(/no readable MP3 frames/);
  });
});
