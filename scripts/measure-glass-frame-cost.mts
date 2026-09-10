/**
 * What a glass panel costs per rendered frame.
 *
 * Glass was recommended on most surfaces of a 92.6-second film, and that
 * recommendation was made without anyone measuring it. The film then rendered
 * at roughly two frames per second and could not finish inside the sandbox
 * ceiling (roadmap #58). `backdrop-filter` is the obvious suspect, because it
 * re-rasterises everything behind the element every frame, but "obvious
 * suspect" is not a measurement and a renderer budget built on one is a guess.
 *
 * So this measures it, in the same engine that renders the film: Remotion
 * drives headless Chromium and captures one screenshot per frame, and that is
 * exactly what this does. It compares three versions of one scene:
 *
 *   none   no panels at all - the floor, the cost of the backdrop alone
 *   flat   panels with a flat translucent fill, border and shadow
 *   glass  the same panels with the real resolveGlassCss output
 *
 * flat is the control, not `none`: an author who drops glass still draws a
 * panel. The number that matters is glass minus flat, which is the cost of
 * `backdrop-filter` itself rather than the cost of having a panel.
 *
 * Two things about the method are load-bearing:
 *
 *  - The backdrop is busy, not a flat colour. Blurring a flat fill is nearly
 *    free and would understate the cost by an order of magnitude.
 *  - Every frame moves. A static scene lets Chromium reuse the rasterised
 *    backdrop between captures, which is not what happens in a film and would
 *    make glass look almost free.
 *
 * Run: node --experimental-strip-types scripts/measure-glass-frame-cost.mts
 *      [--frames 40] [--json <path>]
 *
 * It imports lib/creative/glass.ts directly, so it measures the CSS the
 * product actually ships rather than a copy of it that can drift.
 *
 * This is a `.mts` measuring tool, deliberately outside the tsconfig `include`
 * globs so that typechecking a dev script never has a say in the production
 * build. It is therefore not covered by the promotion gate's `tsc --noEmit`.
 * Check it by hand after editing:
 *
 *   npx tsc --noEmit --allowImportingTsExtensions --module esnext \
 *     --moduleResolution bundler --target es2022 --strict --skipLibCheck \
 *     scripts/measure-glass-frame-cost.mts
 */

import { launch, type Browser } from "puppeteer-core";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { resolveGlassCss } from "../lib/creative/glass.ts";
import type { CreativeDesignSystem } from "../lib/creative/schema.ts";

const CHROME = process.env.CREATIVE_BENCH_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const WIDTH = 1920;
const HEIGHT = 1080;

/** Panel counts worth knowing about: one card, a row, a grid, a wall of them. */
const PANEL_COUNTS = [1, 3, 6, 12];
/** Blur radii spanning a hairline frost to the heavy blur a hero panel uses. */
const BLUR_RADII = [8, 24, 48];

type Variant = "none" | "flat" | "glass";

interface Measurement {
  variant: Variant;
  panels: number;
  blurPx: number;
  medianMs: number;
  p90Ms: number;
  fps: number;
}

function parseArgs(): { frames: number; jsonPath?: string } {
  const argv = process.argv.slice(2);
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const frames = Number(read("--frames") ?? 40);
  if (!Number.isFinite(frames) || frames < 5) throw new Error("--frames must be at least 5");
  return { frames, jsonPath: read("--json") };
}

/** Just enough design system for resolveGlassCss; the tint here is literal. */
const DESIGN_SYSTEM = { colors: {} } as unknown as CreativeDesignSystem;

