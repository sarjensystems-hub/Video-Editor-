"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FileInput, Film, ImagePlus, Layers3, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import type { CreativeDocument } from "@/lib/creative/schema";
import type { EditorAsset } from "./CreativeLayersPanel";

type DecompositionOutput = {
  asset: {
    id: string;
    kind: string;
    url: string;
    filename?: string | null;
    mime_type?: string | null;
  };
  role: string;
  label: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
};

function toEditorAsset(asset: Record<string, unknown>): EditorAsset {
  return {
    id: String(asset.id),
    kind: String(asset.kind),
    url: String(asset.url),
    filename: asset.filename == null ? null : String(asset.filename),
    mimeType: asset.mime_type == null ? null : String(asset.mime_type),
  };
}

export default function CreativeAutomationPanel({
  projectId,
  document,
  assets,
  onDocumentReplace,
  onAssetsAppend,
  onInsertDecomposition,
  bare,
}: {
  projectId: string;
  document: CreativeDocument;
  assets: EditorAsset[];
  onDocumentReplace: (document: CreativeDocument) => void;
  onAssetsAppend: (assets: EditorAsset[]) => void;
  onInsertDecomposition: (asset: EditorAsset, box: DecompositionOutput["box"]) => void;
  bare?: boolean;
}) {
  const [directorIntent, setDirectorIntent] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoJob, setVideoJob] = useState<{ id: string; status: string } | null>(null);
  const imageAssets = useMemo(() => assets.filter((asset) => asset.kind === "image"), [assets]);
  const [sourceAssetId, setSourceAssetId] = useState("");
  const [candidates, setCandidates] = useState<DecompositionOutput[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const requestJson = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
    return payload;
  };

  const direct = async () => {
    if (!directorIntent.trim()) return;
    setBusy("director");
    setMessage(null);
    try {
      const payload = await requestJson("/api/creative/direct", { project_id: projectId, intent: directorIntent });
      onDocumentReplace(payload.document as CreativeDocument);
      setMessage(`Creative direction applied as revision ${payload.revision}.`);
      setDirectorIntent("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const generateImage = async () => {
    if (!imagePrompt.trim()) return;
    setBusy("image");
    setMessage(null);
    try {
      const ratio = document.canvas.width / document.canvas.height;
      const format = ratio > 1.12 ? "landscape" : ratio < 0.9 ? "portrait" : "square";
      const payload = await requestJson("/api/creative/generate-image", { project_id: projectId, prompt: imagePrompt, format, label: "creative-generated" });
      onAssetsAppend([toEditorAsset(payload.asset)]);
      setMessage("Generated image is in Assets. Add it explicitly when you want it on the canvas.");
      setImagePrompt("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const startVideo = async () => {
    if (!videoPrompt.trim()) return;
    setBusy("video");
    setMessage(null);
    try {
      const payload = await requestJson("/api/videos/generate", {
        prompt: videoPrompt,
        aspectRatio: document.canvas.height > document.canvas.width ? "9:16" : "16:9",
        resolution: "480p",
        duration: 10,
        characters: [],
        generateAudio: true,
      });
      setVideoJob({ id: String(payload.job.id), status: String(payload.job.status) });
      setMessage("Video generation started. Use Check video to advance it; completed output can then be added as an asset.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const checkVideo = async () => {
    if (!videoJob) return;
    setBusy("video-check");
    setMessage(null);
    try {
      const response = await fetch(`/api/videos/status/${encodeURIComponent(videoJob.id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Video status failed");
      const status = String(payload.job.status);
      setVideoJob({ id: videoJob.id, status });
      if (status === "completed" && payload.job.video_url) {
        const promoted = await requestJson("/api/creative/promote-video", { project_id: projectId, generation_id: videoJob.id, label: "creative-generated-video" });
        onAssetsAppend([toEditorAsset(promoted.asset)]);
        setMessage("Video completed and is now registered in Assets.");
      } else {
        setMessage(status === "failed" ? String(payload.job.error ?? "Video generation failed") : `Video status: ${status}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const decompose = async () => {
    if (!sourceAssetId) return;
    setBusy("decompose");
    setMessage(null);
    setCandidates([]);
    try {
      const payload = await requestJson("/api/creative/decompose", { project_id: projectId, asset_id: sourceAssetId });
      const next = (payload.candidates ?? []) as DecompositionOutput[];
      setCandidates(next);
      onAssetsAppend(next.map((candidate) => toEditorAsset(candidate.asset)));
      setMessage(next.length ? `Found ${next.length} reviewable semantic crop${next.length === 1 ? "" : "s"}.` : (payload.warning ?? "No confident regions found."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const importFile = async (file: File) => {
    setBusy("import");
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/creative/import", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Import failed");
      window.location.assign(`/dashboard/creative-studio/${encodeURIComponent(payload.project_id)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(null);
    }
  };

  return (
    <Panel
      // Inside a sheet the title is already on the sheet"s own header;
      // repeating it puts the same word on screen twice.
      title={bare ? undefined : "AI production"}
      bare={bare}
      actions={busy ? <Loader2 className="h-4 w-4 animate-spin text-ink-faint" /> : null}
    >
      <p className="mb-3 text-xs leading-relaxed text-ink-faint">
        Generators, structured import and best-effort flat-image decomposition.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AutomationCard icon={<Sparkles className="h-3.5 w-3.5" />} title="Creative director">
          <textarea
            value={directorIntent}
            onChange={(event) => setDirectorIntent(event.target.value)}
            placeholder="Make the opening calmer, move the headline higher, and use a softer fade."
            rows={3}
            className={AUTOMATION_INPUT}
          />
          <Button variant="primary" size="sm" block disabled={Boolean(busy) || !directorIntent.trim()} onClick={direct}>
            Apply direction
          </Button>
        </AutomationCard>

        <AutomationCard icon={<ImagePlus className="h-3.5 w-3.5" />} title="Generate image asset">
          <textarea
            value={imagePrompt}
            onChange={(event) => setImagePrompt(event.target.value)}
            placeholder="Premium automotive workshop, controlled inspection lighting, generous negative space."
            rows={3}
            className={AUTOMATION_INPUT}
          />
          <Button variant="primary" size="sm" block disabled={Boolean(busy) || !imagePrompt.trim()} onClick={generateImage}>
            Generate image
          </Button>
        </AutomationCard>

        <AutomationCard icon={<Film className="h-3.5 w-3.5" />} title="Generate video asset">
          <textarea
            value={videoPrompt}
            onChange={(event) => setVideoPrompt(event.target.value)}
            placeholder="Cinematic close-up of a premium car entering a professional workshop, no text or UI."
            rows={3}
            className={AUTOMATION_INPUT}
          />
          {!videoJob ? (
            <Button variant="primary" size="sm" block disabled={Boolean(busy) || !videoPrompt.trim()} onClick={startVideo}>
              Start 10s Seedance video
            </Button>
          ) : (
            <Button variant="primary" size="sm" block disabled={Boolean(busy)} onClick={checkVideo}>
              Check video · {videoJob.status}
            </Button>
          )}
        </AutomationCard>

        <AutomationCard icon={<FileInput className="h-3.5 w-3.5" />} title="Structured import">
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Import a CreativeDocument JSON or the supported SVG subset into a new revisioned project.
          </p>
          <label className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-lg bg-fire text-xs font-semibold text-white transition-colors hover:bg-fire-hover focus-within:ring-2 focus-within:ring-fire/40 sm:h-8">
            Import JSON / SVG
            <input
              type="file"
              hidden
              accept=".json,.svg,application/json,image/svg+xml"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </AutomationCard>

        <AutomationCard icon={<Layers3 className="h-3.5 w-3.5" />} title="Decompose flat image">
          <select
            value={sourceAssetId}
            onChange={(event) => setSourceAssetId(event.target.value)}
            className={AUTOMATION_INPUT}
          >
            <option value="">Select an image asset</option>
            {imageAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.filename || asset.id}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" block disabled={Boolean(busy) || !sourceAssetId} onClick={decompose}>
            Find editable regions
          </Button>
          {candidates.length > 0 && (
            <div className="grid gap-1.5">
              {candidates.map((candidate) => (
                <button
                  key={candidate.asset.id}
                  type="button"
                  onClick={() => onInsertDecomposition(toEditorAsset(candidate.asset), candidate.box)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-panel px-2.5 py-2 text-[11px] text-ink-muted transition-colors hover:border-fire/50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40"
                >
                  <span className="truncate">
                    {candidate.label} · {Math.round(candidate.confidence * 100)}%
                  </span>
                  <span className="shrink-0 font-semibold">Add crop</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Produces semantic crops for review, not guaranteed alpha-matted cutouts.
          </p>
        </AutomationCard>
      </div>

      {message && (
        <p className="mt-3 rounded-lg bg-canvas-subtle px-3 py-2 text-[11px] leading-relaxed text-ink-muted">{message}</p>
      )}
    </Panel>
  );
}

const AUTOMATION_INPUT =
  "w-full resize-y rounded-lg border border-field-edge bg-field px-2.5 py-2 " +
  "text-base sm:text-[11px] leading-relaxed text-ink " +
  "focus:outline-none focus:ring-2 focus:ring-fire/30 focus:border-fire/40";

function AutomationCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-2 rounded-xl border border-edge-faint bg-canvas-subtle p-3">
      <h3 className="flex items-center gap-1.5 text-[11px] font-bold text-ink">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}
