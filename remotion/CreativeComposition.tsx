import React from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { evaluateSceneAtTime, resolveColor, resolveTextStyle } from "../lib/creative/evaluate";
import { getCreativeAudioClips, resolveAudioClipGain } from "../lib/creative/audio-timeline";
import { resolveVideoPlaybackPlan } from "../lib/creative/video-playback";
import { resolveMaskCss, resolveMotionBlur } from "../lib/creative/mask";
import { resolveBlendModeCss } from "../lib/creative/blend";
import { resolveGlassCss } from "../lib/creative/glass";
import {
  chartAreaId,
  chartAxesId,
  chartSeriesId,
  resolveChartAnnotations,
  resolveChartGeometry,
  type ResolvedChartLabel,
} from "../lib/creative/chart";
import { resolveConnectorGeometry } from "../lib/creative/connector";
import {
  findOwningGroup,
  creativeElementTransformCss,
  preserveHierarchyDepth,
  resolveCameraCss,
  hierarchyTransformCss,
  resolveGroupCss,
  type HierarchyCss,
} from "../lib/creative/hierarchy";
import { resolveContinuedGroupTransform } from "../lib/creative/continuation";
import {
  adjustmentsGrainOpacity,
  adjustmentsToBackdropFilter,
  adjustmentsToCssFilter,
  adjustmentsVignetteGradient,
  hasVisibleAdjustments,
} from "../lib/creative/adjustments";
import {
  getCreativeSceneTimeline,
  type CreativeRemotionInputProps,
  type CreativeSceneTimelineEntry,
} from "../lib/creative/remotion";
import { useCreativeFonts } from "./useCreativeFonts";
import {
  resolveCreativeUiElement,
  type ResolvedCreativeUiNode,
} from "../lib/creative/ui-element";
import { resolveCreativeCompositeElement } from "../lib/creative/composite";
import {
  estimateTextLayout,
  groupTextUnitsByLine,
  resolveTextUnitState,
  splitTextUnits,
} from "../lib/creative/text-animation";
import { resolveCounterText } from "../lib/creative/counter";
import { resolveShapeOutline } from "../lib/creative/shape-morph";
import type {
  CreativeAdjustments,
  CreativeChartElement,
  TextStyleRef,
  CreativeCompositeElement,
  CreativeConnectorElement,
  CreativeDocument,
  CreativeMask,
  CreativeMotionBlur,
  CreativeElement,
  CreativeScene,
  CreativeShapeElement,
  CreativeTextElement,
  CreativeUiElement,
  CreativeVideoElement,
} from "../lib/creative/schema";
import type { EvaluatedElement } from "../lib/creative/evaluate";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function transitionPresentation({
  document,
  entry,
  localMs,
}: {
  document: CreativeDocument;
  entry: CreativeSceneTimelineEntry;
  localMs: number;
}) {
  let opacity = 1;
  let translateX = 0;
  let translateY = 0;
  let scale = 1;
  let blurPx = 0;
  let flash = 0;
  let clipPath: string | undefined;

  const previous = entry.sceneIndex > 0 ? document.scenes[entry.sceneIndex - 1] : null;
  const incoming = previous?.transitionOut;
  if (incoming && incoming.durationMs > 0 && localMs < incoming.durationMs) {
    const p = clamp01(localMs / incoming.durationMs);
    switch (incoming.kind) {
      case "fade":
        opacity *= p;
        break;
      case "slide-left":
      case "push-left":
        translateX += (1 - p) * 100;
        break;
      case "slide-right":
      case "push-right":
        translateX -= (1 - p) * 100;
        break;
      case "push-up":
        translateY += (1 - p) * 100;
        break;
      case "wipe-left":
        clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
        break;
      case "zoom-in":
        scale *= 0.85 + p * 0.15;
        opacity *= p;
        break;
      case "zoom-out":
        scale *= 1.15 - p * 0.15;
        opacity *= p;
        break;
      case "blur":
        blurPx = (1 - p) * 24;
        opacity *= p;
        break;
      case "flash":
        // Incoming side of a flash resolves out of white.
        flash = 1 - p;
        break;
      case "whip-left":
        translateX += (1 - p) * 60;
        blurPx = (1 - p) * 30;
        break;
      case "whip-right":
        translateX -= (1 - p) * 60;
        blurPx = (1 - p) * 30;
        break;
      case "cut":
        break;
    }
  }

  const scene = document.scenes[entry.sceneIndex];
  const outgoing = scene.transitionOut;
  if (outgoing && outgoing.durationMs > 0) {
    const start = scene.durationMs - outgoing.durationMs;
    if (localMs >= start) {
      const p = clamp01((localMs - start) / outgoing.durationMs);
      switch (outgoing.kind) {
        case "fade":
          opacity *= 1 - p;
          break;
        case "slide-left":
        case "push-left":
          translateX -= p * 100;
          break;
        case "slide-right":
        case "push-right":
          translateX += p * 100;
          break;
        case "push-up":
          translateY -= p * 100;
          break;
        case "wipe-left":
          clipPath = `inset(0 ${p * 100}% 0 0)`;
          break;
        case "zoom-in":
          scale *= 1 + p * 0.15;
          opacity *= 1 - p;
          break;
        case "zoom-out":
          scale *= 1 - p * 0.15;
          opacity *= 1 - p;
          break;
        case "blur":
          blurPx = p * 24;
          opacity *= 1 - p;
          break;
        case "flash":
          flash = p;
          break;
        case "whip-left":
          translateX -= p * 60;
          blurPx = p * 30;
          break;
        case "whip-right":
          translateX += p * 60;
          blurPx = p * 30;
          break;
        case "cut":
          break;
      }
    }
  }

  const transforms: string[] = [];
  if (translateX !== 0) transforms.push(`translateX(${translateX}%)`);
  if (translateY !== 0) transforms.push(`translateY(${translateY}%)`);
  if (scale !== 1) transforms.push(`scale(${scale})`);

  return {
    opacity,
    transform: transforms.length ? transforms.join(" ") : undefined,
    filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
    clipPath,
    flash,
  };
}

