import { after } from "next/server";

import { createSessionRequestSchema } from "@print-cess/protocol";

import { createVisitorPrintSession, getRuntime, sweepDueOrphans } from "@/server/runtime";
import { assertAllowedOrigin, errorResponse, json, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { ServiceError } from "@/server/errors";
import { secretMatches } from "@/server/auth";
import { isValidVisitorOperatorCookie, VISITOR_OPERATOR_COOKIE } from "@/server/visitor-operator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    enforceRateLimit(
      `visitor-create:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
      20,
      60_000,
    );
    if (process.env.NODE_ENV === "production") {
      const expected = process.env.KIOSK_REGISTRATION_SECRET;
      const supplied = request.headers.get("x-kiosk-registration-secret");
      const operatorCookie = request.headers
        .get("cookie")
        ?.split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${VISITOR_OPERATOR_COOKIE}=`))
        ?.slice(VISITOR_OPERATOR_COOKIE.length + 1);
      if (
        !secretMatches(supplied, expected) &&
        !isValidVisitorOperatorCookie(operatorCookie, Date.now(), expected)
      ) {
        throw new ServiceError("unauthorized", "Kiosk registration is not authorized.", 401);
      }
    }
    const input = await readJson(request, createSessionRequestSchema);
    const { session, uploadToken, kioskToken } = await createVisitorPrintSession(input);
    after(async () => {
      await sweepDueOrphans(server, Date.now(), 3).catch(() => undefined);
    });
    const capability = `${input.supportsHwpx ? "&hwpx=1" : ""}${input.supportsHwp ? "&hwp=1" : ""}${input.supportsBundle ? "&bundle=1" : ""}`;
    const qrUrl = `${server.config.publicBaseUrl}/s/${session.sessionId}#t=${uploadToken}&fp=${session.kioskPublicKeyFingerprint}${capability}`;
    return json(
      {
        protocolVersion: 1,
        sessionId: session.sessionId,
        status: session.status,
        expiresAt: session.expiresAt,
        visitorTtlMs: server.config.visitorTtlMs,
        kioskToken,
        qrUrl,
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
