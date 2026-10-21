import { dropRecordSchema, type DropRecord } from "@print-cess/protocol";

import type { DropPartCommit, DropReceiverEvent, DropStore } from "../contracts";
import { ServiceError } from "../errors";
import type { RedisScriptClient } from "../session-store/redis-client";
import {
  applyPartCommits,
  applyReceiverEvent,
  assertSealable,
  requireOwner,
  type DropMutation,
} from "./transitions";

const DROP_KEY_PREFIX = "pc:v1:drop:";
const DROP_DUE_KEY = "pc:v1:drops:due";
const MAX_CAS_ATTEMPTS = 3;

const CREATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
return 1
`;

const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if tonumber(decoded.revision) ~= tonumber(ARGV[1]) then return -1 end
local currentTtl = redis.call('PTTL', KEYS[1])
local requestedTtl = tonumber(ARGV[3])
local nextTtl = requestedTtl
if currentTtl > nextTtl then nextTtl = currentTtl end
redis.call('SET', KEYS[1], ARGV[2], 'PX', nextTtl)
return 1
`;

const REMOVE_SCRIPT = `
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

export class RedisDropStore implements DropStore {
  public constructor(private readonly redis: RedisScriptClient) {}

  public async create(drop: DropRecord, retentionMs: number): Promise<void> {
    const result = await this.redis.eval(
      CREATE_SCRIPT,
      [dropKey(drop.dropId), DROP_DUE_KEY],
      [
        JSON.stringify(drop),
        Math.max(1, Math.trunc(drop.expiresAt - drop.createdAt + retentionMs)),
        drop.expiresAt,
        drop.dropId,
      ],
    );
    if (Number(result) !== 1) {
      throw new ServiceError("conflict", "This transfer code is already in use.", 409);
    }
  }

  public async get(dropId: string): Promise<DropRecord | null> {
    const raw = await this.redis.get(dropKey(dropId));
    return raw ? parseDrop(raw) : null;
  }

  public async commitParts(
    dropId: string,
    ownerTokenHash: string,
    parts: readonly DropPartCommit[],
    now: number,
  ): Promise<DropRecord> {
    return this.mutate(dropId, now, (drop) => {
      requireOwner(drop, ownerTokenHash);
      return applyPartCommits(drop, parts);
    });
  }

  public async seal(dropId: string, ownerTokenHash: string, now: number): Promise<DropRecord> {
    return this.mutate(dropId, now, (drop) => {
      requireOwner(drop, ownerTokenHash);
      assertSealable(drop);
      if (drop.status === "ready") return drop;
      return { ...drop, status: "ready", revision: drop.revision + 1 };
    });
  }

  public async recordReceiverEvent(
    dropId: string,
    event: DropReceiverEvent,
    now: number,
  ): Promise<DropRecord> {
    return this.mutate(dropId, now, (drop) => applyReceiverEvent(drop, event));
  }

  public async remove(dropId: string): Promise<void> {
    await this.redis.eval(REMOVE_SCRIPT, [dropKey(dropId), DROP_DUE_KEY], [dropId]);
  }

  public async listExpired(now: number, limit: number): Promise<DropRecord[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const dropIds = await this.redis.zrangeByScore(DROP_DUE_KEY, now, boundedLimit);
    const records: DropRecord[] = [];
    for (const dropId of dropIds) {
      const raw = await this.redis.get(dropKey(dropId));
      if (!raw) {
        await this.redis.zrem(DROP_DUE_KEY, dropId);
        continue;
      }
      const drop = parseDrop(raw);
      if (drop.expiresAt <= now) records.push(drop);
    }
    return records;
  }

  private async mutate(dropId: string, now: number, mutation: DropMutation): Promise<DropRecord> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.get(dropId);
      if (!current) throw new ServiceError("not_found", "This transfer was not found.", 404);
      if (current.expiresAt <= now) {
        throw new ServiceError("expired", "This transfer has expired.", 410);
      }
      const next = mutation(current);
      if (next === current) return current;
      const result = Number(
        await this.redis.eval(
          CAS_SCRIPT,
          [dropKey(dropId)],
          [current.revision, JSON.stringify(next), Math.max(1, next.expiresAt - now + 60_000)],
        ),
      );
      if (result === 1) return next;
      if (result === 0) throw new ServiceError("not_found", "This transfer was not found.", 404);
    }
    throw new ServiceError("conflict", "This transfer changed while it was being updated.", 409);
  }
}

function dropKey(dropId: string): string {
  return `${DROP_KEY_PREFIX}${dropId}`;
}

function parseDrop(raw: string): DropRecord {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new ServiceError("unavailable", "Stored transfer state is unreadable.", 503);
  }
  const parsed = dropRecordSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ServiceError("unavailable", "Stored transfer state is unreadable.", 503);
  }
  return parsed.data;
}
