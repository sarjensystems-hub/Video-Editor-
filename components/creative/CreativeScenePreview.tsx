"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import {
  evaluateSceneAtTime,
  resolveColor,
  resolveTextStyle,
  type EvaluatedElement,
} from "@/lib/creative/evaluate";
import { resolveMaskCss } from "@/lib/creative/mask";
import { resolveBlendModeCss } from "@/lib/creative/blend";
import { resolveGlassCss } from "@/lib/creative/glass";
import {
  chartAreaId,
  chartAxesId,
  chartSeriesId,
  resolveChartAnnotations,
  resolveChartGeometry,
  type ResolvedChartLabel,
} from "@/lib/creative/chart";
import { resolveConnectorGeometry } from "@/lib/creative/connector";
import {
  findOwningGroup,
  creativeElementTransformCss,
  preserveHierarchyDepth,
  resolveCameraCss,
  hierarchyTransformCss,
  resolveGroupCss,
  type HierarchyCss,
} from "@/lib/creative/hierarchy";
import { resolveContinuedGroupTransform } from "@/lib/creative/continuation";
import { resolveVideoSourceTimeMs } from "@/lib/creative/video-playback";
import {
  adjustmentsGrainOpacity,
  adjustmentsToBackdropFilter,
  adjustmentsToCssFilter,
  adjustmentsVignetteGradient,
  hasVisibleAdjustments,
} from "@/lib/creative/adjustments";
import {
  resolveCreativeUiElement,
  type ResolvedCreativeUiNode,
} from "@/lib/creative/ui-element";
import { resolveCreativeCompositeElement } from "@/lib/creative/composite";
import {
  estimateTextLayout,
  groupTextUnitsByLine,
  resolveTextUnitState,
  splitTextUnits,
} from "@/lib/creative/text-animation";
import { resolveCounterText } from "@/lib/creative/counter";
import { resolveShapeOutline } from "@/lib/creative/shape-morph";
import type {
  CreativeAdjustments,
  CreativeChartElement,
  TextStyleRef,
  CreativeCompositeElement,
  CreativeConnectorElement,
  CreativeDocument,
  CreativeMask,
  CreativeImageElement,
  CreativeScene,
  CreativeShapeElement,
  CreativeUiElement,
  CreativeVideoElement,
  CropRect,
} from "@/lib/creative/schema";

export interface CreativePreviewAsset {
  id: string;
  url: string;
  mimeType?: string | null;
}

export type CreativePreviewAssets = Record<string, CreativePreviewAsset>;

function cropStyle(crop?: CropRect): CSSProperties | undefined {
  if (!crop) return undefined;
  return {
    position: "absolute",
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
  };
}

function Placeholder({ label }: { label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 35% 30%, rgba(239,68,68,.26), transparent 35%), linear-gradient(145deg,#18181b,#09090b 70%)",
        color: "rgba(255,255,255,.48)",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: ".08em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );
}

function ImageLayer({ element, asset, crop }: { element: CreativeImageElement; asset?: CreativePreviewAsset; crop?: CropRect }) {
  const image = asset?.url ? (
    <img
      src={asset.url}
      alt={element.name}
      draggable={false}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        objectFit: element.fit,
        ...cropStyle(crop ?? element.crop),
      }}
    />
  ) : (
    <Placeholder label={element.name || "Image"} />
  );

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: element.borderRadius ?? 0 }}>
      {image}
    </div>
  );
}

function SyncedVideo({
  element,
  asset,
  sceneTimeMs,
}: {
  element: CreativeVideoElement;
  asset?: CreativePreviewAsset;
  sceneTimeMs: number;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const visibleStart = element.timing?.startMs ?? 0;
  const localMs = Math.max(0, sceneTimeMs - visibleStart);
  const sourceMs = resolveVideoSourceTimeMs(element, localMs);
  const exactSeek = element.freezeAtSourceMs != null || Boolean(element.speedRamp);

  useEffect(() => {
    const node = ref.current;
    if (!node || !asset?.url) return;
    if (exactSeek) node.pause();
    const target = sourceMs / 1000;
    if (Number.isFinite(target) && Math.abs(node.currentTime - target) > 0.02) {
      try {
        node.currentTime = target;
      } catch {
        // Metadata can still be loading; the next time tick will retry.
      }
    }
  }, [asset?.url, exactSeek, sourceMs]);

  if (!asset?.url) return <Placeholder label={element.name || "Video"} />;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 0 }}>
      <video
        ref={ref}
        src={asset.url}
        muted
        playsInline
        preload="auto"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          objectFit: element.fit,
          ...cropStyle(element.crop),
        }}
      />
    </div>
  );
}

