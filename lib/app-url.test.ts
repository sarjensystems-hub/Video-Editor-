import { afterEach, describe, expect, it } from "vitest";
import { appUrl } from "./app-url";

const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
});

describe("deployment address", () => {
  it("uses an explicitly configured address", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://studio.acme.com";
    expect(appUrl()).toBe("https://studio.acme.com");
  });

  it("drops a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://studio.acme.com/";
    expect(appUrl()).toBe("https://studio.acme.com");
  });

  /** Vercel supplies this one bare, with no scheme. */
  it("falls back to the domain Vercel assigns, adding the scheme", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "video-editor-three-beige.vercel.app";
    expect(appUrl()).toBe("https://video-editor-three-beige.vercel.app");
  });

  /**
   * The empty string is the state SETUP's own flow leaves behind — the
   * variable is added before the real address is known — and it used to crash
   * the build through `metadataBase: new URL("")`.
   */
  it("treats an empty or unparseable value as unset", () => {
    process.env.NEXT_PUBLIC_APP_URL = "";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "video-editor.vercel.app";
    expect(appUrl()).toBe("https://video-editor.vercel.app");

    process.env.NEXT_PUBLIC_APP_URL = "not a url";
    expect(appUrl()).toBe("https://video-editor.vercel.app");
  });

  it("falls back to the dev server when nothing is configured", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(appUrl()).toBe("http://localhost:3000");
  });

  /** The old placeholder host shipped in URLs people were told to paste. */
  it("never invents a placeholder domain", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(appUrl()).not.toContain("example.com");
  });
});
