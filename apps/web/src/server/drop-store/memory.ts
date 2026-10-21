import type { DropRecord } from "@print-cess/protocol";

import type { DropPartCommit, DropReceiverEvent, DropStore } from "../contracts";
import { ServiceError } from "../errors";
import {
  applyPartCommits,
  applyReceiverEvent,
  assertSealable,
  requireOwner,
  type DropMutation,
} from "./transitions";

type StoredDrop = { drop: DropRecord; retentionExpiresAt: number };

export class MemoryDropStore implements DropStore {
  readonly #drops = new Map<string, StoredDrop>();

  public async create(drop: DropRecord, retentionMs: number): Promise<void> {
    this.prune();
    if (this.#drops.has(drop.dropId)) {
      throw new ServiceError("conflict", "This transfer code is already in use.", 409);
    }
    this.#drops.set(drop.dropId, {
      drop: structuredClone(drop),
      retentionExpiresAt: drop.expiresAt + retentionMs,
    });
  }

  public async get(dropId: string): Promise<DropRecord | null> {
    this.prune();
    const stored = this.#drops.get(dropId);
    return stored ? structuredClone(stored.drop) : null;
  }

  public async commitParts(
    dropId: string,
    ownerTokenHash: string,
    parts: readonly DropPartCommit[],
    now: number,
  ): Promise<DropRecord> {
    return this.mutate(dropId, now, (drop) => {
      requireOwner(drop, ownerTokenHash);
      return applyPartCommits(drop, parts);
    });
  }

  public async seal(dropId: string, ownerTokenHash: string, now: number): Promise<DropRecord> {
    return this.mutate(dropId, now, (drop) => {
      requireOwner(drop, ownerTokenHash);
      assertSealable(drop);
      if (drop.status === "ready") return drop;
      return { ...drop, status: "ready", revision: drop.revision + 1 };
    });
  }

  public async recordReceiverEvent(
    dropId: string,
    event: DropReceiverEvent,
    now: number,
  ): Promise<DropRecord> {
    return this.mutate(dropId, now, (drop) => applyReceiverEvent(drop, event));
  }

  public async remove(dropId: string): Promise<void> {
    this.#drops.delete(dropId);
  }

  public async listExpired(now: number, limit: number): Promise<DropRecord[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return [...this.#drops.values()]
      .filter((stored) => stored.drop.expiresAt <= now)
      .sort(
        (left, right) =>
          left.drop.expiresAt - right.drop.expiresAt ||
          left.drop.dropId.localeCompare(right.drop.dropId),
      )
      .slice(0, boundedLimit)
      .map((stored) => structuredClone(stored.drop));
  }

  private async mutate(dropId: string, now: number, mutation: DropMutation): Promise<DropRecord> {
    this.prune(now);
    const stored = this.#drops.get(dropId);
    if (!stored) throw new ServiceError("not_found", "This transfer was not found.", 404);
    if (stored.drop.expiresAt <= now) {
      throw new ServiceError("expired", "This transfer has expired.", 410);
    }
    const next = mutation(structuredClone(stored.drop));
    stored.drop = structuredClone(next);
    return structuredClone(next);
  }

  private prune(now = Date.now()): void {
    for (const [dropId, stored] of this.#drops) {
      if (stored.retentionExpiresAt <= now) this.#drops.delete(dropId);
    }
  }
}
