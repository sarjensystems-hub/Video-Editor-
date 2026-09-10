import * as base from "./mcp-runtime-base";
import type { McpUserContext } from "@/lib/mcp-oauth";
import { suggestEditPoints } from "./audio-analysis";
import { suggestCreativeOperationFix, transactionErrorWithSuggestedFix } from "./validation-suggestions";

export * from "./mcp-runtime-base";

export async function handleCreativeMcpTool(
  context: McpUserContext,
  name: base.CreativeMcpToolName,
  value: unknown,
): Promise<unknown> {
  let result: unknown;
  try {
    result = await base.handleCreativeMcpTool(context, name, value);
  } catch (error) {
    if (name !== "studio_edit_creative_project") throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} Suggested fix: ${suggestCreativeOperationFix(undefined, message)}`);
  }

  if (name === "studio_edit_creative_project" && result && typeof result === "object") {
    const output = result as Record<string, unknown>;
    if (output.error && typeof output.error === "object") {
      return {
        ...output,
        error: transactionErrorWithSuggestedFix(
          output.error as { code: string; message: string; operationIndex?: number; operation_index?: number | null },
        ),
      };
    }
  }

  if (name === "studio_analyze_audio_asset" && result && typeof result === "object") {
    const output = result as Record<string, unknown>;
    const peaks = Array.isArray(output.peaks) ? output.peaks.map(Number).filter(Number.isFinite) : [];
    const peakWindowMs = Number(output.peak_window_ms ?? output.peakWindowMs ?? 0);
    if (peaks.length && peakWindowMs > 0) {
      const points = suggestEditPoints(peaks, peakWindowMs);
      return {
        ...output,
        suggested_edit_points_ms: points.map((point) => point.timeMs),
        suggested_edit_points: points,
      };
    }
  }

  return result;
}
