import {
  DROP_CHUNK_BYTES,
  DROP_PROTOCOL_VERSION,
  MAX_DROP_FILES,
  MAX_DROP_FILE_NAME_BYTES,
  MAX_DROP_PARTS,
  type DropCapabilities,
} from "@print-cess/protocol";

import { relayStoreId } from "@/server/blob-relay";
import { assertAllowedOrigin, errorResponse, json } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { clientAddress } from "@/server/request-identity";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    enforceRateLimit(`drop-capabilities:${clientAddress(request)}`, 60, 60_000);

    const capabilities: DropCapabilities = {
      protocolVersion: DROP_PROTOCOL_VERSION,
      maximumTotalBytes: server.config.dropMaxTotalBytes,
      maximumFileCount: MAX_DROP_FILES,
      maximumParts: MAX_DROP_PARTS,
      maximumFileNameBytes: MAX_DROP_FILE_NAME_BYTES,
      chunkBytes: DROP_CHUNK_BYTES,
      ttlSeconds: Math.floor(server.config.dropTtlMs / 1000),
      sameOriginTransfers: relayStoreId() !== null,
    };
    return json(capabilities);
  } catch (error) {
    return errorResponse(error);
  }
}