function UiNodeLayer({
  node,
  assets,
}: {
  node: ResolvedCreativeUiNode;
  assets: CreativePreviewAssets;
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={assetUrl}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: node.image.fit,
            borderRadius: node.borderRadius || undefined,
          }}
        />
      ) : null}
      {node.children.map((child) => (
        <UiNodeLayer key={child.id} node={child} assets={assets} />
      ))}
    </div>
  );
}

/** Mirrors the Remotion `ui` renderer so the editor preview matches the render. */
function UiLayer({
  document,
  element,
  assets,
  timeMs,
}: {
  document: CreativeDocument;
  element: CreativeUiElement;
  assets: CreativePreviewAssets;
  timeMs: number;
}) {
  const resolved = resolveCreativeUiElement(document, element, timeMs);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: resolved.background ?? undefined,
      }}
    >
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
            <UiNodeLayer key={node.id} node={node} assets={assets} />
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
    </div>
  );
}

/**
 * One resolved child inside a composite's own local viewport.
 *
 * The exact position/glass/blendMode/adjustments recipe the top-level scene
 * loop at the bottom of this file applies to a scene's own elements, in the
 * composite's local pixel space instead of canvas percentages - no group
 * wrapping, because a composite child is never a scene.groups member (see
 * the addressing note on CreativeCompositeElement). A child that is itself a
 * composite recurses through ElementVisual's own "composite" branch below,
 * so nesting one composite inside another costs nothing extra here.
 */
function CompositeChildLayer({
  document,
  scene,
  item,
  assets,
  timeMs,
}: {
  document: CreativeDocument;
  scene: CreativeScene;
  item: EvaluatedElement;
  assets: CreativePreviewAssets;
  timeMs: number;
}) {
  const { transform, element } = item;
  const assetId = element.type === "image" || element.type === "video" ? element.assetId : undefined;
  const glass = element.glass ? resolveGlassCss(document.designSystem, element.glass) : undefined;
  const elementTransformCss = creativeElementTransformCss(transform);
  return (
    <div
      data-creative-element={element.id}
      data-creative-type={element.type}
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
        // Glass is the child's own surface, same convention as a top-level
        // element: it sits on the same box the transform places, behind
        // whatever the child draws.
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
        pointerEvents: "none",
      }}
    >
      <ElementAdjusted adjustments={item.adjustments} mask={element.mask}>
        <ElementVisual
          document={document}
          scene={scene}
          item={item}
          crop={item.crop}
          asset={assetId ? assets[assetId] : undefined}
          assets={assets}
          timeMs={timeMs}
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
 * ordinary element wrapper below, the same one every element gets - fades the
 * flattened card rather than multiplying through each child.
 */
function CompositeVisual({
  document,
  scene,
  element,
  assets,
  timeMs,
}: {
  document: CreativeDocument;
  scene: CreativeScene;
  element: CreativeCompositeElement;
  assets: CreativePreviewAssets;
  timeMs: number;
}) {
  const resolved = resolveCreativeCompositeElement(document, scene, element, timeMs);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "clip", transformStyle: "preserve-3d" }}>
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
          <CompositeChildLayer key={item.element.id} document={document} scene={scene} item={item} assets={assets} timeMs={timeMs} />
        ))}
      </div>
    </div>
  );
}

/** Mirrors the Remotion grading wrapper so preview and export match. */
function ElementAdjusted({
  adjustments,
  mask,
  children,
}: {
  adjustments?: CreativeAdjustments;
  mask?: CreativeMask;
  children: React.ReactNode;
}) {
  const maskCss = resolveMaskCss(mask);
  if (!hasVisibleAdjustments(adjustments) && !maskCss) return <>{children}</>;
  const filter = hasVisibleAdjustments(adjustments) ? adjustmentsToCssFilter(adjustments!) : undefined;
  const vignette = hasVisibleAdjustments(adjustments) ? adjustmentsVignetteGradient(adjustments!) : undefined;
  const backdrop = hasVisibleAdjustments(adjustments) ? adjustmentsToBackdropFilter(adjustments!) : undefined;
  const grain = hasVisibleAdjustments(adjustments) ? adjustmentsGrainOpacity(adjustments!) : 0;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
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
      {children}
      {vignette ? <div style={{ position: "absolute", inset: 0, background: vignette }} /> : null}
      {grain > 0 ? (
        <div style={{ position: "absolute", inset: 0, opacity: grain, mixBlendMode: "overlay",
          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.5'/></svg>\")",
          backgroundRepeat: "repeat" }} />
      ) : null}
    </div>
  );
}

