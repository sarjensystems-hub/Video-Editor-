import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base64Url,
  buildRedirect,
  checkRedirectUri,
  hashToken,
  isValidCodeVerifier,
  parseClientRegistration,
  randomToken,
  redirectUriIsRegistered,
  secretsMatch,
  verifyPkce,
} from "./protocol";

const verifierFor = (seed: string) => seed.padEnd(43, "x").slice(0, 43);
const challengeFor = (verifier: string) => base64Url(createHash("sha256").update(verifier).digest());

describe("randomToken", () => {
  it("is URL-safe and never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(seen.size).toBe(200);
    for (const token of seen) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashToken", () => {
  it("is stable and hides the input", () => {
    const token = randomToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });
});

describe("secretsMatch", () => {
  it("accepts equal values and rejects everything else", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    // Different lengths must not throw, which timingSafeEqual does on its own.
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "")).toBe(true);
  });
});

describe("verifyPkce", () => {
  it("accepts the verifier that produced the challenge", () => {
    const verifier = verifierFor("correct-verifier");
    expect(verifyPkce(verifier, challengeFor(verifier))).toBe(true);
  });

  it("rejects a different verifier", () => {
    const verifier = verifierFor("correct-verifier");
    expect(verifyPkce(verifierFor("other-verifier"), challengeFor(verifier))).toBe(false);
  });

  it("refuses the plain method outright", () => {
    const verifier = verifierFor("plain-verifier");
    // A stolen code is useless only if the challenge is hashed; `plain` would
    // hand the attacker everything they need.
    expect(verifyPkce(verifier, verifier, "plain")).toBe(false);
    expect(verifyPkce(verifier, challengeFor(verifier), "plain")).toBe(false);
  });

  it("rejects a verifier outside the RFC's length and alphabet", () => {
    const short = "tooshort";
    expect(verifyPkce(short, challengeFor(short))).toBe(false);
    const illegal = `${"a".repeat(42)}/`;
    expect(verifyPkce(illegal, challengeFor(illegal))).toBe(false);
  });
});

describe("isValidCodeVerifier", () => {
  it("holds the RFC 7636 bounds", () => {
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(128))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier(`${"a".repeat(42)}+`)).toBe(false);
  });
});

describe("redirectUriIsRegistered", () => {
  const registered = ["https://chatgpt.com/connector_platform_oauth_redirect"];

  it("accepts only an exact match", () => {
    expect(redirectUriIsRegistered(registered[0], registered)).toBe(true);
  });

  it("rejects the near-misses that leak authorization codes", () => {
    for (const attack of [
      "https://chatgpt.com/connector_platform_oauth_redirect/../evil",
      "https://chatgpt.com/connector_platform_oauth_redirect?next=https://evil.test",
      "https://chatgpt.com.evil.test/connector_platform_oauth_redirect",
      "https://evil.test/connector_platform_oauth_redirect",
      "http://chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector_platform_oauth_redirect#x",
    ]) {
      expect(redirectUriIsRegistered(attack, registered)).toBe(false);
    }
  });
});

describe("checkRedirectUri", () => {
  it("accepts https, loopback http, and native custom schemes", () => {
    expect(checkRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(checkRedirectUri("http://localhost:5173/callback")).toBeNull();
    expect(checkRedirectUri("http://127.0.0.1:1410/oauth")).toBeNull();
    expect(checkRedirectUri("myapp://auth")).toBeNull();
  });

  it("rejects plaintext http off loopback, fragments and nonsense", () => {
    expect(checkRedirectUri("http://example.test/cb")?.reason).toMatch(/https/);
    expect(checkRedirectUri("https://example.test/cb#frag")?.reason).toMatch(/fragment/);
    expect(checkRedirectUri("not a url")?.reason).toMatch(/absolute/);
  });
});

describe("parseClientRegistration", () => {
  it("accepts a well-formed registration", () => {
    const result = parseClientRegistration({
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      grant_types: ["authorization_code"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.clientName).toBe("ChatGPT");
      expect(result.value.redirectUris).toHaveLength(1);
    }
  });

  it("names an anonymous client so consent can say who is asking", () => {
    const result = parseClientRegistration({ redirect_uris: ["https://a.test/cb"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.clientName).toBe("Unnamed MCP client");
  });

  it("refuses registrations that would be unsafe to honour", () => {
    for (const body of [
      null,
      "nope",
      {},
      { redirect_uris: [] },
      { redirect_uris: ["http://evil.test/cb"] },
      { redirect_uris: [123] },
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.test/${i}`) },
      { redirect_uris: ["https://a.test/cb"], grant_types: ["implicit"] },
    ]) {
      expect(parseClientRegistration(body).ok).toBe(false);
    }
  });
});

describe("buildRedirect", () => {
  it("adds the response without destroying an existing query", () => {
    const url = buildRedirect("https://chatgpt.com/cb?session=42", { code: "abc", state: "xyz" });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("session")).toBe("42");
    expect(parsed.searchParams.get("code")).toBe("abc");
    expect(parsed.searchParams.get("state")).toBe("xyz");
  });

  it("escapes values rather than letting them add parameters", () => {
    const url = buildRedirect("https://a.test/cb", { state: "x&admin=1" });
    expect(new URL(url).searchParams.get("state")).toBe("x&admin=1");
    expect(new URL(url).searchParams.get("admin")).toBeNull();
  });
});
