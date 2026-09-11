import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isLikelyOpenRouterKey, secretLast4 } from "./user-secrets";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("user secret encryption", () => {
  beforeEach(() => {
    process.env.API_KEY_ENCRYPTION_KEY = KEY_A;
  });

  it("round-trips a secret", () => {
    const secret = "sk-or-v1-0123456789abcdef";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("never stores the plaintext", () => {
    const encoded = encryptSecret("sk-or-v1-supersecret");
    expect(encoded).not.toContain("supersecret");
    expect(encoded.startsWith("v1.")).toBe(true);
  });

  it("produces a different ciphertext every time, so equal keys are not detectable", () => {
    expect(encryptSecret("sk-or-v1-same")).not.toBe(encryptSecret("sk-or-v1-same"));
  });

  it("refuses a ciphertext that was tampered with", () => {
    const encoded = encryptSecret("sk-or-v1-0123456789abcdef");
    const parts = encoded.split(".");
    const body = Buffer.from(parts[3], "base64");
    body[0] ^= 0xff;
    parts[3] = body.toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("refuses a ciphertext encrypted under a different key", () => {
    const encoded = encryptSecret("sk-or-v1-0123456789abcdef");
    process.env.API_KEY_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptSecret(encoded)).toThrow();
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    process.env.API_KEY_ENCRYPTION_KEY = "tooshort";
    expect(() => encryptSecret("sk-or-v1-x")).toThrow(/32 bytes/);
  });

  it("recognises OpenRouter key shapes", () => {
    expect(isLikelyOpenRouterKey("sk-or-v1-0123456789abcdef0123")).toBe(true);
    expect(isLikelyOpenRouterKey("  sk-or-v1-0123456789abcdef0123  ")).toBe(true);
    expect(isLikelyOpenRouterKey("sk-proj-0123456789abcdef")).toBe(false);
    expect(isLikelyOpenRouterKey("sk-or-")).toBe(false);
    expect(isLikelyOpenRouterKey("")).toBe(false);
  });

  it("takes the last four characters for display", () => {
    expect(secretLast4("sk-or-v1-abcd1234")).toBe("1234");
  });
});
