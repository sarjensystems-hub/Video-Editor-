import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const API_ROOT = join(ROOT, "app", "api");
const CREATIVE_RENDER_ROUTE = "app/api/creative/render/route.ts";

function routeFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...routeFiles(absolute));
    } else if (entry === "route.ts" || entry === "route.js") {
      files.push(absolute);
    }
  }
  return files;
}

function declaredDuration(absolute: string) {
  const source = readFileSync(absolute, "utf8");
  const match = source.match(/export\s+const\s+maxDuration\s*=\s*(\d+)\s*;/);
  if (!match) return null;
  return {
    route: absolute.slice(ROOT.length + 1).replaceAll("\\", "/"),
    maxDuration: Number(match[1]),
  };
}

describe("Vercel Pro runtime configuration", () => {
  it("gives only Creative Studio export the Pro 800-second budget", () => {
    const declared = routeFiles(API_ROOT)
      .map(declaredDuration)
      .filter((entry): entry is { route: string; maxDuration: number } => entry !== null);

    expect(declared.filter((entry) => entry.maxDuration > 800)).toEqual([]);
    expect(
      declared.filter(
        (entry) => entry.route !== CREATIVE_RENDER_ROUTE && entry.maxDuration > 300,
      ),
    ).toEqual([]);
    expect(declared.find((entry) => entry.route === CREATIVE_RENDER_ROUTE)?.maxDuration).toBe(800);
  });

  it("enables Fluid Compute for the long-running render route", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
      fluid?: boolean;
    };
    expect(config.fluid).toBe(true);
  });
});
