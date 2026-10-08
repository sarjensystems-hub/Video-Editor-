/**
 * Sends a file from the browser straight into storage, in parts.
 *
 * The server opens the upload and signs one URL per part
 * (`/api/creative/assets/upload-url`); this sends the parts to those URLs,
 * a few at a time, with real progress. A failed part is retried on its own,
 * so a dropped connection at 90% of a large video costs one part, not the
 * file. Nothing here caps the size.
 */

const CONCURRENT_PARTS = 3;
const PART_ATTEMPTS = 4;

function sendPart(url: string, blob: Blob, onBytes: (sent: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused a part (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("The connection dropped while uploading"));
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.send(blob);
  });
}

export async function uploadInParts(input: {
  file: File;
  partSize: number;
  partUrls: string[];
  onProgress: (sentBytes: number, totalBytes: number) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { file, partSize, partUrls, signal } = input;
  const sentPerPart = new Array<number>(partUrls.length).fill(0);
  const report = () => input.onProgress(Math.min(file.size, sentPerPart.reduce((sum, value) => sum + value, 0)), file.size);
  let next = 0;

  const worker = async () => {
    while (next < partUrls.length) {
      const index = next++;
      const blob = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize));
      for (let attempt = 1; ; attempt++) {
        if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
        try {
          await sendPart(partUrls[index], blob, (sent) => {
            sentPerPart[index] = sent;
            report();
          }, signal);
          sentPerPart[index] = blob.size;
          report();
          break;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          sentPerPart[index] = 0;
          report();
          if (attempt >= PART_ATTEMPTS) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        }
      }
    }
  };

  report();
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_PARTS, partUrls.length) }, worker));
}
