/**
 * Waveform and transient analysis.
 *
 * This is what turns "cut to the music" from a guess into an instruction.
 * Without it an assistant can only align visual events to timestamps it
 * invented; with it, it can ask where the beats actually are.
 *
 * Analysis is expensive relative to rendering, so results are meant to be
 * cached on the asset record and never recomputed per render. Nothing here
 * runs during rendering.
 *
 * The pure parts — RMS windowing and onset picking — are separated from the
 * decode so they can be tested without an audio file.
 */

export interface AudioAnalysis {
  durationMs: number;
  sampleRate: number;
  /** Normalized 0..1 RMS peaks, one per window. */
  peaks: number[];
  /** Milliseconds covered by each peak. */
  peakWindowMs: number;
  /** Detected onset times in milliseconds, strongest first. */
  transientsMs: number[];
  /**
   * Which ruler produced `peaks`.
   *
   * "pcm" is true RMS over decoded samples. "mp3-granule-gain" is derived from
   * each MP3 granule's `global_gain` without decoding — see mp3-envelope.ts.
   * Both are normalized to their own loudest window, so onset detection reads
   * the same either way, but a caller wanting absolute loudness should know it
   * is not getting it from the second.
   */
  envelopeSource: "pcm" | "mp3-granule-gain";
}

/** RMS energy per fixed window, normalized so the loudest window is 1. */
export function computeRmsPeaks(samples: Float32Array, samplesPerWindow: number): number[] {
  if (samplesPerWindow <= 0) throw new Error("samplesPerWindow must be positive");
  const peaks: number[] = [];
  for (let start = 0; start < samples.length; start += samplesPerWindow) {
    let sum = 0;
    const end = Math.min(start + samplesPerWindow, samples.length);
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
    peaks.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const loudest = peaks.reduce((max, peak) => Math.max(max, peak), 0);
  return loudest > 0 ? peaks.map((peak) => peak / loudest) : peaks;
}

/**
 * Picks onsets by positive spectral flux on the energy envelope.
 *
 * A transient is a window whose energy rises sharply above the local
 * average. `minGapMs` stops a single drum hit registering as several
 * adjacent onsets, which is what makes the output usable as cut points
 * rather than as noise.
 */
export function detectTransients(
  peaks: number[],
  peakWindowMs: number,
  options: { sensitivity?: number; minGapMs?: number; limit?: number } = {},
): number[] {
  const sensitivity = options.sensitivity ?? 1.5;
  const minGapMs = options.minGapMs ?? 120;
  const limit = options.limit ?? 32;
  if (peaks.length < 3) return [];

  const lookback = Math.max(2, Math.round(300 / Math.max(1, peakWindowMs)));
  const candidates: Array<{ timeMs: number; strength: number }> = [];

  for (let i = 1; i < peaks.length; i += 1) {
    const rise = peaks[i] - peaks[i - 1];
    if (rise <= 0) continue;
    const from = Math.max(0, i - lookback);
    const window = peaks.slice(from, i);
    const average = window.reduce((sum, peak) => sum + peak, 0) / Math.max(1, window.length);
    if (peaks[i] > average * sensitivity) {
      candidates.push({ timeMs: Math.round(i * peakWindowMs), strength: rise });
    }
  }

  // Strongest first, then drop anything too close to an already-picked onset.
  candidates.sort((a, b) => b.strength - a.strength);
  const picked: Array<{ timeMs: number; strength: number }> = [];
  for (const candidate of candidates) {
    if (picked.some((other) => Math.abs(other.timeMs - candidate.timeMs) < minGapMs)) continue;
    picked.push(candidate);
    if (picked.length >= limit) break;
  }
  return picked.map((candidate) => candidate.timeMs);
}

type PcmCodec = "pcm-u8" | "pcm-s16" | "pcm-s24" | "pcm-s32" | "pcm-f32";

function isPcmCodec(codec: string): codec is PcmCodec {
  return codec === "pcm-u8"
    || codec === "pcm-s16"
    || codec === "pcm-s24"
    || codec === "pcm-s32"
    || codec === "pcm-f32";
}

function bytesPerPcmSample(codec: PcmCodec): number {
  switch (codec) {
    case "pcm-u8": return 1;
    case "pcm-s16": return 2;
    case "pcm-s24": return 3;
    case "pcm-s32":
    case "pcm-f32": return 4;
  }
}

function readPcmSample(view: DataView, offset: number, codec: PcmCodec): number {
  switch (codec) {
    case "pcm-u8":
      return (view.getUint8(offset) - 128) / 128;
    case "pcm-s16":
      return view.getInt16(offset, true) / 32768;
    case "pcm-s24": {
      const raw = view.getUint8(offset)
        | (view.getUint8(offset + 1) << 8)
        | (view.getUint8(offset + 2) << 16);
      const signed = raw & 0x800000 ? raw | 0xff000000 : raw;
      return signed / 8388608;
    }
    case "pcm-s32":
      return view.getInt32(offset, true) / 2147483648;
    case "pcm-f32": {
      const value = view.getFloat32(offset, true);
      return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    }
  }
}

/**
 * Remotion media-parser's onAudioTrack callback receives encoded/sample packet
 * bytes, not decoded Float32 waveform data. For PCM tracks those packet bytes
 * already contain the samples, so decode them explicitly and down-mix channels
 * to mono for analysis. Compressed codecs need a real decoder and are rejected
 * rather than being silently reinterpreted as bogus floats.
 */
export function decodePcmPacket(
  data: Uint8Array,
  codec: string,
  numberOfChannels: number,
): Float32Array {
  if (!isPcmCodec(codec)) {
    throw new Error(`Audio analysis cannot decode compressed codec "${codec}" in the server runtime`);
  }
  if (!Number.isInteger(numberOfChannels) || numberOfChannels <= 0) {
    throw new Error("Audio analysis requires a positive channel count");
  }

  const bytesPerSample = bytesPerPcmSample(codec);
  const bytesPerFrame = bytesPerSample * numberOfChannels;
  if (data.byteLength % bytesPerFrame !== 0) {
    throw new Error(
      `PCM packet byte length ${data.byteLength} is not aligned to ${numberOfChannels} channel(s) of ${codec}`,
    );
  }

  const frameCount = data.byteLength / bytesPerFrame;
  const mono = new Float32Array(frameCount);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    const frameOffset = frame * bytesPerFrame;
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      sum += readPcmSample(view, frameOffset + channel * bytesPerSample, codec);
    }
    mono[frame] = sum / numberOfChannels;
  }

  return mono;
}

