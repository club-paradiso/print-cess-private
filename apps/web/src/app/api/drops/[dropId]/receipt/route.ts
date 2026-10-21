import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readDropId } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { clientAddress } from "@/server/request-identity";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ dropId: string }> }) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    const dropId = await readDropId(context);
    enforceRateLimit(`drop-receipt-ip:${clientAddress(request)}`, 60, 60_000);
    enforceRateLimit(`drop-receipt:${dropId}`, 30, 5 * 60_000);

    const drop = await server.drops.get(dropId);
    if (!drop || drop.status !== "ready") {
      throw new ServiceError("not_found", "This transfer was not found.", 404);
    }
    await server.drops.recordReceiverEvent(dropId, "delivered", Date.now());
    return json({ dropId, recorded: true });
  } catch (error) {
    return errorResponse(error);
  }
}
