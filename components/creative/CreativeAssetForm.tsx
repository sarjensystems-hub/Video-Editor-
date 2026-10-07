"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Music, UploadCloud, Video } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextAreaField } from "@/components/ui/Field";
import Sheet from "@/components/ui/Sheet";
import { cn } from "@/components/ui/cn";
import { updateCreativeAssetTags } from "@/app/actions/creative-studio";
import {
  CREATIVE_ASSET_CLASSES,
  assetClassesForKind,
  defaultAssetClass,
  type CreativeAssetClass,
} from "@/lib/creative/asset-class";
import { uploadKindFor } from "@/lib/creative/asset-upload";
import { toEditorAsset, type EditorAsset } from "@/lib/creative/editor-asset";
import { uploadResumable } from "@/lib/creative/resumable-upload";

/** What the browser can tell about a file before it is uploaded. */
interface MediaProbe {
  width?: number;
  height?: number;
  durationMs?: number;
}

/**
 * Reads dimensions and duration from the file itself. The assistant places a
 * voiceover by its length and frames footage by its shape, so these travel
 * with the asset rather than being guessed later. A file the browser cannot
 * decode simply reports nothing.
 */
function probeMedia(file: File, kind: string): Promise<MediaProbe> {
  const url = URL.createObjectURL(file);
  const done = (probe: MediaProbe) => {
    URL.revokeObjectURL(url);
    return probe;
  };
  return new Promise<MediaProbe>((resolve) => {
    const timeout = window.setTimeout(() => resolve(done({})), 8000);
    const finish = (probe: MediaProbe) => {
      window.clearTimeout(timeout);
      resolve(done(probe));
    };
    if (kind === "image") {
      const image = new Image();
      image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => finish({});
      image.src = url;
      return;
    }
    if (kind === "video" || kind === "audio") {
      const media = document.createElement(kind);
      media.preload = "metadata";
      media.onloadedmetadata = () => {
        const seconds = Number.isFinite(media.duration) ? media.duration : 0;
        const video = media as HTMLVideoElement;
        finish({
          durationMs: seconds > 0 ? Math.round(seconds * 1000) : undefined,
          width: kind === "video" ? video.videoWidth || undefined : undefined,
          height: kind === "video" ? video.videoHeight || undefined : undefined,
        });
      };
      media.onerror = () => finish({});
      media.src = url;
      return;
    }
    finish({});
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 100) / 10;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** Speed and time left, once enough has moved to estimate them. */
function uploadEta(progress: { sent: number; total: number; startedAt: number }): string {
  const seconds = (Date.now() - progress.startedAt) / 1000;
  if (progress.sent <= 0 || seconds < 1) return "Starting…";
  const rate = progress.sent / seconds;
  const left = Math.max(0, (progress.total - progress.sent) / rate);
  const speed = `${formatBytes(rate)}/s`;
  if (progress.sent >= progress.total) return "Finishing…";
  return left < 60 ? `${speed} · ${Math.ceil(left)}s left` : `${speed} · ${Math.ceil(left / 60)} min left`;
}

/** Storage errors are written for developers; this is what the person needs to know. */
function uploadErrorMessage(message: string): string {
  if (/maximum allowed size|too large|payload|\b413\b/i.test(message)) {
    return "This file is bigger than the storage's per-file limit. Raise it in Supabase under Storage → Settings, or upload a compressed version.";
  }
  return message;
}

/**
 * Upload a file into the project under a class, or re-file an existing asset.
 * Pass `asset` to edit one; otherwise the sheet uploads a new file, starting
 * on `initialClass` when the person came from a specific class.
 */
export default function CreativeAssetForm({
  open,
  onClose,
  projectId,
  asset,
  initialClass,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  asset?: EditorAsset | null;
  initialClass?: CreativeAssetClass | null;
  onSaved: (asset: EditorAsset) => void;
}) {
  const editing = Boolean(asset);
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<MediaProbe>({});
  const [assetClass, setAssetClass] = useState<string>("");
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [progress, setProgress] = useState<{ sent: number; total: number; startedAt: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setProbe({});
    setError(null);
    setPhase("idle");
    setAssetClass(asset?.assetClass ?? initialClass ?? "");
    setDescription(asset?.description ?? "");
  }, [open, asset, initialClass]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const kind = asset?.kind ?? (file ? uploadKindFor(file.type || "") : initialClass ? CREATIVE_ASSET_CLASSES[initialClass].kind : null);
  const classes = useMemo(() => (kind ? assetClassesForKind(kind) : []), [kind]);
  const accept = initialClass && !editing
    ? `${CREATIVE_ASSET_CLASSES[initialClass].kind}/*`
    : "image/*,video/*,audio/*";

  const pick = async (next: File | null) => {
    setError(null);
    setFile(next);
    setProbe({});
    if (!next) return;
    const nextKind = uploadKindFor(next.type || "");
    if (nextKind !== "image" && nextKind !== "video" && nextKind !== "audio") {
      setError("Choose an image, video or audio file.");
      setFile(null);
      return;
    }
    // Keep the class the person came in with when it still fits the file.
    setAssetClass((current) =>
      current && CREATIVE_ASSET_CLASSES[current as CreativeAssetClass]?.kind === nextKind ? current : defaultAssetClass(nextKind),
    );
    setProbe(await probeMedia(next, nextKind));
  };

  const save = async () => {
    setError(null);
    try {
      if (asset) {
        setPhase("saving");
        const result = await updateCreativeAssetTags(asset.id, { assetClass, description });
        if (!result.ok) throw new Error(result.error);
        onSaved({ ...asset, assetClass: result.data.assetClass, description: result.data.description });
        onClose();
        return;
      }
      if (!file) return;
      setPhase("uploading");
      const ticket = await fetch("/api/creative/assets/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, filename: file.name }),
      });
      const issued = await ticket.json();
      if (!ticket.ok) throw new Error(issued.error ?? "Could not start the upload");

      // The file goes straight from the browser into the user's own folder,
      // in resumable chunks, so progress is real and any size gets through.
      const controller = new AbortController();
      abort.current = controller;
      const startedAt = Date.now();
      setProgress({ sent: 0, total: file.size, startedAt });
      try {
        await uploadResumable({
          file,
          bucket: issued.bucket,
          path: issued.path,
          token: issued.token,
          signal: controller.signal,
          onProgress: (sent, total) => setProgress({ sent, total, startedAt }),
        });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") throw new Error("Upload cancelled.");
        throw new Error(uploadErrorMessage(cause instanceof Error ? cause.message : String(cause)));
      } finally {
        abort.current = null;
      }

      setPhase("saving");
      const response = await fetch("/api/creative/assets/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          path: issued.path,
          filename: file.name,
          contentType: file.type,
          size: file.size,
          assetClass,
          description,
          ...probe,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save the asset");
      onSaved(toEditorAsset(payload.asset));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  };

  const cancel = () => {
    if (abort.current) abort.current.abort();
    else onClose();
  };

  const working = phase !== "idle";
  const ready = editing ? Boolean(assetClass) : Boolean(file && assetClass);

  return (
    <Sheet
      open={open}
      onClose={working ? () => undefined : onClose}
      title={editing ? "Asset details" : "Upload to this project"}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={cancel} disabled={phase === "saving"}>
            {phase === "uploading" ? "Stop upload" : "Cancel"}
          </Button>
          <Button size="sm" onClick={save} disabled={!ready || working}>
            {working && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {phase === "uploading" ? `Uploading ${progress && progress.total ? Math.floor((progress.sent / progress.total) * 100) : 0}%` : phase === "saving" ? "Saving…" : editing ? "Save" : "Upload"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        {!editing && (
          <label
            className={cn(
              "grid cursor-pointer place-items-center gap-2 rounded-xl border border-dashed border-edge p-5 text-center",
              "bg-canvas-subtle transition-colors hover:border-fire/50",
              working && "pointer-events-none opacity-60",
            )}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void pick(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            {preview && file?.type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="max-h-40 rounded-lg object-contain" />
            ) : preview && file?.type.startsWith("video/") ? (
              <video src={preview} className="max-h-40 rounded-lg" muted playsInline controls />
            ) : preview && file?.type.startsWith("audio/") ? (
              <audio src={preview} controls className="w-full" />
            ) : (
              <UploadCloud className="h-6 w-6 text-ink-faint" />
            )}
            <span className="text-xs font-semibold text-ink">
              {file ? file.name : "Choose a file or drop it here"}
            </span>
            <span className="text-[11px] text-ink-faint">
              {file
                ? [formatBytes(file.size), probe.width && probe.height ? `${probe.width}×${probe.height}` : null, probe.durationMs ? formatDuration(probe.durationMs) : null]
                    .filter(Boolean)
                    .join(" · ")
                : "Video, narration, music, sound effects or images"}
            </span>
            <input
              type="file"
              accept={accept}
              hidden
              onChange={(event) => {
                void pick(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
          </label>
        )}

        {editing && asset && (
          <div className="flex items-center gap-3 rounded-xl border border-edge bg-canvas-subtle p-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-stage">
              {asset.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.url} alt="" className="h-full w-full object-cover" />
              ) : asset.kind === "video" ? (
                <Video className="h-5 w-5 text-white/60" />
              ) : (
                <Music className="h-5 w-5 text-white/60" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-ink">{asset.filename || asset.kind}</span>
              <span className="block text-[11px] text-ink-faint">
                {asset.kind}
                {asset.durationMs ? ` · ${formatDuration(asset.durationMs)}` : ""}
              </span>
            </span>
          </div>
        )}

        {classes.length > 0 && (
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              What is it?
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {classes.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAssetClass(id)}
                  aria-pressed={assetClass === id}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40",
                    assetClass === id ? "border-fire/60 bg-fire-wash" : "border-edge hover:bg-canvas-subtle",
                  )}
                >
                  <span className="block text-xs font-semibold text-ink">{CREATIVE_ASSET_CLASSES[id].label}</span>
                  <span className="block text-[10px] leading-snug text-ink-faint">{CREATIVE_ASSET_CLASSES[id].hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <TextAreaField
          label="Notes for your assistant (optional)"
          rows={3}
          maxLength={1000}
          placeholder={
            assetClass === "narration"
              ? "e.g. Intro voiceover, read by Priya. Goes over the first two scenes."
              : assetClass === "music"
                ? "e.g. Upbeat bed, the drop lands at 0:12."
                : "e.g. Our new bottle, front view. Use it in the hero scene."
          }
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        {progress && (
          <div className="grid gap-1.5" role="status" aria-live="polite">
            <div
              className="h-2 overflow-hidden rounded-full bg-canvas-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.total ? Math.floor((progress.sent / progress.total) * 100) : 0}
            >
              <div
                className="h-full rounded-full bg-fire transition-[width] duration-300"
                style={{ width: `${progress.total ? (progress.sent / progress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] tabular-nums text-ink-faint">
              <span>
                {formatBytes(progress.sent)} of {formatBytes(progress.total)}
              </span>
              <span>{uploadEta(progress)}</span>
            </div>
          </div>
        )}

        {error && <p className="rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
