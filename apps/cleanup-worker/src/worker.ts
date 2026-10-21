import type { WorkerConfig } from "./config";

export type SweepCounts = {
  attempted: number;
  deleted: number;
  deferred: number;
  failed: number;
};

export type SweepOutcome =
  | { ok: true; status: number; counts: SweepCounts }
  | { ok: false; status: number | null; reason: "http" | "timeout" | "network" };

export type WorkerLogEvent =
  | ({ event: "sweep" } & SweepCounts & { status: number })
  | { event: "error"; status: number | null; reason: "http" | "timeout" | "network" };

export type WorkerDeps = {
  fetchImpl: typeof fetch;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  log: (event: WorkerLogEvent) => void;
  random: () => number;
};

export function defaultDeps(): WorkerDeps {
  return {
    fetchImpl: (...args) => fetch(...args),
    sleep: abortableSleep,
    log: (event) => {
      // Only counts and a coarse status/reason are emitted — never the secret,
      // the endpoint, request bodies, or response bodies.
      process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
    },
    random: Math.random,
  };
}

/**
 * Perform exactly one cleanup sweep. Never throws for expected transport
 * failures; instead returns a structured, credential-free outcome so the caller
 * decides whether to back off. A non-2xx response is treated as a failure.
 */
export async function sweepOnce(config: WorkerConfig, deps: WorkerDeps): Promise<SweepOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-cleanup-worker-secret": config.secret,
    };
    if (config.vercelProtectionBypass) {
      headers["x-vercel-protection-bypass"] = config.vercelProtectionBypass;
    }
    const response = await deps.fetchImpl(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ sweep: true, limit: config.batchSize }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, reason: "http" };
    }
    const payload: unknown = await response.json().catch(() => null);
    return { ok: true, status: response.status, counts: normalizeCounts(payload) };
  } catch (error) {
    if (isAbortError(error)) return { ok: false, status: null, reason: "timeout" };
    return { ok: false, status: null, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the sweep loop until `signal` aborts. Each iteration fully completes
 * before the next begins (no overlapping polls). Successful cycles wait the
 * configured interval; failures wait an exponential backoff with jitter capped
 * at `maxBackoffMs`, so a persistently failing endpoint cannot become a tight
 * crash loop that fights Railway's restart policy.
 */
export async function runWorker(
  config: WorkerConfig,
  deps: WorkerDeps,
  signal: AbortSignal,
): Promise<void> {
  let consecutiveFailures = 0;
  while (!signal.aborted) {
    const outcome = await sweepOnce(config, deps);
    if (signal.aborted) break;
    if (outcome.ok) {
      consecutiveFailures = 0;
      deps.log({ event: "sweep", status: outcome.status, ...outcome.counts });
      await waitOrStop(config.intervalMs, deps, signal);
    } else {
      consecutiveFailures += 1;
      deps.log({ event: "error", status: outcome.status, reason: outcome.reason });
      await waitOrStop(backoffWithJitter(consecutiveFailures, config, deps), deps, signal);
    }
  }
}

function backoffWithJitter(attempt: number, config: WorkerConfig, deps: WorkerDeps): number {
  const base = Math.min(config.maxBackoffMs, config.intervalMs * 2 ** Math.min(attempt, 20));
  const capped = Math.min(config.maxBackoffMs, base);
  // Full jitter in [capped/2, capped] keeps retries from synchronizing across
  // multiple worker instances while respecting the cap.
  return Math.round(capped / 2 + deps.random() * (capped / 2));
}

async function waitOrStop(ms: number, deps: WorkerDeps, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try {
    await deps.sleep(ms, signal);
  } catch {
    // An aborted sleep simply ends the loop on the next guard.
  }
}

function normalizeCounts(payload: unknown): SweepCounts {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    attempted: readCount(record.attempted),
    deleted: readCount(record.deleted),
    deferred: readCount(record.deferred),
    failed: readCount(record.failed),
  };
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "name" in error && error.name === "AbortError",
  );
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
