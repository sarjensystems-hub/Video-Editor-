/**
 * How a browser upload is cut into parts. B2, like S3, needs every part but
 * the last to be at least 5 MB and allows at most 10,000 parts; 16 MB parts
 * keep the part count low for ordinary video, and the size grows with the
 * file so that anything up to B2's 10 TB object limit still fits.
 */

const MIN_PART_BYTES = 16 * 1024 * 1024;
const MAX_PARTS = 9_000;

export function planUploadParts(sizeBytes: number): { partSize: number; partCount: number } {
  const size = Math.max(1, Math.floor(sizeBytes));
  const partSize = Math.max(MIN_PART_BYTES, Math.ceil(size / MAX_PARTS));
  return { partSize, partCount: Math.max(1, Math.ceil(size / partSize)) };
}
