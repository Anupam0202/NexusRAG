import policy from "./document-original-policy.json";

export interface OriginalDownload {
  blob: Blob;
  filename: string;
  versionId: string;
  sha256: string;
  size: number;
}
export interface OriginalDownloadOptions {
  signal?: AbortSignal;
  onProgress?: (received: number, expected: number) => void;
}

export const originalTransferPolicy = policy;

export async function readOriginalDownload(response: Response, documentId: string, versionId: string,
  options: OriginalDownloadOptions = {}): Promise<OriginalDownload> {
  let completed = false;
  const reader = response.body?.getReader();
  const cancel = () => { void reader?.cancel(options.signal?.reason).catch(() => {}); };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    options.signal?.throwIfAborted();
    const length = response.headers.get("content-length"), size = Number(length);
    const hash = response.headers.get("x-nexus-original-sha256") || "";
    const filename = decodeURIComponent(response.headers.get("x-nexus-original-filename") || "");
    if (!reader || !length || !/^\d+$/.test(length) || !Number.isSafeInteger(size) || size < 1 || size > policy.maximum_bytes ||
        !/^[a-f0-9]{64}$/.test(hash) || response.headers.get("x-nexus-original-document") !== documentId ||
        response.headers.get("x-nexus-original-version") !== versionId || !filename.trim())
      throw new Error("The original file receipt is unavailable or changed. Refresh the document and retry.");
    if (!crypto.subtle) throw new Error("This browser cannot verify the original file. Use a supported secure browser.");
    const bytes = new Uint8Array(size);
    let received = 0, lastPercent = -1;
    options.onProgress?.(0, size);
    while (true) {
      options.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      options.signal?.throwIfAborted();
      if (done) break;
      if (received + value.byteLength > size) throw new Error("The original file exceeded its declared length. No download was started.");
      bytes.set(value, received); received += value.byteLength;
      const percent = Math.floor(received / size * 100);
      if (percent !== lastPercent) { options.onProgress?.(received, size); lastPercent = percent; }
    }
    if (received !== size) throw new Error("The original transfer ended before verification. Retry to download it again.");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer)), value => value.toString(16).padStart(2, "0")).join("");
    options.signal?.throwIfAborted();
    if (digest !== hash) throw new Error("The original file does not match its recorded SHA256. No download was started.");
    completed = true;
    return { blob: new Blob([bytes], { type: "application/octet-stream" }), filename, versionId, sha256: hash, size };
  } catch (error) {
    if (error instanceof RangeError) throw new Error("This browser has insufficient memory for the original file. Retry on a device with more available memory.");
    if (error instanceof TypeError) throw new Error("The original transfer was interrupted before verification. Retry to download it again.");
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    if (!completed) cancel();
    reader?.releaseLock();
  }
}
