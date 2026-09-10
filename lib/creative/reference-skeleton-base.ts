import type { ReferenceVideoAnalysis } from "./reference-analysis";
import type { CreativeDocument, CreativeScene, CreativeShapeElement } from "./schema";

function shape(
  id: string,
  name: string,
  width: number,
  height: number,
  fill: string,
  opacity: number,
  zIndex: number,
  x = 0,
  y = 0,
): CreativeShapeElement {
  return {
    id,
    name,
    type: "shape",
    role: zIndex === 0 ? "background" : undefined,
    transform: {
      x, y, width, height, rotation: 0, opacity,
      anchorX: 0.5, anchorY: 0.5, zIndex,
    },
    shape: "rect",
    fill: { kind: "literal", value: fill },
    borderRadius: 0,
  };
}

/**
 * Turn measured reference shot boundaries into an editable CreativeDocument.
 * No reference pixels or copy are imported. Each scene contains only a flat
 * placeholder plate and a small composition-centre marker, so the resulting
 * document is a timing/composition scaffold rather than copied content.
 */
export function buildReferenceTimelineSkeleton(
  template: CreativeDocument,
  analysis: ReferenceVideoAnalysis,
  title = `${template.title} — Reference Skeleton`,
): CreativeDocument {
  if (!analysis.shot_durations_ms.length) throw new Error("Reference analysis contains no shot durations");
  const { width, height } = template.canvas;
  const background = analysis.palette[0] ?? "#111111";
  const markerSize = Math.max(12, Math.round(Math.min(width, height) * 0.035));
  const centerX = Math.round(analysis.composition_center.x * width - markerSize / 2);
  const centerY = Math.round(analysis.composition_center.y * height - markerSize / 2);
  const scenes: CreativeScene[] = analysis.shot_durations_ms.map((durationMs, index) => ({
    id: `reference-shot-${index + 1}`,
    name: `Reference Shot ${index + 1}`,
    durationMs: Math.max(1, Math.round(durationMs)),
    background: { kind: "literal", value: background },
    elements: [
      shape(`reference-shot-${index + 1}-plate`, "Reference placeholder plate", width, height, background, 1, 0),
      {
        ...shape(
          `reference-shot-${index + 1}-center`,
          "Measured composition centre",
          markerSize,
          markerSize,
          analysis.palette[1] ?? "#ffffff",
          0.22,
          10,
          centerX,
          centerY,
        ),
        shape: "ellipse" as const,
        role: undefined,
      },
    ],
    groups: [],
    ...(index < analysis.shot_durations_ms.length - 1
      ? { transitionOut: { kind: "cut" as const, durationMs: 0, easing: "linear" as const } }
      : {}),
  }));

  return {
    ...JSON.parse(JSON.stringify(template)),
    title,
    scenes,
    audio: [],
    markers: analysis.cuts.map((cut, index) => ({
      id: `reference-cut-${index + 1}`,
      timeMs: cut.time_ms,
      kind: "cue" as const,
      label: `Measured cut (${cut.change_score.toFixed(3)})`,
    })),
    continuations: [],
    groupContinuations: [],
    metadata: {
      ...(template.metadata ?? {}),
      referenceSkeleton: {
        sourceDurationMs: analysis.duration_ms,
        sampleTimesMs: analysis.sample_times_ms,
        cutThreshold: analysis.cut_threshold,
        visualDensity: analysis.visual_density,
        luminanceContrast: analysis.luminance_contrast,
        compositionCenter: analysis.composition_center,
        palette: analysis.palette,
        limitations: analysis.limitations,
      },
    },
  };
}
