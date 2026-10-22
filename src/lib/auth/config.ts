import "server-only";
import { parseAuthConfig } from "./primitives.ts";

export function authConfig() { return parseAuthConfig(process.env); }
export function cookieName(kind: "session" | "ceremony" | "recovery"): string {
  return `${authConfig().secure ? "__Host-" : ""}moneta-${kind}`;
}
export function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: authConfig().secure, sameSite: "strict" as const, path: "/", maxAge };
}
