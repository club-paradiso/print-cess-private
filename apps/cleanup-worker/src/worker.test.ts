import { describe, expect, it } from "vitest";

import { MAX_BACKOFF_MS, type WorkerConfig } from "./config";
import { runWorker, sweepOnce, type WorkerDeps, type WorkerLogEvent } from "./worker";

const SECRET = "w".repeat(40);
const ENDPOINT = "https://app.example.test/api/cleanup";

function baseConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    endpoint: ENDPOINT,
    secret: SECRET,
    vercelProtectionBypass: null,
    intervalMs: 5_000,
    batchSize: 25,
    requestTimeoutMs: 20,
    maxBackoffMs: MAX_BACKOFF_MS,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("sweepOnce", () => {
  it("returns normalized counts on a 2xx response", async () => {
    const deps = stubDeps({
      fetchImpl: async () =>
        jsonResponse(200, {
          attempted: 3,
          deleted: 2,
          deferred: 1,
          failed: 0,
          drops: { attempted: 5, deleted: 4, failed: 1 },
          extra: "ignored",
        }),
    });
    const outcome = await sweepOnce(baseConfig(), deps);
    expect(outcome).toEqual({
      ok: true,
      status: 200,
      counts: {
        attempted: 3,
        deleted: 2,
        deferred: 1,
        failed: 0,
        dropsDeleted: 4,
        dropsFailed: 1,
      },
    });
  });

  it("does not follow a redirect with the secret attached", async () => {
    let seen: RequestInit | undefined;
    const deps = stubDeps({
      fetchImpl: async (_url, init) => {
        seen = init;
        return jsonResponse(307, {});
      },
    });
    expect(await sweepOnce(baseConfig(), deps)).toEqual({ ok: false, status: 307, reason: "http" });
    expect(seen?.redirect).toBe("manual");
  });

  it("sends the worker secret header and sweep body", async () => {
    let seen: RequestInit | undefined;
    const deps = stubDeps({
      fetchImpl: async (_url, init) => {
        seen = init;
        return jsonResponse(200, {});
      },
    });
    await sweepOnce(baseConfig(), deps);
    const headers = seen?.headers as Record<string, string>;
    expect(headers["x-cleanup-worker-secret"]).toBe(SECRET);
    expect(JSON.parse(String(seen?.body))).toEqual({ sweep: true, limit: 25 });
  });

  it("sends the Vercel protection bypass header only when configured", async () => {
    let protectedRequest: RequestInit | undefined;
    const deps = stubDeps({
      fetchImpl: async (_url, init) => {
        protectedRequest = init;
        return jsonResponse(200, {});
      },
    });
    await sweepOnce(baseConfig({ vercelProtectionBypass: "preview-bypass-secret" }), deps);
    expect(
      (protectedRequest?.headers as Record<string, string>)["x-vercel-protection-bypass"],
    ).toBe("preview-bypass-secret");

    let publicRequest: RequestInit | undefined;
    await sweepOnce(
      baseConfig(),
      stubDeps({
        fetchImpl: async (_url, init) => {
          publicRequest = init;
          return jsonResponse(200, {});
        },
      }),
    );
    expect(
      (publicRequest?.headers as Record<string, string>)["x-vercel-protection-bypass"],
    ).toBeUndefined();
  });

  it("treats a non-2xx response as an http failure", async () => {
    const deps = stubDeps({ fetchImpl: async () => jsonResponse(503, {}) });
    expect(await sweepOnce(baseConfig(), deps)).toEqual({ ok: false, status: 503, reason: "http" });
  });

  it("classifies an aborted request as a timeout", async () => {
    const deps = stubDeps({
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });
    expect(await sweepOnce(baseConfig({ requestTimeoutMs: 5 }), deps)).toEqual({
      ok: false,
      status: null,
      reason: "timeout",
    });
  });

  it("classifies a rejected fetch as a network failure", async () => {
    const deps = stubDeps({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await sweepOnce(baseConfig(), deps)).toEqual({
      ok: false,
      status: null,
      reason: "network",
    });
  });
});

describe("runWorker", () => {
  it("waits the interval after a success and never overlaps polls", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    let active = 0;
    let maxActive = 0;
    const logs: WorkerLogEvent[] = [];
    const deps = stubDeps({
      fetchImpl: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return jsonResponse(200, { attempted: 1, deleted: 1, deferred: 0, failed: 0 });
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length >= 2) controller.abort();
      },
      log: (event) => logs.push(event),
    });

    await runWorker(baseConfig(), deps, controller.signal);

    expect(maxActive).toBe(1);
    expect(sleeps).toEqual([5_000, 5_000]);
    expect(logs.every((event) => event.event === "sweep")).toBe(true);
  });

  it("backs off with a jitter that never exceeds the cap on repeated failures", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const deps = stubDeps({
      fetchImpl: async () => jsonResponse(500, {}),
      random: () => 1, // full jitter -> the capped value itself
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length >= 5) controller.abort();
      },
    });

    await runWorker(baseConfig(), deps, controller.signal);

    expect(sleeps).toHaveLength(5);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    expect(sleeps.at(-1)).toBe(MAX_BACKOFF_MS);
    expect(sleeps[0]).toBeLessThan(sleeps.at(-1) as number);
  });

  it("stops promptly when the signal aborts and issues no further requests", async () => {
    const controller = new AbortController();
    let calls = 0;
    const deps = stubDeps({
      fetchImpl: async () => {
        calls += 1;
        controller.abort();
        return jsonResponse(200, {});
      },
      sleep: async () => {
        throw new Error("sleep should not run after abort");
      },
    });

    await runWorker(baseConfig(), deps, controller.signal);
    expect(calls).toBe(1);
  });

  it("never records the secret or endpoint in log events", async () => {
    const controller = new AbortController();
    const logs: WorkerLogEvent[] = [];
    const deps = stubDeps({
      fetchImpl: async () => jsonResponse(500, {}),
      sleep: async () => {
        controller.abort();
      },
      log: (event) => logs.push(event),
    });

    await runWorker(baseConfig(), deps, controller.signal);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("example.test");
  });
});

function stubDeps(overrides: Partial<WorkerDeps>): WorkerDeps {
  return {
    fetchImpl: async () => jsonResponse(200, {}),
    sleep: async () => {},
    log: () => {},
    random: () => 0.5,
    ...overrides,
  };
}
