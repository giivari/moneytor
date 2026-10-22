export interface EnvironmentCheckItem {
  key: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface ProductionReadinessReport {
  ready: boolean;
  mode: "production" | "development" | "test";
  checks: EnvironmentCheckItem[];
}

const MAINTENANCE_DATABASES = new Set(["postgres", "template0", "template1"]);

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

/**
 * Validates runtime configuration for security, WebAuthn RP/Origin alignment,
 * PostgreSQL target safety, and free-tier serverless pool constraints.
 * Never includes raw secret values or connection passwords in output messages.
 */
export function validateProductionEnvironment(
  env: Record<string, string | undefined>,
  options?: { ownerInitialized?: boolean },
): ProductionReadinessReport {
  const rawMode = env.NODE_ENV ?? "development";
  const mode: "production" | "development" | "test" =
    rawMode === "production" || rawMode === "test" ? rawMode : "development";
  const isProd = mode === "production";
  const checks: EnvironmentCheckItem[] = [];

  // 1. DATABASE_URL / POSTGRES_URL check
  const dbUrlRaw = (env.DATABASE_URL ?? env.POSTGRES_URL ?? "").trim();
  if (!dbUrlRaw) {
    checks.push({
      key: "DATABASE_URL",
      status: "fail",
      message: "DATABASE_URL belum dikonfigurasi.",
    });
  } else {
    try {
      const parsed = new URL(dbUrlRaw);
      if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
        checks.push({
          key: "DATABASE_URL",
          status: "fail",
          message: "DATABASE_URL harus menggunakan protokol postgres:// atau postgresql://.",
        });
      } else {
        const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
        if (!dbName || MAINTENANCE_DATABASES.has(dbName)) {
          checks.push({
            key: "DATABASE_URL",
            status: "fail",
            message: "DATABASE_URL harus menunjuk ke database aplikasi bernama khusus, bukan database maintenance.",
          });
        } else {
          const sslMode = parsed.searchParams.get("sslmode") ?? env.MONETA_DB_SSL ?? "";
          const remoteHost = !isLoopbackHost(parsed.hostname);
          if (isProd && remoteHost && sslMode !== "require" && sslMode !== "verify-full" && sslMode !== "true") {
            checks.push({
              key: "DATABASE_URL",
              status: "warn",
              message:
                "Koneksi PostgreSQL produksi ke host eksternal disarankan mengaktifkan TLS (sslmode=require atau MONETA_DB_SSL=require).",
            });
          } else {
            checks.push({
              key: "DATABASE_URL",
              status: "pass",
              message: `Target database aplikasi tervalidasi (${ remoteHost ? "remote host" : "loopback" }).`,
            });
          }
        }
      }
    } catch {
      checks.push({
        key: "DATABASE_URL",
        status: "fail",
        message: "Format URL pada DATABASE_URL tidak valid.",
      });
    }
  }

  // 2. MONETA_ORIGIN & MONETA_RP_ID check
  const originRaw = env.MONETA_ORIGIN?.trim() ?? "";
  const rpIdRaw = env.MONETA_RP_ID?.trim() ?? "";
  if (!originRaw || !rpIdRaw) {
    checks.push({
      key: "WEBAUTHN_ORIGIN_RP",
      status: "fail",
      message: "MONETA_ORIGIN dan MONETA_RP_ID wajib dikonfigurasi untuk keamanan WebAuthn.",
    });
  } else {
    try {
      const url = new URL(originRaw);
      const canonicalOrigin = `${url.protocol}//${url.host}`;
      if (originRaw !== canonicalOrigin || url.pathname !== "/" || url.search || url.hash) {
        checks.push({
          key: "WEBAUTHN_ORIGIN_RP",
          status: "fail",
          message: "MONETA_ORIGIN harus berupa origin kanonik murni tanpa path, query, atau fragment.",
        });
      } else if (url.hostname !== rpIdRaw) {
        checks.push({
          key: "WEBAUTHN_ORIGIN_RP",
          status: "fail",
          message: "Hostname pada MONETA_ORIGIN harus sama persis dengan MONETA_RP_ID.",
        });
      } else if (isProd && url.protocol !== "https:") {
        checks.push({
          key: "WEBAUTHN_ORIGIN_RP",
          status: "fail",
          message: "Lingkungan produksi wajib menggunakan origin HTTPS untuk WebAuthn dan cookie __Host-.",
        });
      } else if (!isProd && url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
        checks.push({
          key: "WEBAUTHN_ORIGIN_RP",
          status: "fail",
          message: "Origin HTTP non-HTTPS hanya diizinkan pada host loopback (localhost / 127.0.0.1).",
        });
      } else {
        checks.push({
          key: "WEBAUTHN_ORIGIN_RP",
          status: "pass",
          message: `Origin WebAuthn (${url.protocol}//${url.host}) dan RP ID (${rpIdRaw}) selaras.`,
        });
      }
    } catch {
      checks.push({
        key: "WEBAUTHN_ORIGIN_RP",
        status: "fail",
        message: "MONETA_ORIGIN bukan URL yang valid.",
      });
    }
  }

  // 3. MONETA_BOOTSTRAP_SECRET lifecycle hygiene
  const hasBootstrapSecret = Boolean(env.MONETA_BOOTSTRAP_SECRET?.trim());
  if (options?.ownerInitialized === true && hasBootstrapSecret) {
    checks.push({
      key: "BOOTSTRAP_SECRET_HYGIENE",
      status: "warn",
      message:
        "Owner sudah terinisialisasi; hapus MONETA_BOOTSTRAP_SECRET dari environment sesuai prosedur keamanan P2.",
    });
  } else if (options?.ownerInitialized === false && !hasBootstrapSecret) {
    checks.push({
      key: "BOOTSTRAP_SECRET_HYGIENE",
      status: "warn",
      message: "Owner belum diinisialisasi dan MONETA_BOOTSTRAP_SECRET belum disetel untuk pendaftaran awal.",
    });
  } else {
    checks.push({
      key: "BOOTSTRAP_SECRET_HYGIENE",
      status: "pass",
      message: "Konfigurasi siklus hidup MONETA_BOOTSTRAP_SECRET sesuai.",
    });
  }

  // 4. Connection pool sizing for free-tier PostgreSQL
  const poolMaxRaw = env.MONETA_DB_POOL_MAX?.trim();
  if (poolMaxRaw) {
    const parsedMax = Number(poolMaxRaw);
    if (!Number.isInteger(parsedMax) || parsedMax < 1 || parsedMax > 25) {
      checks.push({
        key: "DB_POOL_LIMIT",
        status: "fail",
        message: "MONETA_DB_POOL_MAX harus berupa bilangan bulat antara 1 hingga 25.",
      });
    } else if (parsedMax > 10) {
      checks.push({
        key: "DB_POOL_LIMIT",
        status: "warn",
        message: `MONETA_DB_POOL_MAX=${parsedMax} cukup tinggi untuk PostgreSQL free-tier; disarankan 2–5 koneksi.`,
      });
    } else {
      checks.push({
        key: "DB_POOL_LIMIT",
        status: "pass",
        message: `Batas pool koneksi database (${parsedMax}) ramah untuk deployment free-tier.`,
      });
    }
  } else {
    checks.push({
      key: "DB_POOL_LIMIT",
      status: "pass",
      message: "Batas pool koneksi database menggunakan default hemat koneksi (max 5).",
    });
  }

  const ready = checks.every((item) => item.status !== "fail");
  return { ready, mode, checks };
}

