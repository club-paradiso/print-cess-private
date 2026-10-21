"use client";

import type { ReactNode } from "react";
import { Languages } from "lucide-react";
import Link from "next/link";

import { LOCALE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from "@print-cess/i18n";
import { Wordmark } from "@print-cess/ui";

export function AppTopbar({
  locale,
  onLocaleChange,
  languageLabel,
  section,
}: {
  locale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
  languageLabel: string;
  section?: { icon: ReactNode; label: string };
}) {
  return (
    <>
      <div className="mobile-topbar">
        <Link className="app-topbar__home" href="/start">
          <Wordmark compact />
        </Link>
        <LanguagePicker locale={locale} onChange={onLocaleChange} label={languageLabel} />
      </div>
      {section ? (
        <p className="app-section">
          {section.icon}
          {section.label}
        </p>
      ) : null}
    </>
  );
}

export function LanguagePicker({
  locale,
  onChange,
  label,
}: {
  locale: SupportedLocale;
  onChange: (locale: SupportedLocale) => void;
  label: string;
}) {
  return (
    <label className="drop-language">
      <Languages aria-hidden="true" />
      <span className="drop-visually-hidden">{label}</span>
      <select value={locale} onChange={(event) => onChange(event.target.value as SupportedLocale)}>
        {SUPPORTED_LOCALES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {LOCALE_NAMES[candidate]}
          </option>
        ))}
      </select>
    </label>
  );
}
