import { describe, expect, it } from "vitest";
import {
  MP3_SAMPLES_PER_GRANULE,
  gainToAmplitude,
  isVbrHeaderFrame,
  parseMp3Envelope,
  readGranuleGains,
  readMp3FrameHeader,
  skipId3v2,
} from "./mp3-envelope";
import { detectTransients } from "./audio-analysis-base";

/**
 * Writes `count` bits big-endian at an absolute bit position, mirroring the
 * reader in the module. Tests build real frame bytes rather than mocking the
 * parse, because the whole risk in this module is bit arithmetic: a fixture
 * that agreed with a wrong reader would prove nothing.
 */
function writeBits(bytes: Uint8Array, bitOffset: number, value: number, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const bit = (value >> (count - i - 1)) & 1;
    const position = bitOffset + i;
    const mask = 1 << (7 - (position & 7));
    if (bit) bytes[position >> 3] |= mask;
    else bytes[position >> 3] &= ~mask;
  }
}

// MPEG-1 Layer III, 128kbps, 44.1kHz, no CRC, mono.
const MONO_HEADER = [0xff, 0xfb, 0x90, 0xc0];
const MONO_FRAME_BYTES = 417; // floor(144 * 128000 / 44100)
const MONO_PREAMBLE_BITS = 9 + 5 + 4; // main_data_begin + private + scfsi
const GAIN_OFFSET_IN_BLOCK = 12 + 9; // after part2_3_length and big_values
const MPEG1_BLOCK_BITS = 59;

function monoFrame(granuleGains: [number, number]): Uint8Array {
  const frame = new Uint8Array(MONO_FRAME_BYTES);
  frame.set(MONO_HEADER, 0);
  const base = 4 * 8; // side info starts right after the header (no CRC)
  for (let granule = 0; granule < 2; granule += 1) {
    const offset = base + MONO_PREAMBLE_BITS + granule * MPEG1_BLOCK_BITS + GAIN_OFFSET_IN_BLOCK;
    writeBits(frame, offset, granuleGains[granule], 8);
  }
  return frame;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe("skipId3v2", () => {
  it("returns zero when there is no tag", () => {
    expect(skipId3v2(new Uint8Array([0xff, 0xfb, 0x90, 0xc0]))).toBe(0);
  });

  it("reads the size as syncsafe rather than as a plain integer", () => {
    // 0x00 0x00 0x02 0x01 syncsafe is (2 << 7) | 1 = 257, not 513.
    const tag = new Uint8Array(300);
    tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x02, 0x01], 0);
    expect(skipId3v2(tag)).toBe(10 + 257);
  });

  it("counts the footer when the flag is set", () => {
    const tag = new Uint8Array(300);
    tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x10, 0x00, 0x00, 0x02, 0x01], 0);
    expect(skipId3v2(tag)).toBe(10 + 257 + 10);
  });
});

