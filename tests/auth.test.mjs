import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { randomToken, hashToken, validToken, equalSecret, recoveryCodes, recoveryHash, sessionIsValid, parseAuthConfig } from "../src/lib/auth/primitives.ts";

test("opaque tokens have 256-bit encoding and stored hash differs from bearer", () => {
  const tokens = Array.from({ length: 128 }, randomToken);
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) { assert.ok(validToken(token)); assert.equal(Buffer.from(token, "base64url").length, 32); assert.notEqual(hashToken(token), token); }
  assert.ok(equalSecret(tokens[0], tokens[0])); assert.ok(!equalSecret(tokens[0], tokens[1]));
});
test("sessions reject expiration, idle timeout and both revocation states", () => {
  const now = Date.now();
  const row = { expires_at: new Date(now + 1000), last_seen_at: new Date(now), revoked_at: null, credential_revoked_at: null };
  assert.ok(sessionIsValid(row, now));
  assert.ok(!sessionIsValid({ ...row, expires_at: new Date(now) }, now));
  assert.ok(!sessionIsValid({ ...row, last_seen_at: new Date(now - 86400000) }, now));
  assert.ok(!sessionIsValid({ ...row, revoked_at: new Date(now) }, now));
  assert.ok(!sessionIsValid({ ...row, credential_revoked_at: new Date(now) }, now));
});
test("recovery codes are random, hashable and tolerate formatting only", () => {
  const codes = recoveryCodes(); assert.equal(new Set(codes).size, 8);
  assert.equal(recoveryHash(codes[0]), recoveryHash(codes[0].toUpperCase().replaceAll("-", "")));
  assert.notEqual(recoveryHash(codes[0]), recoveryHash(codes[1]));
  assert.throws(() => recoveryHash("short"));
});
test("RP configuration fails closed for production HTTP, subdomain ambiguity and URL extras", () => {
  const base = { MONETA_ORIGIN: "http://localhost:3000", MONETA_RP_ID: "localhost", NODE_ENV: "development" };
  assert.equal(parseAuthConfig(base).secure, false);
  assert.throws(() => parseAuthConfig({ ...base, NODE_ENV: "production" }));
  assert.throws(() => parseAuthConfig({ ...base, MONETA_ORIGIN: "http://localhost:3000/path" }));
  assert.throws(() => parseAuthConfig({ ...base, MONETA_RP_ID: "other.local" }));
  assert.equal(parseAuthConfig({ MONETA_ORIGIN: "https://moneta.example", MONETA_RP_ID: "moneta.example", NODE_ENV: "production" }).secure, true);
});

// Intentionally unsigned malformed assertions. These only prove the library's rejection
// boundaries, not successful WebAuthn crypto or a browser/platform ceremony.
function assertion({ challenge = "expected", origin = "https://moneta.example", rp = "moneta.example" } = {}) {
  const authData = Buffer.alloc(37);
  createHash("sha256").update(rp).digest().copy(authData); authData[32] = 5;
  return { id: "dGVzdA", rawId: "dGVzdA", type: "public-key", clientExtensionResults: {}, response: {
    clientDataJSON: Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin })).toString("base64url"),
    authenticatorData: authData.toString("base64url"), signature: "AA",
  } };
}
const verification = { expectedChallenge: "expected", expectedOrigin: "https://moneta.example", expectedRPID: "moneta.example", requireUserVerification: true, credential: { id: "dGVzdA", publicKey: new Uint8Array([0]), counter: 0 } };
test("actual WebAuthn verifier rejects a wrong challenge", async () => {
  await assert.rejects(verifyAuthenticationResponse({ ...verification, response: assertion({ challenge: "wrong" }) }), /challenge/);
});
test("actual WebAuthn verifier rejects a wrong origin", async () => {
  await assert.rejects(verifyAuthenticationResponse({ ...verification, response: assertion({ origin: "https://attacker.example" }) }), /origin/);
});
test("actual WebAuthn verifier rejects a wrong RP ID hash", async () => {
  await assert.rejects(verifyAuthenticationResponse({ ...verification, response: assertion({ rp: "attacker.example" }) }), /RP ID/);
});
