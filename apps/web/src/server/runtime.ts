import { generateToken, hashToken } from "@print-cess/crypto";
import {
  DROP_PROTOCOL_VERSION,
  MAX_ENVELOPE_BYTES,
  PROTOCOL_VERSION,
  dropPartPath,
  type DropRecord,
  type PrintSession,
} from "@print-cess/protocol";

import { LocalEncryptedBlobTransport } from "./blob/local";
import { S3BlobTransport } from "./blob/s3";
import { VercelBlobTransport } from "./blob/vercel";
import { InProcessCleanupScheduler } from "./cleanup/in-process";
import { PersistentSweepCleanupScheduler } from "./cleanup/persistent-sweep";
import { QStashCleanupScheduler } from "./cleanup/qstash";
import { loadConfig, type ServerConfig } from "./config";
import type {
  BlobTransport,
  CleanupScheduler,
  DropStore,
  PairingStore,
  SessionStore,
} from "./contracts";
import { MemoryDropStore } from "./drop-store/memory";
import { MemoryPairingStore } from "./pairing-store/memory";
import { RedisPairingStore } from "./pairing-store/redis";
import { RailwayPostgresPairingStore } from "./pairing-store/postgres";
import { RailwayPostgresDropStore } from "./drop-store/postgres";
import { RedisDropStore } from "./drop-store/redis";
import { UpstashScriptClient } from "./drop-store/upstash-client";
import { MemorySessionStore } from "./session-store/memory";
import { RailwayPostgresSessionStore } from "./session-store/postgres";
import { createNodeRedisScriptClient } from "./session-store/redis-client";
import { RailwayRedisSessionStore } from "./session-store/redis";
import { UpstashSessionStore } from "./session-store/upstash";
import { ServiceError } from "./errors";

/** Retention past expiry, so a sweep still finds the parts it has to delete. */
const DROP_RETENTION_MS = 10 * 60_000;

export type ServerRuntime = {
  config: ServerConfig;
  sessions: SessionStore;
  drops: DropStore;
  pairings: PairingStore;
  blobs: BlobTransport;
  cleanup: CleanupScheduler;
};

declare global {
  var __printCessRuntime: ServerRuntime | undefined;
}

export function getRuntime(): ServerRuntime {
  if (globalThis.__printCessRuntime) return globalThis.__printCessRuntime;
  const config = loadConfig();
  let runtime: ServerRuntime;
  if (config.mode === "external") {
    const sessions: SessionStore =
      config.sessionProvider === "railway-redis"
        ? new RailwayRedisSessionStore()
        : config.sessionProvider === "railway-postgres"
          ? new RailwayPostgresSessionStore()
          : new UpstashSessionStore();
    const drops: DropStore =
      config.sessionProvider === "railway-redis"
        ? new RedisDropStore(createNodeRedisScriptClient())
        : config.sessionProvider === "railway-postgres"
          ? new RailwayPostgresDropStore()
          : new RedisDropStore(new UpstashScriptClient());
    const pairings: PairingStore =
      config.sessionProvider === "railway-redis"
        ? new RedisPairingStore(createNodeRedisScriptClient())
        : config.sessionProvider === "railway-postgres"
          ? new RailwayPostgresPairingStore()
          : new RedisPairingStore(new UpstashScriptClient());
    const blobs: BlobTransport =
      config.blobProvider === "railway-s3" ? new S3BlobTransport() : new VercelBlobTransport();
    const cleanup: CleanupScheduler =
      config.cleanupProvider === "railway-worker"
        ? new PersistentSweepCleanupScheduler()
        : new QStashCleanupScheduler(`${config.publicBaseUrl}/api/cleanup`);
    runtime = { config, sessions, drops, pairings, blobs, cleanup };
  } else {
    const sessions = new MemorySessionStore();
    const drops = new MemoryDropStore();
    const pairings = new MemoryPairingStore();
    const blobs = new LocalEncryptedBlobTransport(config.publicBaseUrl);
    const cleanup = new InProcessCleanupScheduler(async (sessionId) => {
      await cleanupSession(runtime, sessionId);
    });
    runtime = { config, sessions, drops, pairings, blobs, cleanup };
  }
  globalThis.__printCessRuntime = runtime;
  return runtime;
}

export async function createPrintSession(input: {
  kioskPublicKey: string;
  kioskPublicKeyFingerprint: string;
}): Promise<{ session: PrintSession; uploadToken: string; kioskToken: string }> {
  const runtime = getRuntime();
  const now = Date.now();
  const sessionId = generateToken(16);
  const uploadToken = generateToken(32);
  const kioskToken = generateToken(32);
  const session: PrintSession = {
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    status: "waiting",
    kioskPublicKey: input.kioskPublicKey,
    kioskPublicKeyFingerprint: input.kioskPublicKeyFingerprint,
    createdAt: now,
    expiresAt: now + runtime.config.qrTtlMs,
    uploadTokenHash: await hashToken(uploadToken, "upload"),
    kioskTokenHash: await hashToken(kioskToken, "kiosk"),
    revision: 0,
  };
  await runtime.sessions.create(session, runtime.config.qrTtlMs);
  return { session, uploadToken, kioskToken };
}

