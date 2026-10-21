import type { CleanupScheduler } from "../contracts";

export class InProcessCleanupScheduler implements CleanupScheduler {
  readonly #scheduled = new Map<string, { dueAt: number; timer: ReturnType<typeof setTimeout> }>();

  public constructor(private readonly onDue: (sessionId: string) => Promise<void>) {}

  public async schedule(sessionId: string, dueAt: number): Promise<void> {
    const existing = this.#scheduled.get(sessionId);
    if (existing?.dueAt === dueAt) return;
    if (existing) clearTimeout(existing.timer);

    const delay = Math.max(0, dueAt - Date.now());
    const timer = setTimeout(() => {
      const scheduled = this.#scheduled.get(sessionId);
      if (scheduled?.timer !== timer) return;
      this.#scheduled.delete(sessionId);
      void this.onDue(sessionId).catch(() => {
        // Local development keeps TTL cleanup as the final fallback.
      });
    }, delay);
    this.#scheduled.set(sessionId, { dueAt, timer });
    timer.unref?.();
  }
}
