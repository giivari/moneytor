import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { registerHooks } from "node:module";

// Explicit opt-in. Never infer that an arbitrary DATABASE_URL is a test database.
const enabled = process.env.MONETA_AUTH_DB_TEST === "moneta_p2_verify";
test("P2 disposable PostgreSQL auth lifecycle and constraints", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55433"); assert.equal(target.pathname, "/moneta_p2_verify");
  const admin = new pg.Client({ connectionString: target.toString() }); await admin.connect();
  assert.equal((await admin.query("SELECT current_database() AS name")).rows[0].name, "moneta_p2_verify");
  const schema = `p2_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema}`);
  await admin.query(await readFile(new URL("../db/migrations/003_owner_security.sql", import.meta.url), "utf8"));
  target.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = target.toString();
  process.env.MONETA_ORIGIN = "http://localhost:3000"; process.env.MONETA_RP_ID = "localhost";
  process.env.NODE_ENV = "test"; process.env.MONETA_BOOTSTRAP_SECRET = randomBytes(32).toString("base64url");
  let browserToken;
  // Only the framework request-cookie API is mocked. DB, services and WebAuthn library are real.
  globalThis.__monetaTestCookies = () => ({ get: () => browserToken ? { value: browserToken } : undefined });
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "next/headers") return { url: "data:text/javascript,export async function cookies(){return globalThis.__monetaTestCookies()}", shortCircuit: true };
      if (specifier === "next/navigation") return { url: "data:text/javascript,export function redirect(path){throw new Error('REDIRECT '+path)}", shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      return next(specifier, context);
    },
  });
  const store = await import("../src/lib/auth/store.ts");
  const service = await import("../src/lib/auth/service.ts");
  const crypto = await import("../src/lib/auth/primitives.ts");
  const { database } = await import("../src/lib/db/pool.ts");
  const { requireOwnerSession } = await import("../src/lib/auth/session.ts");
  const { assertRequestOrigin, boundedBody } = await import("../src/lib/auth/http.ts");
  try {
    await t.test("bootstrap secret, grant scope, initial registration challenge", async () => {
      await assert.rejects(service.bootstrap("wrong"));
      const grant = await service.bootstrap(process.env.MONETA_BOOTSTRAP_SECRET);
      const options = await service.registrationOptions(null, grant);
      assert.equal(options.purpose, "bootstrap"); assert.equal(options.options.authenticatorSelection.userVerification, "required");
      const result = await admin.query("SELECT token_hash,purpose FROM recovery_grants");
      assert.equal(result.rows[0].token_hash, crypto.hashToken(grant)); assert.notEqual(result.rows[0].token_hash, grant);
      assert.equal(result.rows[0].purpose, "bootstrap");
    });
    await admin.query("INSERT INTO webauthn_credentials(id,public_key,sign_counter,device_type,backed_up,label) VALUES('synthetic-one',$1,0,'singleDevice',false,'Synthetic one'),('synthetic-two',$1,0,'singleDevice',false,'Synthetic two')", [Buffer.from([1])]);
    await admin.query("UPDATE app_owner_state SET initialized_at=now() WHERE singleton");
    await t.test("bootstrap permanently closes, including previous grants", async () => {
      await assert.rejects(service.bootstrap(process.env.MONETA_BOOTSTRAP_SECRET));
      await assert.rejects(admin.query("UPDATE app_owner_state SET initialized_at=NULL"), /permanent/);
      await assert.rejects(admin.query("DELETE FROM app_owner_state"), /permanent/);
    });
    await t.test("session storage, owner access, expiration, idle and revocation", async () => {
      browserToken = await store.ownerTransaction(client => store.createSession(client, "synthetic-one"));
      const hash = crypto.hashToken(browserToken);
      assert.equal((await admin.query("SELECT token_hash FROM owner_sessions WHERE token_hash=$1", [hash])).rows[0].token_hash, hash);
      assert.equal((await requireOwnerSession()).credentialId, "synthetic-one");
      await admin.query("UPDATE owner_sessions SET created_at=now()-interval '8 days',last_seen_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE token_hash=$1", [hash]);
      assert.equal(await store.resolveSession(browserToken), null);
      await admin.query("UPDATE owner_sessions SET expires_at=now()+interval '1 day' WHERE token_hash=$1", [hash]);
      assert.equal(await store.resolveSession(browserToken), null);
      await admin.query("UPDATE owner_sessions SET last_seen_at=now(),revoked_at=now() WHERE token_hash=$1", [hash]);
      assert.equal(await store.resolveSession(browserToken), null);
      await assert.rejects(requireOwnerSession(), /REDIRECT \/unlock/);
      browserToken = undefined;
      await assert.rejects(requireOwnerSession(), /REDIRECT \/unlock/);
      const { listCatalog } = await import("../src/lib/repositories/catalogs.ts");
      await assert.rejects(listCatalog("providers"), /REDIRECT \/unlock/);
    });
    await t.test("challenge binding, operation, expiry and atomic one-time consumption", async () => {
      const first = await service.authenticationOptions();
      await assert.rejects(store.consumeChallenge(crypto.randomToken(), "login"));
      await assert.rejects(store.consumeChallenge(first.binding, "register"));
      const races = await Promise.allSettled([store.consumeChallenge(first.binding, "login"), store.consumeChallenge(first.binding, "login")]);
      assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
      const expired = await service.authenticationOptions();
      await admin.query("UPDATE auth_challenges SET created_at=now()-interval '10 minutes',expires_at=now()-interval '1 second' WHERE binding_hash=$1", [crypto.hashToken(expired.binding)]);
      await assert.rejects(store.consumeChallenge(expired.binding, "login"));
      const cancelled = await service.authenticationOptions();
      await store.discardChallenge(cancelled.binding, "login");
      await assert.rejects(store.consumeChallenge(cancelled.binding, "login"));
    });
    await t.test("failed verifier burns the challenge", async () => {
      const options = await service.authenticationOptions();
      await assert.rejects(service.authenticate({ id: "synthetic-one" }, options.binding, null));
      await assert.rejects(store.consumeChallenge(options.binding, "login"));
    });
    let session;
    await t.test("recovery is single use, scoped, hashed, and regeneration invalidates prior codes", async () => {
      browserToken = await store.ownerTransaction(client => store.createSession(client, "synthetic-one"));
      session = await store.resolveSession(browserToken);
      const { codes } = await service.securityAction("recovery-codes", session);
      assert.equal((await admin.query("SELECT count(*) FROM recovery_codes")).rows[0].count, "8");
      assert.equal((await admin.query("SELECT count(*) FROM recovery_codes WHERE code_hash=$1", [codes[0]])).rows[0].count, "0");
      const outcomes = await Promise.allSettled([service.recover(codes[0]), service.recover(codes[0])]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      const grant = outcomes.find(result => result.status === "fulfilled").value;
      assert.equal(await store.resolveSession(grant), null);
      assert.equal((await service.registrationOptions(null, grant)).purpose, "recover");
      await service.securityAction("recovery-codes", session);
      await assert.rejects(service.recover(codes[1]));
      await assert.rejects(service.registrationOptions(null, grant));
    });
    await t.test("credential revocation blocks sessions and future authentication, last key protected", async () => {
      const otherToken = await store.ownerTransaction(client => store.createSession(client, "synthetic-two"));
      await service.securityAction("revoke", session, "synthetic-two");
      assert.equal(await store.resolveSession(otherToken), null);
      const options = await service.authenticationOptions();
      await assert.rejects(service.authenticate({ id: "synthetic-two" }, options.binding, null));
      await assert.rejects(service.securityAction("revoke", session, "synthetic-one"));
    });
    await t.test("fresh authentication required for security changes; logout revokes", async () => {
      await admin.query("UPDATE owner_sessions SET created_at=now()-interval '11 minutes' WHERE token_hash=$1", [session.tokenHash]);
      await assert.rejects(service.securityAction("recovery-codes", session));
      await service.securityAction("logout", session);
      assert.equal(await store.resolveSession(browserToken), null);
    });
    await t.test("PostgreSQL rate limit persists and rejects over budget", async () => {
      for (let i = 0; i < 10; i++) await store.limitAttempts("recovery");
      await assert.rejects(store.limitAttempts("recovery"));
      assert.equal((await admin.query("SELECT attempts FROM auth_rate_limits WHERE bucket='recovery'")).rows[0].attempts, 11);
    });
    await t.test("origin, cross-site, method and body-size rejection", async () => {
      assertRequestOrigin(new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { origin: "http://localhost:3000" } }));
      assert.throws(() => assertRequestOrigin(new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { origin: "https://attacker.example" } })));
      assert.throws(() => assertRequestOrigin(new Request("http://localhost:3000/api/auth/logout", { method: "GET", headers: { origin: "http://localhost:3000" } })));
      await assert.rejects(boundedBody(new Request("http://localhost:3000", { method: "POST", body: "x".repeat(32769) })));
    });
    await t.test("durable singleton, session hash, expiry and challenge purpose constraints", async () => {
      await assert.rejects(admin.query("INSERT INTO app_owner_state(singleton,webauthn_user_id) VALUES(false,$1)", [randomBytes(32)]));
      await assert.rejects(admin.query("INSERT INTO owner_sessions(token_hash,credential_id,expires_at) VALUES('plaintext','synthetic-one',now()+interval '1 day')"));
      await assert.rejects(admin.query("INSERT INTO owner_sessions(token_hash,credential_id,expires_at) VALUES($1,'synthetic-one',now()-interval '1 day')", [crypto.hashToken(crypto.randomToken())]));
      await assert.rejects(admin.query("INSERT INTO auth_challenges(binding_hash,challenge,purpose,expires_at) VALUES($1,'wrong','register',now()+interval '1 minute')", [crypto.hashToken(crypto.randomToken())]));
    });
  } finally {
    await database().end(); hooks.deregister(); delete globalThis.__monetaTestCookies;
    await admin.query("SET search_path TO public"); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