/**
 * Renders a chart from geometry `chart.ts` already resolved - this component
 * only applies coordinates, paths and colours, deciding nothing. The SVG's
 * own 0..1 viewBox is stretched to the element's box by `preserveAspectRatio
 * ="none"`, matching the normalized space the geometry module resolves into;
 * `vector-effect="non-scaling-stroke"` keeps the line/bar edge a constant
 * screen-pixel weight regardless of how that stretch scales the box.
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
    <svg
      viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`}
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
    >
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
 * overlay does. localMs is computed here rather than passed in: element-local
 * timing (see CreativeShapeMorph in schema.ts) is exactly the clock
 * apply_text_animation and set_counter already resolve this same way, inside
 * the component that draws them, not inside evaluateSceneAtTime.
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
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
    >
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

function ElementVisual({
  document,
  scene,
  item,
  asset,
  assets,
  timeMs,
  crop,
}: {
  document: CreativeDocument;
  scene: CreativeScene;
  item: EvaluatedElement;
  asset?: CreativePreviewAsset;
  assets: CreativePreviewAssets;
  timeMs: number;
  crop?: { x: number; y: number; width: number; height: number };
}) {
  const element = item.element;

  if (element.type === "text") {
    // Element-local, matching apply_text_animation's clock: a counter and a
    // kinetic-typography run on the same element share this one offset from
    // when the element itself comes on screen.
    const localMs = timeMs - (element.timing?.startMs ?? 0);
    // The pure resolver decides what a counter shows, not this component -
    // resolveCounterText is called here with no branching of its own, the
    // same way resolveTextUnitState already is a few lines down.
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
    const base: CSSProperties = {
      width: "100%",
      color: style.color,
      fontFamily: style.fontFamily,
      fontSize: layout.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textAlign: style.align,
    };
    const wrapper: CSSProperties = {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent:
        style.align === "center" ? "center" : style.align === "right" ? "flex-end" : "flex-start",
      overflow: "hidden",
    };

    if (!element.animation) {
      return (
        <div style={wrapper}>
          <div style={{ ...base, whiteSpace: "pre-wrap" }}>{resolvedText}</div>
        </div>
      );
    }

    // Mirrors remotion/CreativeComposition.tsx so the editor preview and the
    // render resolve the same unit states from the same pure helpers.
    const animation = element.animation;
    const units = splitTextUnits(resolvedText, animation.granularity);
    const lines = groupTextUnitsByLine(units);
    const perLine = animation.granularity === "line" || animation.granularity === "block";

    return (
      <div style={wrapper}>
        <div style={base}>
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
      </div>
    );
  }

  if (element.type === "image") return <ImageLayer element={element} asset={asset} crop={crop} />;
  if (element.type === "video") return <SyncedVideo element={element} asset={asset} sceneTimeMs={timeMs} />;
  if (element.type === "ui") {
    return <UiLayer document={document} element={element} assets={assets} timeMs={timeMs} />;
  }
  if (element.type === "chart") {
    return (
      <ChartVisual
        document={document}
        element={element}
        drawProgress={item.drawProgress ?? 1}
        fillProgress={item.fillProgress ?? item.drawProgress ?? 1}
        timeMs={timeMs}
      />
    );
  }
  if (element.type === "connector") {
    return (
      <ConnectorVisual
        document={document}
        element={element}
        timeMs={timeMs}
        drawProgress={item.drawProgress ?? 1}
      />
    );
  }
  if (element.type === "composite") {
    return <CompositeVisual document={document} scene={scene} element={element} assets={assets} timeMs={timeMs} />;
  }

  // Purely additive: a shape with no morph never reaches ShapeMorphVisual and
  // falls straight through to the plain rect/ellipse box below, exactly as it
  // rendered before this field existed.
  if (element.morph) {
    return (
      <ShapeMorphVisual document={document} element={element} resolvedFill={item.resolvedFill} timeMs={timeMs} />
    );
  }

  const fill = item.resolvedFill ?? resolveColor(document.designSystem, element.fill);
  const stroke = element.stroke
    ? `${element.stroke.width}px solid ${resolveColor(document.designSystem, element.stroke.color)}`
    : undefined;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: fill,
        border: stroke,
        borderRadius: element.shape === "ellipse" ? "50%" : element.borderRadius ?? 0,
        boxSizing: "border-box",
      }}
    />
  );
}


/**
 * A canvas-sized box carrying a group or camera transform, or nothing at all.
 *
 * Because the pivot is canvas-relative and this box covers the canvas, wrapping
 * each of a group's children in its own layer is geometrically identical to
 * wrapping them all in one — and it preserves z-order, which a single shared
 * box cannot when a group's children are not contiguous in z. The camera, which
 * owns every element in the scene, does use one shared box.
 *
 * The one visible difference: a group's opacity multiplies each child's rather
 * than compositing the group as a unit, so overlapping children under a
 * half-opaque group read darker where they overlap. Geometry and stacking are
 * worth more than that here, and a camera composites the scene properly.
 */
