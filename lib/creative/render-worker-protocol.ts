/**
 * The HTTP contract between the app and the self-hosted render worker
 * (render-worker/server.ts). Both sides import these types, so a field renamed
 * on one side fails the type check on the other.
 *
 * The worker holds no storage credential and no database access. The app
 * hands it signed URLs to download media from and to PUT the finished MP4 or
 * preview copy to, exactly as it did for the Vercel Sandbox.
 *
 * Every request carries `Authorization: Bearer <CREATIVE_RENDER_WORKER_SECRET>`.
 *
 *   GET    /health          -> RenderWorkerHealth
 *   POST   /renders         RenderWorkerRenderRequest -> { id }
 *   GET    /renders/:id     -> RenderWorkerRenderStatus (404 once forgotten)
 *   DELETE /renders/:id     cancels a queued or running render
 *   POST   /stills          RenderWorkerStillsRequest -> RenderWorkerStillsResponse
 */

import type { CreativeRemotionAssetMap } from "./remotion";
import type { CreativeDocument } from "./schema";

/**
 * Prefix on a worker render's handle name (`sandboxId`), so a running render
 * is always polled and stopped by the backend that started it.
 */
export const RENDER_WORKER_HANDLE_PREFIX = "worker:";

/** One file the worker copies to local disk before rendering, so no frame re-reads storage. */
export interface RenderWorkerMediaJob {
  /** File name inside the job's local media folder. */
  file: string;
  /** Signed (or external) URL the worker downloads without credentials. */
  url: string;
  /** Every asset id this file serves. */
  assetIds: string[];
  /**
   * Set when the download is a large video's original and a small preview
   * copy should be made from it and PUT here (see lib/creative/sandbox-media.ts).
   */
  preview?: { assetId: string; putUrl: string };
}

export interface RenderWorkerInput {
  document: CreativeDocument;
  /** The asset map as stored. Assets the worker copies locally are rewritten by it. */
  assets: CreativeRemotionAssetMap;
  media: RenderWorkerMediaJob[];
}

export interface RenderWorkerRenderOptions {
  frameRange?: [number, number];
  scale: number;
  crf?: number;
  jpegQuality: number;
}

export interface RenderWorkerRenderRequest extends RenderWorkerInput {
  options: RenderWorkerRenderOptions;
  /** Signed URL the finished MP4 is PUT to. */
  putUrl: string;
  /** POSTed (empty body) once the render has finished or failed. */
  callbackUrl?: string;
}

export type RenderWorkerRenderState = "queued" | "rendering" | "completed" | "failed";

export interface RenderWorkerRenderStatus {
  id: string;
  status: RenderWorkerRenderState;
  /** 0..1 */
  progress: number;
  stage: string;
  error?: string;
  sizeBytes?: number;
  contentType?: string;
}

export interface RenderWorkerStillsRequest extends RenderWorkerInput {
  /** Exact frame numbers, in the order the caller wants them back. */
  frames: number[];
}

export interface RenderWorkerStillsResponse {
  /** Lossless PNG per requested frame, base64-encoded, in request order. */
  frames: Array<{ frame: number; png: string }>;
  /** Preview copies the worker made and stored while preparing media. */
  previewsStored: Array<{ assetId: string; sizeBytes: number }>;
}

export interface RenderWorkerHealth {
  ok: true;
  cpus: number;
  activeRenders: number;
  queuedRenders: number;
}
