import type { PairingRecord, PairingShape } from "@print-cess/protocol";

import { ServiceError } from "../errors";

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

export function requireShape(pairing: PairingRecord, shape: PairingShape): PairingRecord {
  if (pairing.shape !== shape) throw pairingNotFound();
  return pairing;
}
