import type { CleanupScheduler } from "../contracts";

export class PersistentSweepCleanupScheduler implements CleanupScheduler {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- interface parity
  public async schedule(_sessionId: string, _dueAt: number): Promise<void> {
  }
}
