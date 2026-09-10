import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { googleFontsUrlCandidates, requiredFonts } from "../lib/creative/fonts";
import type { CreativeDocument } from "../lib/creative/schema";

/**
 * How long to wait for webfonts before rendering without them.
 *
 * A missing typeface is a bad render; a hung render is a worse one. Every
 * frame of a render blocks on this, so the ceiling is deliberately short.
 */
const FONT_TIMEOUT_MS = 12_000;

async function fetchFirstAvailable(urls: string[], signal: AbortSignal): Promise<string | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal });
      if (response.ok) return await response.text();
    } catch {
      // Try the next candidate; an unreachable font service is not fatal.
    }
  }
  return null;
}

/**
 * Loads the document's webfonts before the first frame is captured.
 *
 * Remotion is told to wait via delayRender, so no frame is photographed while
 * the browser is still showing a fallback face — otherwise a render could
 * contain both, which is precisely the drift this engine exists to prevent.
 */
export function useCreativeFonts(document: CreativeDocument): void {
  const [handle] = useState(() => delayRender("Loading document fonts"));

  useEffect(() => {
    const controller = new AbortController();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      continueRender(handle);
    };

    // The render proceeds in the fallback face rather than hanging.
    const timer = setTimeout(() => {
      controller.abort();
      finish();
    }, FONT_TIMEOUT_MS);

    (async () => {
      try {
        const fonts = requiredFonts(document);
        if (fonts.length === 0) return;

        const sheets = await Promise.all(
          fonts.map((font) => fetchFirstAvailable(googleFontsUrlCandidates(font), controller.signal)),
        );

        const css = sheets.filter((sheet): sheet is string => Boolean(sheet)).join("\n");
        if (css) {
          const style = window.document.createElement("style");
          style.setAttribute("data-creative-fonts", "true");
          style.textContent = css;
          window.document.head.appendChild(style);
        }

        // Ask for each family and weight explicitly: document.fonts.ready alone
        // resolves without loading faces nothing has requested yet.
        await Promise.all(
          fonts.flatMap((font) =>
            font.weights.map((weight) =>
              window.document.fonts
                .load(`${weight} 100px "${font.family}"`)
                .catch(() => undefined),
            ),
          ),
        );
        await window.document.fonts.ready;
      } catch {
        // Fall through to finish(): the render continues with fallback faces.
      } finally {
        clearTimeout(timer);
        finish();
      }
    })();

    return () => {
      clearTimeout(timer);
      controller.abort();
      finish();
    };
  }, [document, handle]);
}
