"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  Building2,
  Camera,
  CheckCircle2,
  CircleHelp,
  Download,
  FileCheck2,
  FileSearch,
  Languages,
  LockKeyhole,
  Printer,
  PrinterX,
  RotateCcw,
  ScanLine,
  Send,
  Smartphone,
  UploadCloud,
  UserX,
} from "lucide-react";

import {
  isRightToLeft,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  translate,
  type SupportedLocale,
} from "@print-cess/i18n";
import { Beacon, ScanFrame, Wordmark } from "@print-cess/ui";

import { printArtifact, type PrintArtifact } from "@/lib/kiosk-print";
import { LanguagePicker } from "@/components/shared/app-topbar";

/**
 * The screens of the shared display, shared by the routed browser kiosk
 * (`/kiosk`, several files per visit) and the single-file demo kiosk, so both
 * look and read the same. They only draw; the session, the crypto and the
 * printing stay in the simulators that own them.
 */

export type KioskStatus =
  | "preparing"
  | "waiting"
  | "claimed"
  | "uploading"
  | "uploaded"
  | "validating"
  | "printing"
  | "completed"
  | "failed";

// Korean and English stay on screen permanently; the remaining languages take
// turns on one line so a visitor sees the same instruction in their own
// language without the display filling up with text.
const SPOTLIGHT_LOCALES: readonly SupportedLocale[] = SUPPORTED_LOCALES.filter(
  (locale) => locale !== "ko" && locale !== "en",
);
const SPOTLIGHT_INTERVAL_MS = 4500;

/**
 * Everything else the service does, for the main page. Printing starts at the
 * QR code; these are the other doors, so nobody who came to send a file or
 * scan a page has to know another address.
 */
const SERVICES: {
  href: string;
  key: string;
  korean: string;
  english: string;
  icon: typeof Send;
}[] = [
  {
    href: "/send",
    key: "homeShareCta",
    korean: "파일 보내기",
    english: "Send files",
    icon: Send,
  },
  {
    href: "/receive",
    key: "homeReceiveCta",
    korean: "파일 받기",
    english: "Receive files",
    icon: ArrowDownToLine,
  },
  {
    href: "/scan",
    key: "homeScanCta",
    korean: "문서 스캔",
    english: "Scan a document",
    icon: ScanLine,
  },
  {
    href: "/workstation",
    key: "homeWorkstationCta",
    korean: "업무용 PC",
    english: "Work computer",
    icon: Building2,
  },
  {
    href: "/start",
    key: "homeStepsLabel",
    korean: "이용 안내",
    english: "How it works",
    icon: CircleHelp,
  },
];

type LocaleChange = (locale: SupportedLocale) => void;

function KioskLanguagePicker({
  locale,
  onChange,
}: {
  locale: SupportedLocale;
  onChange?: LocaleChange | undefined;
}) {
  return onChange ? (
    <LanguagePicker
      locale={locale}
      onChange={onChange}
      label={translate(locale, "selectLanguage")}
    />
  ) : null;
}

