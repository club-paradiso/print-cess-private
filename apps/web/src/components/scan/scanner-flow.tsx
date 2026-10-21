"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Download, Printer, RotateCcw, ScanLine, Send, Share, ShieldCheck } from "lucide-react";

import type { SupportedLocale } from "@print-cess/i18n";
import { PrimaryButton, ScreenShell, StatusIcon } from "@print-cess/ui";

import { AppTopbar } from "@/components/shared/app-topbar";
import { useVisitorLocale } from "@/lib/use-visitor-locale";
import { ScanComposer } from "./scan-composer";
import { scanCopy } from "./scan-copy";

const SendFlow = dynamic(() => import("@/components/drop/send-flow").then((m) => m.SendFlow), {
  ssr: false,
});

export function ScannerFlow({ initialLocale }: { initialLocale?: SupportedLocale }) {
  const [locale, setLocale, text] = useVisitorLocale(initialLocale);
  const copy = scanCopy(locale);
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [canSystemShare, setCanSystemShare] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const printFrame = useRef<HTMLIFrameElement>(null);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const acceptPdf = useCallback((next: File) => {
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setNotice("");
    setCanSystemShare(
      typeof navigator.share === "function" && navigator.canShare?.({ files: [next] }) === true,
    );
  }, []);

  const restart = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setFile(undefined);
    setNotice("");
    setHandingOff(false);
  }, [previewUrl]);

  const download = useCallback(() => {
    if (!file || !previewUrl) return;
    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = file.name;
    link.click();
    setNotice(copy.downloaded);
  }, [copy.downloaded, file, previewUrl]);

  const shareToApp = useCallback(async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      download();
      setNotice(copy.shareFallback);
    }
  }, [copy.shareFallback, download, file]);

  const print = useCallback(() => {
    if (!previewUrl) return;
    setNotice(copy.printHint);
    const frame = printFrame.current;
    if (!frame) return;
    frame.onload = () => frame.contentWindow?.print();
    frame.src = previewUrl;
  }, [copy.printHint, previewUrl]);

  if (file && handingOff) {
    return (
      <SendFlow
        initialLocale={initialLocale ?? locale}
        carriedLocale={locale}
        initialFiles={[file]}
        back={{ label: copy.backToScan, onBack: () => setHandingOff(false) }}
      />
    );
  }

  return (
    <ScreenShell>
      <AppTopbar
        locale={locale}
        onLocaleChange={setLocale}
        languageLabel={text("selectLanguage")}
        section={{ icon: <ScanLine aria-hidden="true" />, label: text("homeScanTitle") }}
      />

      {!file ? (
        <ScanComposer locale={locale} onComplete={acceptPdf} />
      ) : (
        <section className="scan-result">
          <StatusIcon tone="success">
            <ShieldCheck size={32} aria-hidden="true" />
          </StatusIcon>
          <div className="scan-heading">
            <h1>{copy.done}</h1>
            <p>{copy.private}</p>
          </div>
          <div className="scan-pdf-card">
            <iframe src={previewUrl} title={copy.done} />
            <div>
              <strong>{file.name}</strong>
              <span>{formatBytes(file.size)} · PDF</span>
            </div>
          </div>
          {notice ? (
            <p className="scan-notice" role="status">
              {notice}
            </p>
          ) : null}
          <div className="scan-result-actions">
            <PrimaryButton onClick={() => setHandingOff(true)}>
              <Send aria-hidden="true" /> {copy.share}
            </PrimaryButton>
            <div className="scan-more-actions">
              <button type="button" onClick={download}>
                <Download aria-hidden="true" /> {copy.download}
              </button>
              {canSystemShare ? (
                <button type="button" onClick={() => void shareToApp()}>
                  <Share aria-hidden="true" /> {copy.systemShare}
                </button>
              ) : null}
              <button type="button" onClick={print}>
                <Printer aria-hidden="true" /> {copy.print}
              </button>
            </div>
            <button type="button" className="scan-again" onClick={restart}>
              <RotateCcw aria-hidden="true" /> {copy.scanAgain}
            </button>
          </div>
          <iframe ref={printFrame} className="scan-print-frame" title={copy.print} />
        </section>
      )}
    </ScreenShell>
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