/**
 * Decodes an audio URL and analyses it.
 *
 * Uses Remotion's media parser rather than shelling out to ffmpeg, so the
 * dependency is one already pinned for rendering. The current server-side
 * path supports PCM tracks (including the WAV returned by Lyria); compressed
 * codecs are rejected clearly instead of producing invalid waveform data.
 */
export async function analyzeAudioUrl(
  url: string,
  options: { peakWindowMs?: number } = {},
): Promise<AudioAnalysis> {
  const peakWindowMs = options.peakWindowMs ?? 20;

  // Every asset this product generates is MP3: speech is requested as
  // response_format "mp3" and the music model returns MP3 too. Decoding one
  // needs a real decoder, so the envelope is read from granule side info
  // instead. Without this branch analyze_audio_asset throws for the entire
  // generated catalogue and beat-aligned editing is reachable only for an
  // uploaded WAV.
  const mp3 = await readMp3AnalysisIfMp3(url);
  if (mp3) return mp3;

  const { parseMedia } = await import("@remotion/media-parser");

  const channels: Float32Array[] = [];
  let sampleRate = 48_000;
  let durationMs = 0;

  const result = await parseMedia({
    src: url,
    acknowledgeRemotionLicense: true,
    fields: { durationInSeconds: true },
    onAudioTrack: ({ track }) => {
      sampleRate = track.sampleRate ?? sampleRate;
      const codec = track.codecEnum ?? track.codec;
      const numberOfChannels = track.numberOfChannels;
      return (sample) => {
        if (sample.data) channels.push(decodePcmPacket(sample.data, codec, numberOfChannels));
      };
    },
  });

  durationMs = Math.round((result.durationInSeconds ?? 0) * 1000);

  const total = channels.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of channels) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }

  const samplesPerWindow = Math.max(1, Math.round((sampleRate * peakWindowMs) / 1000));
  const peaks = computeRmsPeaks(samples, samplesPerWindow);
  return {
    durationMs,
    sampleRate,
    peaks,
    peakWindowMs,
    transientsMs: detectTransients(peaks, peakWindowMs),
    envelopeSource: "pcm",
  };
}

/**
 * The MP3 analysis path, or null when the stream is not an MP3.
 *
 * One download either way: the bytes are fetched once and sniffed, and an MP3
 * is analysed from exactly those bytes. A non-MP3 falls back to the media
 * parser, which fetches the URL itself — one extra download for the uploaded
 * WAV minority, and none for the generated MP3 majority.
 *
 * `peakWindowMs` is ignored here and reported as the granule duration instead.
 * A granule is 576 samples whatever the caller asked for, and re-windowing an
 * envelope that is already finer than the 20ms default would only blur it.
 */
async function readMp3AnalysisIfMp3(url: string): Promise<AudioAnalysis | null> {
  const { sniffAudioContainer } = await import("./audio-format");
  const { parseMp3Envelope } = await import("./mp3-envelope");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audio asset could not be read (HTTP ${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sniffAudioContainer(bytes) !== "mp3") return null;

  const envelope = parseMp3Envelope(bytes);
  if (!envelope.frames) {
    throw new Error("Audio analysis found no readable MP3 frames in this asset");
  }

  return {
    durationMs: envelope.durationMs,
    sampleRate: envelope.sampleRate,
    peaks: envelope.envelope,
    peakWindowMs: envelope.granuleMs,
    transientsMs: detectTransients(envelope.envelope, envelope.granuleMs),
    envelopeSource: "mp3-granule-gain",
  };
}
