import { NextResponse } from "next/server";

import { assertAllowedOrigin, errorResponse } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

const CLEAR_SITE_DATA = '"cache", "cookies", "storage"';

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request, getRuntime().config);
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Clear-Site-Data": CLEAR_SITE_DATA,
        "Cache-Control": "no-store, max-age=0",
        Vary: "Origin",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
