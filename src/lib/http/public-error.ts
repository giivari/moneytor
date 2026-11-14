/**
 * Message that is safe to show to the owner. Domain errors carry Indonesian messages and pass through; PostgreSQL and
 * Node system errors (constraint names, values, hosts) are replaced by `fallback`.
 */
export function publicMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^(?:[0-9A-Z]{5}|E[A-Z_]+)$/.test(code)) return fallback;
  if ("severity" in error || "routine" in error || "syscall" in error) return fallback;
  return error.message || fallback;
}
