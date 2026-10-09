"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A video that fetches nothing until it scrolls near the viewport, and then
 * only enough to show its first frame. The whole file streams on play.
 * Muted by default, for a wall of clips; a finished film plays with sound.
 */
export default function LazyVideo({ src, muted = true }: { src: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  return (
    <video
      ref={ref}
      src={near ? `${src}#t=0.1` : undefined}
      preload={near ? "metadata" : "none"}
      controls={near}
      muted={muted}
      playsInline
      className="h-full w-full bg-black object-contain"
    />
  );
}
