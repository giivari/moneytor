import "server-only";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON, type AuthenticatorTransport,
} from "@simplewebauthn/server";
import type { PoolClient } from "pg";
import { database } from "../db/pool.ts";
import { authConfig } from "./config.ts";
import { randomToken, hashToken, validToken, equalSecret, recoveryHash, CHALLENGE_SECONDS, RECOVERY_SECONDS } from "./primitives.ts";
import { ownerState, ownerTransaction, deny, consumeChallenge, createSession, replaceRecoveryCodes, event, assertSession, type OwnerSession } from "./store.ts";

type Credential = { id: string; public_key: Buffer; sign_counter: string; transports: AuthenticatorTransport[]; revoked_at: Date | null };
type Purpose = "bootstrap" | "recover" | "register";
export function credentialLabel(value: unknown): string {
  if (value === undefined || value === "") return "Passkey";
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) deny();
  return value.trim();
}
async function grant(client: PoolClient, token: string | undefined) {
  if (!validToken(token)) deny();
  const result = await client.query<{ purpose: "bootstrap" | "recover" }>("SELECT purpose FROM recovery_grants WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()", [hashToken(token)]);
  if (!result.rowCount) deny();
  return result.rows[0].purpose;
}
export async function bootstrap(secret: string) {
  const configured = process.env.MONETA_BOOTSTRAP_SECRET?.trim();
  const submitted = secret.trim();
  // Accept standard 43-char base64url tokens as well as operator-configured secrets (>= 8 chars).
  if (!configured || configured.length < 8 || !submitted || !equalSecret(submitted, configured)) deny();
  await ownerState();
  return ownerTransaction(async (client) => {
    const state = await client.query("SELECT singleton FROM app_owner_state WHERE initialized_at IS NULL");
    if (!state.rowCount) deny();
    const token = randomToken();
    await client.query("INSERT INTO recovery_grants(token_hash,purpose,expires_at) VALUES($1,'bootstrap',now()+$2*interval '1 second')", [hashToken(token), RECOVERY_SECONDS]);
    return token;
  });
}
export async function recover(code: string) {
  const codeHash = recoveryHash(code);
  return ownerTransaction(async (client) => {
    if (!(await client.query("SELECT singleton FROM app_owner_state WHERE initialized_at IS NOT NULL")).rowCount) deny();
    const result = await client.query("UPDATE recovery_codes SET used_at=now() WHERE code_hash=$1 AND used_at IS NULL RETURNING code_hash", [codeHash]);
    if (!result.rowCount) deny();
    const token = randomToken();
    await client.query("INSERT INTO recovery_grants(token_hash,purpose,expires_at) VALUES($1,'recover',now()+$2*interval '1 second')", [hashToken(token), RECOVERY_SECONDS]);
    await event(client, "recovered");
    return token;
  });
}
export async function registrationOptions(session: OwnerSession | null, grantToken: string | undefined) {
  const state = await ownerState();
  return ownerTransaction(async (client) => {
    let purpose: Purpose;
    if (session) { await assertSession(client, session, true); purpose = "register"; }
    else purpose = await grant(client, grantToken);
    if ((purpose === "bootstrap") === !!state.initialized_at) deny();
    const existing = await client.query<Credential>("SELECT id,transports FROM webauthn_credentials");
    const options = await generateRegistrationOptions({
      rpName: authConfig().rpName, rpID: authConfig().rpID, userName: "moneytor owner",
      userID: new Uint8Array(state.webauthn_user_id), attestationType: "none",
      supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      excludeCredentials: existing.rows.map(({ id, transports }) => ({ id, transports })),
    });
    const binding = randomToken();
    await client.query(`INSERT INTO auth_challenges(binding_hash,challenge,purpose,session_hash,recovery_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 second')`,
    [hashToken(binding), options.challenge, purpose, session?.tokenHash ?? null, purpose !== "register" ? hashToken(grantToken!) : null, CHALLENGE_SECONDS]);
    // Bootstrap grants are revalidated at finish; the ceremony cookie binds the challenge.
    return { options, binding, purpose };
  });
}
export async function finishRegistration(input: {
  response: RegistrationResponseJSON; label: unknown; binding: string | undefined;
  purpose: Purpose; session: OwnerSession | null; grantToken: string | undefined;
}) {
  const challenge = await consumeChallenge(input.binding, input.purpose);
  const label = credentialLabel(input.label);
  const config = authConfig();
  const verification = await verifyRegistrationResponse({ response: input.response, expectedChallenge: challenge.challenge,
    expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
  if (!verification.verified || !verification.registrationInfo) deny();
  const info = verification.registrationInfo;
  return ownerTransaction(async (client) => {
    const state = (await client.query<{ initialized_at: Date | null }>("SELECT initialized_at FROM app_owner_state WHERE singleton")).rows[0];
    if (!state || ((input.purpose === "bootstrap") === !!state.initialized_at)) deny();
    if (input.purpose === "register") {
      if (!input.session || challenge.session_hash !== input.session.tokenHash) deny();
      await assertSession(client, input.session, true);
    } else {
      if (await grant(client, input.grantToken) !== input.purpose) deny();
      if (challenge.recovery_hash !== hashToken(input.grantToken!)) deny();
      await client.query("UPDATE recovery_grants SET used_at=now() WHERE token_hash=$1", [hashToken(input.grantToken!)]);
    }
    await client.query(`INSERT INTO webauthn_credentials(id,public_key,sign_counter,transports,device_type,backed_up,label)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter,
      info.credential.transports ?? [], info.credentialDeviceType, info.credentialBackedUp, label]);
    if (input.purpose === "bootstrap") await client.query("UPDATE app_owner_state SET initialized_at=now() WHERE singleton");
    if (input.purpose === "recover") {
      // Lost-device recovery replaces all old credentials and sessions only after a new proof succeeds.
      await client.query("UPDATE webauthn_credentials SET revoked_at=now() WHERE id<>$1 AND revoked_at IS NULL", [info.credential.id]);
      await client.query("UPDATE owner_sessions SET revoked_at=now() WHERE revoked_at IS NULL");
      await client.query("DELETE FROM auth_challenges");
    }
    const codes = input.purpose === "register" ? undefined : await replaceRecoveryCodes(client);
    if (input.session) await client.query("UPDATE owner_sessions SET revoked_at=now() WHERE token_hash=$1", [input.session.tokenHash]);
    const token = await createSession(client, info.credential.id);
    await event(client, "registered");
    return { token, codes };
  });
}
export async function authenticationOptions() {
  const state = await ownerState();
  if (!state.initialized_at) deny();
  const options = await generateAuthenticationOptions({ rpID: authConfig().rpID, userVerification: "required" });
  const binding = randomToken();
  await database().query(`INSERT INTO auth_challenges(binding_hash,challenge,purpose,expires_at)
    VALUES($1,$2,'login',now()+$3*interval '1 second')`, [hashToken(binding), options.challenge, CHALLENGE_SECONDS]);
  return { options, binding };
}
export async function authenticate(response: AuthenticationResponseJSON, binding: string | undefined, previousSession: OwnerSession | null) {
  const challenge = await consumeChallenge(binding, "login");
  const config = authConfig();
  return ownerTransaction(async (client) => {
    const row = (await client.query<Credential>("SELECT * FROM webauthn_credentials WHERE id=$1 AND revoked_at IS NULL FOR UPDATE", [response.id])).rows[0];
    if (!row) deny();
    const state = (await client.query<{ webauthn_user_id: Buffer }>("SELECT webauthn_user_id FROM app_owner_state WHERE initialized_at IS NOT NULL")).rows[0];
    if (!state || (response.response.userHandle && response.response.userHandle !== state.webauthn_user_id.toString("base64url"))) deny();
    const result = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true,
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: Number(row.sign_counter), transports: row.transports } });
    if (!result.verified) deny();
    await client.query("UPDATE webauthn_credentials SET sign_counter=$2,backed_up=$3,last_used_at=now() WHERE id=$1", [row.id, result.authenticationInfo.newCounter, result.authenticationInfo.credentialBackedUp]);
    if (previousSession) await client.query("UPDATE owner_sessions SET revoked_at=now() WHERE token_hash=$1", [previousSession.tokenHash]);
    const token = await createSession(client, row.id);
    await event(client, "authenticated");
    return token;
  });
}
export async function securityOverview(session: OwnerSession) {
  return ownerTransaction(async (client) => {
    await assertSession(client, session);
    const credentials = await client.query<{ id: string; label: string; created_at: Date; last_used_at: Date | null }>("SELECT id,label,created_at,last_used_at FROM webauthn_credentials WHERE revoked_at IS NULL ORDER BY created_at DESC,id DESC");
    const unused = await client.query<{ count: string }>("SELECT count(*) FROM recovery_codes WHERE used_at IS NULL");
    return { credentials: credentials.rows.map(row => ({ id: row.id, label: row.label, createdAt: row.created_at.toISOString(), lastUsedAt: row.last_used_at?.toISOString() ?? null })), recoveryRemaining: Number(unused.rows[0].count) };
  });
}
export async function securityAction(action: string, session: OwnerSession, id?: string, label?: unknown) {
  return ownerTransaction(async (client) => {
    await assertSession(client, session, action !== "logout");
    if (action === "logout") {
      await client.query("UPDATE owner_sessions SET revoked_at=now() WHERE token_hash=$1", [session.tokenHash]);
      await event(client, "logout");
    } else if (action === "recovery-codes") {
      const codes = await replaceRecoveryCodes(client); await event(client, "recovery_regenerated"); return { codes };
    } else if (action === "rename") {
      if (!(await client.query("UPDATE webauthn_credentials SET label=$2 WHERE id=$1 AND revoked_at IS NULL", [id, credentialLabel(label)])).rowCount) deny();
    } else if (action === "revoke") {
      // Always retain one working passkey, even if recovery codes exist.
      if (Number((await client.query("SELECT count(*) FROM webauthn_credentials WHERE revoked_at IS NULL")).rows[0].count) <= 1) deny();
      if (!(await client.query("UPDATE webauthn_credentials SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [id])).rowCount) deny();
      await client.query("UPDATE owner_sessions SET revoked_at=now() WHERE credential_id=$1 AND revoked_at IS NULL", [id]);
      await event(client, "revoked");
    } else if (action === "revoke-sessions") {
      await client.query("UPDATE owner_sessions SET revoked_at=now() WHERE token_hash<>$1 AND revoked_at IS NULL", [session.tokenHash]);
      await event(client, "sessions_revoked");
    } else deny();
    return {};
  });
}
