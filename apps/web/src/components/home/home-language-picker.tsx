"use client";

import { translate, type SupportedLocale } from "@print-cess/i18n";

import { LanguagePicker } from "@/components/shared/app-topbar";
import { savePreferredLocale } from "@/lib/locale-preference";

/** The guide is server-rendered in the selected language from the first paint. */
export function HomeLanguagePicker({ locale }: { locale: SupportedLocale }) {
  return (
    <div className="home-language-picker">
      <LanguagePicker
        locale={locale}
        label={translate(locale, "selectLanguage")}
        onChange={(next) => {
          savePreferredLocale(next);
          window.location.reload();
        }}
      />
    </div>
  );
}
