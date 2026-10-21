import { z } from "zod";

import { MAX_DROP_TOTAL_BYTES } from "@print-cess/protocol";

import { isDemoRouteEnabled } from "./demo";

export const SESSION_PROVIDERS = ["upstash-redis", "railway-redis", "railway-postgres"] as const;
export const BLOB_PROVIDERS = ["vercel-blob", "railway-s3"] as const;
export const CLEANUP_PROVIDERS = ["qstash", "railway-worker"] as const;

export type SessionProvider = (typeof SESSION_PROVIDERS)[number];
export type BlobProvider = (typeof BLOB_PROVIDERS)[number];
export type CleanupProvider = (typeof CLEANUP_PROVIDERS)[number];

const configSchema = z.object({
  mode: z.enum(["local", "external"]),
  sessionProvider: z.enum(SESSION_PROVIDERS).nullable(),
  blobProvider: z.enum(BLOB_PROVIDERS).nullable(),
  cleanupProvider: z.enum(CLEANUP_PROVIDERS).nullable(),
  publicBaseUrl: z.string().url(),
  allowedOrigins: z.array(z.string().url()).min(1),
  qrTtlMs: z.number().int().min(30_000).max(300_000),
  sessionTtlMs: z.number().int().min(30_000).max(300_000),
  signedUrlTtlMs: z.number().int().min(15_000).max(180_000),
  visitorTtlMs: z
    .number()
    .int()
    .min(60_000)
    .max(30 * 60_000),
  dropTtlMs: z
    .number()
    .int()
    .min(5 * 60_000)
    .max(24 * 60 * 60_000),
  dropMaxTotalBytes: z
    .number()
    .int()
    .min(16 * 1024 * 1024)
    .max(MAX_DROP_TOTAL_BYTES),
  demoEnabled: z.boolean(),
});

export type ServerConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const defaultOrigin = environment.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const mode =
    environment.PRINT_CESS_ADAPTER_MODE ??
    (environment.NODE_ENV === "production" ? "external" : "local");
  if (environment.NODE_ENV === "production" && mode !== "external") {
    throw new Error("Production must use the external Redis, Blob, and cleanup adapters");
  }

  const external = mode === "external";
  const sessionProvider = external
    ? selectProvider(environment, "PRINT_CESS_SESSION_PROVIDER", SESSION_PROVIDERS, "upstash-redis")
    : null;
  const blobProvider = external
    ? selectProvider(environment, "PRINT_CESS_BLOB_PROVIDER", BLOB_PROVIDERS, "vercel-blob")
    : null;
  const cleanupProvider = external
    ? selectProvider(environment, "PRINT_CESS_CLEANUP_PROVIDER", CLEANUP_PROVIDERS, "qstash")
    : null;

  const config = configSchema.parse({
    mode,
    sessionProvider,
    blobProvider,
    cleanupProvider,
    publicBaseUrl: defaultOrigin,
    allowedOrigins: (environment.ALLOWED_ORIGINS ?? defaultOrigin)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    qrTtlMs: Number(environment.QR_TTL_SECONDS ?? 120) * 1000,
    sessionTtlMs: Number(environment.SESSION_TTL_SECONDS ?? 180) * 1000,
    signedUrlTtlMs: Number(environment.SIGNED_URL_TTL_SECONDS ?? 120) * 1000,
    visitorTtlMs: Number(environment.VISITOR_TTL_SECONDS ?? 600) * 1000,
    dropTtlMs: Number(environment.DROP_TTL_SECONDS ?? 1800) * 1000,
    dropMaxTotalBytes: Number(environment.DROP_MAX_TOTAL_MB ?? 2048) * 1024 * 1024,
    demoEnabled: isDemoRouteEnabled(environment) || environment.NODE_ENV !== "production",
  });

  if (config.qrTtlMs > config.sessionTtlMs) {
    throw new Error("QR_TTL_SECONDS must not exceed SESSION_TTL_SECONDS");
  }

  if (environment.NODE_ENV === "production") {
    assertExactHttpsOrigin(config.publicBaseUrl, "PUBLIC_BASE_URL");
    for (const origin of config.allowedOrigins) assertExactHttpsOrigin(origin, "ALLOWED_ORIGINS");
    requireSecret(environment, "KIOSK_REGISTRATION_SECRET", 32);
    requireSecret(environment, "ADMIN_DIAGNOSTICS_SECRET", 32);
  }

  if (external) {
    assertSessionProvider(environment, sessionProvider);
    assertBlobProvider(environment, blobProvider);
    assertCleanupProvider(environment, cleanupProvider);
  }

  return config;
}

