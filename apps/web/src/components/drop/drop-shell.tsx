"use client";

import type { ReactNode } from "react";
import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Presentation,
  Share2,
} from "lucide-react";

import type { SupportedLocale } from "@print-cess/i18n";
import { ScreenShell } from "@print-cess/ui";

import { AppTopbar } from "@/components/shared/app-topbar";

import { dropFileKind, dropFileKindLabelKey, type DropFileKind } from "@/lib/drop-file-kind";
import { useVisitorLocale, type Text } from "@/lib/use-visitor-locale";

export type { Text };

export const useDropLocale = useVisitorLocale;

export function DropShell({
  locale,
  onLocaleChange,
  text,
  children,
}: {
  locale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
  text: Text;
  children: ReactNode;
}) {
  return (
    <ScreenShell>
      <AppTopbar
        locale={locale}
        onLocaleChange={onLocaleChange}
        languageLabel={text("selectLanguage")}
        section={{ icon: <Share2 aria-hidden="true" />, label: text("shareTitle") }}
      />
      {children}
    </ScreenShell>
  );
}

export function TransferBar({
  progress,
  text,
  minutesRemaining,
}: {
  progress: { transferredBytes: number; totalBytes: number };
  text: Text;
  minutesRemaining?: number | null;
}) {
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, Math.floor((progress.transferredBytes / progress.totalBytes) * 100))
      : 0;
  return (
    <div className="drop-progress">
      <div
        className="drop-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={text("dropPercent", { percent })}
      >
        <span className="drop-progress__fill" style={{ inlineSize: `${percent}%` }} />
      </div>
      <p className="drop-progress__label">
        {text("dropPercent", { percent })} · {formatBytes(progress.transferredBytes)} /{" "}
        {formatBytes(progress.totalBytes)}
        {minutesRemaining ? ` · ${text("dropRemaining", { minutes: minutesRemaining })}` : ""}
      </p>
    </div>
  );
}

export function FileRow({
  file,
  text,
  detail,
}: {
  file: { name: string; size: number; type: string };
  text: Text;
  detail?: string | undefined;
}) {
  const kind = dropFileKind(file.name, file.type);
  const Icon = FILE_KIND_ICONS[kind];
  return (
    <div className="drop-file__row">
      <span className="drop-file__icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="drop-file__detail">
        <span className="drop-file-list__name">{file.name}</span>
        <span className="drop-file-list__size">
          {text(dropFileKindLabelKey(kind))} · {formatBytes(file.size)}
          {detail ? ` · ${detail}` : ""}
        </span>
      </span>
    </div>
  );
}

const FILE_KIND_ICONS: Record<DropFileKind, typeof FileText> = {
  pdf: FileType,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  document: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  text: FileCode2,
  hancom: FileType,
  file: File,
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function minutesUntil(timestamp: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((timestamp - now) / 60_000));
}