/**
 * Mints a visitor (government-counter) print session. This is the same state
 * machine as {@link createPrintSession} — QR → claim → upload → kiosk print →
 * cleanup — but the QR and the uploaded file live under the dedicated,
 * configurable visitor TTL instead of the public QR window. Session-expiry
 * cleanup still deletes the orphaned encrypted blob once `expiresAt` passes,
 * so an abandoned counter session can never pin a visitor's file on the
 * server past its lifetime.
 */
export async function createVisitorPrintSession(input: {
  kioskPublicKey: string;
  kioskPublicKeyFingerprint: string;
}): Promise<{ session: PrintSession; uploadToken: string; kioskToken: string }> {
  const runtime = getRuntime();
  const now = Date.now();
  const sessionId = generateToken(16);
  const uploadToken = generateToken(32);
  const kioskToken = generateToken(32);
  const session: PrintSession = {
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    status: "waiting",
    kioskPublicKey: input.kioskPublicKey,
    kioskPublicKeyFingerprint: input.kioskPublicKeyFingerprint,
    createdAt: now,
    expiresAt: now + runtime.config.visitorTtlMs,
    uploadTokenHash: await hashToken(uploadToken, "upload"),
    kioskTokenHash: await hashToken(kioskToken, "kiosk"),
    revision: 0,
  };
  await runtime.sessions.create(session, runtime.config.visitorTtlMs);
  return { session, uploadToken, kioskToken };
}

export function createBlobPath(): string {
  return `v1/${generateToken(16)}.bin`;
}

export function signedExpiry(config: ServerConfig, sessionExpiresAt: number): number {
  return Math.min(sessionExpiresAt, Date.now() + config.signedUrlTtlMs);
}

export type CleanupSessionResult = "absent" | "deferred" | "deleted";

export async function cleanupSession(
  runtime: ServerRuntime,
  sessionId: string,
  now = Date.now(),
): Promise<CleanupSessionResult> {
  const preparation = await runtime.sessions.prepareCleanup(sessionId, now);
  if (preparation.action === "absent") return "absent";
  if (preparation.action === "defer") {
    await runtime.cleanup.schedule(sessionId, preparation.retryAt);
    return "deferred";
  }

  if (preparation.orphan) {
    await runtime.blobs.delete(preparation.orphan.pathname, preparation.orphan.etag);
  }
  await runtime.sessions.putReceipt({
    protocolVersion: 1,
    sessionId,
    status: preparation.receiptStatus,
    expiresAt: now + 15_000,
  });
  const finalized = await runtime.sessions.finalizeCleanup(
    sessionId,
    preparation.sealedRevision,
    preparation.orphan?.pathname ?? null,
  );
  if (!finalized) {
    throw new ServiceError("conflict", "Cleanup state changed before it could be finalized.", 409);
  }
  return "deleted";
}

export async function createDrop(input: {
  dropId: string;
  ownerTokenHash: string;
  manifest: string;
  fileCount: number;
  partCount: number;
  totalBytes: number;
}): Promise<DropRecord> {
  const runtime = getRuntime();
  const now = Date.now();
  const drop: DropRecord = {
    protocolVersion: DROP_PROTOCOL_VERSION,
    dropId: input.dropId,
    status: "collecting",
    ownerTokenHash: input.ownerTokenHash,
    manifest: input.manifest,
    fileCount: input.fileCount,
    partCount: input.partCount,
    totalBytes: input.totalBytes,
    parts: Array.from({ length: input.partCount }, () => null),
    totalCiphertextBytes: 0,
    openCount: 0,
    downloadCount: 0,
    deliveredCount: 0,
    createdAt: now,
    expiresAt: now + runtime.config.dropTtlMs,
    revision: 0,
  };
  await runtime.drops.create(drop, DROP_RETENTION_MS);
  return drop;
}

/**
 * Deletes every part a drop ever authorized, then the record. Part paths are
 * derived from the identifier rather than stored, so a record that was written
 * before a crash still names all of its ciphertext.
 */
export async function deleteDrop(runtime: ServerRuntime, drop: DropRecord): Promise<void> {
  for (let index = 0; index < drop.partCount; index += 1) {
    const part = drop.parts[index];
    try {
      await runtime.blobs.delete(dropPartPath(drop.dropId, index));
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) continue;
      if (!part) continue;
      throw error;
    }
  }
  await runtime.drops.remove(drop.dropId);
}

export type DropSweepResult = { attempted: number; deleted: number; failed: number };

export async function sweepExpiredDrops(
  runtime: ServerRuntime,
  now = Date.now(),
  limit = 5,
): Promise<DropSweepResult> {
  const expired = await runtime.drops.listExpired(now, limit);
  const result: DropSweepResult = { attempted: expired.length, deleted: 0, failed: 0 };
  for (const drop of expired) {
    try {
      await deleteDrop(runtime, drop);
      result.deleted += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export type OrphanSweepResult = {
  attempted: number;
  deleted: number;
  deferred: number;
  failed: number;
};

export async function sweepDueOrphans(
  runtime: ServerRuntime,
  now = Date.now(),
  limit = 10,
): Promise<OrphanSweepResult> {
  const due = await runtime.sessions.listDueOrphans(now, limit);
  const result: OrphanSweepResult = { attempted: due.length, deleted: 0, deferred: 0, failed: 0 };
  for (const orphan of due) {
    try {
      const outcome = await cleanupSession(runtime, orphan.sessionId, now);
      if (outcome === "deleted" || outcome === "absent") result.deleted += 1;
      else result.deferred += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export { MAX_ENVELOPE_BYTES };
