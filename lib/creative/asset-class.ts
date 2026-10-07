/**
 * What an asset is for, as opposed to what format it is in.
 *
 * `kind` says image, video or audio; the class says logo or product shot,
 * narration or music. The assistant needs the second to use an upload
 * correctly — a voiceover goes on the timeline under the scenes it speaks
 * over, a music bed runs the whole film and ducks under that voice, a logo
 * belongs in the outro rather than behind a headline.
 *
 * Every asset carries one, uploaded or generated: generators assign theirs
 * from what they made, uploads from the class the person picked.
 */

export type CreativeAssetMediaKind = "image" | "video" | "audio" | "font" | "other";

export const CREATIVE_ASSET_CLASSES = {
  footage:    { kind: "video", label: "Video footage",  hint: "Clips to cut into scenes" },
  render:     { kind: "video", label: "Exported film",  hint: "A finished render from this studio" },
  image:      { kind: "image", label: "Image",          hint: "Photos and illustrations" },
  product:    { kind: "image", label: "Product shot",   hint: "The thing being sold or shown" },
  logo:       { kind: "image", label: "Logo / brand",   hint: "Marks, wordmarks, brand art" },
  character:  { kind: "image", label: "Character",      hint: "A person or mascot to keep consistent" },
  background: { kind: "image", label: "Background",     hint: "Full-frame plates and textures" },
  narration:  { kind: "audio", label: "Narration",      hint: "Voiceover to place under scenes" },
  music:      { kind: "audio", label: "Music",          hint: "A bed that runs under the film" },
  sfx:        { kind: "audio", label: "Sound effect",   hint: "Short hits, whooshes, clicks" },
  font:       { kind: "font",  label: "Font",           hint: "A typeface for text layers" },
  other:      { kind: "other", label: "Other",          hint: "Anything else" },
} as const satisfies Record<string, { kind: CreativeAssetMediaKind; label: string; hint: string }>;

export type CreativeAssetClass = keyof typeof CREATIVE_ASSET_CLASSES;
export const CREATIVE_ASSET_CLASS_IDS = Object.keys(CREATIVE_ASSET_CLASSES) as CreativeAssetClass[];

/** The classes a file of this kind may take, most common first. */
export function assetClassesForKind(kind: string): CreativeAssetClass[] {
  return CREATIVE_ASSET_CLASS_IDS.filter((id) => CREATIVE_ASSET_CLASSES[id].kind === kind);
}

/** The class an asset gets when nothing more specific is known. */
export function defaultAssetClass(kind: string): CreativeAssetClass {
  switch (kind) {
    case "video": return "footage";
    case "image": return "image";
    case "audio": return "narration";
    case "font":  return "font";
    default:      return "other";
  }
}

/**
 * Resolves a requested class against the file's kind. A class that does not
 * fit the kind — "music" on a PNG — is refused rather than silently swapped,
 * because the caller asked for something specific and got it wrong.
 */
export function resolveAssetClass(requested: unknown, kind: string): CreativeAssetClass {
  const raw = typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (!raw) return defaultAssetClass(kind);
  if (!(raw in CREATIVE_ASSET_CLASSES)) {
    throw new Error(`Unknown asset class ${raw}. Use one of: ${CREATIVE_ASSET_CLASS_IDS.join(", ")}`);
  }
  const assetClass = raw as CreativeAssetClass;
  if (CREATIVE_ASSET_CLASSES[assetClass].kind !== kind) {
    throw new Error(`Asset class ${assetClass} is for ${CREATIVE_ASSET_CLASSES[assetClass].kind} files, not ${kind}. Use one of: ${assetClassesForKind(kind).join(", ")}`);
  }
  return assetClass;
}

/** The audio clip kind an audio class goes on the timeline as. */
export function audioClipKindForClass(assetClass: string | null | undefined): "voiceover" | "music" | "sfx" {
  if (assetClass === "music") return "music";
  if (assetClass === "sfx") return "sfx";
  return "voiceover";
}
