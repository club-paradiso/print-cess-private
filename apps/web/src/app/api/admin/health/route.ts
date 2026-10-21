import { secretMatches } from "@/server/auth";
import { ServiceError } from "@/server/errors";
import { errorResponse, json } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

const PROBE_SESSION_ID = "AAAAAAAAAAAAAAAAAAAAAA";

export async function GET(request: Request) {
  try {
    const expected = process.env.ADMIN_DIAGNOSTICS_SECRET;
    if (!expected) {
      throw new ServiceError("unavailable", "Administrator authentication is not configured.", 503);
    }
    if (!secretMatches(request.headers.get("x-admin-secret"), expected)) {
      throw new ServiceError("unauthorized", "Administrator authentication failed.", 401);
    }

    const server = getRuntime();
    let sessionStore: "ready" | "unavailable" = "ready";
    try {
      await server.sessions.get(PROBE_SESSION_ID);
    } catch {
      sessionStore = "unavailable";
    }

    return json({
      adapterMode: server.config.mode,
      server: "ready",
      sessionStore,
      blob: server.config.mode === "local" ? "encrypted-local-ready" : "configured-unverified",
      cleanup: server.config.mode === "local" ? "in-process-ready" : "configured-unverified",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
