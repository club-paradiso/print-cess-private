import { after } from "next/server";

import {
  DROP_CHUNK_BYTES,
  MAX_DROP_PART_BYTES,
  MAX_DROP_MANIFEST_BYTES,
  createDropRequestSchema,
} from "@print-cess/protocol";

import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { createDrop, getRuntime, sweepExpiredDrops } from "@/server/runtime";
import { clientAddress } from "@/server/request-identity";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    enforceRateLimit(`drop-create:${clientAddress(request)}`, 10, 60_000);

    const body = await readJson(request, createDropRequestSchema, MAX_DROP_MANIFEST_BYTES + 2048);
    if (body.totalBytes > server.config.dropMaxTotalBytes) {
      throw new ServiceError("payload_too_large", "This transfer is larger than the limit.", 413);
    }
    const drop = await createDrop(body);

    if (server.cleanup.scheduleSweep) {
      try {
        await server.cleanup.scheduleSweep(drop.expiresAt);
      } catch (error) {
        await server.drops.remove(drop.dropId).catch(() => undefined);
        throw error;
      }
    }

    after(async () => {
      await sweepExpiredDrops(server, Date.now(), 3).catch(() => undefined);
    });

    return json(
      {
        protocolVersion: drop.protocolVersion,
        dropId: drop.dropId,
        status: drop.status,
        expiresAt: drop.expiresAt,
        chunkBytes: DROP_CHUNK_BYTES,
        maximumPartBytes: MAX_DROP_PART_BYTES,
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
