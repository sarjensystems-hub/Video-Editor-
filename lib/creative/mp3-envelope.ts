/**
 * An energy envelope read out of MP3 side info, without decoding the audio.
 *
 * Beat-aligned editing was unreachable for every asset this product actually
 * produces. `analyzeAudioUrl` decodes PCM packets, speech is requested as
 * `response_format: "mp3"`, and the music model returns MP3 too — so
 * `analyze_audio_asset` rejected the entire generated catalogue and worked
 * only on an uploaded WAV. "Cut to the music" was a feature you could not
 * reach from inside the product.
 *
 * A full MP3 decoder is Huffman tables, an IMDCT and a polyphase synthesis
 * filterbank: more than a thousand lines of arithmetic that would have to be
 * right, to produce samples that are then immediately thrown away in favour of
 * a coarse energy envelope. So we do not decode.
 *
 * Every Layer III granule carries `global_gain`, an 8-bit logarithmic
 * quantizer exponent, in its side info. It is the loudness the encoder chose
 * for those 576 samples, and it sits at a fixed bit offset that can be read
 * from the frame header and side info alone — no entropy decoding, no
 * transform. One granule is 576 samples, which is 13ms at 44.1kHz: finer than
 * the 20ms window the PCM path uses by default, so the envelope this produces
 * is if anything better resolved than the one it replaces.
 *
 * What it is not: an absolute measurement. `global_gain` tracks the signal's
 * magnitude but is a quantizer step, not an amplitude, and the encoder is free
 * to spend bits differently across frames. Onset detection reads *relative*
 * rises against a local average, which is exactly what this supports and why
 * the approximation is the right one — but a caller wanting true RMS should
 * know it is not getting it. `AudioAnalysis.envelopeSource` says which ruler
 * was used.
 *
 * Pure: bytes in, numbers out, no I/O.
 */

/** Layer III always codes 576 samples per granule, in every MPEG version. */
export const MP3_SAMPLES_PER_GRANULE = 576;

export type Mp3Version = "mpeg1" | "mpeg2" | "mpeg2.5";

export interface Mp3FrameHeader {
  version: Mp3Version;
  sampleRate: number;
  bitrateBps: number;
  channels: number;
  crcPresent: boolean;
  /** Total bytes of this frame, header included. */
  frameBytes: number;
  /** 2 for MPEG-1, 1 for the low sampling frequency extensions. */
  granules: number;
  samplesPerFrame: number;
  sideInfoBytes: number;
}

export interface Mp3Envelope {
  sampleRate: number;
  channels: number;
  durationMs: number;
  /** One value per granule, normalized so the loudest granule is 1. */
  envelope: number[];
  /** Milliseconds each envelope entry covers. */
  granuleMs: number;
  /** Audio frames read. Zero means this was not a parseable MP3 stream. */
  frames: number;
}

// Layer III bitrates in kbps, indexed by the header's 4-bit bitrate index.
// Index 0 is "free" and index 15 is invalid; both are refused rather than
// guessed, because a wrong frame size desynchronises everything after it.
const BITRATES_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_LSF = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

