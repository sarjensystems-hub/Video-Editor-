export const CREATIVE_SNAPSHOT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;
export const CREATIVE_SNAPSHOT_REUSE_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;

function timestampMs(record) {
  const createdAt = Date.parse(record.createdAt ?? "");
  if (Number.isFinite(createdAt)) return createdAt;
  return Number.isFinite(record.lastModifiedMs) ? record.lastModifiedMs : 0;
}

function newest(records) {
  return [...records].sort((a, b) => timestampMs(b) - timestampMs(a))[0] ?? null;
}

function reusableByAge(record, nowMs) {
  const createdMs = timestampMs(record);
  if (!createdMs) return false;
  return nowMs - createdMs <= CREATIVE_SNAPSHOT_REUSE_MAX_AGE_MS;
}

/**
 * Snapshot reuse policy:
 * - With a fingerprint scheme, prefer the newest exact match for that scheme.
 * - If this is the first deployment using a new fingerprint scheme, bootstrap
 *   once from the newest usable snapshot and write new-scheme metadata.
 * - After new-scheme metadata exists, a changed fingerprint must build a fresh
 *   snapshot rather than silently reusing an incompatible renderer.
 * - Without a scheme argument, preserve the original bundle-fingerprint policy
 *   for backward-compatible tests/callers.
 */
export function chooseReusableCreativeSnapshot(
  records,
  bundleFingerprint,
  nowMs = Date.now(),
  fingerprintKind,
) {
  const usable = records.filter(
    (record) =>
      typeof record?.snapshotId === "string" &&
      record.snapshotId.length > 0 &&
      reusableByAge(record, nowMs),
  );

  if (fingerprintKind) {
    const exact = newest(
      usable.filter(
        (record) =>
          record.fingerprintKind === fingerprintKind &&
          record.bundleFingerprint === bundleFingerprint,
      ),
    );
    if (exact) return { ...exact, reuseReason: "matching-source" };

    const hasCurrentSchemeMetadata = records.some(
      (record) => record?.fingerprintKind === fingerprintKind,
    );
    if (hasCurrentSchemeMetadata) return null;

    const bootstrap = newest(usable);
    return bootstrap
      ? { ...bootstrap, reuseReason: "fingerprint-scheme-bootstrap" }
      : null;
  }

  const exact = newest(
    usable.filter((record) => record.bundleFingerprint === bundleFingerprint),
  );
  if (exact) return { ...exact, reuseReason: "matching-bundle" };

  const hasFingerprintMetadata = records.some(
    (record) =>
      typeof record?.bundleFingerprint === "string" &&
      record.bundleFingerprint.length > 0,
  );
  if (hasFingerprintMetadata) return null;

  const legacy = newest(
    usable.filter(
      (record) =>
        !record.bundleFingerprint ||
        typeof record.bundleFingerprint !== "string",
    ),
  );
  return legacy ? { ...legacy, reuseReason: "legacy-bootstrap" } : null;
}
