import { Redis } from "@upstash/redis";

import type { RedisScriptClient } from "../session-store/redis-client";

export class UpstashScriptClient implements RedisScriptClient {
  readonly #redis: Redis;

  public constructor(environment: NodeJS.ProcessEnv = process.env) {
    const url = environment.UPSTASH_REDIS_REST_URL ?? environment.KV_REST_API_URL;
    const token = environment.UPSTASH_REDIS_REST_TOKEN ?? environment.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error("Upstash Redis credentials are required in external adapter mode");
    }
    this.#redis = new Redis({ url, token, enableTelemetry: false });
  }

  public async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    return this.#redis.eval(
      script,
      keys,
      args.map((value) => String(value)),
    );
  }

  public async get(key: string): Promise<string | null> {
    const raw = await this.#redis.get<unknown>(key);
    if (raw === null || raw === undefined) return null;
    return typeof raw === "string" ? raw : JSON.stringify(raw);
  }

  public async set(key: string, value: string, pxMs?: number): Promise<void> {
    if (pxMs === undefined) {
      await this.#redis.set(key, value);
      return;
    }
    await this.#redis.set(key, value, { px: Math.max(1, Math.trunc(pxMs)) });
  }

  public async del(key: string): Promise<void> {
    await this.#redis.del(key);
  }

  public async zrangeByScore(key: string, max: number, count: number): Promise<string[]> {
    return this.#redis.zrange<string[]>(key, "-inf", max, {
      byScore: true,
      offset: 0,
      count: Math.max(1, Math.trunc(count)),
    });
  }

  public async zrem(key: string, member: string): Promise<void> {
    await this.#redis.zrem(key, member);
  }
}
