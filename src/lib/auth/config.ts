import "server-only";
import { parseAuthConfig } from "./primitives.ts";

function normalizedEnv(): Record<string, string | undefined> {
  const rawOrigin = (
    process.env.MONETA_ORIGIN ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  ).trim();

  let cleanOrigin = rawOrigin;
  let cleanRpId = (process.env.MONETA_RP_ID || "").trim();

  try {
    if (rawOrigin) {
      const parsedOrigin = new URL(rawOrigin.startsWith("http") ? rawOrigin : `https://${rawOrigin}`);
      cleanOrigin = parsedOrigin.origin;
      if (!cleanRpId) {
        cleanRpId = parsedOrigin.hostname;
      } else if (cleanRpId.includes("://") || cleanRpId.includes("/")) {
        cleanRpId = new URL(cleanRpId.startsWith("http") ? cleanRpId : `https://${cleanRpId}`).hostname;
      }
      // On Vercel, ensure RP ID always matches the canonical origin hostname
      if (process.env.VERCEL && cleanRpId !== parsedOrigin.hostname) {
        cleanRpId = parsedOrigin.hostname;
      }
    }
  } catch {
    // Fall through to strict parseAuthConfig validation
  }

  return {
    ...process.env,
    MONETA_ORIGIN: cleanOrigin || undefined,
    MONETA_RP_ID: cleanRpId || undefined,
  };
}

export function authConfig() { return parseAuthConfig(normalizedEnv()); }
export function cookieName(kind: "session" | "ceremony" | "recovery"): string {
  return `${authConfig().secure ? "__Host-" : ""}moneta-${kind}`;
}
export function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: authConfig().secure, sameSite: "strict" as const, path: "/", maxAge };
}