/**
 * A frame worth blurring, as a bitmap rather than as CSS.
 *
 * The first version of this used layered CSS gradients including a 2px
 * repeating pattern, and the result was nonsense: every case landed near
 * 1300ms and glass measured *faster* than flat, more so the more panels there
 * were. The pattern was the whole cost. Software rasterising a 2px repeat over
 * a scaled full-bleed layer every frame dwarfed everything else, panels hid
 * some of it, and a blur effectively downsamples it - so adding glass removed
 * more work than it added. The harness was measuring its own backdrop.
 *
 * A real film's backdrop is a photograph, a generated image or a video frame:
 * a bitmap, cheap to blit and expensive to blur. So this generates one -
 * smoothed RGB noise, which carries a photograph's frequency content without
 * shipping a photograph - and the scene blits it like the renderer would.
 */
async function backdropDataUri(): Promise<string> {
  const w = 960;
  const h = 540;
  const pixels = Buffer.alloc(w * h * 3);
  // Seeded, so two runs of the benchmark measure the same picture.
  let seed = 0x2f6e2b1;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    pixels[index] = seed >>> 24;
  }
  const png = await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
    // Smoothed so it has the low- and mid-frequency structure of a photograph
    // rather than the pure high-frequency of raw noise, which no camera makes.
    .blur(3)
    .modulate({ saturation: 1.3 })
    .resize(WIDTH, HEIGHT)
    .png({ compressionLevel: 6 })
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function panelHtml(index: number, variant: Exclude<Variant, "none">, blurPx: number): string {
  // Resolved at the glass blur even for the flat control, because the control
  // has to be the same panel minus the backdrop filter - same tint strength,
  // same hairline, same radius, same shadow. Resolving it twice with different
  // inputs would measure the panel as well as the filter.
  const glass = resolveGlassCss(DESIGN_SYSTEM, {
    blurPx: Math.max(blurPx, 1),
    tint: { kind: "literal", value: "#ffffff" },
    radius: 24,
  });
  if (!glass) throw new Error("resolveGlassCss returned nothing for a visible glass block");

  // flat keeps the panel's own paint - tint, border, radius, shadow - and
  // drops only the backdrop filter, so the delta isolates that one property.
  const surface = variant === "glass"
    ? `backdrop-filter: ${glass.backdropFilter};
       -webkit-backdrop-filter: ${glass.backdropFilter};
       background: ${glass.background};`
    : `background: ${glass.background};`;

  return `
    <div class="panel" data-panel="${index}" style="
      ${surface}
      border: ${glass.border ?? "none"};
      border-radius: ${glass.borderRadius ?? "24px"};
      box-shadow: ${glass.boxShadow ?? "none"};
    ">
      <div class="panel-label">Adoption / cohort ${index + 1}</div>
      <div class="panel-value">${(38 + index * 7) % 100}%</div>
      <div class="panel-foot">measured over 90 days</div>
    </div>
  `;
}

function sceneHtml(variant: Variant, panels: number, blurPx: number, backdrop: string): string {
  const bodies = variant === "none"
    ? ""
    : Array.from({ length: panels }, (_, index) => panelHtml(index, variant, blurPx)).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  #backdrop {
    position: absolute; inset: -8%;
    background-image: url("${backdrop}");
    background-size: cover;
    will-change: transform;
  }
  #stage { position: absolute; inset: 0; }
  .panel {
    position: absolute;
    width: 520px; height: 300px;
    padding: 34px 38px;
    color: #fff;
    font: 400 20px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
    will-change: transform;
  }
  .panel-label { opacity: 0.66; font-size: 20px; letter-spacing: 0.4px; }
  .panel-value { margin-top: 14px; font-size: 92px; font-weight: 700; letter-spacing: -2px; }
  .panel-foot { margin-top: 12px; opacity: 0.5; font-size: 17px; }
