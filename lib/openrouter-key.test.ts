import { describe, expect, it, vi } from "vitest";
import {
  MissingOpenRouterKeyError,
  getOpenRouterKey,
  requireOpenRouterKey,
  runWithOpenRouterKey,
} from "./openrouter-key";

describe("request-scoped OpenRouter key", () => {
  it("uses the key belonging to the request", async () => {
    const key = await runWithOpenRouterKey(async () => "sk-or-user", () => getOpenRouterKey());
    expect(key).toBe("sk-or-user");
  });

  it("carries the key across awaits and into nested calls", async () => {
    const deep = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getOpenRouterKey();
    };
    expect(await runWithOpenRouterKey(async () => "sk-or-deep", deep)).toBe("sk-or-deep");
  });

  it("loads the user's key at most once per request", async () => {
    const load = vi.fn(async () => "sk-or-once");
    await runWithOpenRouterKey(load, async () => {
      await Promise.all([getOpenRouterKey(), getOpenRouterKey(), getOpenRouterKey()]);
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never loads a key for a request that does not generate", async () => {
    const load = vi.fn(async () => "sk-or-unused");
    await runWithOpenRouterKey(load, async () => "did nothing");
    expect(load).not.toHaveBeenCalled();
  });

  it("has nothing to fall back on when the account has no key", async () => {
    expect(await runWithOpenRouterKey(async () => null, () => getOpenRouterKey())).toBeNull();
  });

  it("resolves to nothing outside a request scope", async () => {
    expect(await getOpenRouterKey()).toBeNull();
  });

  it("asks the user to add a key when the account has none", async () => {
    await expect(
      runWithOpenRouterKey(async () => null, () => requireOpenRouterKey()),
    ).rejects.toBeInstanceOf(MissingOpenRouterKeyError);

    await expect(
      runWithOpenRouterKey(async () => null, () => requireOpenRouterKey()),
    ).rejects.toThrow(/Settings → API keys/);
  });

  it("keeps two concurrent requests on their own keys", async () => {
    const [a, b] = await Promise.all([
      runWithOpenRouterKey(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "sk-or-alice";
      }, () => getOpenRouterKey()),
      runWithOpenRouterKey(async () => "sk-or-bob", () => getOpenRouterKey()),
    ]);
    expect(a).toBe("sk-or-alice");
    expect(b).toBe("sk-or-bob");
  });
});