function mediaCropStyle(crop: { x: number; y: number; width: number; height: number } | undefined) {
  if (!crop) return undefined;
  return {
    position: "absolute" as const,
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
  };
}

function MissingAsset({ name }: { name: string }) {
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(145deg,#18181b,#09090b)",
        color: "rgba(255,255,255,.45)",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Arial, sans-serif",
        fontWeight: 700,
        fontSize: 22,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
    >
      {name}
    </AbsoluteFill>
  );
}

function VideoVisual({
  element,
  url,
  sceneFps,
  crop,
  localMs,
}: {
  element: CreativeVideoElement;
  url: string;
  sceneFps: number;
  crop?: { x: number; y: number; width: number; height: number };
  /** Time since the start of this clip's visible window. */
  localMs: number;
}) {
  const plan = resolveVideoPlaybackPlan(element, localMs, sceneFps);
  const style = {
    width: "100%",
    height: "100%",
    objectFit: element.fit,
    ...mediaCropStyle(crop ?? element.crop),
  } as const;

  if (plan.mode === "exact-frame") {
    const exactFrame = (
      <OffthreadVideo
        src={url}
        trimBefore={plan.trimBefore}
        trimAfter={plan.trimAfter}
        muted
        volume={0}
        style={style}
      />
    );
    return <Freeze frame={plan.freezeFrame}>{exactFrame}</Freeze>;
  }

  return (
    <OffthreadVideo
      src={url}
      trimBefore={plan.trimBefore}
      trimAfter={plan.trimAfter}
      playbackRate={plan.playbackRate}
      muted={element.muted}
      volume={element.muted ? 0 : element.volume}
      style={style}
    />
  );
}

/**
 * Renders a text element, animating it per unit when the element asks for it.
 *
 * Units are laid out as inline-blocks so words and characters wrap naturally
 * while each carries its own transform. Line granularity uses block spans so
 * a line still occupies a full row.
 */
