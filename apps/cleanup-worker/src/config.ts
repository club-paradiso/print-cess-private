export type WorkerConfig = {
  endpoint: string;
  secret: string;
  vercelProtectionBypass: string | null;
  intervalMs: number;
  batchSize: number;
  requestTimeoutMs: number;
  maxBackoffMs: number;
};

export const MAX_BACKOFF_MS = 60_000;
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MINIMUM_SECRET_LENGTH = 32;

export function parseWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const endpoint = environment.CLEANUP_ENDPOINT;
  if (!endpoint) throw new Error("CLEANUP_ENDPOINT is required");
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("CLEANUP_ENDPOINT must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("CLEANUP_ENDPOINT must use HTTPS");
  }
  if (parsed.pathname !== "/api/cleanup" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("CLEANUP_ENDPOINT must target the exact /api/cleanup path with no query");
  }

  const secret = environment.CLEANUP_WORKER_SECRET ?? "";
  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error("CLEANUP_WORKER_SECRET must contain at least 32 characters");
  }

  return {
    endpoint,
    secret,
    vercelProtectionBypass: readOptionalSecret(
      environment.VERCEL_AUTOMATION_BYPASS_SECRET,
      "VERCEL_AUTOMATION_BYPASS_SECRET",
    ),
    intervalMs: readPositiveInt(environment.CLEANUP_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    batchSize: readBoundedInt(environment.CLEANUP_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 100),
    requestTimeoutMs: readPositiveInt(
      environment.CLEANUP_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    maxBackoffMs: MAX_BACKOFF_MS,
  };
}

function readOptionalSecret(raw: string | undefined, name: string): string | null {
  if (raw === undefined || raw === "") return null;
  if (/[\r\n]/u.test(raw)) {
    throw new Error(`${name} must not contain line breaks`);
  }
  return raw;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer but received "${raw}"`);
  }
  return value;
}

function readBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected an integer in [${min}, ${max}] but received "${raw}"`);
  }
  return value;
}
