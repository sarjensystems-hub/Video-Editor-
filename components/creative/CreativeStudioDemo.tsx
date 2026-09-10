"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import type { CreativeDocument } from "@/lib/creative/schema";
import CreativeScenePreview from "./CreativeScenePreview";

export default function CreativeStudioDemo({ document }: { document: CreativeDocument }) {
  const scene = document.scenes[0];
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const startedAt = useRef<number | null>(null);
  const startedFrom = useRef(0);
  const durationMs = scene.durationMs;

  useEffect(() => {
    if (!playing) {
      startedAt.current = null;
      return;
    }

    let frame = 0;
    const tick = (now: number) => {
      if (startedAt.current == null) startedAt.current = now;
      const next = startedFrom.current + (now - startedAt.current);
      if (next >= durationMs) {
        setTimeMs(durationMs - 1);
        setPlaying(false);
        startedAt.current = null;
        return;
      }
      setTimeMs(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, durationMs]);

  const timestamp = useMemo(() => `${(timeMs / 1000).toFixed(2)}s / ${(durationMs / 1000).toFixed(2)}s`, [timeMs, durationMs]);

  const toggle = () => {
    if (!playing) {
      if (timeMs >= durationMs - 1) setTimeMs(0);
      startedFrom.current = timeMs >= durationMs - 1 ? 0 : timeMs;
      startedAt.current = null;
    }
    setPlaying((value) => !value);
  };

  return (
    <section className="grid gap-4">
      <div className="rounded-2xl border border-edge bg-stage-frame p-3 shadow-md sm:p-4">
        <div
          className="relative w-full overflow-hidden rounded-xl bg-stage"
          style={{ aspectRatio: `${document.canvas.width}/${document.canvas.height}` }}
        >
          <CreativeScenePreview document={document} sceneId={scene.id} timeMs={timeMs} assets={{}} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-edge bg-panel px-3 py-2.5">
        <IconButton label={playing ? "Pause" : "Play"} size="sm" variant="ghost" onClick={toggle}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </IconButton>
        <IconButton
          label="Restart"
          size="sm"
          variant="ghost"
          onClick={() => {
            setPlaying(false);
            startedFrom.current = 0;
            setTimeMs(0);
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </IconButton>

        <input
          type="range"
          aria-label="Preview time"
          min={0}
          max={Math.max(1, durationMs - 1)}
          value={Math.min(Math.round(timeMs), durationMs - 1)}
          onChange={(event) => {
            setPlaying(false);
            startedFrom.current = Number(event.currentTarget.value);
            setTimeMs(Number(event.currentTarget.value));
          }}
          className="scrubber min-w-[8rem] flex-1"
        />

        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink-muted">{timestamp}</span>
      </div>
    </section>
  );
}
