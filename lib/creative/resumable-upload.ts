/**
 * Browser uploads into Supabase Storage over TUS, the resumable protocol.
 *
 * A plain upload is one request: no progress until it ends, and a dropped
 * connection at 90% of a 2 GB video starts over. TUS sends 6 MB chunks, so
 * progress is real, a failed chunk is retried on its own, and an interrupted
 * upload resumes where it stopped. Nothing here caps the size; the only limit
 * left is the per-file maximum set in the Supabase project.
 *
 * Authorisation is the signed upload token the server issued for one exact
 * path inside the user's own folder (`x-signature`), so the browser can only
 * write where the server said it may.
 */

import { Upload } from "tus-js-client";

/** Supabase requires exactly this chunk size for resumable uploads. */
const CHUNK_BYTES = 6 * 1024 * 1024;

/**
 * The direct storage host Supabase recommends for large uploads
 * (`<ref>.storage.supabase.co`), or the project URL itself on a custom domain.
 */
export function resumableEndpoint(projectUrl: string): string {
  const url = new URL(projectUrl);
  const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
  const host = match ? `${match[1]}.storage.supabase.co` : url.host;
  return `${url.protocol}//${host}/storage/v1/upload/resumable`;
}

export function uploadResumable(input: {
  file: File;
  bucket: string;
  path: string;
  token: string;
  onProgress: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return new Promise((resolve, reject) => {
    const upload = new Upload(input.file, {
      endpoint: resumableEndpoint(projectUrl),
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      chunkSize: CHUNK_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { apikey: apiKey, "x-signature": input.token },
      metadata: {
        bucketName: input.bucket,
        objectName: input.path,
        contentType: input.file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onProgress: (sent, total) => input.onProgress(sent, total),
      onSuccess: () => resolve(),
      onError: (error) => reject(error),
    });
    input.signal?.addEventListener("abort", () => {
      void upload.abort(true);
      reject(new DOMException("Upload cancelled", "AbortError"));
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });
}
