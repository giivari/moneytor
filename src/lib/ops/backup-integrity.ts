import { createHash } from "node:crypto";

export interface SnapshotVerificationResult {
  valid: boolean;
  schemaVersion: string | null;
  sha256: string;
  counts: {
    assets: number;
    activities: number;
    holdings: number;
    budgets: number;
    goals: number;
    reserves: number;
    obligations: number;
    importBatches: number;
  };
  errors: string[];
}

const FORBIDDEN_SNAPSHOT_KEYS = new Set([
  "sessions",
  "owner_sessions",
  "passkeys",
  "credentials",
  "owner_credentials",
  "recovery_codes",
  "owner_recovery_codes",
  "bootstrap_secret",
]);

/**
 * Verifies the structural and accounting integrity of a portable JSON backup
 * (`moneytor.export.v1`) during backup & recovery drills.
 * Ensures no session/passkey secrets are present and all monetary fields are valid integer strings.
 */
export function verifySnapshotIntegrity(rawJson: string | Record<string, unknown>): SnapshotVerificationResult {
  const serialized = typeof rawJson === "string" ? rawJson : JSON.stringify(rawJson);
  const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
  const errors: string[] = [];

  let parsed: Record<string, unknown>;
  try {
    parsed = (typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson) as Record<string, unknown>;
  } catch {
    return {
      valid: false,
      schemaVersion: null,
      sha256,
      counts: {
        assets: 0,
        activities: 0,
        holdings: 0,
        budgets: 0,
        goals: 0,
        reserves: 0,
        obligations: 0,
        importBatches: 0,
      },
      errors: ["Payload cadangan bukan dokumen JSON yang valid."],
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      valid: false,
      schemaVersion: null,
      sha256,
      counts: {
        assets: 0,
        activities: 0,
        holdings: 0,
        budgets: 0,
        goals: 0,
        reserves: 0,
        obligations: 0,
        importBatches: 0,
      },
      errors: ["Root dokumen snapshot harus berupa objek JSON."],
    };
  }

  // Ensure no secret/auth tables leaked into backup
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_SNAPSHOT_KEYS.has(key.toLowerCase())) {
      errors.push(`Data sensitif autentikasi (${key}) tidak boleh ada di dalam snapshot ekspor.`);
    }
  }

  const schemaVersion = typeof parsed.version === "string" ? parsed.version : null;
  if (schemaVersion !== "moneytor.export.v1") {
    errors.push(`Versi skema snapshot tidak didukung: ${schemaVersion ?? "kosong"}.`);
  }

  if (typeof parsed.exportedAt !== "string" || Number.isNaN(Date.parse(parsed.exportedAt))) {
    errors.push("Timestamp exportedAt pada snapshot tidak valid.");
  }

  const assets = Array.isArray(parsed.assets) ? parsed.assets : null;
  const activities = Array.isArray(parsed.activities) ? parsed.activities : null;
  const investments =
    parsed.investments && typeof parsed.investments === "object" && !Array.isArray(parsed.investments)
      ? (parsed.investments as Record<string, unknown>)
      : null;
  const planning =
    parsed.planning && typeof parsed.planning === "object" && !Array.isArray(parsed.planning)
      ? (parsed.planning as Record<string, unknown>)
      : null;
  const importBatches = Array.isArray(parsed.importBatches) ? parsed.importBatches : null;

  if (!assets) errors.push("Koleksi assets tidak ditemukan atau bukan array.");
  if (!activities) errors.push("Koleksi activities tidak ditemukan atau bukan array.");
  if (!investments || !Array.isArray(investments.holdings) || !Array.isArray(investments.trades)) {
    errors.push("Koleksi investments (holdings & trades) tidak lengkap.");
  }
  if (
    !planning ||
    !Array.isArray(planning.budgets) ||
    !Array.isArray(planning.goals) ||
    !Array.isArray(planning.reserves) ||
    !Array.isArray(planning.obligations)
  ) {
    errors.push("Koleksi planning (budgets, goals, reserves, obligations) tidak lengkap.");
  }
  if (!importBatches) errors.push("Koleksi importBatches tidak ditemukan atau bukan array.");

  // Validate exact integer minor-unit representations on assets and activities
  if (assets) {
    for (let i = 0; i < assets.length; i++) {
      const row = assets[i] as Record<string, unknown>;
      if (typeof row?.balanceMinor !== "string" || !/^-?\d+$/.test(row.balanceMinor)) {
        errors.push(`Asset indeks ${i} memiliki balanceMinor yang bukan bilangan bulat eksak.`);
        break;
      }
    }
  }

  if (activities) {
    for (let i = 0; i < activities.length; i++) {
      const row = activities[i] as Record<string, unknown>;
      if (typeof row?.baseAmountMinor !== "string" || !/^-?\d+$/.test(row.baseAmountMinor)) {
        errors.push(`Activity indeks ${i} memiliki baseAmountMinor yang bukan bilangan bulat eksak.`);
        break;
      }
    }
  }

  const holdings = investments && Array.isArray(investments.holdings) ? investments.holdings : [];
  const budgets = planning && Array.isArray(planning.budgets) ? planning.budgets : [];
  const goals = planning && Array.isArray(planning.goals) ? planning.goals : [];
  const reserves = planning && Array.isArray(planning.reserves) ? planning.reserves : [];
  const obligations = planning && Array.isArray(planning.obligations) ? planning.obligations : [];

  return {
    valid: errors.length === 0,
    schemaVersion,
    sha256,
    counts: {
      assets: assets?.length ?? 0,
      activities: activities?.length ?? 0,
      holdings: holdings.length,
      budgets: budgets.length,
      goals: goals.length,
      reserves: reserves.length,
      obligations: obligations.length,
      importBatches: importBatches?.length ?? 0,
    },
    errors,
  };
}
