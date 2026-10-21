import { timingSafeEqualBase64Url } from "@print-cess/crypto";
import {
  ENCRYPTED_BLOB_PATH_PATTERN,
  SESSION_ID_PATTERN,
  assertTransition,
  printSessionSchema,
  type PrintSession,
  type PrintSessionStatus,
} from "@print-cess/protocol";
import { z } from "zod";

import type {
  BlobOrphanRecord,
  CleanupPreparation,
  SessionReceipt,
  SessionStore,
  UploadAuthorizationResult,
} from "../contracts";
import { ServiceError } from "../errors";
import { createNodeRedisScriptClient, type RedisScriptClient } from "./redis-client";

const CLEANUP_RETENTION_MS = 5 * 60_000;
const PROCESSING_LEASE_MS = 2 * 60_000;
const PROCESSING_STATUSES = new Set<PrintSessionStatus>(["consumed", "validating", "printing"]);
const ORPHAN_DUE_KEY = "pc:v1:orphans:due";

const blobOrphanSchema = z
  .object({
    protocolVersion: z.literal(1),
    sessionId: z.string().regex(SESSION_ID_PATTERN),
    pathname: z.string().regex(ENCRYPTED_BLOB_PATH_PATTERN),
    etag: z.string().min(1).max(256).optional(),
    createdAt: z.number().int().nonnegative(),
    dueAt: z.number().int().positive(),
  })
  .strict();
const sessionReceiptSchema = z
  .object({
    protocolVersion: z.literal(1),
    sessionId: z.string().regex(SESSION_ID_PATTERN),
    status: z.enum(["completed", "failed", "expired", "cancelled"]),
    expiresAt: z.number().int().positive(),
  })
  .strict();

const CREATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`;

const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if tonumber(decoded.revision) ~= tonumber(ARGV[1]) then return -1 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

const AUTHORIZE_UPLOAD_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if tonumber(decoded.revision) ~= tonumber(ARGV[1]) then return -1 end
if redis.call('EXISTS', KEYS[2]) == 1 then return -2 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[4])
redis.call('ZADD', KEYS[3], ARGV[5], ARGV[6])
return 1
`;

const COMMIT_UPLOAD_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if tonumber(decoded.revision) ~= tonumber(ARGV[1]) then return -1 end

local orphanRaw = redis.call('GET', KEYS[2])
local orphan
if orphanRaw then
  orphan = cjson.decode(orphanRaw)
  if orphan.pathname ~= ARGV[4] then return -2 end
else
  orphan = cjson.decode(ARGV[6])
end
orphan.etag = ARGV[5]

redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('SET', KEYS[2], cjson.encode(orphan))
redis.call('ZADD', KEYS[3], ARGV[7], ARGV[8])
return 1
`;

const PREPARE_CLEANUP_SCRIPT = `
local now = tonumber(ARGV[1])
local retention = tonumber(ARGV[2])
local sessionId = ARGV[3]
local currentRaw = redis.call('GET', KEYS[1])
local orphanRaw = redis.call('GET', KEYS[2])
local orphan = nil
if orphanRaw then orphan = cjson.decode(orphanRaw) end

if not currentRaw then
  if not orphan then
    redis.call('ZREM', KEYS[3], sessionId)
    return cjson.encode({ action = 'absent' })
  end
  return cjson.encode({
    action = 'delete',
    orphan = orphan,
    receiptStatus = 'expired',
    sealedRevision = cjson.null
  })
end

local session = cjson.decode(currentRaw)
if orphan and session.encryptedBlobPath and orphan.pathname ~= session.encryptedBlobPath then
  return cjson.encode({ action = 'conflict' })
end
if not orphan and session.encryptedBlobPath then
  orphan = {
    protocolVersion = 1,
    sessionId = sessionId,
    pathname = session.encryptedBlobPath,
    createdAt = now,
    dueAt = math.max(now, tonumber(session.expiresAt))
  }
  if session.encryptedBlobEtag then orphan.etag = session.encryptedBlobEtag end
  redis.call('SET', KEYS[2], cjson.encode(orphan))
  redis.call('ZADD', KEYS[3], orphan.dueAt, sessionId)