function selectProvider<T extends readonly string[]>(
  environment: NodeJS.ProcessEnv,
  name: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return raw as T[number];
}

function assertSessionProvider(
  environment: NodeJS.ProcessEnv,
  provider: SessionProvider | null,
): void {
  if (provider === "railway-redis") {
    assertTlsRedisUrl(environment, "REDIS_URL");
    return;
  }
  if (provider === "railway-postgres") {
    assertPostgresUrl(environment, "POSTGRES_URL");
    requirePemCertificate(environment, "POSTGRES_CA_CERT");
    return;
  }
  requireHttpsValue(
    environment.UPSTASH_REDIS_REST_URL ?? environment.KV_REST_API_URL,
    "UPSTASH_REDIS_REST_URL or KV_REST_API_URL",
  );
  requireSecretValue(
    environment.UPSTASH_REDIS_REST_TOKEN ?? environment.KV_REST_API_TOKEN,
    "UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN",
    20,
  );
}

function assertBlobProvider(environment: NodeJS.ProcessEnv, provider: BlobProvider | null): void {
  if (provider === "railway-s3") {
    requireHttpsUrl(environment, "S3_ENDPOINT");
    requirePresent(environment, "S3_REGION");
    requirePresent(environment, "S3_BUCKET");
    requireSecret(environment, "S3_ACCESS_KEY_ID", 1);
    requireSecret(environment, "S3_SECRET_ACCESS_KEY", 1);
    return;
  }
  requireSecret(environment, "BLOB_READ_WRITE_TOKEN", 20);
}

function assertCleanupProvider(
  environment: NodeJS.ProcessEnv,
  provider: CleanupProvider | null,
): void {
  if (provider === "railway-worker") {
    requireSecret(environment, "CLEANUP_WORKER_SECRET", 32);
    return;
  }
  requireSecret(environment, "QSTASH_TOKEN", 20);
  requireSecret(environment, "QSTASH_CURRENT_SIGNING_KEY", 20);
  requireSecret(environment, "QSTASH_NEXT_SIGNING_KEY", 20);
}

function assertExactHttpsOrigin(value: string, name: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || value !== url.origin) {
    throw new Error(`${name} must be an exact HTTPS origin without a path, query, or fragment`);
  }
}

function requireHttpsUrl(environment: NodeJS.ProcessEnv, name: string): void {
  requireHttpsValue(environment[name], name);
}

function requireHttpsValue(value: string | undefined, name: string): void {
  if (!value || new URL(value).protocol !== "https:") {
    throw new Error(`${name} must be configured with HTTPS in production`);
  }
}

function assertTlsRedisUrl(environment: NodeJS.ProcessEnv, name: string): void {
  const value = environment[name];
  if (!value) throw new Error(`${name} must be configured in external adapter mode`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid Redis connection URL`);
  }
  if (url.protocol !== "rediss:") {
    throw new Error(`${name} must use a TLS connection (rediss://) outside local development`);
  }
}

function assertPostgresUrl(environment: NodeJS.ProcessEnv, name: string): void {
  const value = environment[name];
  if (!value) throw new Error(`${name} must be configured in external adapter mode`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${name} must use the postgres:// or postgresql:// protocol`);
  }
  if (!url.hostname || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    throw new Error(`${name} must target a remote TLS-enabled PostgreSQL host`);
  }
}

function requirePresent(environment: NodeJS.ProcessEnv, name: string): void {
  if (!environment[name]) {
    throw new Error(`${name} must be configured in external adapter mode`);
  }
}

function requirePemCertificate(environment: NodeJS.ProcessEnv, name: string): void {
  const value = environment[name];
  if (
    !value ||
    !/^-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/=]+\n)+-----END CERTIFICATE-----\n?$/u.test(
      value,
    )
  ) {
    throw new Error(`${name} must contain one PEM-encoded certificate`);
  }
}

function requireSecret(environment: NodeJS.ProcessEnv, name: string, minimumLength: number): void {
  requireSecretValue(environment[name], name, minimumLength);
}

function requireSecretValue(value: string | undefined, name: string, minimumLength: number): void {
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} must contain at least ${minimumLength} characters in production`);
  }
}
