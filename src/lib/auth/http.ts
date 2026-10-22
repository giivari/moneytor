import "server-only";
import { authConfig } from "./config.ts";
import { deny } from "./store.ts";

export function assertRequestOrigin(request: Request) {
  if (request.method !== "POST" || request.headers.get("origin") !== authConfig().origin) deny();
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") deny();
}
export async function boundedBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > 32768 || !request.body) deny();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); deny(); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString("utf8");
}
