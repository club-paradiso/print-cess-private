import { SUPPORTED_LOCALES, type SupportedLocale } from "@print-cess/i18n";

/** A language explicitly selected by this browser, shared across Print, Share and Scan. */
export const VISITOR_LOCALE_COOKIE = "print-cess-locale";

export function preferredLocaleFromCookie(
  header: string | null | undefined,
): SupportedLocale | undefined {
  const value = header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${VISITOR_LOCALE_COOKIE}=`))
    ?.slice(VISITOR_LOCALE_COOKIE.length + 1);
  if (!value) return undefined;
  try {
    const decoded = decodeURIComponent(value);
    return SUPPORTED_LOCALES.find((locale) => locale === decoded);
  } catch {
    return undefined;
  }
}

export function savePreferredLocale(locale: SupportedLocale): void {
  // No personal data, no server-side session: only an allowlisted language tag.
  document.cookie = `${VISITOR_LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=15552000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
}
