/**
 * Identifies an audio container from its own bytes.
 *
 * The generator's declared format cannot be trusted. OpenRouter's Lyria
 * response carries no `format` field, so the declared-type path fell through
 * to its "wav" default while the payload was actually MP3 — every generated
 * music asset was stored as `.wav` with `audio/wav` over MP3 bytes, and
 * studio_analyze_audio_asset refused all of them because the container
 * did not match the label.
 *
 * Sniffing is authoritative where it matches, because a magic number is what
 * the decoder will read too.
 */

export type AudioContainer = "wav" | "mp3" | "flac" | "ogg" | "m4a";

const CONTENT_TYPES: Record<AudioContainer, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/** Returns the container a byte stream actually is, or null if unrecognised. */
export function sniffAudioContainer(bytes: Uint8Array): AudioContainer | null {
  if (bytes.length < 12) return null;

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "wav";
  if (ascii(bytes, 0, 4) === "fLaC") return "flac";
  if (ascii(bytes, 0, 4) === "OggS") return "ogg";
  // ISO base media: "ftyp" at offset 4 covers m4a/mp4 audio.
  if (ascii(bytes, 4, 4) === "ftyp") return "m4a";
  // MP3 with an ID3v2 tag, or a bare frame sync (11 set bits).
  if (ascii(bytes, 0, 3) === "ID3") return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";

  return null;
}

/** Maps a declared format string onto a container, or null when unrecognised. */
export function containerFromFormat(format: string | null | undefined): AudioContainer | null {
  switch ((format ?? "").trim().toLowerCase()) {
    case "wav":
    case "wave":
      return "wav";
    case "mp3":
    case "mpeg":
      return "mp3";
    case "flac":
      return "flac";
    case "ogg":
    case "opus":
      return "ogg";
    case "m4a":
    case "mp4":
    case "aac":
      return "m4a";
    default:
      return null;
  }
}

export function audioContentTypeFor(container: AudioContainer): string {
  return CONTENT_TYPES[container];
}

export function audioExtensionFor(container: AudioContainer): string {
  return container;
}

/**
 * Resolves the container for generated audio, preferring what the bytes say.
 *
 * The declared format is only a fallback for a stream we cannot recognise, and
 * mp3 is the final default because that is what every OpenRouter audio model
 * has actually returned.
 */
export function resolveAudioContainer(
  bytes: Uint8Array,
  declaredFormat?: string | null,
): AudioContainer {
  return sniffAudioContainer(bytes) ?? containerFromFormat(declaredFormat) ?? "mp3";
}

/** Raw PCM has no header, so its shape has to be carried alongside the bytes. */
export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/** Exact playing time of a raw PCM buffer. No estimation: it is arithmetic. */
export function pcmDurationMs(byteLength: number, format: PcmFormat): number {
  const bytesPerFrame = (format.bitsPerSample / 8) * format.channels;
  if (bytesPerFrame <= 0) throw new Error("PCM format must have positive channels and bit depth");
  return (byteLength / bytesPerFrame / format.sampleRate) * 1000;
}

/**
 * Wraps raw PCM in a canonical 44-byte RIFF/WAVE header.
 *
 * Gemini TTS returns headerless PCM, and headerless PCM is the one thing
 * `sniffAudioContainer` cannot recognise - it has no magic number, so it would
 * fall through to the "mp3" default and be stored as `.mp3` over bytes that are
 * not MP3 at all. Nothing downstream would play it.
 *
 * Wrapping rather than transcoding is deliberate: it is lossless, it costs one
 * header, and `pcm-s16` is already a first-class codec in the analysis path, so
 * a wrapped voiceover measures and analyses through code that already exists
 * rather than a second decoder written for this one provider.
 */
export function wrapPcmInWav(pcm: Uint8Array, format: PcmFormat): Buffer {
  const { sampleRate, channels, bitsPerSample } = format;
  if (sampleRate <= 0 || channels <= 0 || bitsPerSample <= 0) {
    throw new Error("PCM format must have positive sample rate, channels and bit depth");
  }
  const blockAlign = (bitsPerSample / 8) * channels;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}
