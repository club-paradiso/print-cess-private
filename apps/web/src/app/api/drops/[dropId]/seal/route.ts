import { authenticateToken, bearerToken } from "@/server/auth";
import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readDropId } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ dropId: string }> }) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    const dropId = await readDropId(context);
    enforceRateLimit(`drop-seal:${dropId}`, 20, 60_000);

    const drop = await server.drops.get(dropId);
    if (!drop) throw new ServiceError("not_found", "This transfer was not found.", 404);
    const tokenHash = await authenticateToken(
      bearerToken(request, "x-print-cess-drop-token"),
      drop.ownerTokenHash,
      "drop",
    );
    const sealed = await server.drops.seal(dropId, tokenHash, Date.now());
    return json({ dropId, status: sealed.status, expiresAt: sealed.expiresAt });
  } catch (error) {
    return errorResponse(error);
  }
}
