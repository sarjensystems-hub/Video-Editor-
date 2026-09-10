import { describe, expect, it } from "vitest";
import {
  audioContentTypeFor,
  containerFromFormat,
  resolveAudioContainer,
  sniffAudioContainer,
} from "./audio-format";

function header(...parts: Array<string | number[]>): Uint8Array {
  const bytes: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const char of part) bytes.push(char.charCodeAt(0));
    else bytes.push(...part);
  }
  while (bytes.length < 16) bytes.push(0);
  return Uint8Array.from(bytes);
}

describe("audio container sniffing", () => {
  it("recognises the containers a generator can return", () => {
    expect(sniffAudioContainer(header("RIFF", [0, 0, 0, 0], "WAVE"))).toBe("wav");
    expect(sniffAudioContainer(header("fLaC"))).toBe("flac");
    expect(sniffAudioContainer(header("OggS"))).toBe("ogg");
    expect(sniffAudioContainer(header([0, 0, 0, 0], "ftypM4A "))).toBe("m4a");
    expect(sniffAudioContainer(header("ID3", [3, 0]))).toBe("mp3");
    // Bare MP3 frame sync, no ID3 tag.
    expect(sniffAudioContainer(header([0xff, 0xfb, 0x90, 0x00]))).toBe("mp3");
  });

  it("returns null rather than guessing at an unrecognised stream", () => {
    expect(sniffAudioContainer(header("NOPE"))).toBeNull();
    expect(sniffAudioContainer(Uint8Array.from([1, 2, 3]))).toBeNull();
  });

  it("does not mistake RIFF for WAVE when the form type is something else", () => {
    // RIFF is a generic container; AVI shares the magic number.
    expect(sniffAudioContainer(header("RIFF", [0, 0, 0, 0], "AVI "))).toBeNull();
  });
});

describe("resolving a generator's container", () => {
  it("believes the bytes over the declared format", () => {
    // The exact Lyria case: MP3 payload, declared (defaulted) as wav.
    const mp3 = header("ID3", [3, 0]);
    expect(resolveAudioContainer(mp3, "wav")).toBe("mp3");
    expect(audioContentTypeFor(resolveAudioContainer(mp3, "wav"))).toBe("audio/mpeg");
  });

  it("falls back to the declared format only when the bytes are unrecognised", () => {
    const unknown = header("NOPE");
    expect(resolveAudioContainer(unknown, "flac")).toBe("flac");
  });

  it("defaults to mp3 when nothing identifies the stream", () => {
    // mp3, not wav: every OpenRouter audio model observed returns mp3, and the
    // wav default is what mislabelled every generated music asset.
    expect(resolveAudioContainer(header("NOPE"), null)).toBe("mp3");
    expect(resolveAudioContainer(header("NOPE"), "something-else")).toBe("mp3");
  });

  it("maps the format aliases a provider might send", () => {
    expect(containerFromFormat("WAVE")).toBe("wav");
    expect(containerFromFormat("mpeg")).toBe("mp3");
    expect(containerFromFormat("aac")).toBe("m4a");
    expect(containerFromFormat("opus")).toBe("ogg");
    expect(containerFromFormat("")).toBeNull();
    expect(containerFromFormat(undefined)).toBeNull();
  });
});
