import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectCreativeRendererSourceFiles,
  fingerprintCreativeRendererSource,
} from "./creative-render-source-fingerprint.mjs";

const roots = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "creative-render-source-"));
  roots.push(root);
  await mkdir(join(root, "remotion"), { recursive: true });
  await mkdir(join(root, "lib"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"fixture"}\n');
  await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(join(root, "remotion", "index.ts"), 'import { value } from "../lib/value";\nexport { value };\n');
  await writeFile(join(root, "lib", "value.ts"), 'export const value = "a";\n');
  await writeFile(join(root, "lib", "unrelated.ts"), 'export const unrelated = "x";\n');
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("creative renderer source fingerprint", () => {
  it("includes only the renderer import graph plus package manifests", async () => {
    const root = await fixture();
    const files = await collectCreativeRendererSourceFiles(root);
    expect(files.map((file) => file.path)).toEqual([
      "lib/value.ts",
      "package-lock.json",
      "package.json",
      "remotion/index.ts",
    ]);
  });

  it("stays stable when unrelated server source changes", async () => {
    const root = await fixture();
    const before = await fingerprintCreativeRendererSource(root);
    await writeFile(join(root, "lib", "unrelated.ts"), 'export const unrelated = "changed";\n');
    const after = await fingerprintCreativeRendererSource(root);
    expect(after).toBe(before);
  });

  it("changes when renderer source or dependency versions change", async () => {
    const root = await fixture();
    const first = await fingerprintCreativeRendererSource(root);
    await writeFile(join(root, "lib", "value.ts"), 'export const value = "b";\n');
    const second = await fingerprintCreativeRendererSource(root);
    expect(second).not.toBe(first);

    await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3,"changed":true}\n');
    const third = await fingerprintCreativeRendererSource(root);
    expect(third).not.toBe(second);
  });
});
