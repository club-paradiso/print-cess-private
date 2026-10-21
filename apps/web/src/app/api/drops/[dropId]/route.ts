import { dropReceiverState, type DropSenderView } from "@print-cess/protocol";

import { authenticateToken, bearerToken } from "@/server/auth";
import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readDropId } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { deleteDrop, getRuntime } from "@/server/runtime";
import { uploadedPartCount } from "@/server/drop-store/transitions";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ dropId: string }> }) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    const dropId = await readDropId(context);
    enforceRateLimit(`drop-status:${dropId}`, 240, 60_000);

    const drop = await server.drops.get(dropId);
    if (!drop) throw new ServiceError("not_found", "This transfer was not found.", 404);
    await authenticateToken(
      bearerToken(request, "x-print-cess-drop-token"),
      drop.ownerTokenHash,
      "drop",
    );
    const view: DropSenderView = {
      protocolVersion: drop.protocolVersion,
      dropId,
      status: drop.status,
      uploadedPartCount: uploadedPartCount(drop),
      partCount: drop.partCount,
      receiver: dropReceiverState(drop),
      openCount: drop.openCount,
      downloadCount: drop.downloadCount,
      deliveredCount: drop.deliveredCount,
      expiresAt: drop.expiresAt,
    };
    return json(view);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ dropId: string }> }) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    const dropId = await readDropId(context);
    enforceRateLimit(`drop-delete:${dropId}`, 20, 60_000);

    const drop = await server.drops.get(dropId);
    if (!drop) return json({ dropId, deleted: true });
    await authenticateToken(
      bearerToken(request, "x-print-cess-drop-token"),
      drop.ownerTokenHash,
      "drop",
    );
    await deleteDrop(server, drop);
    return json({ dropId, deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
