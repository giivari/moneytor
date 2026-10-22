import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { authConfig, cookieName, cookieOptions } from "@/lib/auth/config";
import { assertRequestOrigin, boundedBody } from "@/lib/auth/http";
import { limitAttempts, deny, discardChallenge } from "@/lib/auth/store";
import { currentOwnerSession } from "@/lib/auth/session";
import { authenticate, authenticationOptions, bootstrap, recover, registrationOptions, finishRegistration, securityAction, securityOverview } from "@/lib/auth/service";
import { CHALLENGE_SECONDS, RECOVERY_SECONDS, SESSION_SECONDS } from "@/lib/auth/primitives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const operations = new Set(["bootstrap", "recover", "login-options", "login-finish", "register-options", "register-finish", "cancel", "overview", "logout", "rename", "revoke", "recovery-codes", "revoke-sessions"]);
function json(data: unknown) { return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } }); }
function setCookie(response: NextResponse, kind: "session" | "ceremony" | "recovery", token: string, duration: number) {
  response.cookies.set(cookieName(kind), token, cookieOptions(duration));
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  let isBootstrap = false;
  try {
    assertRequestOrigin(request);
    const { operation } = await params;
    if (!operations.has(operation)) deny();
    isBootstrap = operation === "bootstrap";
    await limitAttempts(isBootstrap ? "bootstrap" : operation === "recover" ? "recovery" : operation.startsWith("login") ? "login" : "security");
    const raw = await boundedBody(request);
    if (isBootstrap) {
      if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) deny();
      const secret = new URLSearchParams(raw).get("secret") ?? "";
      const token = await bootstrap(secret);
      const response = NextResponse.redirect(new URL("/enroll", authConfig().origin), 303);
      response.headers.set("Cache-Control", "no-store");
      setCookie(response, "recovery", token, RECOVERY_SECONDS);
      return response;
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) deny();
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) deny();
    const session = await currentOwnerSession();
    const binding = request.cookies.get(cookieName("ceremony"))?.value;
    const grantToken = request.cookies.get(cookieName("recovery"))?.value;
    if (operation === "cancel") {
      if (typeof body.purpose !== "string") deny();
      await discardChallenge(binding, body.purpose);
      const response = json({ ok: true }); setCookie(response, "ceremony", "", 0); return response;
    }
    if (operation === "recover") {
      if (typeof body.code !== "string") deny();
      const token = await recover(body.code);
      const response = json({ ok: true }); setCookie(response, "recovery", token, RECOVERY_SECONDS);
      setCookie(response, "session", "", 0); setCookie(response, "ceremony", "", 0); return response;
    }
    if (operation === "login-options") {
      const result = await authenticationOptions(); const response = json({ options: result.options });
      setCookie(response, "ceremony", result.binding, CHALLENGE_SECONDS); return response;
    }
    if (operation === "login-finish") {
      const token = await authenticate(body.response as AuthenticationResponseJSON, binding, session);
      const response = json({ ok: true }); setCookie(response, "session", token, SESSION_SECONDS);
      setCookie(response, "ceremony", "", 0); setCookie(response, "recovery", "", 0); return response;
    }
    if (operation === "register-options") {
      const result = await registrationOptions(session, grantToken);
      const response = json({ options: result.options, purpose: result.purpose });
      setCookie(response, "ceremony", result.binding, CHALLENGE_SECONDS); return response;
    }
    if (operation === "register-finish") {
      if (!["register", "bootstrap", "recover"].includes(body.purpose)) deny();
      const result = await finishRegistration({ response: body.response as RegistrationResponseJSON, label: body.label,
        purpose: body.purpose, binding, session, grantToken });
      const response = json({ ok: true, codes: result.codes }); setCookie(response, "session", result.token, SESSION_SECONDS);
      setCookie(response, "ceremony", "", 0); setCookie(response, "recovery", "", 0); return response;
    }
    if (!session) deny();
    if (operation === "overview") return json(await securityOverview(session));
    if (body.id !== undefined && (typeof body.id !== "string" || body.id.length > 2048)) deny();
    const result = await securityAction(operation, session, body.id, body.label);
    const response = json(result);
    if (operation === "logout" || (operation === "revoke" && body.id === session.credentialId)) {
      setCookie(response, "session", "", 0);
      setCookie(response, "ceremony", "", 0);
      setCookie(response, "recovery", "", 0);
    }
    return response;
  } catch {
    // Deliberately exclude request bodies, credentials, tokens, and internal errors from logs.
    if (isBootstrap) {
      const response = NextResponse.redirect(new URL("/unlock?failed=1", authConfig().origin), 303);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    return NextResponse.json({ error: "Permintaan tidak dapat diproses. Coba lagi atau buka ulang dengan passkey." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