const SAMPLE_RATES: Record<Mp3Version, number[]> = {
  mpeg1: [44100, 48000, 32000],
  mpeg2: [22050, 24000, 16000],
  "mpeg2.5": [11025, 12000, 8000],
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * Byte offset of the first audio byte, skipping an ID3v2 tag if present.
 *
 * The tag's size is stored as four "syncsafe" bytes — seven bits each, so no
 * byte can be mistaken for a frame sync. Reading it as a plain 32-bit integer
 * overshoots and lands mid-stream.
 */
export function skipId3v2(bytes: Uint8Array): number {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return 0;
  const flags = bytes[5];
  const size = ((bytes[6] & 0x7f) << 21)
    | ((bytes[7] & 0x7f) << 14)
    | ((bytes[8] & 0x7f) << 7)
    | (bytes[9] & 0x7f);
  // Bit 4 of the flags adds a 10-byte footer after the tag body.
  const footer = flags & 0x10 ? 10 : 0;
  return Math.min(bytes.length, 10 + size + footer);
}

/**
 * Reads a Layer III frame header, or null if these four bytes are not one.
 *
 * Returning null rather than throwing is what makes resynchronisation
 * possible: a stream can carry ID3v1 trailers, APE tags or padding between
 * frames, and the reader simply advances a byte and asks again.
 */
export function readMp3FrameHeader(bytes: Uint8Array, offset: number): Mp3FrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];

  // 11 set bits of frame sync.
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03;
  if (versionBits === 0x01) return null; // reserved
  const version: Mp3Version = versionBits === 0x03 ? "mpeg1" : versionBits === 0x02 ? "mpeg2" : "mpeg2.5";

  // Only Layer III carries the granule side info this module reads.
  if (((b1 >> 1) & 0x03) !== 0x01) return null;

  const crcPresent = (b1 & 0x01) === 0;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const table = version === "mpeg1" ? BITRATES_MPEG1 : BITRATES_LSF;
  const bitrateKbps = table[bitrateIndex];
  if (!bitrateKbps) return null; // free-format or invalid: frame size is unknowable here

  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (sampleRateIndex === 0x03) return null;
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];

  const padding = (b2 >> 1) & 0x01;
  const channelMode = (b3 >> 6) & 0x03;
  const channels = channelMode === 0x03 ? 1 : 2;

  const granules = version === "mpeg1" ? 2 : 1;
  const samplesPerFrame = granules * MP3_SAMPLES_PER_GRANULE;
  const bitrateBps = bitrateKbps * 1000;
  const frameBytes = Math.floor((samplesPerFrame / 8) * bitrateBps / sampleRate) + padding;
  if (frameBytes <= 4) return null;

  // Side info is fixed-width per version and channel count.
  const sideInfoBytes = version === "mpeg1"
    ? (channels === 1 ? 17 : 32)
    : (channels === 1 ? 9 : 17);

  return {
    version,
    sampleRate,
    bitrateBps,
    channels,
    crcPresent,
    frameBytes,
    granules,
    samplesPerFrame,
    sideInfoBytes,
  };
}

/** Reads `count` bits big-endian starting at an absolute bit position. */
function readBits(bytes: Uint8Array, bitOffset: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i += 1) {
    const bit = bitOffset + i;
    const byte = bytes[bit >> 3];
    if (byte === undefined) return value << (count - i - 1);
    value = (value << 1) | ((byte >> (7 - (bit & 7))) & 1);
  }
  return value;
}

/**
 * `global_gain` for every granule and channel of one frame.
 *
 * The side info block layout differs between MPEG-1 and the low sampling
 * frequency versions in its preamble and in the per-granule block width, but
 * `global_gain` sits at bit 21 of each block in both — after `part2_3_length`
 * (12 bits) and `big_values` (9). Deriving the offset from the two fields in
 * front of it, rather than hard-coding 21, is what keeps this readable against
 * the spec.
 */
export function readGranuleGains(
  bytes: Uint8Array,
  frameOffset: number,
  header: Mp3FrameHeader,
): number[][] {
  const sideInfoStart = frameOffset + 4 + (header.crcPresent ? 2 : 0);
  const base = sideInfoStart * 8;

  const PART2_3_LENGTH_BITS = 12;
  const BIG_VALUES_BITS = 9;
  const GLOBAL_GAIN_BITS = 8;
  const gainOffsetInBlock = PART2_3_LENGTH_BITS + BIG_VALUES_BITS;

  // MPEG-1: main_data_begin(9) + private(5 mono / 3 stereo) + scfsi(4 per channel).
  // LSF:    main_data_begin(8) + private(1 mono / 2 stereo), and no scfsi.
  const preambleBits = header.version === "mpeg1"
    ? 9 + (header.channels === 1 ? 5 : 3) + 4 * header.channels
    : 8 + (header.channels === 1 ? 1 : 2);
  // The blocks differ only in the width of `scalefac_compress` and the
  // window-switching fields that follow the gain, which we never read.
  const blockBits = header.version === "mpeg1" ? 59 : 63;

  const gains: number[][] = [];
  for (let granule = 0; granule < header.granules; granule += 1) {
    const perChannel: number[] = [];
    for (let channel = 0; channel < header.channels; channel += 1) {
      const blockIndex = granule * header.channels + channel;
      const bitOffset = base + preambleBits + blockIndex * blockBits + gainOffsetInBlock;
      perChannel.push(readBits(bytes, bitOffset, GLOBAL_GAIN_BITS));
    }
    gains.push(perChannel);
  }
  return gains;
}

