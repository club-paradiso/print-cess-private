import { POST as createKioskSession } from "@/app/api/kiosk/sessions/route";
import { ServiceError } from "@/server/errors";
import { errorResponse } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!getRuntime().config.demoEnabled) {
      throw new ServiceError("not_found", "The requested resource was not found.", 404);
    }
  } catch (error) {
    return errorResponse(error);
  }
  return createKioskSession(request);
}