function HierarchyLayer({ css, children }: { css: HierarchyCss | undefined; children: React.ReactNode }) {
  if (!css) return <>{children}</>;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
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
    </div>
  );
}

export default function CreativeScenePreview({
  document,
  sceneId,
  timeMs,
  assets = {},
  className,
}: {
  document: CreativeDocument;
  sceneId?: string;
  timeMs: number;
  assets?: CreativePreviewAssets;
  className?: string;
}) {
  const scene = useMemo(
    () => document.scenes.find((item) => item.id === sceneId) ?? document.scenes[0],
    [document, sceneId],
  );
  const clampedTime = Math.min(Math.max(0, timeMs), Math.max(0, scene.durationMs - 0.001));
  const evaluated = useMemo(
    () => evaluateSceneAtTime(document, scene, clampedTime),
    [document, scene, clampedTime],
  );
  const cameraCss = useMemo(
    () => resolveCameraCss(scene.camera, clampedTime),
    [scene.camera, clampedTime],
  );

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${document.canvas.width} / ${document.canvas.height}`,
        overflow: "hidden",
        background: evaluated.background,
        containerType: "inline-size",
      }}
      data-creative-scene={scene.id}
      data-creative-time={Math.round(clampedTime)}
    >
      <HierarchyLayer css={cameraCss}>
      {evaluated.elements.map((item) => {
        const { transform } = item;
        const element = item.element;
        const assetId = element.type === "image" || element.type === "video" ? element.assetId : undefined;
        const owningGroup = findOwningGroup(scene.groups, element.id);
        // A continuing group blends its transform back toward the outgoing
        // group's, so the cluster arrives as one object rather than snapping
        // into place. Falls through to the plain resolve when it is not.
        const continuedGroup = owningGroup
          ? resolveContinuedGroupTransform(document, scene, owningGroup.id, clampedTime)
          : undefined;
        const resolvedGroupCss = continuedGroup
          ? hierarchyTransformCss(continuedGroup)
          : owningGroup ? resolveGroupCss(owningGroup, clampedTime) : undefined;
        const elementTransformCss = creativeElementTransformCss(transform);
        const groupCss = elementTransformCss.transformStyle ? preserveHierarchyDepth(resolvedGroupCss) : resolvedGroupCss;
        const glass = element.glass ? resolveGlassCss(document.designSystem, element.glass) : undefined;
        return (
          <HierarchyLayer css={groupCss} key={`layer-${element.id}`}>
          <div
            key={element.id}
            data-creative-element={element.id}
            data-creative-type={element.type}
            style={{
              position: "absolute",
              left: `${(transform.x / document.canvas.width) * 100}%`,
              top: `${(transform.y / document.canvas.height) * 100}%`,
              width: `${(transform.width / document.canvas.width) * 100}%`,
              height: `${(transform.height / document.canvas.height) * 100}%`,
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
              pointerEvents: "none",
            }}
          >
            {/* item.adjustments, not element.adjustments: an animated blur
                renders as its starting value if the static block is read. */}
            <ElementAdjusted adjustments={item.adjustments} mask={element.mask}>
              <ElementVisual
                document={document}
                scene={scene}
                item={item}
                crop={item.crop}
                asset={assetId ? assets[assetId] : undefined}
                assets={assets}
                timeMs={clampedTime}
              />
            </ElementAdjusted>
          </div>
          </HierarchyLayer>
        );
      })}
      </HierarchyLayer>
    </div>
  );
}