/**
 * Amplitude implied by a granule's `global_gain`.
 *
 * The requantization in the standard scales coefficients by
 * `2^((global_gain - 210) / 4)`; that factor is the encoder's own statement of
 * how loud the granule is, so it is what the envelope is built from. Channels
 * are averaged as amplitudes rather than as gains, because the gains are
 * logarithmic and averaging them would understate the louder channel.
 */
export function gainToAmplitude(globalGain: number): number {
  return Math.pow(2, (globalGain - 210) / 4);
}

/**
 * Whether this frame's main data is a VBR header rather than audio.
 *
 * Encoders put Xing/Info/VBRI metadata in the first frame, which is silent and
 * whose `global_gain` is meaningless. Counting it produces a phantom onset at
 * time zero, which is exactly the kind of thing an assistant would then cut to.
 */
export function isVbrHeaderFrame(bytes: Uint8Array, frameOffset: number, header: Mp3FrameHeader): boolean {
  const afterSideInfo = frameOffset + 4 + (header.crcPresent ? 2 : 0) + header.sideInfoBytes;
  const tag = ascii(bytes, afterSideInfo, 4);
  if (tag === "Xing" || tag === "Info") return true;
  return ascii(bytes, frameOffset + 36, 4) === "VBRI";
}

/**
 * The whole stream's envelope, one entry per granule.
 *
 * Frames are walked by their computed size rather than by scanning for the
 * next sync word, because a sync pattern occurs naturally inside compressed
 * data often enough that scanning finds false frames. When a computed jump
 * does not land on a valid header — a trailing tag, a truncated file — the
 * reader resynchronises by advancing one byte at a time, bounded, and stops
 * if it cannot find its footing again.
 */
export function parseMp3Envelope(bytes: Uint8Array): Mp3Envelope {
  let offset = skipId3v2(bytes);
  let header: Mp3FrameHeader | null = null;
  let frames = 0;
  const amplitudes: number[] = [];

  // Bounded resynchronisation, so a corrupt stream cannot spin.
  const RESYNC_LIMIT = 1 << 16;

  while (offset + 4 <= bytes.length) {
    const parsed = readMp3FrameHeader(bytes, offset);
    if (!parsed) {
      let scanned = 0;
      let found: Mp3FrameHeader | null = null;
      while (offset + 4 <= bytes.length && scanned < RESYNC_LIMIT) {
        offset += 1;
        scanned += 1;
        found = readMp3FrameHeader(bytes, offset);
        if (found) break;
      }
      if (!found) break;
      continue;
    }

    if (!header) header = parsed;

    if (isVbrHeaderFrame(bytes, offset, parsed)) {
      offset += parsed.frameBytes;
      continue;
    }

    // A frame whose declared size runs past the end of the buffer is
    // truncated; its side info may still be complete, but counting it would
    // overstate the duration, so it is dropped.
    if (offset + parsed.frameBytes > bytes.length) break;

    for (const perChannel of readGranuleGains(bytes, offset, parsed)) {
      const sum = perChannel.reduce((total, gain) => total + gainToAmplitude(gain), 0);
      amplitudes.push(sum / perChannel.length);
    }
    frames += 1;
    offset += parsed.frameBytes;
  }

  const sampleRate = header?.sampleRate ?? 44100;
  const granuleMs = (MP3_SAMPLES_PER_GRANULE / sampleRate) * 1000;
  const loudest = amplitudes.reduce((max, value) => Math.max(max, value), 0);

  return {
    sampleRate,
    channels: header?.channels ?? 0,
    durationMs: Math.round(amplitudes.length * granuleMs),
    envelope: loudest > 0 ? amplitudes.map((value) => value / loudest) : amplitudes,
    granuleMs,
    frames,
  };
}
