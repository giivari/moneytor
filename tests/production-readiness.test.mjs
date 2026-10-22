import test from "node:test";
import assert from "node:assert/strict";
import { validateProductionEnvironment } from "../src/lib/ops/production-readiness.ts";
import { createStructuredLog, redactSensitiveData, redactSensitiveText } from "../src/lib/ops/observability.ts";
import { verifySnapshotIntegrity } from "../src/lib/ops/backup-integrity.ts";

test("validateProductionEnvironment enforces HTTPS origin and RP alignment in production", () => {
  const validProd = validateProductionEnvironment(
    {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://app_user:secret@db.example.com:5432/moneytor_prod?sslmode=require",
      MONETA_ORIGIN: "https://finance.example.com",
      MONETA_RP_ID: "finance.example.com",
      MONETA_DB_POOL_MAX: "3",
    },
    { ownerInitialized: true },
  );
  assert.equal(validProd.ready, true);
  assert.equal(validProd.mode, "production");
  assert.ok(validProd.checks.every((c) => c.status === "pass"));

  // Reject HTTP origin in production
  const httpProd = validateProductionEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app_user:secret@db.example.com:5432/moneytor_prod?sslmode=require",
    MONETA_ORIGIN: "http://finance.example.com",
    MONETA_RP_ID: "finance.example.com",
  });
  assert.equal(httpProd.ready, false);

  // Reject mismatched RP ID or maintenance DB
  const mismatch = validateProductionEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app_user:secret@db.example.com:5432/postgres",
    MONETA_ORIGIN: "https://finance.example.com",
    MONETA_RP_ID: "example.com",
  });
  assert.equal(mismatch.ready, false);
  assert.equal(
    mismatch.checks.find((c) => c.key === "DATABASE_URL")?.status,
    "fail",
  );
  assert.equal(
    mismatch.checks.find((c) => c.key === "WEBAUTHN_ORIGIN_RP")?.status,
    "fail",
  );
});

test("validateProductionEnvironment allows loopback HTTP in development and warns on lingering bootstrap secret", () => {
  const devReport = validateProductionEnvironment(
    {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55433/moneta_p2_verify",
      MONETA_ORIGIN: "http://localhost:3000",
      MONETA_RP_ID: "localhost",
      MONETA_BOOTSTRAP_SECRET: "still-present-after-init",
    },
    { ownerInitialized: true },
  );
  assert.equal(devReport.ready, true);
  assert.equal(
    devReport.checks.find((c) => c.key === "BOOTSTRAP_SECRET_HYGIENE")?.status,
    "warn",
  );
});

test("observability redactor strips secrets, bearer tokens, and PostgreSQL credentials", () => {
  const rawError = new Error(
    "Connection failed to postgresql://owner:super_secret_pw@127.0.0.1:55433/moneta_p2_verify with Bearer eyJhbGciOiJIUzI1NiJ9.payload",
  );
  const log = createStructuredLog(
    "error",
    "db.connection_error",
    {
      databaseUrl: "postgres://owner:super_secret_pw@127.0.0.1:55433/moneta_p2_verify",
      sessionToken: "raw-session-token-value",
      recoveryCode: "ABCD-EFGH-IJKL",
      safeMetric: 42,
      cause: rawError,
    },
    18.4,
  );

  const serialized = JSON.stringify(log);
  assert.ok(!serialized.includes("super_secret_pw"));
  assert.ok(!serialized.includes("raw-session-token-value"));
  assert.ok(!serialized.includes("ABCD-EFGH-IJKL"));
  assert.ok(!serialized.includes("eyJhbGciOiJIUzI1NiJ9"));
  assert.equal(log.durationMs, 18);
  assert.equal(log.context?.safeMetric, 42);
  assert.equal(log.context?.sessionToken, "[REDACTED]");
  assert.deepEqual(redactSensitiveData({ apiKey: "secret-key", count: 5n }), { apiKey: "[REDACTED]", count: "5" });
  assert.equal(
    redactSensitiveText("postgres://admin:myPass123@db.neon.tech/moneytor"),
    "postgres://[REDACTED]:[REDACTED]@db.neon.tech/moneytor",
  );
});

test("verifySnapshotIntegrity validates moneytor.export.v1 and rejects leaked auth fields or corrupted minor units", () => {
  const validSnapshot = {
    version: "moneytor.export.v1",
    exportedAt: "2026-10-22T01:00:00.000Z",
    catalogs: {
      currencies: [{ code: "IDR", name: "Rupiah", symbol: "Rp", exponent: 0 }],
      categories: [],
      assetGroups: [],
      assetTypes: [],
      providers: [],
      paymentNetworks: [],
      chargeTypes: [],
    },
    assets: [
      {
        id: "a1",
        displayName: "BCA Utama",
        currency: "IDR",
        exponent: 0,
        balanceMinor: "12500000",
      },
    ],
    activities: [
      {
        id: "act1",
        kind: "expense",
        currency: "IDR",
        exponent: 0,
        baseAmountMinor: "50000",
      },
    ],
    investments: {
      portfolios: [],
      instruments: [],
      holdings: [],
      trades: [],
      prices: [],
    },
    planning: {
      budgets: [],
      goals: [],
      reserves: [],
      obligations: [],
    },
    importBatches: [],
  };

  const okResult = verifySnapshotIntegrity(JSON.stringify(validSnapshot));
  assert.equal(okResult.valid, true);
  assert.equal(okResult.counts.assets, 1);
  assert.equal(okResult.counts.activities, 1);
  assert.equal(okResult.sha256.length, 64);

  // Reject snapshot with leaked auth credentials or float balanceMinor
  const badSnapshot = {
    ...validSnapshot,
    passkeys: [{ id: "leaked" }],
    assets: [{ id: "a1", balanceMinor: "12500.50" }],
  };
  const badResult = verifySnapshotIntegrity(badSnapshot);
  assert.equal(badResult.valid, false);
  assert.equal(badResult.errors.length, 2);
});
