import type { DropOpenView, DropPendingView } from "@print-cess/protocol";

import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readDropId } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { clientAddress } from "@/server/request-identity";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

const COARSE_PER_CALLER = 240;
const COARSE_PER_DROP = 300;
const MANIFEST_PER_CALLER = 20;
const MANIFEST_PER_DROP = 30;

export async function POST(request: Request, context: { params: Promise<{ dropId: string }> }) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    const dropId = await readDropId(context);
    const caller = clientAddress(request);
    enforceRateLimit(`drop-open-ip:${caller}`, COARSE_PER_CALLER, 60_000);
    enforceRateLimit(`drop-open:${dropId}`, COARSE_PER_DROP, 5 * 60_000);

    const drop = await server.drops.get(dropId);
    if (!drop) throw new ServiceError("not_found", "This transfer was not found.", 404);
    if (drop.expiresAt <= Date.now()) {
      throw new ServiceError("expired", "This transfer has expired.", 410);
    }

    if (drop.status !== "ready") {
      const pending: DropPendingView = {
        protocolVersion: drop.protocolVersion,
        state: "collecting",
        dropId,
        expiresAt: drop.expiresAt,
      };
      return json(pending);
    }

    enforceRateLimit(`drop-manifest-ip:${caller}`, MANIFEST_PER_CALLER, 60_000);
    enforceRateLimit(`drop-manifest:${dropId}`, MANIFEST_PER_DROP, 5 * 60_000);

    const view: DropOpenView = {
      protocolVersion: drop.protocolVersion,
      state: "ready",
      dropId,
      manifest: drop.manifest,
      fileCount: drop.fileCount,
      partCount: drop.partCount,
      partSizes: drop.parts.map((part) => part?.size ?? 0),
      totalCiphertextBytes: drop.totalCiphertextBytes,
      expiresAt: drop.expiresAt,
    };
    await server.drops.recordReceiverEvent(dropId, "opened", Date.now()).catch(() => undefined);
    return json(view);
  } catch (error) {
    return errorResponse(error);
  }
}
