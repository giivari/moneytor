import { equalSecret } from "@/lib/auth/primitives";

/** 503 bila CRON_SECRET belum disetel, 401 bila header Bearer tidak cocok, "ok" bila cocok (perbandingan timing-safe). */
export function cronAuthorization(authorization: string | null, secret: string | undefined): 503 | 401 | "ok" {
  const expected = (secret ?? "").trim();
  if (!expected) return 503;
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  if (!match || !equalSecret(match[1].trim(), expected)) return 401;
  return "ok";
}
