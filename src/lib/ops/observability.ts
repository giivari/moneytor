const SENSITIVE_KEY_PATTERN =
  /password|secret|token|cookie|authorization|credential|recovery|api[_-]?key|database[_-]?url|private[_-]?key|session/i;

const CONNECTION_URL_PATTERN = /\b(postgres(?:ql)?):\/\/([^/\s:@]+):([^@\s/]+)@([^\s/]+)/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;

/**
 * Redacts credentials, tokens, secrets, and PostgreSQL connection passwords
 * from strings, Error objects, and nested metadata records before logging.
 */
export function redactSensitiveText(input: string): string {
  return input
    .replace(CONNECTION_URL_PATTERN, "$1://[REDACTED]:[REDACTED]@$4")
    .replace(BEARER_PATTERN, "$1[REDACTED]");
}

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactSensitiveData(entry, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export interface StructuredLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  event: string;
  durationMs?: number;
  context?: Record<string, unknown>;
}

export function createStructuredLog(
  level: "info" | "warn" | "error",
  event: string,
  context?: Record<string, unknown>,
  durationMs?: number,
): StructuredLogEntry {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
  };
  if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
    entry.durationMs = Math.max(0, Math.round(durationMs));
  }
  if (context && Object.keys(context).length > 0) {
    entry.context = redactSensitiveData(context) as Record<string, unknown>;
  }
  return entry;
}

