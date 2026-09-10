"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tailwind's `lg` breakpoint. Kept as one constant because the editor's layout
 * switch has to agree with the CSS that hides and shows the same regions — two
 * numbers that drift apart give you a sheet and a sidebar open at once.
 */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Subscribes to a media query.
 *
 * The server snapshot is always `false`, so the first paint is the narrow
 * layout and wide viewports correct themselves on hydration. That direction is
 * deliberate: the parts that matter on a phone — canvas, toolbar, timeline —
 * render identically either way, and the only thing a correction moves is where
 * the side panels live, which on a phone start closed inside a sheet anyway.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
