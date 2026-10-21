import {
  PAIRING_CODE_PATTERN,
  redeemPairingRequestSchema,
  type PairingRecord,
  type PairingReceiverView,
} from "@print-cess/protocol";

import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readJson } from "@/server/http";
import { pairingNotFound } from "@/server/pairing-store/transitions";
import { assertUnderRateLimit, enforceRateLimit } from "@/server/rate-limit";
import { clientAddress } from "@/server/request-identity";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    const { code } = await context.params;
    if (!PAIRING_CODE_PATTERN.test(code)) throw pairingNotFound();

    const address = clientAddress(request);
    enforceRateLimit(`pairing-redeem:${address}`, 120, 60_000);
    assertUnderRateLimit(`pairing-miss:${address}`, 5, 15 * 60_000);

    const body = await readJson(request, redeemPairingRequestSchema, 1024);
    let pairing: PairingRecord;
    try {
      pairing = await server.pairings.redeem(code, body.shape, Date.now());
    } catch (error) {
      if (error instanceof ServiceError && error.code === "not_found") {
        enforceRateLimit(`pairing-miss:${address}`, 5, 15 * 60_000);
      }
      throw error;
    }

    const view: PairingReceiverView = {
      protocolVersion: 1,
      transferCode: pairing.transferCode,
      expiresAt: pairing.expiresAt,
    };
    return json(view);
  } catch (error) {
    return errorResponse(error);
  }
}
