import { createClient } from "redis";

/**
 * Minimal command surface the session store depends on. Injecting this port
 * keeps the store unit-testable without a live Redis server and hides the
 * concrete client so the atomic Lua contract is the only coupling.
 */
export interface RedisScriptClient {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, pxMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Members whose score is `<= max`, ordered ascending, capped at `count`. */
  zrangeByScore(key: string, max: number, count: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

function createRedisClient(url: string) {
  return createClient({
    url,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => Math.min(MAX_RECONNECT_DELAY_MS, 100 * 2 ** retries),
    },
  });
}

type NodeRedisClient = ReturnType<typeof createRedisClient>;

const clients = new Map<string, { client: NodeRedisClient; ready: Promise<NodeRedisClient> }>();

export function createNodeRedisScriptClient(
  environment: NodeJS.ProcessEnv = process.env,
): RedisScriptClient {
  const url = environment.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is required for the railway-redis session provider");
  }
  assertTlsUrl(url);
  return new NodeRedisScriptClient(url);
}

function assertTlsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("REDIS_URL must be a valid Redis connection URL");
  }
  if (parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use a TLS connection (rediss://)");
  }
}

class NodeRedisScriptClient implements RedisScriptClient {
  public constructor(private readonly url: string) {}

  private async connection(): Promise<NodeRedisClient> {
    const cached = clients.get(this.url);
    if (cached) return cached.ready;

    const client = createRedisClient(this.url);
    client.on("error", () => {});

    const ready = client
      .connect()
      .then(() => client)
      .catch((error: unknown) => {
        clients.delete(this.url);
        throw new Error(`Redis connection failed: ${classifyError(error)}`);
      });
    clients.set(this.url, { client, ready });
    return ready;
  }

  public async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    const client = await this.connection();
    return client.eval(script, { keys, arguments: args.map((value) => String(value)) });
  }

  public async get(key: string): Promise<string | null> {
    const client = await this.connection();
    return client.get(key);
  }

  public async set(key: string, value: string, pxMs?: number): Promise<void> {
    const client = await this.connection();
    if (pxMs === undefined) {
      await client.set(key, value);
    } else {
      await client.set(key, value, { PX: Math.max(1, Math.trunc(pxMs)) });
    }
  }

  public async del(key: string): Promise<void> {
    const client = await this.connection();
    await client.del(key);
  }

  public async zrangeByScore(key: string, max: number, count: number): Promise<string[]> {
    const client = await this.connection();
    return client.zRangeByScore(key, "-inf", max, {
      LIMIT: { offset: 0, count: Math.max(1, Math.trunc(count)) },
    });
  }

  public async zrem(key: string, member: string): Promise<void> {
    const client = await this.connection();
    await client.zRem(key, member);
  }
}

function classifyError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  if (error instanceof Error) return error.name;
  return "unknown";
}

/** Test hook: drop cached connections so specs stay isolated. */
export function resetRedisClientsForTest(): void {
  clients.clear();
}
