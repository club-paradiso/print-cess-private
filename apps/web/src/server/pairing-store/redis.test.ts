import { describe, expect, it } from "vitest";

import type { PairingRecord } from "@print-cess/protocol";

import type { RedisScriptClient } from "../session-store/redis-client";
import { RedisPairingStore } from "./redis";

const TRANSFER_CODE = "23456789ABCD";

function draft(now = 1_000): Omit<PairingRecord, "code"> {
  return {
    protocolVersion: 1,
    shape: "star",
    transferCode: TRANSFER_CODE,
    createdAt: now,
    expiresAt: now + 180_000,
  };
}

class FakeRedis implements RedisScriptClient {
  readonly values = new Map<string, string>();
  returnObjects = false;

  async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    if (script.includes("'INCR'")) {
      const count = Number(this.values.get(keys[0]!) ?? 0) + 1;
      this.values.set(keys[0]!, String(count));
      return count;
    }
    if (script.includes("cjson.decode")) {
      const value = this.values.get(keys[0]!);
      if (!value) return false;
      const decoded = JSON.parse(value) as PairingRecord;
      if (decoded.shape === args[0]) {
        this.values.delete(keys[0]!);
        return this.returnObjects ? decoded : value;
      }
      const misses = (decoded.misses ?? 0) + 1;
      if (misses >= Number(args[1])) this.values.delete(keys[0]!);
      else this.values.set(keys[0]!, JSON.stringify({ ...decoded, misses }));
      return false;
    }
    if (script.includes("'SET'")) {
      for (const [index, key] of keys.entries()) {
        if (this.values.has(key)) continue;
        this.values.set(key, String(args[index + 1]));
        return index + 1;
      }
      return 0;
    }
    throw new Error("Unexpected script");
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }

  async zrangeByScore(): Promise<string[]> {
    return [];
  }

  async zrem(): Promise<void> {}
}

describe("RedisPairingStore", () => {
  it("forgives one wrong shape and deletes the pairing on the second", async () => {
    const redis = new FakeRedis();
    const store = new RedisPairingStore(redis);
    await store.claim(draft(), ["4242", "4243"]);
    await store.claim(draft(), ["4243"]);

    await expect(store.redeem("4242", "circle", 1_000)).rejects.toThrow(
      "Those numbers and that shape do not match a transfer.",
    );
    await expect(store.redeem("4242", "star", 1_000)).resolves.toMatchObject({
      transferCode: TRANSFER_CODE,
    });

    await expect(store.redeem("4243", "circle", 1_000)).rejects.toThrow();
    await expect(store.redeem("4243", "triangle", 1_000)).rejects.toThrow();
    await expect(store.redeem("4243", "star", 1_000)).rejects.toThrow();
  });

  it("counts wrong guesses in one shared key per window", async () => {
    const redis = new FakeRedis();
    const store = new RedisPairingStore(redis);
    await store.recordMiss(60_000);
    await store.recordMiss(90_000);
    expect(await store.recentMisses(119_999)).toBe(2);
    expect(await store.recentMisses(120_000)).toBe(0);
  });

  it("accepts the decoded JSON value returned by REST Redis clients", async () => {
    const redis = new FakeRedis();
    redis.returnObjects = true;
    const store = new RedisPairingStore(redis);
    await store.claim(draft(), ["4242"]);

    await expect(store.redeem("4242", "star", 1_000)).resolves.toMatchObject({
      transferCode: TRANSFER_CODE,
    });
  });
});