function TextVisual({
  document,
  element,
  timeMs,
}: {
  document: CreativeDocument;
  element: CreativeTextElement;
  timeMs: number;
}) {
  // Element-local, matching apply_text_animation's clock - computed up front
  // because both the plain and the animated branch below need it, the
  // counter to resolve what to show and the animation to time how it moves.
  const localMs = timeMs - (element.timing?.startMs ?? 0);
  // The pure resolver decides what a counter shows, not this component.
  const resolvedText = element.counter ? resolveCounterText(element.counter, localMs) : element.text;
  const style = resolveTextStyle(document.designSystem, element.style);
  const layout = estimateTextLayout(
    resolvedText,
    {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
    },
    { width: element.transform.width, height: element.transform.height },
    element.fit,
  );

  const base = {
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: layout.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.align,
  } as const;

  if (!element.animation) {
    return (
      <AbsoluteFill style={{ justifyContent: "center", overflow: "hidden" }}>
        <div style={{ width: "100%", ...base, whiteSpace: "pre-wrap" }}>{resolvedText}</div>
      </AbsoluteFill>
    );
  }

  const animation = element.animation;
  const units = splitTextUnits(resolvedText, animation.granularity);
  const lines = groupTextUnitsByLine(units);
  const perLine = animation.granularity === "line" || animation.granularity === "block";

  return (
    <AbsoluteFill style={{ justifyContent: "center", overflow: "hidden" }}>
      <div style={{ width: "100%", ...base }}>
        {lines.map((line, lineIndex) => (
          <div key={lineIndex} style={{ display: "block" }}>
            {line.map((unit) => {
              const state = resolveTextUnitState(animation, unit.index, units.length, localMs);
              return (
                <span
                  key={unit.index}
                  style={{
                    display: perLine ? "block" : "inline-block",
                    opacity: state.opacity,
                    transform: `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`,
                    letterSpacing: style.letterSpacing + state.letterSpacingDelta,
                    clipPath: state.clipPercent > 0 ? `inset(0 ${state.clipPercent}% 0 0)` : undefined,
                    whiteSpace: "pre-wrap",
                    willChange: "transform, opacity",
                  }}
                >
                  {unit.text}
                  {animation.granularity === "word" ? " " : ""}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function UiNode({
  node,
  assets,
}: {
  node: ResolvedCreativeUiNode;
  assets: CreativeRemotionInputProps["assets"];
}) {
  const assetUrl = node.image ? assets[node.image.assetId]?.url : undefined;
  // A node outside its timing window renders nothing, and takes its children
  // with it — they are nested inside it.
  if (!node.visible) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        opacity: node.opacity,
        transform: node.transform ?? undefined,
        transformOrigin: node.transformOrigin,
        borderRadius: node.borderRadius || undefined,
        background: node.background ?? undefined,
        border: node.border ? `${node.border.width}px solid ${node.border.color}` : undefined,
        overflow: node.clip ? "hidden" : "visible",
        boxSizing: "border-box",
      }}
    >
      {node.text ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            color: node.text.style.color,
            fontFamily: node.text.style.fontFamily,
            fontSize: node.text.style.fontSize,
            fontWeight: node.text.style.fontWeight,
            lineHeight: node.text.style.lineHeight,
            letterSpacing: node.text.style.letterSpacing,
            textAlign: node.text.style.align,
            whiteSpace: "pre-wrap",
          }}
        >
          {node.text.value}
        </div>
      ) : null}
      {node.image && assetUrl ? (
        <Img
          src={assetUrl}
          style={{ width: "100%", height: "100%", objectFit: node.image.fit, borderRadius: node.borderRadius || undefined }}
        />
      ) : null}
      {node.children.map((child) => (
        <UiNode key={child.id} node={child} assets={assets} />
      ))}
    </div>
  );
}

/**
 * Renders a `ui` element: a fixed viewport laid out from the validated node
 * tree and scaled to exactly fill the element box. No markup string, script
 * or external URL is involved — the same resolution runs in the still
 * preview and the in-app editor preview.
 */
function UiVisual({
  document,
  element,
  assets,
  timeMs,
}: {
  document: CreativeDocument;
  element: CreativeUiElement;
  assets: CreativeRemotionInputProps["assets"];
  timeMs: number;
}) {
  const resolved = resolveCreativeUiElement(document, element, timeMs);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: resolved.background ?? undefined }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: resolved.viewport.width,
          height: resolved.viewport.height,
          transformOrigin: "0 0",
          transform: `scale(${resolved.scaleX}, ${resolved.scaleY})`,
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: -resolved.scrollY, width: "100%", height: "100%" }}>
          {resolved.nodes.map((node) => (
            <UiNode key={node.id} node={node} assets={assets} />
          ))}
        </div>
        {resolved.pointer ? (
          <div
            style={{
              position: "absolute",
              left: resolved.pointer.x - resolved.pointer.radius,
              top: resolved.pointer.y - resolved.pointer.radius,
              width: resolved.pointer.radius * 2,
              height: resolved.pointer.radius * 2,
              borderRadius: "50%",
              background: resolved.pointer.color,
              opacity: resolved.pointer.pressed ? 0.9 : 0.45,
              transform: `scale(${resolved.pointer.pressed ? 0.82 : 1})`,
              transformOrigin: "50% 50%",
            }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

/**
 * Renders a chart from geometry `chart.ts` already resolved - this component
 * only applies coordinates, paths and colours, deciding nothing. Identical to
 * the editor preview's ChartVisual: same geometry module, same viewBox
 * convention, same non-scaling-stroke treatment, so a chart looks the same in
 * both by construction.
 */
function ChartVisual({
  document,
  element,
  drawProgress,
  fillProgress,
  timeMs,
}: {
  document: CreativeDocument;
  element: CreativeChartElement;
  drawProgress: number;
  fillProgress: number;
  /** Scene-local, the clock a callout's own startMs/durationMs/fadeMs is on. */
  timeMs: number;
}) {
  const geometry = resolveChartGeometry(element.id, element, drawProgress, fillProgress);
  const annotations = resolveChartAnnotations(element.id, element, geometry, timeMs);
  const strokeColor = resolveColor(document.designSystem, element.stroke.color);
  const fillColor = element.fill ? resolveColor(document.designSystem, element.fill) : "none";
  return (
    <>
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
    >
      {annotations ? (
        <>
          {[annotations.yLinePath, annotations.xLinePath].map((path, index) =>
            path ? (
              <path
                key={`axis-${index}`}
                data-creative-chart-part={chartAxesId(element.id)}
                d={path}
                fill="none"
                stroke={strokeColor}
                strokeOpacity={0.45}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ) : null,
          )}
          {annotations.gridPaths.map((path, index) => (
            <path
              key={`grid-${index}`}
              d={path}
              fill="none"
              stroke={strokeColor}
              strokeOpacity={0.16}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {annotations.calloutLeaders.map((leader, index) => (
            <path
              key={`leader-${index}`}
              d={leader.path}
              fill="none"
              stroke={strokeColor}
              strokeOpacity={0.5 * leader.opacity}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      ) : null}
      {geometry.donutSegments ? (
        geometry.donutSegments.map((segment, segmentIndex) => (
          <path
            key={segment.id}
            data-creative-chart-part={segment.id}
            d={segment.path}
            fill={segment.fill ? resolveColor(document.designSystem, segment.fill) : fillColor !== "none" ? fillColor : strokeColor}
            fillOpacity={Math.max(0.32, 1 - segmentIndex * 0.08)}
            stroke={element.stroke.width > 0 ? strokeColor : "none"}
            strokeWidth={element.stroke.width}
            vectorEffect="non-scaling-stroke"
          />
        ))
      ) : geometry.progressBar ? (
        <rect
          data-creative-chart-part={chartSeriesId(element.id)}
          x={geometry.progressBar.x}
          y={geometry.progressBar.y}
          width={geometry.progressBar.width}
          height={geometry.progressBar.height}
          rx={geometry.progressBar.height / 2}
          fill={fillColor !== "none" ? fillColor : strokeColor}
        />
      ) : geometry.bars ? (
        geometry.bars.map((bar) => (
          <rect
            key={bar.id}
            data-creative-chart-part={bar.id}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            fill={bar.fill ? resolveColor(document.designSystem, bar.fill) : fillColor}
            stroke={element.stroke.width > 0 ? strokeColor : "none"}
            strokeWidth={element.stroke.width}
            vectorEffect="non-scaling-stroke"
          />
        ))
      ) : (
        <>
          {geometry.areaPath ? (
            <path data-creative-chart-part={chartAreaId(element.id)} d={geometry.areaPath} fill={fillColor} stroke="none" />
          ) : null}
          {geometry.linePath ? (
            <path
              data-creative-chart-part={chartSeriesId(element.id)}
              d={geometry.linePath}
              fill="none"
              stroke={strokeColor}
              strokeWidth={element.stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {geometry.points.map((point) =>
            point.emphasis ? (
              <circle
                key={point.id}
                data-creative-chart-part={point.id}
                cx={point.x}
                cy={point.y}
                r={point.emphasis.radius}
                fill={point.emphasis.color ? resolveColor(document.designSystem, point.emphasis.color) : strokeColor}
              />
            ) : null,
          )}
        </>
      )}
    </svg>
    {annotations && element.labelStyle ? (
      <ChartLabels document={document} labels={annotations.labels} style={element.labelStyle} />
    ) : null}
    </>
  );
}

/**
 * Chart text, in an overlay that is not stretched.
 *
 * The chart's SVG maps a 0..1 viewBox onto the element box with
 * preserveAspectRatio="none", so anything drawn inside it is stretched by the
 * same non-uniform factor - a 600x200 chart would render its labels three
 * times wider than tall. Text therefore lives outside that space, positioned
 * from the normalized coordinates chart.ts resolved, using the translate it
 * resolved too so both renderers hang a label off its point identically.
 */
function ChartLabels({
  document,
  labels,
  style,
}: {
  document: CreativeDocument;
  labels: ResolvedChartLabel[];
  style: TextStyleRef;
}) {
  const resolved = resolveTextStyle(document.designSystem, style);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
      {labels.map((label) => (
        <div
          key={label.id}
          data-creative-chart-part={label.id}
          style={{
            position: "absolute",
            left: `${label.x * 100}%`,
            top: `${label.y * 100}%`,
            transform: `translate(${label.translate})`,
            // Always resolved by chart.ts, 1 for every label but a callout
            // mid-fade, so this is applied unconditionally rather than only
            // when a caller happens to have timed something.
            opacity: label.opacity,
            whiteSpace: "nowrap",
            color: resolved.color,
            fontFamily: resolved.fontFamily,
            fontSize: resolved.fontSize,
            fontWeight: resolved.fontWeight,
            lineHeight: resolved.lineHeight,
            letterSpacing: resolved.letterSpacing,
          }}
        >
          {label.text}
        </div>
      ))}
    </div>
  );
}

function ConnectorVisual({
  document, element, timeMs, drawProgress,
}: {
  document: CreativeDocument;
  element: CreativeConnectorElement;
  timeMs: number;
  drawProgress: number;
}) {
  const geometry = resolveConnectorGeometry(document, element, timeMs);
  if (!geometry) return null;
  const stroke = resolveColor(document.designSystem, element.stroke.color);
  const progress = Math.min(1, Math.max(0, drawProgress));
  return (
    <svg viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
      <path
        data-creative-connector={element.id}
        d={geometry.path}
        fill="none"
        stroke={stroke}
        strokeWidth={element.stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - progress}
      />
    </svg>
  );
}

/**
 * A shape element whose outline is a deterministic morph rather than the
 * plain rect/ellipse box. Box-relative like ChartVisual's own SVG (viewBox
 * "0 0 1 1", stretched with preserveAspectRatio="none"), not canvas-relative
 * like ConnectorVisual's - a shape morph lives inside its own transform box
 * the way a chart does, not spanning the whole scene the way a connector
 * overlay does. localMs is computed here rather than threaded through
 * evaluateSceneAtTime: element-local timing (see CreativeShapeMorph in
 * schema.ts) is exactly the clock TextVisual already resolves this same way,
 * inside the component that draws it.
 */
function ShapeMorphVisual({
  document, element, resolvedFill, timeMs,
}: {
  document: CreativeDocument;
  element: CreativeShapeElement;
  resolvedFill?: string;
  timeMs: number;
}) {
  if (!element.morph) return null;
  const localMs = timeMs - (element.timing?.startMs ?? 0);
  const outline = resolveShapeOutline(element.morph, localMs);
  const fill = resolvedFill ?? resolveColor(document.designSystem, element.fill);
  const strokeColor = element.stroke ? resolveColor(document.designSystem, element.stroke.color) : undefined;
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
      <path
        data-creative-shape-morph={element.id}
        d={outline.path}
        fill={fill}
        stroke={strokeColor}
        strokeWidth={element.stroke?.width}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * One resolved child inside a composite's own local viewport.
 *
 * The exact position/glass/blendMode/adjustments recipe SceneRenderer applies
 * to a scene's own top-level elements below, reused here in the composite's
 * local pixel space - which for Remotion is the same raw-pixel convention the
 * top level already uses, so this differs from SceneRenderer's own per-element
 * block only in dropping the group wrapper (a composite child is never a
 * scene.groups member) and motion blur (velocity needs a previous-frame
 * re-evaluation of the same list, which composite children do not have here -
 * a deliberate scope cut, not a correctness gap: a child's motionBlur simply
 * resolves to no blur rather than a wrong one). A child that is itself a
 * composite recurses through ElementContent's own "composite" branch below.
 */
function CompositeChildLayer({
  document,
  scene,
  item,
  assets,
  fps,
  timeMs,
}: {
  document: CreativeDocument;
  scene: CreativeScene;
  item: EvaluatedElement;
  assets: CreativeRemotionInputProps["assets"];
  fps: number;
  timeMs: number;
}) {
  const { transform, element } = item;
  const assetId = element.type === "image" || element.type === "video" ? element.assetId : undefined;
  const glass = element.glass ? resolveGlassCss(document.designSystem, element.glass) : undefined;
  const elementTransformCss = creativeElementTransformCss(transform);
  return (
    <div
      style={{
        position: "absolute",
        left: transform.x,
        top: transform.y,
        width: transform.width,
        height: transform.height,
        opacity: transform.opacity,
        transformOrigin: `${transform.anchorX * 100}% ${transform.anchorY * 100}%`,
        ...elementTransformCss,
        mixBlendMode: resolveBlendModeCss(element.blendMode),
        ...(glass
          ? {
              backdropFilter: glass.backdropFilter,
              WebkitBackdropFilter: glass.backdropFilter,
              background: glass.background,
              border: glass.border,
              borderRadius: glass.borderRadius,
              boxShadow: glass.boxShadow,
            }
          : null),
        overflow: "visible",
      }}
    >
      <ElementAdjusted
        adjustments={item.adjustments}
        mask={element.mask}
        motionBlur={undefined}
        velocityX={0}
        velocityY={0}
        elementId={element.id}
      >
        <ElementContent
          document={document}
          scene={scene}
          element={element}
          assetUrl={assetId ? assets[assetId]?.url : undefined}
          assets={assets}
          fps={fps}
          timeMs={timeMs}
          crop={item.crop}
          drawProgress={item.drawProgress}
          fillProgress={item.fillProgress}
          resolvedFill={item.resolvedFill}
        />
      </ElementAdjusted>
    </div>
  );
}

/**
 * Renders a `composite` element: a fixed local viewport, scaled to exactly
 * fill the element box exactly like `ui`'s (see resolveCreativeCompositeElement),
 * holding real resolved children stacked among themselves only - the whole
 * children keep a local preserve-3d context until the composite viewport clips
 * them. `overflow: clip` is intentional: unlike `hidden`, it does not force
 * intermediate 3D flattening. The clipped subtree then composites as one
 * surface (design decision 4 on
 * CreativeCompositeElement), so the composite's own opacity - applied by the
 * ordinary element wrapper in SceneRenderer, the same one every element gets -
 * fades the flattened card rather than multiplying through each child.
 */
function CompositeVisual({
  document,
  scene,
  element,
  assets,
  fps,
  timeMs,
}: {
  document: CreativeDocument;
  scene: CreativeScene;
  element: CreativeCompositeElement;
  assets: CreativeRemotionInputProps["assets"];
  fps: number;
  timeMs: number;
}) {
  const resolved = resolveCreativeCompositeElement(document, scene, element, timeMs);
  return (
    <AbsoluteFill style={{ overflow: "clip", transformStyle: "preserve-3d" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: resolved.viewport.width,
          height: resolved.viewport.height,
          transformOrigin: "0 0",
          transform: `scale(${resolved.scaleX}, ${resolved.scaleY})`,
          transformStyle: "preserve-3d",
          overflow: "visible",
        }}
      >
        {resolved.children.map((item) => (
          <CompositeChildLayer key={item.element.id} document={document} scene={scene} item={item} assets={assets} fps={fps} timeMs={timeMs} />
        ))}
      </div>
    </AbsoluteFill>
  );
}

function ElementContent({
  document,
  scene,
  element,
  assetUrl,
  assets,
  fps,
  timeMs,
  crop,
  drawProgress,
  fillProgress,
  resolvedFill,
}: {
  document: CreativeDocument;
  scene: CreativeScene;
  element: CreativeElement;
  assetUrl?: string;
  assets: CreativeRemotionInputProps["assets"];
  fps: number;
  timeMs: number;
  /** Animated crop window, when the element animates one. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Chart elements only, already resolved by evaluateSceneAtTime. */
  drawProgress?: number;
  fillProgress?: number;
  /** Shape fill resolved by the shared evaluator. */
  resolvedFill?: string;
}) {
  if (element.type === "text") {
    return <TextVisual document={document} element={element} timeMs={timeMs} />;
  }

  if (element.type === "image") {
    if (!assetUrl) return <MissingAsset name={element.name || "Image"} />;
    return (
      <AbsoluteFill style={{ overflow: "hidden", borderRadius: element.borderRadius ?? 0 }}>
        <Img
          src={assetUrl}
          style={{ width: "100%", height: "100%", objectFit: element.fit, ...mediaCropStyle(crop ?? element.crop) }}
        />
      </AbsoluteFill>
    );
  }

  if (element.type === "video") {
    if (!assetUrl) return <MissingAsset name={element.name || "Video"} />;
    const startMs = element.timing?.startMs ?? 0;
    const endMs = element.timing?.endMs ?? document.scenes[0]?.durationMs ?? 1000;
    const from = Math.max(0, Math.round((startMs / 1000) * fps));
    const duration = Math.max(1, Math.ceil(((endMs - startMs) / 1000) * fps));
    return (
      <Sequence from={from} durationInFrames={duration} layout="none">
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <VideoVisual element={element} url={assetUrl} sceneFps={fps} crop={crop} localMs={timeMs - startMs} />
        </AbsoluteFill>
      </Sequence>
    );
  }

  if (element.type === "ui") {
    return <UiVisual document={document} element={element} assets={assets} timeMs={timeMs} />;
  }
  if (element.type === "chart") {
    return (
      <ChartVisual
        document={document}
        element={element}
        drawProgress={drawProgress ?? 1}
        fillProgress={fillProgress ?? drawProgress ?? 1}
        timeMs={timeMs}
      />
    );
  }
  if (element.type === "connector") {
    return <ConnectorVisual document={document} element={element} timeMs={timeMs} drawProgress={drawProgress ?? 1} />;
  }
  if (element.type === "composite") {
    return <CompositeVisual document={document} scene={scene} element={element} assets={assets} fps={fps} timeMs={timeMs} />;
  }

  // Purely additive: a shape with no morph never reaches ShapeMorphVisual and
  // falls straight through to the plain rect/ellipse box below, exactly as it
  // rendered before this field existed.
  if (element.morph) {
    return <ShapeMorphVisual document={document} element={element} resolvedFill={resolvedFill} timeMs={timeMs} />;
  }

  const fill = resolvedFill ?? resolveColor(document.designSystem, element.fill);
  return (
    <AbsoluteFill
      style={{
        background: fill,
        border: element.stroke
          ? `${element.stroke.width}px solid ${resolveColor(document.designSystem, element.stroke.color)}`
          : undefined,
        borderRadius: element.shape === "ellipse" ? "50%" : element.borderRadius ?? 0,
        boxSizing: "border-box",
      }}
    />
  );
}

/**
 * Applies deterministic grading to one element.
 *
 * Colour work is a CSS filter on a wrapper; vignette and grain are overlays
 * on top of the graded content, because both describe light falling on the
 * image rather than a change to its colour. When nothing is set the wrapper
 * disappears entirely so an ungraded element costs no extra layer.
 */
function ElementAdjusted({
  adjustments,
  mask,
  motionBlur,
  velocityX,
  velocityY,
  elementId,
  children,
}: {
  adjustments?: CreativeAdjustments;
  mask?: CreativeMask;
  motionBlur?: CreativeMotionBlur;
  velocityX: number;
  velocityY: number;
  elementId: string;
  children: React.ReactNode;
}) {
  const maskCss = resolveMaskCss(mask);
  const blur = resolveMotionBlur(motionBlur, velocityX, velocityY);
  if (!hasVisibleAdjustments(adjustments) && !maskCss && !blur) return <>{children}</>;

  const colour = hasVisibleAdjustments(adjustments) ? adjustmentsToCssFilter(adjustments!) : undefined;
  const vignette = hasVisibleAdjustments(adjustments) ? adjustmentsVignetteGradient(adjustments!) : undefined;
  const backdrop = hasVisibleAdjustments(adjustments) ? adjustmentsToBackdropFilter(adjustments!) : undefined;
  const grain = hasVisibleAdjustments(adjustments) ? adjustmentsGrainOpacity(adjustments!) : 0;

  // Motion blur is an SVG filter because CSS blur() is isotropic and real
  // motion blur smears only along the direction of travel.
  const blurId = `mb-${elementId}`;
  const filter = [colour, blur ? `url(#${blurId})` : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <AbsoluteFill
      style={{
        filter,
        backdropFilter: backdrop,
        WebkitBackdropFilter: backdrop,
        WebkitMaskImage: maskCss?.maskImage,
        maskImage: maskCss?.maskImage,
        maskSize: maskCss?.maskSize,
        maskPosition: maskCss?.maskPosition,
        maskRepeat: maskCss?.maskRepeat,
        maskComposite: maskCss?.maskComposite,
        WebkitMaskComposite: maskCss?.webkitMaskComposite,
        clipPath: maskCss?.clipPath,
      }}
    >
      {blur ? (
        <svg width="0" height="0" style={{ position: "absolute" }}>
          <defs>
            <filter id={blurId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={`${blur.stdDeviationX} ${blur.stdDeviationY}`} />
            </filter>
          </defs>
        </svg>
      ) : null}
      {children}
      {vignette ? <AbsoluteFill style={{ background: vignette, pointerEvents: "none" }} /> : null}
      {grain > 0 ? (
        <AbsoluteFill
          style={{
            opacity: grain,
            pointerEvents: "none",
            mixBlendMode: "overlay",
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.5'/></svg>\")",
            backgroundRepeat: "repeat",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}

/**
 * A canvas-sized box carrying a group or camera transform, or nothing at all.
 *
 * Identical in behaviour to the editor preview's layer, because both apply the
 * same values resolved by `lib/creative/hierarchy.ts`. Wrapping each of a
 * group's children individually is geometrically the same as one shared box —
 * the pivot is canvas-relative and this box covers the canvas — and it keeps
 * z-order intact when a group's children are not contiguous in z. The camera
 * owns every element in the scene, so it uses one shared box.
 */
function HierarchyLayer({ css, children }: { css: HierarchyCss | undefined; children: React.ReactNode }) {
  if (!css) return <>{children}</>;
  return (
    <AbsoluteFill
      style={{
        transformOrigin: css.transformOrigin,
        transform: css.transform,
        opacity: css.opacity,
        filter: css.filter,
        perspective: css.perspective,
        perspectiveOrigin: css.perspectiveOrigin,
        transformStyle: css.transformStyle,
        pointerEvents: "none",
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function SceneRenderer({
  document,
  scene,
  entry,
  assets,
}: {
  document: CreativeDocument;
  scene: CreativeScene;
  entry: CreativeSceneTimelineEntry;
  assets: CreativeRemotionInputProps["assets"];
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localMs = Math.min(scene.durationMs - 0.001, (frame / fps) * 1000);
  const evaluated = evaluateSceneAtTime(document, scene, localMs);
  // Evaluating one frame earlier gives per-element velocity, which is what
  // motion blur needs; it costs nothing when no element asks for blur.
  const previousFrame =
    frame > 0 && scene.elements.some((element) => element.motionBlur)
      ? evaluateSceneAtTime(document, scene, Math.max(0, localMs - 1000 / fps))
      : null;
  const { flash, ...presentation } = transitionPresentation({ document, entry, localMs });
  const cameraCss = resolveCameraCss(scene.camera, localMs);

  return (
    <AbsoluteFill style={{ background: evaluated.background, ...presentation }}>
      <HierarchyLayer css={cameraCss}>
      {evaluated.elements.map(({ element, transform, crop, adjustments, drawProgress, fillProgress, resolvedFill }) => {
        // Velocity for motion blur: where this element was one frame ago.
        const previous = previousFrame?.elements.find((item) => item.element.id === element.id);
        const velocityX = previous ? transform.x - previous.transform.x : 0;
        const velocityY = previous ? transform.y - previous.transform.y : 0;
        const assetId = element.type === "image" || element.type === "video" ? element.assetId : undefined;
        const owningGroup = findOwningGroup(scene.groups, element.id);
        // A continuing group blends its transform back toward the outgoing
        // group's, so the cluster arrives as one object rather than snapping
        // into place. Falls through to the plain resolve when it is not.
        const continuedGroup = owningGroup
          ? resolveContinuedGroupTransform(document, scene, owningGroup.id, localMs)
          : undefined;
        const resolvedGroupCss = continuedGroup
          ? hierarchyTransformCss(continuedGroup)
          : owningGroup ? resolveGroupCss(owningGroup, localMs) : undefined;
        const elementTransformCss = creativeElementTransformCss(transform);
        const groupCss = elementTransformCss.transformStyle ? preserveHierarchyDepth(resolvedGroupCss) : resolvedGroupCss;
        const glass = element.glass ? resolveGlassCss(document.designSystem, element.glass) : undefined;
        return (
          <HierarchyLayer css={groupCss} key={`layer-${element.id}`}>
          <div
            key={element.id}
            style={{
              position: "absolute",
              left: transform.x,
              top: transform.y,
              width: transform.width,
              height: transform.height,
              opacity: transform.opacity,
              transformOrigin: `${transform.anchorX * 100}% ${transform.anchorY * 100}%`,
              ...elementTransformCss,
              mixBlendMode: resolveBlendModeCss(element.blendMode),
              // Glass is the element's own surface, so it sits on the same box
              // the transform places - behind whatever the element draws.
              ...(glass
                ? {
                    backdropFilter: glass.backdropFilter,
                    WebkitBackdropFilter: glass.backdropFilter,
                    background: glass.background,
                    border: glass.border,
                    borderRadius: glass.borderRadius,
                    boxShadow: glass.boxShadow,
                  }
                : null),
              overflow: "visible",
            }}
          >
            {/* The resolved block, not element.adjustments: an animated blur
                renders as its starting value if the static one is read. */}
            <ElementAdjusted
              adjustments={adjustments}
              mask={element.mask}
              motionBlur={element.motionBlur}
              velocityX={velocityX}
              velocityY={velocityY}
              elementId={element.id}
            >
              <ElementContent
                document={document}
                scene={scene}
                element={element}
                assetUrl={assetId ? assets[assetId]?.url : undefined}
                assets={assets}
                fps={fps}
                timeMs={localMs}
                crop={crop}
                drawProgress={drawProgress}
                fillProgress={fillProgress}
                resolvedFill={resolvedFill}
              />
            </ElementAdjusted>
          </div>
          </HierarchyLayer>
        );
      })}
      </HierarchyLayer>
      {flash > 0 ? (
        <AbsoluteFill style={{ background: "white", opacity: flash, pointerEvents: "none" }} />
      ) : null}
    </AbsoluteFill>
  );
}

/**
 * The document's audio bed.
 *
 * Each clip is mounted as its own Sequence on the rendered timeline, with a
 * per-frame volume taken from the same pure resolver the editor uses, so
 * fades and ducking are identical in preview and export.
 */
function CreativeAudioTrack({
  document,
  assets,
}: {
  document: CreativeDocument;
  assets: CreativeRemotionInputProps["assets"];
}) {
  const { fps } = useVideoConfig();
  const clips = getCreativeAudioClips(document);
  if (clips.length === 0) return null;

  return (
    <>
      {clips.map((clip) => {
        const url = assets[clip.assetId]?.url;
        if (!url || clip.muted) return null;
        const from = Math.max(0, Math.round((clip.startMs / 1000) * fps));
        const duration = Math.max(1, Math.ceil(((clip.endMs - clip.startMs) / 1000) * fps));
        return (
          <Sequence key={clip.id} from={from} durationInFrames={duration} layout="none">
            <Audio
              src={url}
              startFrom={Math.max(0, Math.round((clip.sourceStartMs / 1000) * fps))}
              volume={(frame) =>
                resolveAudioClipGain(clip, clips, clip.startMs + (frame / fps) * 1000)
              }
            />
          </Sequence>
        );
      })}
    </>
  );
}

export function CreativeComposition({ document, assets }: CreativeRemotionInputProps) {
  // Blocks the first frame until the document's typefaces are ready, so a
  // render can never contain some frames in the brand face and some in a
  // fallback. Times out rather than hanging.
  useCreativeFonts(document);
  const { fps } = useVideoConfig();
  const timeline = getCreativeSceneTimeline(document);
  return (
    <AbsoluteFill style={{ background: resolveColor(document.designSystem, document.canvas.background) }}>
      <CreativeAudioTrack document={document} assets={assets} />
      {timeline.map((entry) => {
        const scene = document.scenes[entry.sceneIndex];
        const from = Math.max(0, Math.round((entry.startMs / 1000) * fps));
        const duration = Math.max(1, Math.ceil((scene.durationMs / 1000) * fps));
        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration} layout="none">
            <SceneRenderer document={document} scene={scene} entry={entry} assets={assets} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
