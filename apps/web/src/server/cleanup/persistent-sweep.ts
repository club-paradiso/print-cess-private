import type { CleanupScheduler } from "../contracts";

/**
 * Cleanup scheduler for the Railway persistent-worker model.
 *
 * In the QStash model each upload authorization publishes a delayed remote
 * message. With a persistent worker that is unnecessary and would be unsafe to
 * emulate: the due time is already persisted transactionally in the Redis
 * orphan sorted set by `SessionStore.authorizeUpload` (and refreshed on every
 * `prepareCleanup` defer). The worker polls `/api/cleanup { sweep: true }`,
 * which reads that same sorted set through `listDueOrphans`.
 *
 * Therefore `schedule()` intentionally performs no remote scheduling. This is
 * not hidden behaviour — the durable due record is the single source of truth,
 * so it survives worker restarts, is idempotent across duplicate sweeps, and is
 * safe under multiple concurrent worker instances (each `cleanupSession` is a
 * CAS/atomic Lua operation). The store tests prove the due record is written
 * and rescheduled; this scheduler simply relies on it.
 */
export class PersistentSweepCleanupScheduler implements CleanupScheduler {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- interface parity
  public async schedule(_sessionId: string, _dueAt: number): Promise<void> {
    // No-op by design: the due record is already durable in Redis. See the
    // class doc for the safety argument.
  }
}
