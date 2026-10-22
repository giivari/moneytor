import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const IDLE_SECONDS = 24 * 60 * 60;
export const CHALLENGE_SECONDS = 300;
export const RECOVERY_SECONDS = 600;

export function randomToken(): string { return randomBytes(32).toString("base64url"); }
export function hashToken(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function validToken(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value); }
export function equalSecret(input: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(hashToken(input), "hex"), Buffer.from(hashToken(expected), "hex"));
}
export function recoveryCodes(): string[] {
  return Array.from({ length: 8 }, () => randomBytes(20).toString("hex").match(/.{5}/g)!.join("-"));
}
export function recoveryHash(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll("-", "");
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error("Invalid recovery code");
  return hashToken(normalized);
}
export function sessionIsValid(row: { expires_at: Date; last_seen_at: Date; revoked_at: Date | null; credential_revoked_at: Date | null }, now = Date.now()): boolean {
  return !row.revoked_at && !row.credential_revoked_at && row.expires_at.getTime() > now
    && row.last_seen_at.getTime() + IDLE_SECONDS * 1000 > now;
}

export function parseAuthConfig(env: Record<string, string | undefined>) {
  const origin = env.MONETA_ORIGIN;
  const rpID = env.MONETA_RP_ID;
  if (!origin || !rpID) throw new Error("Auth origin and RP ID must be configured");
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || url.hostname !== rpID) throw new Error("Origin must exactly match RP host");
  if (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && url.protocol === "http:" && rpID === "localhost")) {
    throw new Error("HTTPS is required except localhost development");
  }
  return { origin, rpID, rpName: "moneytor", secure: url.protocol === "https:" };
}
