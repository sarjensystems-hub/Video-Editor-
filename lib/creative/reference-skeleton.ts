export * from "./reference-skeleton-base";

import { buildReferenceTimelineSkeleton as buildReferenceTimelineSkeletonBase } from "./reference-skeleton-base";
import type { ReferenceVideoAnalysis } from "./reference-analysis";
import type { CreativeDocument, JsonValue } from "./schema";
import { scoreReferenceSimilarity } from "./reference-similarity";

/**
 * The reference scaffold is also the natural project-vs-reference comparison
 * point because it already receives both inputs. Embed the deterministic score
 * in returned metadata so the agent gets timing scaffold + measurable distance
 * from the current project in one bounded call.
 */
export function buildReferenceTimelineSkeleton(
  template: CreativeDocument,
  analysis: ReferenceVideoAnalysis,
  title?: string,
): CreativeDocument {
  const document = buildReferenceTimelineSkeletonBase(template, analysis, title);
  // Metadata is intentionally JSON-only. Round-trip through JSON here so the
  // type boundary says exactly what persistence does rather than widening the
  // document metadata contract to arbitrary interfaces.
  const referenceSimilarity = JSON.parse(
    JSON.stringify(scoreReferenceSimilarity(template, analysis)),
  ) as JsonValue;
  return {
    ...document,
    metadata: {
      ...(document.metadata ?? {}),
      referenceSimilarity,
    },
  };
}
