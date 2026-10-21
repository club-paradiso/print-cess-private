"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { isRightToLeft, matchLocale, translate, type SupportedLocale } from "@print-cess/i18n";

export type Text = (key: string, values?: Record<string, string | number>) => string;

export function useVisitorLocale(
  initialLocale: SupportedLocale = "en",
  carriedLocale?: SupportedLocale,
): [SupportedLocale, (locale: SupportedLocale) => void, Text] {
  const detected = useSyncExternalStore(subscribeNever, readBrowserLocale, () => initialLocale);
  const [chosen, setChosen] = useState<SupportedLocale | undefined>(carriedLocale);
  const locale = chosen ?? detected;
  const setLocale = useCallback((next: SupportedLocale) => setChosen(next), []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRightToLeft(locale) ? "rtl" : "ltr";
  }, [locale]);

  const text = useCallback<Text>((key, values) => translate(locale, key, values), [locale]);
  return [locale, setLocale, text];
}

function subscribeNever(): () => void {
  return () => {};
}

function readBrowserLocale(): SupportedLocale {
  return matchLocale(navigator.languages);
}
