import { SESSION_ID_PATTERN } from "@print-cess/protocol";

import { parseSessionFragment } from "./session-fragment";

export function parsePrintSessionQr(
  rawValue: string,
  origin: string,
  sessionOrigins: readonly string[] = [],
): string | null {
  if (rawValue.length > 512) return null;
  let url: URL;
  try {
    url = new URL(rawValue.trim());
  } catch {
    return null;
  }
  if (url.origin !== origin && !sessionOrigins.includes(url.origin)) return null;
  if (url.username || url.password || url.search) return null;
  const match = /^\/s\/([^/]+)$/u.exec(url.pathname);
  const sessionId = match?.[1];
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return null;
  if (!parseSessionFragment(url.hash)) return null;
  return `/s/${sessionId}${url.hash}`;
}

export function sessionOriginFrom(publicBaseUrl: string | undefined): string | undefined {
  if (!publicBaseUrl) return undefined;
  let url: URL;
  try {
    url = new URL(publicBaseUrl.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    return undefined;
  }
  return url.origin;
}
