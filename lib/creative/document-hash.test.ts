import { describe, expect, it } from "vitest";
import { assertDocumentSha256, canonicalJson, documentSha256 } from "./document-hash";

describe("canonicalJson", () => {
  it("does not care what order the keys arrived in", () => {
    // A JSON round trip through a tool call does not preserve key order, so a
    // hash that depended on it would fail on documents that are in fact fine.
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("sorts at every depth, not just the top", () => {
    expect(canonicalJson({ outer: { z: 1, a: { y: 2, b: 3 } } })).toBe(
      '{"outer":{"a":{"b":3,"y":2},"z":1}}',
    );
  });

  it("keeps array order, because order is meaning", () => {
    // Scenes and elements are ordered; sorting them would make two different
    // films hash the same.
    expect(canonicalJson(["b", "a"])).not.toBe(canonicalJson(["a", "b"]));
  });

  it("emits no whitespace", () => {
    expect(canonicalJson({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });

  it("treats an explicit undefined as absent rather than crashing", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("documentSha256", () => {
  it("is stable across key reordering", () => {
    const a = { version: 1, title: "Film", scenes: [{ id: "s1", durationMs: 3000 }] };
    const b = { scenes: [{ durationMs: 3000, id: "s1" }], title: "Film", version: 1 };
    expect(documentSha256(a)).toBe(documentSha256(b));
  });

  it("changes when anything in the document changes", () => {
    const base = { title: "Film", scenes: [{ id: "s1", durationMs: 3000 }] };
    expect(documentSha256(base)).not.toBe(
      documentSha256({ ...base, scenes: [{ id: "s1", durationMs: 3001 }] }),
    );
  });

  it("notices a dropped element, which is the failure it exists for", () => {
    const full = { scenes: [{ id: "s1", elements: [{ id: "a" }, { id: "b" }] }] };
    const truncated = { scenes: [{ id: "s1", elements: [{ id: "a" }] }] };
    expect(documentSha256(full)).not.toBe(documentSha256(truncated));
  });

  it("is lowercase hex of the expected length", () => {
    expect(documentSha256({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("assertDocumentSha256", () => {
  const document = { version: 1, title: "Film" };

  it("returns the computed hash when the caller did not supply one", () => {
    // Always returning it is what lets a caller record the hash on a first
    // import and check it on the next one.
    expect(assertDocumentSha256(document, undefined)).toBe(documentSha256(document));
    expect(assertDocumentSha256(document, null)).toBe(documentSha256(document));
  });

  it("passes a matching hash, in any case and with stray whitespace", () => {
    const hash = documentSha256(document);
    expect(assertDocumentSha256(document, hash)).toBe(hash);
    expect(assertDocumentSha256(document, `  ${hash.toUpperCase()}  `)).toBe(hash);
  });

  it("refuses a document that changed in transit, and says nothing was imported", () => {
    const stale = documentSha256({ version: 1, title: "Different" });
    expect(() => assertDocumentSha256(document, stale)).toThrow(/nothing was imported/);
    expect(() => assertDocumentSha256(document, stale)).toThrow(/changed in transit/);
  });

  it("tells the caller how to compute the hash when it does not match", () => {
    // A mismatch is as likely to be the caller hashing raw bytes as real
    // corruption, so the error has to say which form is expected.
    const stale = documentSha256({ other: true });
    expect(() => assertDocumentSha256(document, stale)).toThrow(/keys sorted at every depth/);
  });

  it("rejects something that is not a digest rather than treating it as a mismatch", () => {
    expect(() => assertDocumentSha256(document, "not-a-hash")).toThrow(/64-character hex/);
    expect(() => assertDocumentSha256(document, 12345)).toThrow(/64-character hex/);
  });
});
