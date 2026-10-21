import { dropDownloadRequestSchema, dropPartPath } from "@print-cess/protocol";

import { relayUrlFor } from "@/server/blob-relay";
import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readDropId, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { clientAddress } from "@/server/request-identity";
import { getRuntime, signedExpiry } from "@/server/runtime";

export const runtime = "nodejs";

/**
 * Signed read URLs for a batch of parts. They are re-issued on demand so a
 * download that stalls on a weak connection resumes from the part it reached
 * instead of restarting the whole transfer.
 */
export async function POST(request: Request, context: { params: Promise<{ dropId: string }> }) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    const dropId = await readDropId(context);
    enforceRateLimit(`drop-download-ip:${clientAddress(request)}`, 600, 60_000);
    enforceRateLimit(`drop-download:${dropId}`, 600, 60_000);

    const drop = await server.drops.get(dropId);
    if (!drop || drop.status !== "ready") {
      throw new ServiceError("not_found", "This transfer was not found.", 404);
    }
    if (drop.expiresAt <= Date.now()) {
      throw new ServiceError("expired", "This transfer has expired.", 410);
    }

    const body = await readJson(request, dropDownloadRequestSchema);
    const expiresAt = signedExpiry(server.config, drop.expiresAt);
    const operations = [];
    for (const index of body.indexes) {
      const part = drop.parts[index];
      if (!part) throw new ServiceError("not_found", "That part is not in this transfer.", 404);
      const operation = await server.blobs.authorizeDownload(
        dropPartPath(dropId, index),
        expiresAt,
      );
      operations.push({
        index,
        method: operation.method,
        url: operation.url,
        relayUrl: relayUrlFor(operation.url),
        headers: operation.headers,
        expiresAt: operation.expiresAt,
        size: part.size,
      });
    }

    // Counted once per batch that starts at the first part. This is the point
    // at which a download has started, and no more than that: whether any byte
    // reached the other phone's storage is something only that phone can
    // report, which it does through the receipt endpoint.
    if (body.indexes.includes(0)) {
      await server.drops
        .recordReceiverEvent(dropId, "downloading", Date.now())
        .catch(() => undefined);
    }
    return json({ dropId, operations });
  } catch (error) {
    return errorResponse(error);
  }
}