describe("readMp3FrameHeader", () => {
  it("reads an MPEG-1 Layer III frame", () => {
    const header = readMp3FrameHeader(new Uint8Array(MONO_HEADER), 0);
    expect(header).toBeTruthy();
    expect(header!.version).toBe("mpeg1");
    expect(header!.sampleRate).toBe(44100);
    expect(header!.bitrateBps).toBe(128_000);
    expect(header!.channels).toBe(1);
    expect(header!.granules).toBe(2);
    expect(header!.samplesPerFrame).toBe(1152);
    expect(header!.sideInfoBytes).toBe(17);
    expect(header!.frameBytes).toBe(MONO_FRAME_BYTES);
  });

  it("sizes a stereo frame's side info at 32 bytes", () => {
    // Channel mode 00 is stereo; everything else identical.
    const header = readMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), 0);
    expect(header!.channels).toBe(2);
    expect(header!.sideInfoBytes).toBe(32);
  });

  it("adds the padding byte when the padding bit is set", () => {
    const padded = readMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x92, 0xc0]), 0);
    expect(padded!.frameBytes).toBe(MONO_FRAME_BYTES + 1);
  });

  it("reads MPEG-2 as one granule with its own bitrate table", () => {
    // Version 10 = MPEG-2, bitrate index 9 = 80kbps on the LSF table, 22050Hz.
    const header = readMp3FrameHeader(new Uint8Array([0xff, 0xf3, 0x90, 0xc0]), 0);
    expect(header!.version).toBe("mpeg2");
    expect(header!.sampleRate).toBe(22050);
    expect(header!.bitrateBps).toBe(80_000);
    expect(header!.granules).toBe(1);
    expect(header!.samplesPerFrame).toBe(576);
    expect(header!.sideInfoBytes).toBe(9);
    expect(header!.frameBytes).toBe(Math.floor((576 / 8) * 80_000 / 22050));
  });

  it("refuses anything it cannot size, rather than guessing", () => {
    // A wrong frame size desynchronises every frame after it, so each of these
    // must return null and let the caller resynchronise.
    expect(readMp3FrameHeader(new Uint8Array([0x00, 0xfb, 0x90, 0xc0]), 0), "bad sync").toBeNull();
    expect(readMp3FrameHeader(new Uint8Array([0xff, 0xeb, 0x90, 0xc0]), 0), "reserved version").toBeNull();
    expect(readMp3FrameHeader(new Uint8Array([0xff, 0xfd, 0x90, 0xc0]), 0), "layer II").toBeNull();
    expect(readMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x00, 0xc0]), 0), "free bitrate").toBeNull();
    expect(readMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0xf0, 0xc0]), 0), "invalid bitrate").toBeNull();
    expect(readMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x9c, 0xc0]), 0), "invalid sample rate").toBeNull();
    expect(readMp3FrameHeader(new Uint8Array([0xff, 0xfb]), 0), "truncated").toBeNull();
  });
});

describe("readGranuleGains", () => {
  it("reads each granule's gain from its own block", () => {
    const frame = monoFrame([120, 200]);
    const header = readMp3FrameHeader(frame, 0)!;
    expect(readGranuleGains(frame, 0, header)).toEqual([[120], [200]]);
  });

  it("reads both channels of a stereo frame", () => {
    // Stereo: preamble is 9 + 3 private + 4 scfsi per channel, four blocks.
    const frame = new Uint8Array(418);
    frame.set([0xff, 0xfb, 0x90, 0x00], 0);
    const base = 4 * 8;
    const preamble = 9 + 3 + 4 * 2;
    const gains = [10, 20, 30, 40];
    for (let block = 0; block < 4; block += 1) {
      writeBits(frame, base + preamble + block * MPEG1_BLOCK_BITS + GAIN_OFFSET_IN_BLOCK, gains[block], 8);
    }
    const header = readMp3FrameHeader(frame, 0)!;
    expect(readGranuleGains(frame, 0, header)).toEqual([[10, 20], [30, 40]]);
  });

  it("skips the CRC when one is present", () => {
    // Protection bit clear means a 2-byte CRC sits between header and side info.
    const frame = new Uint8Array(MONO_FRAME_BYTES);
    frame.set([0xff, 0xfa, 0x90, 0xc0], 0);
    const base = (4 + 2) * 8;
    writeBits(frame, base + MONO_PREAMBLE_BITS + GAIN_OFFSET_IN_BLOCK, 175, 8);
    const header = readMp3FrameHeader(frame, 0)!;
    expect(header.crcPresent).toBe(true);
    expect(readGranuleGains(frame, 0, header)[0]).toEqual([175]);
  });
});

describe("gainToAmplitude", () => {
  it("follows the requantization scale from the standard", () => {
    expect(gainToAmplitude(210)).toBeCloseTo(1, 10);
    expect(gainToAmplitude(214)).toBeCloseTo(2, 10);
    expect(gainToAmplitude(206)).toBeCloseTo(0.5, 10);
  });

  it("is monotonic, which is all the envelope depends on", () => {
    for (let gain = 1; gain < 256; gain += 1) {
      expect(gainToAmplitude(gain)).toBeGreaterThan(gainToAmplitude(gain - 1));
    }
  });
});

