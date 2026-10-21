import { pairingRecordSchema, type PairingRecord } from "@print-cess/protocol";

import type { PairingStore } from "../contracts";
import type { RedisScriptClient } from "../session-store/redis-client";
import { pairingNotFound, requireLive, requireShape } from "./transitions";

const PAIRING_KEY_PREFIX = "pc:v1:pairing:";

const CLAIM_SCRIPT = `
for index, key in ipairs(KEYS) do
  if redis.call('SET', key, ARGV[index + 1], 'PX', ARGV[1], 'NX') then
    return index
  end
end
return 0
`;

const REDEEM_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return false end
redis.call('DEL', KEYS[1])
return current
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
    const raw = await this.redis.eval(REDEEM_SCRIPT, [pairingKey(code)], []);
    return requireShape(requireLive(parsePairing(raw), now), shape);
  }

  public async remove(code: string): Promise<void> {
    await this.redis.del(pairingKey(code));
  }
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
