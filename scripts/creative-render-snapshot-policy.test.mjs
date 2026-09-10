import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CREATIVE_SNAPSHOT_EXPIRATION_MS,
  CREATIVE_SNAPSHOT_REUSE_MAX_AGE_MS,
  chooseReusableCreativeSnapshot,
} from "./creative-render-snapshot-policy.mjs";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

function record(overrides = {}) {
  return {
    snapshotId: "snap_default",
    deploymentId: "dpl_default",
    createdAt: new Date(NOW - 60_000).toISOString(),
    lastModifiedMs: NOW - 60_000,
    ...overrides,
  };
}

describe("creative renderer snapshot reuse policy", () => {
  it("reuses the newest snapshot for the exact renderer bundle", () => {
    const chosen = chooseReusableCreativeSnapshot(
      [
        record({
          snapshotId: "snap_old",
          bundleFingerprint: "bundle-a",
          createdAt: new Date(NOW - 2 * 60_000).toISOString(),
        }),
        record({
          snapshotId: "snap_new",
          bundleFingerprint: "bundle-a",
          createdAt: new Date(NOW - 60_000).toISOString(),
        }),
      ],
      "bundle-a",
      NOW,
    );

    expect(chosen?.snapshotId).toBe("snap_new");
    expect(chosen?.reuseReason).toBe("matching-bundle");
  });

  it("bootstraps once from the newest legacy snapshot before fingerprint metadata exists", () => {
    const chosen = chooseReusableCreativeSnapshot(
      [
        record({
          snapshotId: "snap_legacy_old",
          bundleFingerprint: undefined,
          createdAt: new Date(NOW - 2 * 60_000).toISOString(),
        }),
        record({
          snapshotId: "snap_legacy_new",
          bundleFingerprint: undefined,
          createdAt: new Date(NOW - 60_000).toISOString(),
        }),
      ],
      "bundle-a",
      NOW,
    );

    expect(chosen?.snapshotId).toBe("snap_legacy_new");
    expect(chosen?.reuseReason).toBe("legacy-bootstrap");
  });

  it("requires a fresh snapshot when fingerprint metadata exists but the bundle changed", () => {
    const chosen = chooseReusableCreativeSnapshot(
      [
        record({ snapshotId: "snap_bundle_a", bundleFingerprint: "bundle-a" }),
        record({ snapshotId: "snap_legacy", bundleFingerprint: undefined }),
      ],
      "bundle-b",
      NOW,
    );

    expect(chosen).toBeNull();
  });

  it("bootstraps a new deterministic fingerprint scheme from the newest usable snapshot", () => {
    const chosen = chooseReusableCreativeSnapshot(
      [
        record({
          snapshotId: "snap_old_scheme",
          bundleFingerprint: "unstable-build-hash",
          fingerprintKind: "bundle-bytes-v1",
          createdAt: new Date(NOW - 2 * 60_000).toISOString(),
        }),
        record({
          snapshotId: "snap_newest",
          bundleFingerprint: "another-build-hash",
          createdAt: new Date(NOW - 60_000).toISOString(),
        }),
      ],
      "source-hash-a",
      NOW,
      "source-graph-v1",
    );

    expect(chosen?.snapshotId).toBe("snap_newest");
    expect(chosen?.reuseReason).toBe("fingerprint-scheme-bootstrap");
  });

  it("requires a fresh snapshot after source-graph metadata exists and source changes", () => {
    const chosen = chooseReusableCreativeSnapshot(
      [
        record({
          snapshotId: "snap_source_a",
          bundleFingerprint: "source-hash-a",
          fingerprintKind: "source-graph-v1",
        }),
      ],
      "source-hash-b",
      NOW,
      "source-graph-v1",
    );

    expect(chosen).toBeNull();
  });

  it("reuses an exact source-graph fingerprint", () => {
    const chosen = chooseReusableCreativeSnapshot(
      [
        record({
          snapshotId: "snap_source_a",
          bundleFingerprint: "source-hash-a",
          fingerprintKind: "source-graph-v1",
        }),
      ],
      "source-hash-a",
      NOW,
      "source-graph-v1",
    );

    expect(chosen?.snapshotId).toBe("snap_source_a");
    expect(chosen?.reuseReason).toBe("matching-source");
  });

  it("does not reuse stale metadata forever", () => {
    const chosen = chooseReusableCreativeSnapshot(
      [
        record({
          snapshotId: "snap_stale",
          bundleFingerprint: "bundle-a",
          createdAt: new Date(NOW - CREATIVE_SNAPSHOT_REUSE_MAX_AGE_MS - 1).toISOString(),
        }),
      ],
      "bundle-a",
      NOW,
    );

    expect(chosen).toBeNull();
    expect(CREATIVE_SNAPSHOT_EXPIRATION_MS).toBeGreaterThan(CREATIVE_SNAPSHOT_REUSE_MAX_AGE_MS);
  });

  it("wires the build script to deterministic source fingerprints and forbids never-expiring snapshots", async () => {
    const source = await readFile(new URL("./create-creative-render-snapshot.mjs", import.meta.url), "utf8");

    expect(source).toContain("fingerprintCreativeRendererSource");
    expect(source).toContain("CREATIVE_RENDERER_FINGERPRINT_KIND");
    expect(source).toContain("expiration: CREATIVE_SNAPSHOT_EXPIRATION_MS");
    expect(source).not.toContain("expiration: 0");
  });
});