</style></head>
<body>
  <div id="backdrop"></div>
  <div id="stage">${bodies}</div>
  <script>
    const panels = Array.from(document.querySelectorAll('.panel'));
    const backdrop = document.getElementById('backdrop');
    // Both the backdrop and the panels move every frame. A still scene lets
    // Chromium reuse the rasterised backdrop between captures, which is not
    // what a film does and would make glass look nearly free.
    window.seek = (frame) => {
      const t = frame / 30;
      backdrop.style.transform =
        'translate(' + Math.sin(t * 0.9) * 44 + 'px,' + Math.cos(t * 0.7) * 38 + 'px)';
      panels.forEach((panel, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        const x = 140 + column * 560 + Math.sin(t * 1.3 + index) * 26;
        const y = 90 + row * 250 + Math.cos(t * 1.1 + index) * 20;
        panel.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      });
    };
    window.seek(0);
  </script>
</body></html>`;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};

async function measure(
  browser: Browser,
  variant: Variant,
  panels: number,
  blurPx: number,
  frames: number,
  backdrop: string,
): Promise<Measurement> {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.setContent(sceneHtml(variant, panels, blurPx, backdrop), { waitUntil: "load" });

  // Warm-up captures, discarded: the first frames pay for shader compilation
  // and font rasterisation, which a film pays once and not per frame.
  for (let frame = 0; frame < 5; frame += 1) {
    await page.evaluate((f) => (window as unknown as { seek: (n: number) => void }).seek(f), frame);
    await page.screenshot({ type: "jpeg", quality: 55 });
  }

  const samples: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate((f) => (window as unknown as { seek: (n: number) => void }).seek(f), frame + 5);
    const started = performance.now();
    await page.screenshot({ type: "jpeg", quality: 55 });
    samples.push(performance.now() - started);
  }
  await page.close();

  const medianMs = median(samples);
  return {
    variant,
    panels,
    blurPx,
    medianMs: Number(medianMs.toFixed(2)),
    p90Ms: Number(percentile(samples, 0.9).toFixed(2)),
    fps: Number((1000 / medianMs).toFixed(2)),
  };
}

async function main(): Promise<void> {
  const { frames, jsonPath } = parseArgs();
  const browser = await launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  });

  const backdrop = await backdropDataUri();
  const results: Measurement[] = [];
  try {
    results.push(await measure(browser, "none", 0, 0, frames, backdrop));
    for (const panels of PANEL_COUNTS) {
      results.push(await measure(browser, "flat", panels, BLUR_RADII[1], frames, backdrop));
      for (const blurPx of BLUR_RADII) {
        results.push(await measure(browser, "glass", panels, blurPx, frames, backdrop));
      }
    }
  } finally {
    await browser.close();
  }

  const floor = results.find((entry) => entry.variant === "none")!;
  console.log(`\nFrame cost at ${WIDTH}x${HEIGHT}, ${frames} measured frames per case, median ms.\n`);
  console.log(`backdrop only (no panels): ${floor.medianMs} ms  (${floor.fps} fps)\n`);
  console.log("panels  variant        blur   median   p90     fps    vs flat");
  console.log("-".repeat(64));
  for (const panels of PANEL_COUNTS) {
    const flat = results.find((entry) => entry.variant === "flat" && entry.panels === panels)!;
    console.log(
      `${String(panels).padStart(6)}  flat           ${"-".padStart(4)}  ${String(flat.medianMs).padStart(7)}  ${String(flat.p90Ms).padStart(6)}  ${String(flat.fps).padStart(5)}       -`,
    );
    for (const blurPx of BLUR_RADII) {
      const glass = results.find(
        (entry) => entry.variant === "glass" && entry.panels === panels && entry.blurPx === blurPx,
      )!;
      const multiple = (glass.medianMs / flat.medianMs).toFixed(2);
      console.log(
        `${String(panels).padStart(6)}  glass          ${String(blurPx).padStart(4)}  ${String(glass.medianMs).padStart(7)}  ${String(glass.p90Ms).padStart(6)}  ${String(glass.fps).padStart(5)}   ${multiple}x`,
      );
    }
  }

  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify({ width: WIDTH, height: HEIGHT, frames, results }, null, 2)}\n`);
    console.log(`\nWrote ${jsonPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
