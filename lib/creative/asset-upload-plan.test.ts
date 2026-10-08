import { describe, expect, it } from "vitest";
import { planUploadParts } from "./asset-upload-plan";

describe("upload part plan", () => {
  it("sends a small file as one part", () => {
    expect(planUploadParts(3 * 1024 * 1024)).toEqual({ partSize: 16 * 1024 * 1024, partCount: 1 });
  });

  it("cuts a 150 MB video into 16 MB parts", () => {
    expect(planUploadParts(150 * 1024 * 1024)).toEqual({ partSize: 16 * 1024 * 1024, partCount: 10 });
  });

  it("grows the part size so even a huge file stays within the part limit", () => {
    const { partSize, partCount } = planUploadParts(500 * 1024 ** 3);
    expect(partCount).toBeLessThanOrEqual(9000);
    expect(partSize * partCount).toBeGreaterThanOrEqual(500 * 1024 ** 3);
  });
});