end

local terminal = session.status == 'completed' or session.status == 'failed' or session.status == 'expired' or session.status == 'cancelled'
if not terminal then
  local lease = 0
  if session.status == 'consumed' or session.status == 'validating' or session.status == 'printing' then
    lease = tonumber(session.consumeLeaseExpiresAt or 0)
  end
  local retryAt = math.max(tonumber(session.expiresAt), lease)
  if retryAt > now then
    if orphan then
      orphan.dueAt = retryAt
      redis.call('SET', KEYS[2], cjson.encode(orphan))
      redis.call('ZADD', KEYS[3], retryAt, sessionId)
    end
    return cjson.encode({ action = 'defer', retryAt = retryAt })
  end

  if session.status == 'validating' or session.status == 'printing' then
    session.status = 'failed'
  else
    session.status = 'expired'
  end
  session.revision = tonumber(session.revision) + 1
  redis.call('SET', KEYS[1], cjson.encode(session), 'PX', retention)
else
  redis.call('PEXPIRE', KEYS[1], retention)
end

return cjson.encode({
  action = 'delete',
  orphan = orphan or cjson.null,
  receiptStatus = session.status,
  sealedRevision = tonumber(session.revision)
})
`;

const FINALIZE_CLEANUP_SCRIPT = `
local currentRaw = redis.call('GET', KEYS[1])
local expectedRevision = ARGV[2]
if currentRaw then
  if expectedRevision == '' then return 0 end
  local session = cjson.decode(currentRaw)
  if tonumber(session.revision) ~= tonumber(expectedRevision) then return 0 end
  local terminal = session.status == 'completed' or session.status == 'failed' or session.status == 'expired' or session.status == 'cancelled'
  if not terminal then return 0 end
end

local orphanRaw = redis.call('GET', KEYS[2])
local expectedPathname = ARGV[3]
if orphanRaw then
  local orphan = cjson.decode(orphanRaw)
  if expectedPathname == '' or orphan.pathname ~= expectedPathname then return 0 end
elseif expectedPathname ~= '' and currentRaw then
  return 0
end

redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('ZREM', KEYS[3], ARGV[1])
return 1
`;

/**
 * Railway (or any standard) Redis-backed session store. The concrete Redis
 * transport is injected through {@link RedisScriptClient} so the store can be
 * unit tested without a live server; the default transport is a TLS-only
 * node-redis client built from `REDIS_URL`.
 */
export class RailwayRedisSessionStore implements SessionStore {
  readonly #redis: RedisScriptClient;

  public constructor(client?: RedisScriptClient, environment: NodeJS.ProcessEnv = process.env) {
    this.#redis = client ?? createNodeRedisScriptClient(environment);
  }

  public async create(session: PrintSession, ttlMs: number): Promise<void> {
    const result = toInteger(
      await this.#redis.eval(
        CREATE_SCRIPT,
        [sessionKey(session.sessionId), orphanKey(session.sessionId)],
        [JSON.stringify(session), ttlMs + CLEANUP_RETENTION_MS],
      ),
    );
    if (result !== 1)
      throw new ServiceError("conflict", "A session with this identifier already exists.", 409);
  }

  public async get(sessionId: string): Promise<PrintSession | null> {
    const raw = await this.#redis.get(sessionKey(sessionId));
    return raw ? printSessionSchema.parse(deserialize(raw)) : null;
  }

  public async claim(
    sessionId: string,
    uploadTokenHash: string,
    mobileTokenHash: string,
    claimIdHash: string,
    now: number,
    ttlMs: number,
  ): Promise<PrintSession> {
    return this.mutate(sessionId, now, (session) => {
      requireHash(session.uploadTokenHash, uploadTokenHash);
      if (session.status === "claimed") {
        if (
          same(session.claimIdHash, claimIdHash) &&
          same(session.mobileTokenHash, mobileTokenHash)
        )
          return session;
        throw new ServiceError("conflict", "This QR code has already been claimed.", 409);
      }
      assertTransition(session.status, "claimed");
      return {
        ...session,
        status: "claimed",
        mobileTokenHash,
        claimIdHash,
        claimedAt: now,
        expiresAt: now + ttlMs,
        revision: session.revision + 1,
      };
    });
  }

  public async authorizeUpload(
    sessionId: string,
    mobileTokenHash: string,
    operationIdHash: string,
    blobPath: string,
    now: number,
    cleanupDueAt: number,
  ): Promise<UploadAuthorizationResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.requireMutableSession(sessionId, now);
      requireHash(current.mobileTokenHash, mobileTokenHash);
      if (current.status === "upload_authorized") {
        if (same(current.uploadOperationIdHash, operationIdHash)) {
          return { session: structuredClone(current), newlyAuthorized: false };
        }
        throw new ServiceError("conflict", "Upload authorization has already been used.", 409);
      }
      assertTransition(current.status, "upload_authorized");
      const next: PrintSession = {
        ...current,
        status: "upload_authorized",
        encryptedBlobPath: blobPath,
        uploadOperationIdHash: operationIdHash,
        revision: current.revision + 1,
      };
      const orphan: BlobOrphanRecord = {
        protocolVersion: 1,
        sessionId,
        pathname: blobPath,
        createdAt: now,
        dueAt: cleanupDueAt,
      };
      const result = toInteger(
        await this.#redis.eval(
          AUTHORIZE_UPLOAD_SCRIPT,
          [sessionKey(sessionId), orphanKey(sessionId), ORPHAN_DUE_KEY],
          [
            current.revision,
            JSON.stringify(next),
            retentionMs(next, now),
            JSON.stringify(orphan),
            cleanupDueAt,
            sessionId,
          ],
        ),
      );
      if (result === 1) return { session: next, newlyAuthorized: true };
      if (result === 0)
        throw new ServiceError("not_found", "The print session was not found.", 404);
      if (result === -2)
        throw new ServiceError("conflict", "Encrypted blob cleanup tracking already exists.", 409);
    }
    throw concurrentChange();
  }

  public async markUploading(
    sessionId: string,
    mobileTokenHash: string,
    now: number,
  ): Promise<PrintSession> {
    return this.mutate(sessionId, now, (session) => {
      requireHash(session.mobileTokenHash, mobileTokenHash);
      if (session.status === "uploading") return session;
      assertTransition(session.status, "uploading");
      return { ...session, status: "uploading", revision: session.revision + 1 };
    });
  }

  public async markUploaded(
    sessionId: string,
    mobileTokenHash: string,
    metadata: { etag: string; size: number },
    now: number,
  ): Promise<PrintSession> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.requireMutableSession(sessionId, now);
      requireHash(current.mobileTokenHash, mobileTokenHash);
      if (current.status === "uploaded") {
        if (
          current.encryptedBlobEtag === metadata.etag &&
          current.encryptedBlobSize === metadata.size
        )
          return current;
        throw new ServiceError("conflict", "A different upload has already been committed.", 409);
      }
      assertTransition(current.status, "uploaded");
      if (!current.encryptedBlobPath) {
        throw new ServiceError("conflict", "The encrypted upload path is missing.", 409);
      }
      const next: PrintSession = {
        ...current,
        status: "uploaded",
        encryptedBlobEtag: metadata.etag,
        encryptedBlobSize: metadata.size,
        revision: current.revision + 1,
      };
      const fallbackOrphan: BlobOrphanRecord = {
        protocolVersion: 1,
        sessionId,
        pathname: current.encryptedBlobPath,
        etag: metadata.etag,
        createdAt: now,
        dueAt: current.expiresAt,
      };
      const result = toInteger(
        await this.#redis.eval(
          COMMIT_UPLOAD_SCRIPT,
          [sessionKey(sessionId), orphanKey(sessionId), ORPHAN_DUE_KEY],
          [
            current.revision,
            JSON.stringify(next),
            retentionMs(next, now),
            current.encryptedBlobPath,
            metadata.etag,
            JSON.stringify(fallbackOrphan),
            current.expiresAt,
            sessionId,
          ],
        ),
      );
      if (result === 1) return next;
      if (result === 0)
        throw new ServiceError("not_found", "The print session was not found.", 404);
      if (result === -2)
        throw new ServiceError("conflict", "Encrypted blob cleanup tracking is inconsistent.", 409);
    }
    throw concurrentChange();
  }

  public async consume(
    sessionId: string,
    kioskTokenHash: string,
    consumeIdHash: string,
    now: number,
    leaseMs: number,
  ): Promise<PrintSession> {
    return this.mutate(sessionId, now, (session) => {
      requireHash(session.kioskTokenHash, kioskTokenHash);
      if (session.status === "consumed") {
        if (
          same(session.consumeIdHash, consumeIdHash) &&
          (session.consumeLeaseExpiresAt ?? 0) > now
        )
          return session;
        throw new ServiceError("conflict", "This document has already been consumed.", 409);
      }
      assertTransition(session.status, "consumed");
      return {
        ...session,
        status: "consumed",
        consumeIdHash,
        consumeLeaseExpiresAt: now + leaseMs,
        revision: session.revision + 1,
      };
    });
  }

  public async transition(
    sessionId: string,
    kioskTokenHash: string,
    next: PrintSessionStatus,
    now: number,
  ): Promise<PrintSession> {
    return this.mutate(sessionId, now, (session) => {
      requireHash(session.kioskTokenHash, kioskTokenHash);
      assertTransition(session.status, next);
      return {
        ...session,
        status: next,
        ...(next === "validating" || next === "printing"
          ? { consumeLeaseExpiresAt: now + PROCESSING_LEASE_MS }
          : {}),
        ...(next === "completed" ? { completedAt: now } : {}),
        revision: session.revision + 1,
      };
    });
  }

  public async cancel(
    sessionId: string,
    candidateTokenHash: string,
    role: "mobile" | "kiosk",
    now: number,
  ): Promise<PrintSession> {
    return this.mutate(sessionId, now, (session) => {
      requireHash(
        role === "mobile" ? session.mobileTokenHash : session.kioskTokenHash,
        candidateTokenHash,
      );
      assertTransition(session.status, "cancelled");
      return { ...session, status: "cancelled", revision: session.revision + 1 };
    });
  }

  public async remove(sessionId: string): Promise<void> {
    await this.#redis.del(sessionKey(sessionId));
  }

  public async putReceipt(receipt: SessionReceipt): Promise<void> {
    const ttl = Math.max(1, receipt.expiresAt - Date.now());
    await this.#redis.set(receiptKey(receipt.sessionId), JSON.stringify(receipt), ttl);
  }

  public async getReceipt(sessionId: string): Promise<SessionReceipt | null> {
    const raw = await this.#redis.get(receiptKey(sessionId));
    return raw ? sessionReceiptSchema.parse(deserialize(raw)) : null;
  }

  public async prepareCleanup(sessionId: string, now: number): Promise<CleanupPreparation> {
    const raw = await this.#redis.eval(
      PREPARE_CLEANUP_SCRIPT,
      [sessionKey(sessionId), orphanKey(sessionId), ORPHAN_DUE_KEY],
      [now, CLEANUP_RETENTION_MS, sessionId],
    );
    if (typeof raw !== "string") {
      throw new ServiceError("unavailable", "Cleanup state is invalid.", 503);
    }
    const parsed = deserialize(raw) as Record<string, unknown>;
    if (parsed.action === "absent") return { action: "absent" };
    if (parsed.action === "defer" && typeof parsed.retryAt === "number") {
      return { action: "defer", retryAt: parsed.retryAt };
    }
    if (parsed.action === "conflict") {
      throw new ServiceError("conflict", "Encrypted blob cleanup tracking is inconsistent.", 409);
    }
    if (parsed.action !== "delete") {
      throw new ServiceError("unavailable", "Cleanup state is invalid.", 503);
    }
    const receiptStatus = parsed.receiptStatus;
    if (
      receiptStatus !== "completed" &&
      receiptStatus !== "failed" &&
      receiptStatus !== "expired" &&
      receiptStatus !== "cancelled"
    ) {
      throw new ServiceError("unavailable", "Cleanup terminal state is invalid.", 503);
    }
    return {
      action: "delete",
      orphan: parsed.orphan === null ? null : parseOrphan(parsed.orphan),
      receiptStatus,
      sealedRevision: typeof parsed.sealedRevision === "number" ? parsed.sealedRevision : null,
    };
  }

  public async finalizeCleanup(
    sessionId: string,
    sealedRevision: number | null,
    pathname: string | null,
  ): Promise<boolean> {
    const result = toInteger(
      await this.#redis.eval(
        FINALIZE_CLEANUP_SCRIPT,
        [sessionKey(sessionId), orphanKey(sessionId), ORPHAN_DUE_KEY],
        [sessionId, sealedRevision === null ? "" : String(sealedRevision), pathname ?? ""],
      ),
    );
    return result === 1;
  }

  public async listDueOrphans(now: number, limit: number): Promise<BlobOrphanRecord[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const sessionIds = await this.#redis.zrangeByScore(ORPHAN_DUE_KEY, now, boundedLimit);
    const records: BlobOrphanRecord[] = [];
    for (const sessionId of sessionIds) {
      const raw = await this.#redis.get(orphanKey(sessionId));
      if (!raw) {
        await this.#redis.zrem(ORPHAN_DUE_KEY, sessionId);
        continue;
      }
      const orphan = parseOrphan(deserialize(raw));
      if (orphan.dueAt <= now) records.push(orphan);
    }
    return records;
  }

  private async mutate(
    sessionId: string,
    now: number,
    mutation: (session: PrintSession) => PrintSession,
  ): Promise<PrintSession> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.requireMutableSession(sessionId, now);
      const next = mutation(current);
      if (next === current) return structuredClone(current);
      const result = toInteger(
        await this.#redis.eval(
          CAS_SCRIPT,
          [sessionKey(sessionId)],
          [current.revision, JSON.stringify(next), retentionMs(next, now)],
        ),
      );
      if (result === 1) return next;
      if (result === 0)
        throw new ServiceError("not_found", "The print session was not found.", 404);
    }
    throw concurrentChange();
  }

  private async requireMutableSession(sessionId: string, now: number): Promise<PrintSession> {
    const current = await this.get(sessionId);
    if (!current) throw new ServiceError("not_found", "The print session was not found.", 404);
    const processingLeaseActive =
      PROCESSING_STATUSES.has(current.status) && (current.consumeLeaseExpiresAt ?? 0) > now;
    if (current.expiresAt <= now && !processingLeaseActive) {
      throw new ServiceError("expired", "The print session has expired.", 410);
    }
    return current;
  }
}

function sessionKey(sessionId: string): string {
  return `pc:v1:session:${sessionId}`;
}

function receiptKey(sessionId: string): string {
  return `pc:v1:receipt:${sessionId}`;
}

function orphanKey(sessionId: string): string {
  return `pc:v1:orphan:${sessionId}`;
}

function retentionMs(session: PrintSession, now: number): number {
  const retainUntil =
    Math.max(session.expiresAt, session.consumeLeaseExpiresAt ?? 0) + CLEANUP_RETENTION_MS;
  return Math.max(60_000, retainUntil - now);
}

function deserialize(raw: unknown): unknown {
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function toInteger(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return Number(value);
  throw new ServiceError("unavailable", "The session store returned an unexpected reply.", 503);
}

function parseOrphan(value: unknown): BlobOrphanRecord {
  const parsed = blobOrphanSchema.safeParse(value);
  if (!parsed.success) {
    throw new ServiceError("unavailable", "Cleanup record is invalid.", 503);
  }
  const { etag, ...required } = parsed.data;
  return structuredClone(etag === undefined ? required : { ...required, etag });
}

function same(expected: string | undefined, candidate: string): boolean {
  return Boolean(expected && timingSafeEqualBase64Url(expected, candidate));
}

function requireHash(expected: string | undefined, candidate: string): void {
  if (!same(expected, candidate))
    throw new ServiceError("unauthorized", "The session credential is invalid.", 401);
}

function concurrentChange(): ServiceError {
  return new ServiceError(
    "conflict",
    "The session changed concurrently. Try the current step again.",
    409,
  );
}

export type { RedisScriptClient };
