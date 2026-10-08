import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { workspaceScopeFilter } from "./active-site";

describe("workspace scope", () => {
  it("shows the active workspace's rows and the ones filed under none", () => {
    expect(workspaceScopeFilter("e61c87ef-93f1-448a-9d33-b7e7a4435873")).toBe(
      "site_id.eq.e61c87ef-93f1-448a-9d33-b7e7a4435873,site_id.is.null",
    );
  });

  it("does not filter at all when no workspace is selected", () => {
    expect(workspaceScopeFilter(null)).toBeNull();
  });

  /** The id is a cookie value: anything but a UUID never reaches a filter. */
  it("ignores a cookie that is not a workspace id", () => {
    expect(workspaceScopeFilter("x,user_id.neq.0")).toBeNull();
  });
});
