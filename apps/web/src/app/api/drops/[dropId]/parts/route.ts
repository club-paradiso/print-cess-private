import {
  MAX_DROP_PART_BYTES,
  dropPartAuthorizeRequestSchema,
  dropPartPath,
} from "@print-cess/protocol";

import { authenticateToken, bearerToken } from "@/server/auth";
import { relayUrlFor } from "@/server/blob-relay";
import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readDropId, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { getRuntime, signedExpiry } from "@/server/runtime";

export const runtime = "nodejs";

/**
 * Hands the sending phone a small batch of signed upload URLs. Batching keeps a
 * multi-gigabyte transfer to a handful of round trips per group of parts, and
 * re-authorizing an index is always allowed so a part interrupted by a lost
 * signal can simply be sent again.
 */
export async function POST(request: Request, context: { params: Promise<{ dropId: string }> }) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    const dropId = await readDropId(context);
    enforceRateLimit(`drop-parts:${dropId}`, 600, 60_000);

    const drop = await server.drops.get(dropId);
    if (!drop) throw new ServiceError("not_found", "This transfer was not found.", 404);
    if (drop.expiresAt <= Date.now()) {
      throw new ServiceError("expired", "This transfer has expired.", 410);
    }
    await authenticateToken(
      bearerToken(request, "x-print-cess-drop-token"),
      drop.ownerTokenHash,
      "drop",
    );
    if (drop.status !== "collecting") {
      throw new ServiceError("conflict", "This transfer is already sealed.", 409);
    }

    const body = await readJson(request, dropPartAuthorizeRequestSchema);
    const expiresAt = signedExpiry(server.config, drop.expiresAt);
    const operations = [];
    for (const index of body.indexes) {
      if (index >= drop.partCount) {
        throw new ServiceError("bad_request", "That part is not in this transfer.", 400);
      }
      const operation = await server.blobs.authorizeUpload(
        dropPartPath(dropId, index),
        expiresAt,
        MAX_DROP_PART_BYTES,
        { allowOverwrite: true },
      );
      operations.push({
        index,
        method: operation.method,
        url: operation.url,
        relayUrl: relayUrlFor(operation.url),
        headers: operation.headers,
        expiresAt: operation.expiresAt,
        maximumSize: MAX_DROP_PART_BYTES,
      });
    }
    return json({ dropId, operations });
  } catch (error) {
    return errorResponse(error);
  }
}
