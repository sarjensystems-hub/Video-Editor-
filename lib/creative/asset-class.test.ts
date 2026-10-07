import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREATIVE_ASSET_CLASS_IDS,
  assetClassesForKind,
  audioClipKindForClass,
  defaultAssetClass,
  resolveAssetClass,
} from "./asset-class";

describe("asset classes", () => {
  it("gives every kind a default class that suits it", () => {
    expect(defaultAssetClass("video")).toBe("footage");
    expect(defaultAssetClass("image")).toBe("image");
    expect(defaultAssetClass("audio")).toBe("narration");
    expect(defaultAssetClass("anything")).toBe("other");
  });

  it("offers only the classes that fit a file's kind", () => {
    expect(assetClassesForKind("audio")).toEqual(["narration", "music", "sfx"]);
    expect(assetClassesForKind("image")).toEqual(["image", "product", "logo", "character", "background"]);
  });

  it("refuses a class that does not fit the file rather than swapping it", () => {
    expect(resolveAssetClass("music", "audio")).toBe("music");
    expect(resolveAssetClass(" LOGO ", "image")).toBe("logo");
    expect(resolveAssetClass(undefined, "video")).toBe("footage");
    expect(() => resolveAssetClass("music", "image")).toThrow(/for audio files/);
    expect(() => resolveAssetClass("jingle", "audio")).toThrow(/Unknown asset class/);
  });

  it("puts each audio class on the timeline as the matching clip kind", () => {
    expect(audioClipKindForClass("narration")).toBe("voiceover");
    expect(audioClipKindForClass("music")).toBe("music");
    expect(audioClipKindForClass("sfx")).toBe("sfx");
  });

  it("matches the database's check constraint exactly", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/add_creative_asset_class.sql"), "utf8");
    const listed = sql.match(/asset_class in \(([^)]+)\)/)?.[1].match(/'([a-z]+)'/g)?.map((value) => value.slice(1, -1));
    expect(listed).toEqual(CREATIVE_ASSET_CLASS_IDS);
  });
});
