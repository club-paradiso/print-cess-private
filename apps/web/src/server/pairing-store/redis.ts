import { PAIRING_SHAPE_TRIES, pairingRecordSchema, type PairingRecord } from "@print-cess/protocol";

import type { PairingStore } from "../contracts";
import type { RedisScriptClient } from "../session-store/redis-client";
import {
  missWindowStart,
  PAIRING_MISS_WINDOW_MS,
  pairingNotFound,
  requireLive,
} from "./transitions";

const PAIRING_KEY_PREFIX = "pc:v1:pairing:";
const PAIRING_MISS_KEY_PREFIX = "pc:v1:pairing-misses:";

const CLAIM_SCRIPT = `
for index, key in ipairs(KEYS) do
  if redis.call('SET', key, ARGV[index + 1], 'PX', ARGV[1], 'NX') then
    return index
  end
end
return 0
`;

// A match consumes the escrow. A miss is counted on the record, keeping its
// remaining lifetime, and the last allowed miss deletes it. Both a miss and an
// unknown code return false, so the caller cannot tell them apart.
const REDEEM_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return false end
local decoded = cjson.decode(current)
if decoded.shape == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return current
end
local misses = (tonumber(decoded.misses) or 0) + 1
local ttl = redis.call('PTTL', KEYS[1])
if misses >= tonumber(ARGV[2]) or ttl <= 0 then
  redis.call('DEL', KEYS[1])
else
  decoded.misses = misses
  redis.call('SET', KEYS[1], cjson.encode(decoded), 'PX', ttl)
end
return false
`;

const MISS_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

export class RedisPairingStore implements PairingStore {
  public constructor(private readonly redis: RedisScriptClient) {}

  public async claim(
    pairing: Omit<PairingRecord, "code">,
    candidates: readonly string[],
  ): Promise<PairingRecord | null> {
    if (candidates.length === 0) return null;
    const ttl = Math.max(1, Math.trunc(pairing.expiresAt - pairing.createdAt));
    const records = candidates.map((code) => JSON.stringify({ ...pairing, code }));
    const taken = Number(
      await this.redis.eval(CLAIM_SCRIPT, candidates.map(pairingKey), [String(ttl), ...records]),
    );
    if (taken <= 0) return null;
    return { ...pairing, code: candidates[taken - 1]! };
  }

  public async get(code: string): Promise<PairingRecord | null> {
    const raw = await this.redis.get(pairingKey(code));
    if (!raw) return null;
    return parsePairing(raw);
  }

  public async redeem(
    code: string,
    shape: PairingRecord["shape"],
    now: number,
  ): Promise<PairingRecord> {
    const raw = await this.redis.eval(
      REDEEM_SCRIPT,
      [pairingKey(code)],
      [shape, PAIRING_SHAPE_TRIES],
    );
    return requireLive(parsePairing(raw), now);
  }

  public async recordMiss(now: number): Promise<void> {
    await this.redis.eval(MISS_SCRIPT, [missKey(now)], [PAIRING_MISS_WINDOW_MS * 2]);
  }

  public async recentMisses(now: number): Promise<number> {
    return Number((await this.redis.get(missKey(now))) ?? 0) || 0;
  }

  public async remove(code: string): Promise<void> {
    await this.redis.del(pairingKey(code));
  }

  /** Every escrow key carries a PX expiry, so Redis has already removed it. */
  public async pruneExpired(): Promise<void> {}
}

function parsePairing(value: unknown): PairingRecord {
  let decoded: unknown = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value);
    } catch {
      throw pairingNotFound();
    }
  }
  const parsed = pairingRecordSchema.safeParse(decoded);
  if (!parsed.success) throw pairingNotFound();
  return parsed.data;
}

function pairingKey(code: string): string {
  return `${PAIRING_KEY_PREFIX}${code}`;
}

function missKey(now: number): string {
  return `${PAIRING_MISS_KEY_PREFIX}${missWindowStart(now)}`;
}
