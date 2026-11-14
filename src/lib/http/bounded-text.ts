/** Reads a request body as UTF-8 text without ever buffering more than `maxBytes` (also for chunked bodies without content-length). */
export class BodyTooLargeError extends Error {}

export async function boundedText(request: Request, maxBytes: number): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new BodyTooLargeError("Ukuran permintaan melebihi batas.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new BodyTooLargeError("Ukuran permintaan melebihi batas."); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString("utf8");
}
