import { headers } from "next/headers";

import { matchAcceptLanguage, type SupportedLocale } from "@print-cess/i18n";

export async function requestLocale(): Promise<SupportedLocale> {
  const requestHeaders = await headers();
  return matchAcceptLanguage(requestHeaders.get("accept-language"));
}
