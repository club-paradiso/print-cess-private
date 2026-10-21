import { after } from "next/server";

import { createSessionRequestSchema } from "@print-cess/protocol";

import { isBrowserKioskEnabled } from "@/server/demo";
import { ServiceError } from "@/server/errors";
import { assertAllowedOrigin, errorResponse, json, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { createPrintSession, getRuntime, sweepDueOrphans } from "@/server/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isBrowserKioskEnabled()) {
      throw new ServiceError("not_found", "The requested resource was not found.", 404);
    }

    const server = getRuntime();
    const origin = request.headers.get("origin");
    if (!origin) {
      throw new ServiceError("unauthorized", "This request origin is not allowed.", 403);
    }

    const trustedVercelPreviewOrigin = isTrustedVercelPreviewOrigin(origin);
    if (!trustedVercelPreviewOrigin) {
      assertAllowedOrigin(request, server.config);
    }

    enforceRateLimit(
      `browser-kiosk-create:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
      20,
      60_000,
    );

    const input = {
      ...(await readJson(request, createSessionRequestSchema)),
      supportsBundle: true,
    };
    const { session, uploadToken, kioskToken } = await createPrintSession(input);
    after(async () => {
      await sweepDueOrphans(server, Date.now(), 3).catch(() => undefined);
    });

    const qrBaseUrl = trustedVercelPreviewOrigin ? origin : server.config.publicBaseUrl;
    const capability = `${input.supportsHwpx ? "&hwpx=1" : ""}${input.supportsHwp ? "&hwp=1" : ""}${input.supportsBundle ? "&bundle=1" : ""}`;
    const qrUrl = `${qrBaseUrl}/s/${session.sessionId}#t=${uploadToken}&fp=${session.kioskPublicKeyFingerprint}${capability}`;
    return json(
      {
        protocolVersion: 1,
        sessionId: session.sessionId,
        status: session.status,
        expiresAt: session.expiresAt,
        kioskToken,
        qrUrl,
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function isTrustedVercelPreviewOrigin(origin: string): boolean {
  if (process.env.VERCEL_ENV !== "preview") return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" || parsed.origin !== origin) return false;

  const trustedHosts = [process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL].filter(
    (value): value is string => Boolean(value),
  );
  return trustedHosts.includes(parsed.host);
}
