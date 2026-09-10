/**
 * A fingerprint for a document that had to be retyped to get here.
 *
 * `import_creative_document` takes its document inline, so importing an
 * authored file means printing it out and reproducing it verbatim in a tool
 * call. That is a transcription step in the middle of a document that must be
 * byte-exact, and nothing was checking it: a dropped element or a mangled
 * number would import cleanly and only show up as a wrong film.
 *
 * Fetching the document from a URL instead would remove the retyping, but it
 * would also make the server fetch caller-supplied URLs, which is an SSRF
 * surface this does not need. A hash needs no fetch. The payload still arrives
 * inline; the hash only says whether it arrived intact.
 *
 * The hash is taken over a canonical form rather than raw bytes, because raw
 * bytes cannot survive a JSON round trip through a tool call — whitespace and
 * key order are not preserved, and neither side would agree on them. Sorting
 * keys and dropping whitespace gives both sides something they can compute
 * independently from the same document.
 */
import { createHash } from "node:crypto";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * The document as a stable string: object keys sorted at every depth, arrays
 * left in order because their order is meaning, and no whitespace anywhere.
 */
export function canonicalJson(value: unknown): string {
  const canonicalize = (input: unknown): Json => {
    if (input === null || typeof input !== "object") {
      // undefined has no JSON form; treat it as absent rather than crashing on
      // a document that carries an explicit undefined.
      return (input === undefined ? null : input) as Json;
    }
    if (Array.isArray(input)) return input.map(canonicalize);
    const source = input as Record<string, unknown>;
    const sorted: Record<string, Json> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  };
  return JSON.stringify(canonicalize(value));
}

/** Lowercase hex sha256 of the canonical form. */
export function documentSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Compare a caller's expected hash against what actually arrived.
 *
 * Throws rather than warning: a document that did not survive transcription is
 * not a document to build a film on, and the caller asked to be told.
 */
export function assertDocumentSha256(value: unknown, expected: unknown): string {
  const actual = documentSha256(value);
  if (expected == null) return actual;
  if (typeof expected !== "string" || !SHA256_HEX.test(expected.trim().toLowerCase())) {
    throw new Error("document_sha256 must be a 64-character hex sha256 digest");
  }
  const wanted = expected.trim().toLowerCase();
  if (wanted !== actual) {
    throw new Error(
      `document_sha256 does not match the document received (expected ${wanted}, got ${actual}). ` +
        "The document changed in transit; nothing was imported. Hash the canonical form: " +
        "object keys sorted at every depth, arrays in order, no whitespace.",
    );
  }
  return actual;
}
