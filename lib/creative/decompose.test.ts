import { describe, expect, it } from "vitest";
import {
  parseDecompositionPlan,
  pixelCropFromNormalized,
} from "./decompose";

describe("flat image decomposition", () => {
  it("clamps normalized candidate boxes and filters low confidence", () => {
    const result = parseDecompositionPlan(JSON.stringify({
      candidates: [
        { role: "subject", label: "car", confidence: 0.94, x: -0.1, y: 0.2, width: 0.8, height: 0.9 },
        { role: "text", label: "tiny", confidence: 0.12, x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].box).toEqual({ x: 0, y: 0.2, width: 0.7, height: 0.8 });
  });

  it("rejects unknown semantic roles", () => {
    expect(() => parseDecompositionPlan(JSON.stringify({ candidates: [{ role: "shell", label: "bad", confidence: 1, x: 0, y: 0, width: 1, height: 1 }] }))).toThrow(/role/i);
  });

  it("converts normalized boxes into bounded pixel crops", () => {
    expect(pixelCropFromNormalized({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, 1200, 800)).toEqual({ left: 120, top: 160, width: 600, height: 320 });
    expect(pixelCropFromNormalized({ x: 0.99, y: 0.99, width: 0.5, height: 0.5 }, 100, 100)).toEqual({ left: 99, top: 99, width: 1, height: 1 });
  });
});