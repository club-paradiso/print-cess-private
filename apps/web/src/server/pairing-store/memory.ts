import type { PairingRecord } from "@print-cess/protocol";

import type { PairingStore } from "../contracts";
import { guessShape, missWindowStart, pairingNotFound, requireLive } from "./transitions";

export class MemoryPairingStore implements PairingStore {
  readonly #pairings = new Map<string, PairingRecord>();
  readonly #misses = new Map<number, number>();

  public async claim(
    pairing: Omit<PairingRecord, "code">,
    candidates: readonly string[],
  ): Promise<PairingRecord | null> {
    this.prune(pairing.createdAt);
    for (const code of candidates) {
      if (this.#pairings.has(code)) continue;
      const claimed: PairingRecord = { ...pairing, code };
      this.#pairings.set(code, structuredClone(claimed));
      return claimed;
    }
    return null;
  }

  public async get(code: string): Promise<PairingRecord | null> {
    const stored = this.#pairings.get(code);
    return stored ? structuredClone(stored) : null;
  }

  public async redeem(
    code: string,
    shape: PairingRecord["shape"],
    now: number,
  ): Promise<PairingRecord> {
    const current = requireLive(await this.get(code), now);
    const guess = guessShape(current, shape);
    if (guess.outcome === "match") {
      this.#pairings.delete(code);
      return current;
    }
    if (guess.remaining) this.#pairings.set(code, structuredClone(guess.remaining));
    else this.#pairings.delete(code);
    throw pairingNotFound();
  }

  public async recordMiss(now: number): Promise<void> {
    const window = missWindowStart(now);
    this.#misses.set(window, (this.#misses.get(window) ?? 0) + 1);
  }

  public async recentMisses(now: number): Promise<number> {
    return this.#misses.get(missWindowStart(now)) ?? 0;
  }

  public async remove(code: string): Promise<void> {
    this.#pairings.delete(code);
  }

  public async pruneExpired(now: number): Promise<void> {
    this.prune(now);
  }

  private prune(now: number): void {
    for (const [code, pairing] of this.#pairings) {
      if (pairing.expiresAt <= now) this.#pairings.delete(code);
    }
    const current = missWindowStart(now);
    for (const window of this.#misses.keys()) {
      if (window < current) this.#misses.delete(window);
    }
  }
}
