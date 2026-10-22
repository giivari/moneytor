import "server-only";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { database, inDatabaseTransaction } from "../db/pool.ts";
import { hashToken, validToken, sessionIsValid, randomToken, recoveryCodes, recoveryHash, SESSION_SECONDS } from "./primitives.ts";

export type OwnerSession = { tokenHash: string; credentialId: string; createdAt: Date };
export class AuthFailure extends Error {}
export function deny(): never { throw new AuthFailure("Access denied"); }

// Serializes owner initialization, credential changes, recovery and session creation.
export async function ownerTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  return inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('moneta_owner_security'))");
    return work(client);
  });
}
export async function ownerState() {
  return ownerTransaction(async (client) => {
    await client.query("INSERT INTO app_owner_state(singleton, webauthn_user_id) VALUES(true,$1) ON CONFLICT DO NOTHING", [randomBytes(32)]);
    return (await client.query<{ initialized_at: Date | null; webauthn_user_id: Buffer }>("SELECT initialized_at, webauthn_user_id FROM app_owner_state WHERE singleton")).rows[0];
  });
}
export async function resolveSession(token: string | undefined): Promise<OwnerSession | null> {
  if (!validToken(token)) return null;
  const tokenHash = hashToken(token);
  const result = await database().query<{
    credential_id: string; created_at: Date; expires_at: Date; last_seen_at: Date;
    revoked_at: Date | null; credential_revoked_at: Date | null;
  }>(`SELECT s.*, c.revoked_at AS credential_revoked_at FROM owner_sessions s
      JOIN webauthn_credentials c ON c.id=s.credential_id
      WHERE s.token_hash=$1 AND EXISTS (SELECT 1 FROM app_owner_state WHERE initialized_at IS NOT NULL)`, [tokenHash]);
  const row = result.rows[0];
  if (!row || !sessionIsValid(row)) return null;
  // No cookie extension: idle time slides, absolute seven-day expiry never does.
  const touched = await database().query(`UPDATE owner_sessions SET last_seen_at=now()
    WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()
    AND last_seen_at>now()-interval '24 hours'
    AND EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.id=owner_sessions.credential_id AND c.revoked_at IS NULL)
    RETURNING token_hash`, [tokenHash]);
  return touched.rowCount ? { tokenHash, credentialId: row.credential_id, createdAt: row.created_at } : null;
}
export async function assertSession(client: PoolClient, session: OwnerSession, fresh = false) {
  const result = await client.query(`SELECT s.token_hash FROM owner_sessions s JOIN webauthn_credentials c ON c.id=s.credential_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND c.revoked_at IS NULL AND s.expires_at>now()
    AND s.last_seen_at>now()-interval '24 hours' AND (NOT $2::boolean OR s.created_at>now()-interval '10 minutes')`, [session.tokenHash, fresh]);
  if (!result.rowCount) deny();
}
export async function createSession(client: PoolClient, credentialId: string): Promise<string> {
  const token = randomToken();
  await client.query(`INSERT INTO owner_sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+$3*interval '1 second')`, [hashToken(token), credentialId, SESSION_SECONDS]);
  return token;
}
export async function replaceRecoveryCodes(client: PoolClient): Promise<string[]> {
  const codes = recoveryCodes();
  await client.query("DELETE FROM recovery_codes");
  await client.query("DELETE FROM recovery_grants");
  for (const code of codes) await client.query("INSERT INTO recovery_codes(code_hash) VALUES($1)", [recoveryHash(code)]);
  return codes;
}
export async function event(client: PoolClient, name: string) {
  await client.query("INSERT INTO security_events(event) VALUES($1)", [name]);
}
export async function limitAttempts(bucket: "bootstrap" | "login" | "recovery" | "security") {
  const limit = { bootstrap: 10, login: 60, recovery: 10, security: 60 }[bucket];
  const result = await database().query<{ attempts: number }>(`INSERT INTO auth_rate_limits(bucket,window_start,attempts) VALUES($1,now(),1)
    ON CONFLICT(bucket) DO UPDATE SET
    attempts=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END,
    window_start=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
    RETURNING attempts`, [bucket]);
  if (result.rows[0].attempts > limit) deny();
  // Bounded retention, no IP identifiers or request payload logging.
  await database().query("DELETE FROM auth_challenges WHERE expires_at<now()");
  await database().query("DELETE FROM recovery_grants WHERE expires_at<now()");
  await database().query("DELETE FROM owner_sessions WHERE expires_at<now()-interval '7 days'");
  await database().query("DELETE FROM security_events WHERE created_at<now()-interval '90 days'");
}
export async function consumeChallenge(binding: string | undefined, purpose: string) {
  if (!validToken(binding)) deny();
  // Committed BEFORE verification: failed proofs cannot replay a challenge.
  const result = await database().query<{ challenge: string; session_hash: string | null; recovery_hash: string | null }>(
    "DELETE FROM auth_challenges WHERE binding_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING challenge,session_hash,recovery_hash",
    [hashToken(binding), purpose]);
  if (!result.rowCount) deny();
  return result.rows[0];
}

export async function discardChallenge(binding: string | undefined, purpose: string): Promise<void> {
  if (!validToken(binding) || !["bootstrap", "login", "register", "recover"].includes(purpose)) deny();
  await database().query("DELETE FROM auth_challenges WHERE binding_hash=$1 AND purpose=$2", [hashToken(binding), purpose]);
}
