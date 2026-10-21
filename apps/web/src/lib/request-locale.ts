import { headers } from "next/headers";

import { matchAcceptLanguage, type SupportedLocale } from "@print-cess/i18n";

import { preferredLocaleFromCookie } from "./locale-preference";

/**
 * The visitor's language for this request, read from `Accept-Language`.
 *
 * Every screen in this service is opened on the visitor's own phone. The QR
 * code sits on a shared kiosk, but the browser that scans it is theirs and
 * already carries their language, so asking for it again is a question the
 * service could have answered itself. Resolving it on the server also means the
 * first paint is already correct: a client-only guess renders English and then
 * swaps, which a visitor sees as the page changing language under them.
 */
export async function requestLocale(): Promise<SupportedLocale> {
  const requestHeaders = await headers();
  return (
    preferredLocaleFromCookie(requestHeaders.get("cookie")) ??
    matchAcceptLanguage(requestHeaders.get("accept-language"))
  );
}

/**
 * A shared print station retains its Korean first-screen default. Unlike
 * a visitor's private phone, the station browser's language setting is not a
 * reliable indication of the next visitor's language. An explicit choice
 * persists across reloads through the same allowlisted preference cookie.
 */
export async function requestKioskLocale(): Promise<SupportedLocale> {
  const requestHeaders = await headers();
  return preferredLocaleFromCookie(requestHeaders.get("cookie")) ?? "ko";
}