describe("parseMp3Envelope", () => {
  it("returns one entry per granule, normalized to the loudest", () => {
    const stream = concat([monoFrame([100, 120]), monoFrame([140, 160])]);
    const envelope = parseMp3Envelope(stream);

    expect(envelope.frames).toBe(2);
    expect(envelope.envelope).toHaveLength(4);
    expect(envelope.sampleRate).toBe(44100);
    expect(envelope.channels).toBe(1);
    expect(Math.max(...envelope.envelope)).toBe(1);
    // Gains rise monotonically, so the envelope must too.
    for (let i = 1; i < envelope.envelope.length; i += 1) {
      expect(envelope.envelope[i]).toBeGreaterThan(envelope.envelope[i - 1]);
    }
  });

  it("times each entry at one granule, not one frame", () => {
    const envelope = parseMp3Envelope(concat([monoFrame([120, 120]), monoFrame([120, 120])]));
    expect(envelope.granuleMs).toBeCloseTo((MP3_SAMPLES_PER_GRANULE / 44100) * 1000, 10);
    expect(envelope.durationMs).toBe(Math.round(4 * envelope.granuleMs));
  });

  it("skips an ID3v2 tag before the first frame", () => {
    const tag = new Uint8Array(10 + 64);
    tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40], 0);
    const envelope = parseMp3Envelope(concat([tag, monoFrame([120, 130])]));
    expect(envelope.frames).toBe(1);
    expect(envelope.envelope).toHaveLength(2);
  });

  it("does not count a Xing header frame as audio", () => {
    // Its main data is metadata, not sound; counting it invents an onset at
    // time zero, which is exactly what an assistant would then cut to.
    const xing = monoFrame([255, 255]);
    xing.set([0x58, 0x69, 0x6e, 0x67], 4 + 17); // "Xing" after the side info
    const envelope = parseMp3Envelope(concat([xing, monoFrame([120, 130])]));
    expect(envelope.frames).toBe(1);
    expect(envelope.envelope).toHaveLength(2);
  });

  it("resynchronises past garbage between frames", () => {
    const stream = concat([monoFrame([120, 130]), new Uint8Array(23), monoFrame([140, 150])]);
    expect(parseMp3Envelope(stream).frames).toBe(2);
  });

  it("drops a truncated trailing frame rather than overstating the duration", () => {
    const stream = concat([monoFrame([120, 130]), monoFrame([140, 150]).slice(0, 200)]);
    expect(parseMp3Envelope(stream).frames).toBe(1);
  });

  it("returns an empty envelope for bytes that are not an MP3 at all", () => {
    const envelope = parseMp3Envelope(new Uint8Array(4096));
    expect(envelope.frames).toBe(0);
    expect(envelope.envelope).toEqual([]);
    expect(envelope.durationMs).toBe(0);
  });
});

/**
 * The point of the module: the envelope has to be usable by the onset picker
 * that already exists, at a resolution fine enough to cut to.
 */
describe("the envelope drives the existing transient detector", () => {
  it("finds the moment a quiet passage turns loud", () => {
    const quiet = Array.from({ length: 20 }, () => monoFrame([120, 120]));
    const loud = Array.from({ length: 10 }, () => monoFrame([190, 190]));
    const envelope = parseMp3Envelope(concat([...quiet, ...loud]));

    const onsets = detectTransients(envelope.envelope, envelope.granuleMs);
    expect(onsets.length).toBeGreaterThan(0);

    // 40 quiet granules precede the jump.
    const expectedMs = 40 * envelope.granuleMs;
    expect(Math.min(...onsets.map((time) => Math.abs(time - expectedMs)))).toBeLessThan(
      envelope.granuleMs * 2,
    );
  });

  it("resolves finer than the 20ms window the PCM path uses by default", () => {
    const envelope = parseMp3Envelope(concat([monoFrame([120, 120])]));
    expect(envelope.granuleMs).toBeLessThan(20);
  });
});
