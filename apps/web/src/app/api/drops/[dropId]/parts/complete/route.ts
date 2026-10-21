import { dropPartCommitRequestSchema, dropPartPath } from "@print-cess/protocol";

import { authenticateToken, bearerToken } from "@/server/auth";
import type { DropPartCommit } from "@/server/contracts";
import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readDropId, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { getRuntime } from "@/server/runtime";
import { uploadedPartCount } from "@/server/drop-store/transitions";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ dropId: string }> }) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    const dropId = await readDropId(context);
    enforceRateLimit(`drop-commit:${dropId}`, 600, 60_000);

    const drop = await server.drops.get(dropId);
    if (!drop) throw new ServiceError("not_found", "This transfer was not found.", 404);
    const tokenHash = await authenticateToken(
      bearerToken(request, "x-print-cess-drop-token"),
      drop.ownerTokenHash,
      "drop",
    );

    const body = await readJson(request, dropPartCommitRequestSchema);
    const commits: DropPartCommit[] = [];
    for (const part of body.parts) {
      if (part.index >= drop.partCount) {
        throw new ServiceError("bad_request", "That part is not in this transfer.", 400);
      }
      const stored = await server.blobs.head(dropPartPath(dropId, part.index));
      if (stored.size !== part.size) {
        throw new ServiceError("conflict", "A part did not arrive completely.", 409);
      }
      commits.push({ index: part.index, size: stored.size, etag: stored.etag });
    }

    const updated = await server.drops.commitParts(dropId, tokenHash, commits, Date.now());
    return json({
      dropId,
      status: updated.status,
      uploadedPartCount: uploadedPartCount(updated),
      partCount: updated.partCount,
      expiresAt: updated.expiresAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
