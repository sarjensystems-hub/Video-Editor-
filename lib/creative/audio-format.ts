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