/** The waiting screen: one instruction, the whole visit, and the code. */
export function KioskWaitingScreen({
  status,
  session,
  remaining,
  lifetime: sessionLifetime,
  maxFiles,
  services = false,
  locale = "ko",
  onLocaleChange,
}: {
  status: KioskStatus;
  session?: { qrUrl: string; qrImage: string } | undefined;
  remaining: number;
  /** Seconds the current QR code had when it appeared. */
  lifetime: number;
  /** How many files one visit may print; omitted for the one-file kiosk. */
  maxFiles?: number;
  /**
   * Show the links to the service's other features. On for the main page;
   * off for `/kiosk`, the station URL, where a tap away would leave the
   * printer's screen without its QR code.
   */
  services?: boolean;
  locale?: SupportedLocale;
  onLocaleChange?: LocaleChange;
}) {
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(
      () => setSpotlightIndex((index) => (index + 1) % SPOTLIGHT_LOCALES.length),
      SPOTLIGHT_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  const spotlight = SPOTLIGHT_LOCALES[spotlightIndex] ?? "zh-CN";
  const navigationLabel = locale === "ko" ? "다른 기능" : translate(locale, "homeMoreTitle");
  const lifetime = session ? Math.max(1, sessionLifetime) : 1;
  const qrProgress = session ? Math.min(1, remaining / lifetime) : 1;

  return (
    <main
      className="kiosk-shell kiosk-shell--waiting"
      lang={locale}
      dir={isRightToLeft(locale) ? "rtl" : "ltr"}
      data-kiosk-state="waiting"
    >
      <header className="kiosk-header">
        <Wordmark />
        <KioskLanguagePicker locale={locale} onChange={onLocaleChange} />
        {/* Only while the code is still being made. Once it is on screen the
            code itself says the display is ready; a pill reading "available"
            only made visitors wonder what was available. */}
        {status === "preparing" ? (
          <p className="kiosk-availability" aria-live="polite">
            <span className="kiosk-availability__dot" />
            {locale === "ko" ? "QR코드를 준비하고 있어요" : translate(locale, "kioskScanTitle")}
          </p>
        ) : null}
        {services ? (
          <nav className="kiosk-services" aria-label={navigationLabel}>
            <ul>
              {SERVICES.map(({ href, key, korean, english, icon: Icon }) => (
                <li key={href}>
                  <Link href={href}>
                    <Icon aria-hidden="true" />
                    <span>
                      <strong>{locale === "ko" ? korean : translate(locale, key)}</strong>
                      <small lang="en">{english}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <div className="kiosk-layout">
        <section className="kiosk-instructions" aria-labelledby="kiosk-title">
          {/* The same Beacon the visitor's guide (/start) shows, so somebody
              told to "look for the screen with this mark" can match it. It
              carries no words of its own: a label like "Start printing here"
              read as a button to press, and the headline below already says
              what to do. */}
          <div className="kiosk-beacon">
            <Beacon size="sm" />
          </div>

          <h1
            id="kiosk-title"
            className={locale === "ko" ? "kiosk-title" : "kiosk-title kiosk-title--translated"}
          >
            {locale === "ko" ? (
              <>
                <span>휴대전화 카메라로</span>
                <span>
                  <em>QR코드</em>를 비추세요
                </span>
              </>
            ) : (
              <span>{translate(locale, "kioskScanTitle")}</span>
            )}
          </h1>
          <p className="kiosk-english" lang="en">
            Point your phone camera at the QR code
          </p>
          {/* One line, rotating through the languages that are not permanently
              on screen, so a visitor who reads neither Korean nor English still
              sees what to do. Hidden from assistive technology because a line
              that changes on a timer would interrupt it repeatedly. */}
          <p
            className="kiosk-spotlight"
            lang={spotlight}
            dir={isRightToLeft(spotlight) ? "rtl" : "ltr"}
            aria-hidden="true"
          >
            <span>{LOCALE_NAMES[spotlight]}</span>
            {translate(spotlight, "kioskScanTitle")}
          </p>

          {/* The whole visit in three steps, so the first one is not mistaken
              for all of it: scan here, choose on the phone, collect from the
              printer. The first is the one happening at this screen. */}
          <ol className="kiosk-steps" aria-label="인쇄하는 방법">
            <li className="kiosk-step is-current">
              <span className="kiosk-step__icon" aria-hidden="true">
                <ScanLine />
              </span>
              <span className="kiosk-step__number" aria-hidden="true">
                1
              </span>
              <div>
                <strong>
                  {locale === "ko" ? "QR코드 비추기" : translate(locale, "homePrintStepScan")}
                </strong>
                <small>
                  {locale === "ko"
                    ? "휴대전화에 뜨는 링크를 누르세요"
                    : translate(locale, "homePrintStepScanBody")}
                  <span lang="en"> · Tap the link on your phone</span>
                </small>
              </div>
            </li>
            <li className="kiosk-step">
              <span className="kiosk-step__icon" aria-hidden="true">
                <Smartphone />
              </span>
              <span className="kiosk-step__number" aria-hidden="true">
                2
              </span>
              <div>
                <strong>
                  {locale === "ko"
                    ? "휴대전화에서 파일 고르기"
                    : translate(locale, "homePrintStepPick")}
                </strong>
                {maxFiles ? (
                  <small>
                    {locale === "ko"
                      ? `사진과 PDF, 한 번에 최대 ${maxFiles}개`
                      : translate(locale, "homePrintStepPickBody")}
                    <span lang="en"> · Choose up to {maxFiles} files</span>
                  </small>
                ) : (
                  <small>
                    {locale === "ko"
                      ? "사진이나 PDF를 고르고 미리 보기를 확인하세요"
                      : translate(locale, "homePrintStepPickBody")}
                    <span lang="en"> · Pick a photo or PDF</span>
                  </small>
                )}
              </div>
            </li>
            <li className="kiosk-step">
              <span className="kiosk-step__icon" aria-hidden="true">
                <Printer />
              </span>
              <span className="kiosk-step__number" aria-hidden="true">
                3
              </span>
              <div>
                <strong>
                  {locale === "ko"
                    ? "프린터에서 종이 받기"
                    : translate(locale, "homePrintStepCollect")}
                </strong>
                <small>
                  {locale === "ko"
                    ? "고른 파일이 바로 인쇄돼요"
                    : translate(locale, "homePrintStepCollectBody")}
                  <span lang="en"> · Collect your pages</span>
                </small>
              </div>
            </li>
          </ol>
        </section>

        <section
          className="kiosk-qr"
          aria-label={translate(locale, "kioskScanTitle")}
          // The QR URL carries the one-time upload token and key fingerprint.
          // End-to-end tests need to read it, but a Production kiosk must not
          // publish it as page text where a DOM snapshot or an extension could
          // pick it up; the QR image alone is enough there.
          data-session-url={process.env.NODE_ENV === "production" ? undefined : session?.qrUrl}
        >
          <p className="kiosk-qr__instruction">
            <Camera aria-hidden="true" />
            <span>
              <strong>
                {locale === "ko"
                  ? "QR코드를 카메라로 비추세요"
                  : translate(locale, "kioskScanTitle")}
              </strong>
              <small>사진을 찍을 필요는 없습니다 · No photo needed</small>
            </span>
          </p>
          <div className="kiosk-qr__stage">
            <div className="kiosk-qr__frame">
              <ScanFrame />
              {session ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={session.qrImage} alt={translate(locale, "kioskScanTitle")} />
              ) : (
                <div className="kiosk-qr__loading" aria-busy="true" />
              )}
            </div>
          </div>
          {/* Time is shown as a bar that empties as well as a number, so a
              visitor can tell at a glance whether to hurry, and so nobody is
              surprised when the code changes under their camera. */}
          <div className="kiosk-qr__timer">
            <span
              className="kiosk-qr__timer-bar"
              aria-hidden="true"
              style={{ "--kiosk-qr-progress": qrProgress } as CSSProperties}
            />
            <span className="kiosk-countdown">
              새 QR코드로 바뀌기까지 <b>{formatTime(remaining)}</b>
            </span>
          </div>
        </section>
      </div>

      <footer className="kiosk-footer">
        <p>
          <LockKeyhole aria-hidden="true" />
          <span>
            {locale === "ko" ? (
              <>
                인쇄가 끝나면 <strong>보낸 파일은 바로 삭제</strong>
              </>
            ) : (
              translate(locale, "privacySummary")
            )}
          </span>
        </p>
        <p>
          <UserX aria-hidden="true" />
          <span>
            {locale === "ko" ? (
              <>
                <strong>가입 없이</strong> 바로 인쇄
              </>
            ) : (
              translate(locale, "homeNoAccount")
            )}
          </span>
        </p>
        <p>
          <FileCheck2 aria-hidden="true" />
          <span>
            <strong>PDF · JPG/JPEG · HEIC 등 사진</strong>
          </span>
        </p>
        <p className="kiosk-languages">
          <Languages aria-hidden="true" />
          <span>
            {SUPPORTED_LOCALES.length} languages · {translate(locale, "selectLanguage")}
          </span>
        </p>
      </footer>
    </main>
  );
}

/**
 * The stations the files pass through, as the kiosk sees them. Each one maps
 * to a state the protocol actually has, so a step lights up only because the
 * session reached it: what the room sees and what the service knows cannot
 * drift apart.
 */
const JOURNEY: {
  status: KioskStatus;
  korean: string;
  english: string;
  icon: typeof Smartphone;
}[] = [
  {
    status: "claimed",
    korean: "연결됨",
    english: "Connected",
    icon: Smartphone,
  },
  {
    status: "uploading",
    korean: "도착하는 중",
    english: "Arriving",
    icon: UploadCloud,
  },
  {
    status: "validating",
    korean: "확인하는 중",
    english: "Checking",
    icon: FileSearch,
  },
  {
    status: "printing",
    korean: "인쇄하는 중",
    english: "Printing",
    icon: Printer,
  },
];

const JOURNEY_ORDER: KioskStatus[] = [
  "claimed",
  "uploading",
  "uploaded",
  "validating",
  "printing",
  "completed",
];

/**
 * What the room should do at each stage, in one sentence. The visitor is
 * either looking at their phone or waiting at the printer; the screen says
 * which, so nobody stands in front of it wondering whether it is their turn.
 */
function connectedCopy(status: KioskStatus): {
  headline: string;
  english: string;
  hint: string;
} {
  if (status === "printing") {
    return {
      headline: "선택한 파일을 인쇄하고 있어요",
      english: "Printing your selected files",
      hint: "프린터 앞에서 종이를 기다려 주세요",
    };
  }
  if (status === "uploading" || status === "uploaded" || status === "validating") {
    return {
      headline: "파일을 받고 있어요",
      english: "Receiving your files",
      hint: "곧 인쇄가 시작돼요. 잠시만 기다려 주세요",
    };
  }
  return {
    headline: "휴대전화에서 계속하세요",
    english: "Continue on your phone",
    hint: "인쇄할 파일을 고르고 휴대전화의 인쇄 버튼을 누르세요",
  };
}

/**
 * What the shared screen shows while the work is happening on somebody's
 * phone: a category and a stage, never a file name, a count, or a thumbnail.
 */
export function ConnectedScreen({
  status,
  remaining,
  locale = "ko",
  onLocaleChange,
}: {
  status: KioskStatus;
  remaining: number;
  locale?: SupportedLocale;
  onLocaleChange?: LocaleChange;
}) {
  const reached = JOURNEY_ORDER.indexOf(status);
  const copy = connectedCopy(status);
  const TokenIcon =
    status === "printing" ? Printer : status === "claimed" ? Smartphone : FileSearch;
  return (
    <main
      className="kiosk-shell kiosk-shell--connected"
      lang={locale}
      dir={isRightToLeft(locale) ? "rtl" : "ltr"}
      data-kiosk-state="connected"
    >
      <header className="kiosk-header">
        <Wordmark />
        <KioskLanguagePicker locale={locale} onChange={onLocaleChange} />
        <p className="kiosk-connected__badge">
          <Smartphone aria-hidden="true" /> 휴대전화가 연결됐어요
          <small lang="en">Phone connected</small>
        </p>
      </header>
      <div className="kiosk-connected">
        <div
          className={`kiosk-token kiosk-token--${status}`}
          aria-hidden="true"
          data-testid="kiosk-document-token"
        >
          <TokenIcon />
        </div>
        <h1 className="kiosk-connected__headline">
          {copy.headline}
          <small lang="en">{copy.english}</small>
        </h1>
        <p className="kiosk-connected__hint">{copy.hint}</p>
        <ol className="kiosk-journey">
          {JOURNEY.map((step, index) => {
            const at = JOURNEY_ORDER.indexOf(step.status);
            // "uploaded" sits between arriving and checking; it is still the
            // arriving stage as far as the room is concerned.
            const effective = status === "uploaded" ? JOURNEY_ORDER.indexOf("uploading") : reached;
            const state = effective > at ? "is-done" : effective === at ? "is-active" : undefined;
            const Icon = state === "is-done" ? CheckCircle2 : step.icon;
            return (
              <li
                key={step.status}
                className={state}
                aria-current={state === "is-active" ? "step" : undefined}
              >
                <span className="kiosk-journey__icon" aria-hidden="true">
                  <Icon />
                </span>
                {/* The word carries the stage as well as the colour, so it
                    survives a monochrome screen and reduced motion alike. */}
                <strong>
                  <span className="kiosk-journey__index" aria-hidden="true">
                    {index + 1}.{" "}
                  </span>
                  {step.korean}
                </strong>
                <small lang="en">{step.english}</small>
              </li>
            );
          })}
        </ol>
        <div className="kiosk-status-row" aria-live="polite">
          {/* The headline already says the stage to anyone looking; this
              copy is for a screen reader, which hears it as it changes. */}
          <strong className="drop-visually-hidden">{statusLabel(status)}</strong>
          <span className="kiosk-countdown">
            남은 시간 <b>{formatTime(remaining)}</b>
          </span>
        </div>
      </div>
    </main>
  );
}

export function CompletedScreen({
  artifacts,
  automaticPrinting,
  remaining,
  locale = "ko",
  onLocaleChange,
}: {
  artifacts: PrintArtifact[];
  automaticPrinting: boolean;
  remaining: number;
  locale?: SupportedLocale;
  onLocaleChange?: LocaleChange;
}) {
  return (
    <main
      className="kiosk-result kiosk-result--success"
      lang={locale}
      dir={isRightToLeft(locale) ? "rtl" : "ltr"}
      data-printing-mode={automaticPrinting ? "automatic" : "interactive"}
    >
      <div className="kiosk-result__topbar">
        <Wordmark />
        <KioskLanguagePicker locale={locale} onChange={onLocaleChange} />
      </div>
      <CheckCircle2 aria-hidden="true" />
      <h1>{automaticPrinting ? "인쇄가 시작됐어요" : "인쇄 준비가 끝났어요"}</h1>
      {/* The one thing left to do, said louder than anything else on the
          screen: the paper is at the printer, not here. */}
      <p className="kiosk-result__next">
        <Printer aria-hidden="true" />
        {automaticPrinting ? (
          <span>
            프린터에서 종이를 가져가세요
            <small lang="en">Collect your pages from the printer</small>
          </span>
        ) : (
          <span>
            화면의 인쇄 창을 확인하세요
            <small lang="en">Confirm the print dialog on this screen</small>
          </span>
        )}
      </p>
      <p className="kiosk-result__count">
        {automaticPrinting
          ? `파일 ${artifacts.length}개를 프린터로 보냈어요`
          : `파일 ${artifacts.length}개를 인쇄할 준비를 했어요`}
        <span lang="en">
          {" "}
          · {artifacts.length} file{artifacts.length === 1 ? "" : "s"}{" "}
          {automaticPrinting ? "sent to the printer" : "ready to print"}
        </span>
      </p>
      <div className="kiosk-result__actions">
        {automaticPrinting ? null : (
          <button type="button" onClick={() => void printAll(artifacts)}>
            <Printer aria-hidden="true" /> 인쇄 창 다시 열기
          </button>
        )}
        {artifacts.map((artifact, index) => (
          <a
            key={artifact.url}
            href={artifact.url}
            // The artifact already carries a descriptive name. Numbering it is
            // only useful when there is more than one file to tell apart, and
            // a second `print-cess-` prefix in front of that name is noise on
            // the counter staff's download.
            download={
              artifacts.length === 1 ? artifact.filename : `${index + 1}-${artifact.filename}`
            }
            className="kiosk-download"
          >
            <Download aria-hidden="true" />{" "}
            {artifacts.length === 1
              ? "파일 다운로드 (직원용)"
              : `파일 ${index + 1} 다운로드 (직원용)`}
          </a>
        ))}
      </div>
      <div className="kiosk-result__footer">
        <span
          className="kiosk-result__timer"
          aria-hidden="true"
          style={{ "--kiosk-qr-progress": remaining / 60 } as CSSProperties}
        />
        <span className="kiosk-result__reset">
          <LockKeyhole aria-hidden="true" />
          <span>보내신 파일은 모두 지웠어요 · {remaining}초 후 새 QR코드</span>
        </span>
      </div>
    </main>
  );
}

async function printAll(artifacts: readonly PrintArtifact[]) {
  for (const artifact of artifacts) await printArtifact(artifact).catch(() => undefined);
}

/** How long the failure screen waits before trying for a fresh QR code. */
const UNAVAILABLE_RETRY_SECONDS = 30;

export function UnavailableScreen({
  onReset,
  locale = "ko",
  onLocaleChange,
}: {
  onReset: () => void;
  locale?: SupportedLocale;
  onLocaleChange?: LocaleChange;
}) {
  // A shared display is usually unattended. Rather than waiting for somebody
  // to find and press the button, it tries again on its own; the button stays
  // for the visitor or staff member who does not want to wait.
  const [retryIn, setRetryIn] = useState(UNAVAILABLE_RETRY_SECONDS);
  useEffect(() => {
    const deadline = Date.now() + UNAVAILABLE_RETRY_SECONDS * 1000;
    const interval = window.setInterval(
      () => setRetryIn(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
      250,
    );
    const timeout = window.setTimeout(onReset, UNAVAILABLE_RETRY_SECONDS * 1000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [onReset]);

  return (
    <main
      className="kiosk-result kiosk-result--error"
      lang={locale}
      dir={isRightToLeft(locale) ? "rtl" : "ltr"}
    >
      <div className="kiosk-result__topbar">
        <Wordmark />
        <KioskLanguagePicker locale={locale} onChange={onLocaleChange} />
      </div>
      {/* A failure never wears a security badge: the icon says what broke. */}
      <PrinterX aria-hidden="true" />
      <h1>지금은 인쇄할 수 없어요</h1>
      <p>잠시 뒤에 다시 시도해 주세요. 계속 안 되면 직원에게 알려 주세요.</p>
      <p className="kiosk-result__english" lang="en">
        Printing is unavailable right now. Please try again in a moment.
      </p>
      <button type="button" onClick={onReset}>
        <RotateCcw aria-hidden="true" />
        다시 시도하기
      </button>
      <div className="kiosk-result__footer">
        <span className="kiosk-result__reset">
          <span>{retryIn}초 후 자동으로 다시 시도해요</span>
        </span>
      </div>
    </main>
  );
}

export function statusLabel(status: KioskStatus): string {
  return {
    preparing: "준비 중",
    waiting: "QR코드를 비춰 주세요",
    claimed: "휴대전화가 연결됐어요",
    uploading: "파일을 받고 있어요",
    uploaded: "파일을 받았어요",
    validating: "파일을 확인하고 있어요",
    printing: "인쇄하고 있어요",
    completed: "인쇄가 끝났어요",
    failed: "잠시 사용할 수 없어요",
  }[status];
}

export function formatTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function playCompletionTone() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.28);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.28);
  } catch {
    // Completion remains visible when audio is blocked.
  }
}
