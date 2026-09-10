"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Video, Upload, X, Loader2, Play, Download, RectangleHorizontal,
  RectangleVertical, AlertCircle, CheckCircle2, Clock, Sparkles, Volume2, VolumeX,
} from "lucide-react";
import {
  VIDEO_ASPECT_RATIOS, VIDEO_RESOLUTIONS, VIDEO_MIN_DURATION, VIDEO_MAX_DURATION,
  MAX_VIDEO_CHARACTERS,
  type VideoAspectRatio, type VideoResolution, type VideoGenerationRow,
} from "@/lib/video-gen";
import { videoGenerationCost } from "@/lib/credit-costs";

type CharacterSlot = {
  id:          string;
  name:        string;
  previewUrl:  string;
  url:         string | null;
  uploading:   boolean;
  error:       string | null;
};

const POLL_INTERVAL_MS = 4000;
const ACTIVE_STATES = new Set(["pending", "in_progress"]);

function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Character";
}

export default function VideosWorkspace({ initialJobs }: { initialJobs: VideoGenerationRow[] }) {
  const [characters, setCharacters] = useState<CharacterSlot[]>([]);
  const [prompt, setPrompt]         = useState("");
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>("16:9");
  const [resolution, setResolution]   = useState<VideoResolution>("720p");
  const [duration, setDuration]       = useState(5);
  const [generateAudio, setGenerateAudio] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeJob, setActiveJob]   = useState<VideoGenerationRow | null>(null);
  const [jobs, setJobs]             = useState<VideoGenerationRow[]>(initialJobs);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollErrors    = useRef(0);

  const estimatedCost = videoGenerationCost(duration, resolution);
  const slotsLeft = MAX_VIDEO_CHARACTERS - characters.length;

  /* ── Character uploads ── */
  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const toAdd = Array.from(files).slice(0, slotsLeft);

    for (const file of toAdd) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);
      setCharacters((prev) => [
        ...prev,
        { id, name: nameFromFilename(file.name), previewUrl, url: null, uploading: true, error: null },
      ]);
      uploadCharacter(id, file);
    }
  }

  async function uploadCharacter(id: string, file: File) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/videos/upload-character", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, url: data.url, uploading: false } : c)));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, uploading: false, error: message } : c)));
    }
  }

  function removeCharacter(id: string) {
    setCharacters((prev) => {
      const target = prev.find((c) => c.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((c) => c.id !== id);
    });
  }

  function renameCharacter(id: string, name: string) {
    setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  /* ── Polling ── */
  const pollJob = useCallback((id: string) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/videos/status/${id}`);
        const data = await res.json();
        if (!res.ok || !data.job) throw new Error(data.error ?? "Failed to check status");
        pollErrors.current = 0;
        const job = data.job as VideoGenerationRow;
        setActiveJob((prev) => (prev?.id === id ? job : prev));
        setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
        if (ACTIVE_STATES.has(job.status)) {
          pollJob(id);
        }
      } catch (e) {
        // Transient failures (network blip, upstream hiccup) shouldn't kill
        // tracking of a job that may still finish fine — keep retrying up
        // to a small cap before giving up and surfacing the error.
        pollErrors.current += 1;
        if (pollErrors.current <= 5) {
          pollJob(id);
        } else {
          setSubmitError(e instanceof Error ? e.message : "Failed to check generation status");
        }
      }
    }, POLL_INTERVAL_MS);
  }, []);

  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  /* ── Submit ── */
  async function handleGenerate() {
    if (!prompt.trim() || submitting) return;
    if (characters.some((c) => c.uploading)) {
      setSubmitError("Wait for character uploads to finish first.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          aspectRatio,
          resolution,
          duration,
          generateAudio,
          characters: characters
            .filter((c) => c.url)
            .map((c) => ({ name: c.name, url: c.url })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start generation");
      const job = data.job as VideoGenerationRow;
      setActiveJob(job);
      setJobs((prev) => [job, ...prev]);
      pollJob(job.id);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to start generation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-xl sm:text-[26px] font-semibold tracking-tight text-gray-900 dark:text-white flex items-center gap-2.5">
            <Video className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500 shrink-0" />
            Videos
          </h1>
          <p className="text-sm text-gray-500 dark:text-white/40 mt-1">
            Generate video with ByteDance Seedance 2.0 Fast — upload characters, write your prompt, pick a shape.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
        {/* ── LEFT: form ── */}
        <div className="space-y-6">
          {/* Characters */}
          <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Characters</h3>
              <span className="text-xs text-gray-400">{characters.length}/{MAX_VIDEO_CHARACTERS}</span>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Upload up to {MAX_VIDEO_CHARACTERS} reference images, raw — nothing is compressed or resized. Name each one exactly
              (e.g. &ldquo;Alice&rdquo;) — we automatically tell the model which reference is which before your prompt runs, so
              just refer to those same names naturally in your prompt below (e.g. &ldquo;Alice hands Bob a coffee&rdquo;). Reused
              a name on two images? That&apos;s fine — it means multiple reference angles of the same character.
            </p>

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {characters.map((c, i) => (
                <div key={c.id} className="relative group">
                  <div className="aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 relative">
                    <img src={c.previewUrl} alt={c.name} className="w-full h-full object-cover" />
                    <span className="absolute top-1 left-1 text-[10px] font-bold bg-black/60 text-white rounded px-1.5 py-0.5">
                      {i + 1}
                    </span>
                    {c.uploading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      </div>
                    )}
                    {c.error && (
                      <div className="absolute inset-0 flex items-center justify-center bg-red-900/60 p-1">
                        <span className="text-[9px] text-white text-center leading-tight">{c.error}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeCharacter(c.id)}
                      aria-label={`Remove ${c.name}`}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={c.name}
                    onChange={(e) => renameCharacter(c.id, e.target.value)}
                    placeholder="Name"
                    className="mt-1 w-full text-[11px] border border-gray-200 dark:border-white/10 rounded-md px-1.5 py-1 bg-white dark:bg-white/5 text-gray-800 dark:text-white outline-none focus:border-orange-400 dark:focus:border-orange-500/50 transition-colors"
                  />
                </div>
              ))}

              {slotsLeft > 0 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-lg border border-dashed border-gray-300 dark:border-white/15 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-orange-400 hover:text-orange-500 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  <span className="text-[10px] font-medium">Add</span>
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => { handleFilesSelected(e.target.files); e.target.value = ""; }}
            />
          </div>

          {/* Prompt */}
          <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Prompt</h3>
            <p className="text-xs text-gray-400 mb-3">
              Sent to the model exactly as you write it — nothing is added, rewritten, or cleaned up.
            </p>
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the video you want. Mention your characters by name if you uploaded any."
              className="w-full border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-white/5 placeholder:text-gray-300 dark:placeholder:text-white/20 outline-none focus:border-orange-400 dark:focus:border-orange-500/50 transition-colors resize-none"
            />
          </div>

          {/* Settings */}
          <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4 sm:p-5 space-y-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Settings</h3>

            {/* Aspect ratio */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-wider mb-2">Aspect ratio</p>
              <div className="flex gap-2">
                {VIDEO_ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setAspectRatio(ratio)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      aspectRatio === ratio
                        ? "bg-orange-50 dark:bg-orange-500/15 border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-400"
                        : "border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/40 hover:border-gray-300"
                    }`}
                  >
                    {ratio === "16:9" ? <RectangleHorizontal className="w-4 h-4" /> : <RectangleVertical className="w-4 h-4" />}
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-wider mb-2">Resolution</p>
              <div className="flex gap-2">
                {VIDEO_RESOLUTIONS.map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setResolution(res)}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      resolution === res
                        ? "bg-orange-50 dark:bg-orange-500/15 border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-400"
                        : "border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/40 hover:border-gray-300"
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-wider">Duration</p>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{duration}s</span>
              </div>
              <input
                type="range"
                min={VIDEO_MIN_DURATION}
                max={VIDEO_MAX_DURATION}
                step={1}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full accent-orange-500"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>{VIDEO_MIN_DURATION}s</span>
                <span>{VIDEO_MAX_DURATION}s</span>
              </div>
            </div>

            {/* Audio */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-wider mb-2">Audio</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setGenerateAudio(true)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    generateAudio
                      ? "bg-orange-50 dark:bg-orange-500/15 border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-400"
                      : "border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/40 hover:border-gray-300"
                  }`}
                >
                  <Volume2 className="w-4 h-4" />
                  On
                </button>
                <button
                  type="button"
                  onClick={() => setGenerateAudio(false)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    !generateAudio
                      ? "bg-orange-50 dark:bg-orange-500/15 border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-400"
                      : "border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/40 hover:border-gray-300"
                  }`}
                >
                  <VolumeX className="w-4 h-4" />
                  Off
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Dialogue, lip-sync and music. Not confirmed that Seedance 2.0 Fast always produces audio — verify on your first
                generation.
              </p>
            </div>
          </div>

          {submitError && (
            <p className="flex items-start gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {submitError}
            </p>
          )}

          <button
            onClick={handleGenerate}
            disabled={submitting || !prompt.trim() || characters.some((c) => c.uploading)}
            className="btn w-full lg:w-auto"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {submitting ? "Starting…" : `Generate Video · ~${estimatedCost} credits`}
          </button>
        </div>

        {/* ── RIGHT: preview + history ── */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Preview</h3>
            {activeJob ? <JobPreview job={activeJob} /> : (
              <div className="aspect-video rounded-lg border border-dashed border-gray-300 dark:border-white/15 flex items-center justify-center text-gray-300 dark:text-white/20">
                <Play className="w-8 h-8" />
              </div>
            )}
          </div>

          {jobs.length > 0 && (
            <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Recent generations</h3>
              <div className="space-y-2 max-h-[480px] overflow-y-auto">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => setActiveJob(job)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      activeJob?.id === job.id
                        ? "border-orange-300 dark:border-orange-500/40 bg-orange-50 dark:bg-orange-500/10"
                        : "border-gray-100 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5"
                    }`}
                  >
                    <StatusIcon status={job.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 dark:text-white/90 truncate">{job.prompt}</p>
                      <p className="text-[10px] text-gray-400 flex items-center gap-1">
                        {job.aspect_ratio} · {job.resolution} · {job.duration_seconds}s ·{" "}
                        {job.generate_audio ? <Volume2 className="w-2.5 h-2.5" /> : <VolumeX className="w-2.5 h-2.5" />}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
  if (status === "failed" || status === "cancelled" || status === "expired") return <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />;
  return <Clock className="w-4 h-4 text-orange-400 shrink-0 animate-pulse" />;
}

function JobPreview({ job }: { job: VideoGenerationRow }) {
  if (job.status === "completed" && job.video_url) {
    return (
      <div className="space-y-3">
        <video
          controls
          loop
          playsInline
          src={job.video_url}
          className={`w-full rounded-lg bg-black ${job.aspect_ratio === "9:16" ? "max-h-[520px] mx-auto" : ""}`}
        />
        <a
          href={job.video_url}
          download
          target="_blank"
          rel="noreferrer"
          className="btn-ghost w-full justify-center"
        >
          <Download className="w-4 h-4" />
          Download original file
        </a>
      </div>
    );
  }

  if (job.status === "failed" || job.status === "cancelled" || job.status === "expired") {
    return (
      <div className="aspect-video rounded-lg border border-red-100 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 flex flex-col items-center justify-center gap-2 text-center px-4">
        <AlertCircle className="w-6 h-6 text-red-500" />
        <p className="text-xs text-red-600 dark:text-red-400">{job.error ?? "Generation failed. Credits were refunded."}</p>
      </div>
    );
  }

  return (
    <div className="aspect-video rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 flex flex-col items-center justify-center gap-2">
      <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
      <p className="text-xs text-gray-400">
        {job.status === "pending" ? "Queued…" : "Generating…"}
      </p>
    </div>
  );
}
