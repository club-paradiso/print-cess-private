import type { PairingRecord } from "@print-cess/protocol";

import type { PairingStore } from "../contracts";
import { requireLive, requireShape } from "./transitions";

export class MemoryPairingStore implements PairingStore {
  readonly #pairings = new Map<string, PairingRecord>();

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
    this.#pairings.delete(code);
    return requireShape(current, shape);
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
  }
}
