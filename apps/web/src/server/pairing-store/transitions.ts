import { PAIRING_SHAPE_TRIES, type PairingRecord, type PairingShape } from "@print-cess/protocol";

import { ServiceError } from "../errors";

/** Wrong guesses the whole service tolerates per window before joins pause. */
export const PAIRING_GLOBAL_MISS_LIMIT = 60;
export const PAIRING_MISS_WINDOW_MS = 60_000;

export function pairingNotFound(): ServiceError {
  return new ServiceError(
    "not_found",
    "Those numbers and that shape do not match a transfer.",
    404,
  );
}

export function requireLive(pairing: PairingRecord | null, now: number): PairingRecord {
  if (!pairing || pairing.expiresAt <= now) throw pairingNotFound();
  return pairing;
}

/**
 * What a shape guess does to a stored escrow. A match consumes it; a miss is
 * counted, and the last allowed miss deletes it. The caller answers a miss
 * exactly like an unknown code, so a guess never reveals that a code is live.
 */
export type ShapeGuess =
  { outcome: "match" } | { outcome: "miss"; remaining: PairingRecord | null };

export function guessShape(pairing: PairingRecord, shape: PairingShape): ShapeGuess {
  if (pairing.shape === shape) return { outcome: "match" };
  const misses = (pairing.misses ?? 0) + 1;
  return {
    outcome: "miss",
    remaining: misses >= PAIRING_SHAPE_TRIES ? null : { ...pairing, misses },
  };
}

export function missWindowStart(now: number): number {
  return now - (now % PAIRING_MISS_WINDOW_MS);
}
