"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { isRightToLeft, matchLocale, translate, type SupportedLocale } from "@print-cess/i18n";

import { preferredLocaleFromCookie, savePreferredLocale } from "./locale-preference";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/**
 * The visitor's language, answered rather than asked.
 *
 * Every screen in this service is reached from the visitor's own phone — the
 * QR code is on a shared kiosk, but the browser that opens it is theirs, and
 * it already carries their language in `Accept-Language`. Making them pick one
 * from a list of thirteen was a screen and a tap spent on a question the
 * service could answer itself, before they had seen the thing they came to do.
 *
 * The server resolves the same preference and renders the first paint in it, so
 * that is the snapshot handed back during hydration: defaulting to English here
 * would make a Korean visitor watch the page load in English and then change
 * under them. The picker stays in the header for the times the guess is wrong.
 */
export function useVisitorLocale(
  initialLocale: SupportedLocale = "en",
  /** A language the visitor already chose on the screen that led here. */
  carriedLocale?: SupportedLocale,
): [SupportedLocale, (locale: SupportedLocale) => void, Text] {
  const detected = useSyncExternalStore(subscribeNever, readBrowserLocale, () => initialLocale);
  const [chosen, setChosen] = useState<SupportedLocale | undefined>(carriedLocale);
  const locale = chosen ?? detected;
  const setLocale = useCallback((next: SupportedLocale) => {
    setChosen(next);
    savePreferredLocale(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRightToLeft(locale) ? "rtl" : "ltr";
  }, [locale]);

  const text = useCallback<Text>((key, values) => translate(locale, key, values), [locale]);
  return [locale, setLocale, text];
}

function subscribeNever(): () => void {
  // Language preferences do not change while a screen is open.
  return () => {};
}

function readBrowserLocale(): SupportedLocale {
  return preferredLocaleFromCookie(document.cookie) ?? matchLocale(navigator.languages);
}
