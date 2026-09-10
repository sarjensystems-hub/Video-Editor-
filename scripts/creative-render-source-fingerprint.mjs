import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

export const CREATIVE_RENDERER_FINGERPRINT_KIND = "source-graph-v1";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = extname(base)
    ? [base]
    : [
        base,
        ...EXTENSIONS.map((extension) => `${base}${extension}`),
        ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
      ];

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }

  throw new Error(`Could not resolve renderer import ${specifier} from ${fromFile}`);
}

function localSpecifiers(source) {
  const found = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^\"'`;]*?\s+from\s+)?[\"']([^\"']+)[\"']/g,
    /\bimport\(\s*[\"']([^\"']+)[\"']\s*\)/g,
    /\brequire\(\s*[\"']([^\"']+)[\"']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier?.startsWith(".")) found.add(specifier);
    }
  }

  return [...found];
}

export async function collectCreativeRendererSourceFiles(
  root = process.cwd(),
  entryRelative = "remotion/index.ts",
) {
  const rootPath = resolve(root);
  const entry = resolve(rootPath, entryRelative);
  const visited = new Set();
  const contents = new Map();

  async function visit(file) {
    const absolute = resolve(file);
    if (visited.has(absolute)) return;
    visited.add(absolute);

    const source = await readFile(absolute, "utf8");
    contents.set(absolute, source);

    for (const specifier of localSpecifiers(source)) {
      const dependency = await resolveLocalImport(absolute, specifier);
      if (dependency) await visit(dependency);
    }
  }

  await visit(entry);

  for (const manifest of ["package.json", "package-lock.json"]) {
    const path = resolve(rootPath, manifest);
    if (await isFile(path)) contents.set(path, await readFile(path, "utf8"));
  }

  return [...contents.entries()]
    .map(([absolute, content]) => ({
      path: relative(rootPath, absolute).replaceAll("\\", "/"),
      content,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function fingerprintCreativeRendererSource(
  root = process.cwd(),
  entryRelative = "remotion/index.ts",
) {
  const files = await collectCreativeRendererSourceFiles(root, entryRelative);
  const hash = createHash("sha256");

  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }

  return hash.digest("hex");
}
