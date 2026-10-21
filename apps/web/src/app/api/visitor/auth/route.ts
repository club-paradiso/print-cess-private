import { z } from "zod";

import { secretMatches } from "@/server/auth";
import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { getRuntime } from "@/server/runtime";
import { issueVisitorOperatorCookie, VISITOR_OPERATOR_COOKIE } from "@/server/visitor-operator";

export const runtime = "nodejs";

/** Staff explicitly unlocks the protected visitor counter; this endpoint never returns the secret. */
export async function POST(request: Request) {
  try {
    const server = getRuntime();
    assertAllowedOrigin(request, server.config);
    enforceRateLimit(
      `visitor-unlock:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
      5,
      300_000,
    );
    const body = await readJson(
      request,
      z.object({ registrationSecret: z.string().min(1).max(256) }),
    );
    if (!secretMatches(body.registrationSecret, process.env.KIOSK_REGISTRATION_SECRET)) {
      throw new ServiceError("unauthorized", "Staff authentication failed.", 401);
    }
    const result = json({ ok: true });
    result.cookies.set(VISITOR_OPERATOR_COOKIE, issueVisitorOperatorCookie(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/visitor",
      maxAge: 30 * 60,
    });
    return result;
  } catch (error) {
    return errorResponse(error);
  }
}
