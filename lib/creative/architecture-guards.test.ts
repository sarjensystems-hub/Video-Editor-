import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CREATIVE_MCP_TOOL_NAMES } from "./mcp-runtime";
import { DEFAULT_VIDEO_MODEL } from "../video-gen-api";
import {
  MAX_VIDEO_CHARACTERS,
  VIDEO_MAX_DURATION,
  VIDEO_MIN_DURATION,
  VIDEO_RESOLUTIONS,
} from "../video-gen";
import { parseGenerateVideoRequest } from "../mcp-server/types";

const ROOT = resolve(__dirname, "..", "..");
const SOURCE_DIRS = ["app", "components", "lib", "remotion", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"];
/** This file names the forbidden dependency in order to test for it. */
const SELF = join("lib", "creative", "architecture-guards.test.ts");

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (relative: string) => {
    const absolute = join(ROOT, relative);
    for (const entry of readdirSync(absolute)) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
      const childRelative = join(relative, entry);
      if (statSync(join(ROOT, childRelative)).isDirectory()) {
        walk(childRelative);
        continue;
      }
      if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(childRelative);
    }
  };
  for (const dir of SOURCE_DIRS) walk(dir);
  return found;
}

/**
 * Resolves the local module graph reachable from an entry file, following
 * both static imports and dynamic `await import(...)` calls.
 */
function localModuleGraph(entryRelative: string): Set<string> {
  const seen = new Set<string>();
  const candidates = (base: string) => [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base];

  const visit = (relative: string) => {
    if (seen.has(relative)) return;
    seen.add(relative);
    let source: string;
    try {
      source = readFileSync(join(ROOT, relative), "utf8");
    } catch {
      return;
    }
    const specifiers = [
      ...source.matchAll(/from\s+["']([^"']+)["']/g),
      ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);

    for (const specifier of specifiers) {
      let base: string;
      if (specifier.startsWith("@/")) base = specifier.slice(2);
      else if (specifier.startsWith(".")) base = join(relative, "..", specifier);
      else continue;
      for (const candidate of candidates(base)) {
        try {
          if (statSync(join(ROOT, candidate)).isFile()) {
            visit(candidate);
            break;
          }
        } catch {
          // Try the next extension.
        }
      }
    }
  };

  visit(entryRelative);
  return seen;
}

describe("Creative Runtime V2 architectural guards", () => {
  it("keeps Seedance 2.0 Fast as the video generation worker", () => {
    expect(DEFAULT_VIDEO_MODEL).toBe("bytedance/seedance-2.0-fast");
  });

  it("preserves the video defaults of 480p, 10-15 seconds and audio ON", () => {
    expect(VIDEO_RESOLUTIONS).toContain("480p");
    expect(VIDEO_MIN_DURATION).toBeLessThanOrEqual(10);
    expect(VIDEO_MAX_DURATION).toBeGreaterThanOrEqual(15);

    const panel = readFileSync(join(ROOT, "components/creative/CreativeAutomationPanel.tsx"), "utf8");
    expect(panel).toMatch(/resolution:\s*"480p"/);
    expect(panel).toMatch(/duration:\s*1[0-5]\b/);
    expect(panel).toMatch(/generateAudio:\s*true/);

    // Audio is on unless the caller explicitly turns it off.
    const parsed = parseGenerateVideoRequest({ prompt: "p", idempotency_key: "k", duration: 10, resolution: "480p" });
    expect(parsed.generateAudio).toBe(true);
    expect(parsed.duration).toBe(10);
    expect(parsed.resolution).toBe("480p");
    expect(parseGenerateVideoRequest({ prompt: "p", idempotency_key: "k", duration: 15 }).duration).toBe(15);
    expect(MAX_VIDEO_CHARACTERS).toBe(12);
  });

  it("keeps generative video on the async OpenRouter video API, not chat completions", () => {
    const api = readFileSync(join(ROOT, "lib/video-gen-api.ts"), "utf8");
    expect(api).toMatch(/https:\/\/openrouter\.ai\/api\/v1\/videos/);
    expect(api).not.toMatch(/chat\/completions/);
  });

  it("never lets a second general-purpose LLM reinterpret creative instructions in the ChatGPT editing path", () => {
    const graph = localModuleGraph(join("lib", "creative", "mcp-runtime.ts"));
    expect([...graph]).not.toContain(join("lib", "creative", "director.ts"));
    expect([...graph]).not.toContain(join("lib", "creative", "decompose.ts"));

    for (const relative of graph) {
      const source = readFileSync(join(ROOT, relative), "utf8");
      expect(
        /fetchAIResponse|fetchAIResponseWithImages|fetchVisionResponse|planCreativeTransaction/.test(source),
        `${relative} reaches an OpenRouter chat-planning helper from the ChatGPT creative path`,
      ).toBe(false);
    }
  });

  it("does not advertise the removed director or decomposition tools", () => {
    expect(CREATIVE_MCP_TOOL_NAMES).not.toContain("studio_direct_creative_project");
    expect(CREATIVE_MCP_TOOL_NAMES).not.toContain("studio_decompose_image_asset");
    const route = readFileSync(join(ROOT, "app/api/mcp/route.ts"), "utf8");
    expect(route).not.toMatch(/director|decompose/i);
  });

  it("keeps the exact OpenAI image file handoff intact", () => {
    const mcp = readFileSync(join(ROOT, "lib/mcp-server/mcp.ts"), "utf8");
    expect(mcp).toMatch(/"openai\/fileParams"/);
    expect(mcp).toMatch(/do not convert it to base64/i);
    const upload = readFileSync(join(ROOT, "lib/mcp-image-upload-core.ts"), "utf8");
    expect(upload).not.toMatch(/image_base64/);
  });

  it("introduces no Canva dependency", () => {
    // "canvas" is legitimate everywhere in this codebase; "canva" is not.
    const canva = /canva(?!s)/i;

    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    expect(dependencies.filter((name) => canva.test(name))).toEqual([]);

    const lock = readFileSync(join(ROOT, "package-lock.json"), "utf8");
    expect(lock).not.toMatch(/node_modules\/@?canva(?!s)/i);

    const offenders = sourceFiles().filter(
      (relative) => relative !== SELF && canva.test(readFileSync(join(ROOT, relative), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
