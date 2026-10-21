import { ArrowLeft, Building2, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@print-cess/ui";

import { requestLocale } from "@/lib/request-locale";

import { VisitorPrintFlow, type VisitorCopy } from "./visitor-flow";

const copy: Record<
  "ko" | "en",
  {
    eyebrow: string;
    title: string;
    intro: string;
    back: string;
    securityTitle: string;
    securityBody: string;
  } & VisitorCopy
> = {
  ko: {
    eyebrow: "출입국관서 · 관공서 방문자 인쇄",
    title: "방문자 인쇄 모드",
    intro:
      "민원인은 카운터 화면의 QR 코드를 휴대전화로 스캔해 서류를 올립니다. 직원이 출력하면 파일은 서버에서 자동으로 파기됩니다. 로그인, 앱 설치, 회원가입이 필요하지 않습니다.",
    back: "처음으로",
    securityTitle: "민원 서류는 출력 후 자동 파기됩니다",
    securityBody:
      "업로드된 서류는 종단간 암호화된 상태로만 서버에 보관되며, 출력이 끝나거나 세션 만료 시간이 지나면 즉시 삭제됩니다. 방문자가 자리를 떠나기 전에 시작한 인쇄는 세션 만료 시 자동으로 무효화됩니다.",
    expiresIn: "세션 만료까지",
    expired: "세션이 만료되었습니다",
    newSession: "새 방문자 세션 만들기",
    preparing: "방문자 세션을 준비하는 중…",
    preparingFailed: "세션 준비에 실패했습니다. 다시 시도해 주세요.",
    completed: "출력이 완료되었습니다",
    completedDetail: "서류가 출력되었고 서버의 파일은 자동으로 파기되었습니다.",
    failed: "인쇄에 실패했습니다",
    failedDetail: "서류가 출력되지 않았습니다. 새 세션을 만들어 다시 시도해 주세요.",
    expiredTitle: "세션이 만료되었습니다",
    expiredDetail: "업로드된 파일이 자동으로 파기되었습니다. 새 세션을 만들어 주세요.",
    cancelled: "인쇄가 취소되었습니다",
    cancelledDetail: "업로드된 파일은 파기되었습니다.",
    statusLive: "인쇄 진행 상태",
    qrAlt: "서류 업로드를 위한 방문자 인쇄 QR 코드",
    stepScan: "QR 스캔",
    stepScanDetail: "휴대전화 카메라로 QR 코드를 스캔하세요",
    stepUpload: "서류 업로드",
    stepUploadDetail: "휴대전화에서 출력할 서류를 선택해 업로드하세요",
    stepPrint: "키오스크 출력",
    stepPrintDetail: "직원이 확인 후 카운터에서 출력합니다",
    stepDestroy: "자동 파기",
    stepDestroyDetail: "출력 완료 후 서버의 파일이 즉시 삭제됩니다",
  },
  en: {
    eyebrow: "Immigration office · government visitor printing",
    title: "Visitor print mode",
    intro:
      "Visitors scan the QR code on the counter screen with their phone and upload their documents. Once staff prints them, the files are automatically destroyed on the server. No login, app install, or sign-up is required.",
    back: "Back to start",
    securityTitle: "Visitor documents are destroyed after printing",
    securityBody:
      "Uploaded documents are stored on the server only in end-to-end encrypted form, and are deleted as soon as printing finishes or the session expires. A print started before a visitor leaves is automatically voided when the session expires.",
    expiresIn: "Session expires in",
    expired: "The session has expired",
    newSession: "Start a new visitor session",
    preparing: "Preparing a visitor session…",
    preparingFailed: "The session could not be prepared. Please try again.",
    completed: "Printing is complete",
    completedDetail: "The documents were printed and the server copy was destroyed automatically.",
    failed: "Printing failed",
    failedDetail: "The documents were not printed. Start a new session and try again.",
    expiredTitle: "The session has expired",
    expiredDetail: "The uploaded file was destroyed automatically. Please start a new session.",
    cancelled: "Printing was cancelled",
    cancelledDetail: "The uploaded file was destroyed.",
    statusLive: "Print progress",
    qrAlt: "Visitor print QR code for document upload",
    stepScan: "Scan the QR",
    stepScanDetail: "Scan the QR code with the phone camera",
    stepUpload: "Upload documents",
    stepUploadDetail: "Choose the documents to print on the phone and upload them",
    stepPrint: "Counter print",
    stepPrintDetail: "Staff confirm and print at the counter",
    stepDestroy: "Auto-destroy",
    stepDestroyDetail: "The server copy is deleted as soon as printing finishes",
  },
} as const;

export default async function VisitorPage() {
  const locale = await requestLocale();
  const text = locale === "ko" ? copy.ko : copy.en;

  return (
    <main className="visitor-page">
      <header className="visitor-header">
        <Wordmark />
        <Link className="visitor-back" href="/">
          <ArrowLeft aria-hidden="true" /> {text.back}
        </Link>
      </header>

      <section className="visitor-hero">
        <div className="visitor-eyebrow">
          <Building2 aria-hidden="true" /> {text.eyebrow}
        </div>
        <h1>{text.title}</h1>
        <p>{text.intro}</p>
      </section>

      <VisitorPrintFlow copy={text} />

      <section className="visitor-security">
        <div className="visitor-security__heading">
          <ShieldCheck aria-hidden="true" />
          <h2>{text.securityTitle}</h2>
        </div>
        <p>{text.securityBody}</p>
      </section>
    </main>
  );
}
