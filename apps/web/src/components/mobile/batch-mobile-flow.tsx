"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  CheckCircle2,
  CircleQuestionMark,
  Clock3,
  FileCheck2,
  Files,
  Image as ImageIcon,
  Languages,
  LockKeyhole,
  Mail,
  MessageCircle,
  Printer,
  RotateCcw,
  ScanLine,
  Send,
  TriangleAlert,
  WifiOff,
  X,
} from "lucide-react";

import {
  encryptDocument,
  fingerprintPublicKey,
  fromBase64Url,
  generateToken,
  hashToken,
  timingSafeEqual,
} from "@print-cess/crypto";
import { LOCALE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from "@print-cess/i18n";
import {
  MAX_PRINT_BUNDLE_BYTES,
  MAX_PRINT_BUNDLE_FILES,
  decidePrintQuota,
  encodePrintBundle,
  printBundleEncodedSize,
  type PrintQuotaDecision,
  type PrintableFileKind,
} from "@print-cess/protocol";
import {
  HandoffIllustration,
  PrimaryButton,
  ProgressSteps,
  ScreenShell,
  StatusIcon,
  TertiaryButton,
  Wordmark,
} from "@print-cess/ui";

import { FileRow } from "@/components/drop/drop-shell";
import { SourcePicker } from "@/components/shared/source-picker";
import {
  authorizeUpload,
  cancelSession,
  claimSession,
  completeUpload,
  getMobileStatus,
  startUpload,
  uploadCiphertext,
  ApiClientError,
} from "@/lib/api-client";
import { quotaDocument } from "@/lib/print-quota-document";

import { PrintQuotaDialog } from "./print-quota-dialog";
import {
  FileValidationError,
  validateMobileDocument,
  type ValidatedMobileFile,
} from "@/lib/mobile-document-validation";
import { splitFirstSentence } from "@/lib/first-sentence";
import { watchPrintStatus, type PrintWatchState } from "@/lib/print-status";
import { parseSessionFragment } from "@/lib/session-fragment";
import { clearBrowserSiteData } from "@/lib/session-teardown";
import { useVisitorLocale, type Text } from "@/lib/use-visitor-locale";

import { DocumentPreview } from "./document-preview";
import { formatBatchCopy, printBatchCopy, type PrintBatchCopy } from "./print-batch-copy";

type Stage =
  "boot" | "file" | "preview" | "transfer" | "progress" | "complete" | "closed" | "error";
type ClaimedSession = Awaited<ReturnType<typeof claimSession>>;
type SelectedDocument = { file: File; validated: ValidatedMobileFile };

const CLOSE_CONFIRM_MS = 150;
const AUTOMATIC_SHUTDOWN_MS = 30_000;

const HELP_KEYS: Record<Stage, string> = {
  boot: "helpProgress",
  file: "helpFile",
  preview: "helpPreview",
  transfer: "helpProgress",
  progress: "helpProgress",
  complete: "helpDone",
  closed: "helpDone",
  error: "helpError",
};

/**
 * What one attempt at spending a QR code produced. Errors are carried back as a
 * copy key rather than thrown so that the caller can apply the result of a
 * single shared attempt to whichever run of the effect is still mounted.
 */
type ClaimOutcome =
  | {
      ok: true;
      session: ClaimedSession;
      mobileToken: string;
      supportsHwpx: boolean;
      supportsHwp: boolean;
    }
  | { ok: false; errorKey: string };

/**
 * Reads the credentials out of the URL fragment and spends them exactly once.
 * The kiosk's public key is checked against the fingerprint the QR code
 * carried, so a session handed back by anything other than the kiosk on screen
 * is cancelled rather than used.
 */
async function claimOnce(sessionId: string): Promise<ClaimOutcome> {
  const fragment = parseSessionFragment(window.location.hash);
  if (!fragment) return { ok: false, errorKey: "invalidQr" };
  try {
    const mobileToken = generateToken();
    const session = await claimSession({
      sessionId,
      uploadToken: fragment.uploadToken,
      mobileTokenHash: await hashToken(mobileToken, "mobile"),
      claimIdHash: await hashToken(generateToken(), "mobile"),
    });
    const computed = await fingerprintPublicKey(session.kioskPublicKey);
    if (
      !timingSafeEqual(fromBase64Url(computed), fromBase64Url(fragment.fingerprint)) ||
      session.kioskPublicKeyFingerprint !== fragment.fingerprint
    ) {
      await cancelSession(sessionId, mobileToken).catch(() => undefined);
      return { ok: false, errorKey: "fingerprintMismatch" };
    }
    return {
      ok: true,
      session,
      mobileToken,
      supportsHwpx: fragment.supportsHwpx,
      supportsHwp: fragment.supportsHwp,
    };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 409) {
      return { ok: false, errorKey: "usedQr" };
    }
    if (error instanceof ApiClientError && error.status === 410) {
      return { ok: false, errorKey: "expiredQr" };
    }
    return { ok: false, errorKey: "networkError" };
  }
}

export function BatchMobileFlow({
  sessionId,
  initialLocale,
}: {
  sessionId: string;
  initialLocale?: SupportedLocale;
}) {
  const [locale, setLocale, text] = useVisitorLocale(initialLocale);
  const copy = printBatchCopy(locale);
  const [stage, setStage] = useState<Stage>("boot");
  const [claimed, setClaimed] = useState<ClaimedSession>();
  const [mobileToken, setMobileToken] = useState("");
  const [documents, setDocuments] = useState<SelectedDocument[]>([]);
  const [errorKey, setErrorKey] = useState("networkError");
  const [fileErrorKey, setFileErrorKey] = useState<string>();
  const [batchError, setBatchError] = useState<string>();
  const [fileNoticeKey, setFileNoticeKey] = useState<string>();
  const [quotaBlock, setQuotaBlock] = useState<PrintQuotaDecision>();
  const [progressKey, setProgressKey] = useState("encrypting");
  const [watching, setWatching] = useState<PrintWatchState>({ kind: "waiting" });
  const [supportsHwpx, setSupportsHwpx] = useState(false);
  const [supportsHwp, setSupportsHwp] = useState(false);
  const [reminderStage, setReminderStage] = useState<Stage>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const watchAbort = useRef<AbortController>(null);
  const claimAttempt = useRef<{ sessionId: string; outcome: Promise<ClaimOutcome> }>(null);

  // An input keeps its value after a rejected pick, and choosing the same file
  // again then fires no change event. The iCloud notice asks for exactly that
  // second pick once the download finishes, so every rejection clears both.
  const resetPickers = useCallback(() => {
    if (photoInput.current) photoInput.current.value = "";
    if (fileInput.current) fileInput.current.value = "";
  }, []);

  const clearDocuments = useCallback(() => {
    setDocuments((current) => {
      for (const item of current) item.validated.bytes.fill(0);
      return [];
    });
    setFileErrorKey(undefined);
    setBatchError(undefined);
    setFileNoticeKey(undefined);
    resetPickers();
  }, [resetPickers]);

  const shutdownPage = useCallback(() => {
    void clearBrowserSiteData();
    try {
      window.close();
    } catch {
      // A tab opened by scanning is usually not script-closeable.
    }
    window.setTimeout(() => {
      if (window.closed) return;
      history.replaceState(null, "", window.location.pathname);
      setStage("closed");
    }, CLOSE_CONFIRM_MS);
  }, []);

  useEffect(() => {
    if (stage !== "complete") return;
    const timer = window.setTimeout(shutdownPage, AUTOMATIC_SHUTDOWN_MS);
    return () => window.clearTimeout(timer);
  }, [shutdownPage, stage]);

  useEffect(() => {
    const timer = window.setTimeout(() => setReminderStage(stage), 30_000);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => () => watchAbort.current?.abort(), []);

  // A ticking clock only while the visitor is choosing: that is the part of the
  // visit they control, and the code runs out if they wander off mid-choice.
  useEffect(() => {
    if (stage !== "file" && stage !== "preview") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== "file") return;
    const inputs = [photoInput.current, fileInput.current].filter(
      (input): input is HTMLInputElement => Boolean(input),
    );
    const announce = () => setFileNoticeKey("cancelled");
    for (const input of inputs) input.addEventListener("cancel", announce);
    return () => {
      for (const input of inputs) input.removeEventListener("cancel", announce);
    };
  }, [stage]);

  useEffect(() => {
    let active = true;
    // Spending the QR code is a one-shot server operation: a second attempt is
    // answered with 409, which reads to the visitor as "someone else already
    // used this code". React deliberately runs an effect twice in development,
    // and a fast remount would do the same in production, so the attempt is
    // started once per session and every later run of this effect awaits that
    // same promise instead of spending a code that is already claimed.
    if (claimAttempt.current?.sessionId !== sessionId) {
      claimAttempt.current = { sessionId, outcome: claimOnce(sessionId) };
    }
    void claimAttempt.current.outcome.then((outcome) => {
      if (!active) return;
      if (!outcome.ok) {
        setErrorKey(outcome.errorKey);
        setStage("error");
        return;
      }
      setSupportsHwpx(outcome.supportsHwpx);
      setSupportsHwp(outcome.supportsHwp);
      setClaimed(outcome.session);
      setMobileToken(outcome.mobileToken);
      history.replaceState(null, "", `${window.location.pathname}#claimed`);
      setStage("file");
    });
    return () => {
      active = false;
    };
  }, [sessionId]);

  const chooseFiles = useCallback(
    async (incoming: FileList | null) => {
      if (!incoming || incoming.length === 0) return;
      const files = Array.from(incoming);
      setFileErrorKey(undefined);
      setBatchError(undefined);
      setFileNoticeKey(undefined);
      setQuotaBlock(undefined);
      if (files.length > MAX_PRINT_BUNDLE_FILES) {
        resetPickers();
        setBatchError(copy.tooManyFiles);
        return;
      }

      const next: SelectedDocument[] = [];
      try {
        for (const file of files) {
          const validated = await validateMobileDocument(file, {
            allowHwp: supportsHwp,
            allowHwpx: supportsHwpx,
          });
          next.push({ file, validated });
        }
        if (
          next.length > 1 &&
          printBundleEncodedSize(next.map(({ validated }) => ({ bytes: validated.bytes }))) >
            MAX_PRINT_BUNDLE_BYTES
        ) {
          throw new BatchSelectionError(copy.batchTooLarge);
        }
        // The whole selection is judged together. Ten files that each clear the
        // limit on their own are still ten files' worth of paper.
        const quota = decidePrintQuota(next.map(({ validated }) => quotaDocument(validated)));
        if (quota.kind !== "allowed") {
          for (const item of next) item.validated.bytes.fill(0);
          resetPickers();
          setQuotaBlock(quota);
          return;
        }
        clearDocuments();
        setDocuments(next);
        setStage("preview");
      } catch (error) {
        for (const item of next) item.validated.bytes.fill(0);
        resetPickers();
        if (error instanceof BatchSelectionError) setBatchError(error.message);
        else setFileErrorKey(error instanceof FileValidationError ? error.code : "damagedFile");
      }
    },
    [
      clearDocuments,
      copy.batchTooLarge,
      copy.tooManyFiles,
      resetPickers,
      supportsHwp,
      supportsHwpx,
    ],
  );

  const cancelClaim = useCallback(async () => {
    if (mobileToken) await cancelSession(sessionId, mobileToken).catch(() => undefined);
    clearDocuments();
    setClaimed(undefined);
    setMobileToken("");
  }, [clearDocuments, mobileToken, sessionId]);

  const print = useCallback(async () => {
    if (!claimed || documents.length === 0 || !mobileToken) return;
    let envelope: Uint8Array | undefined;
    let bundle: Uint8Array | undefined;
    try {
      setStage("transfer");
      setProgressKey("encrypting");
      const first = documents[0];
      if (!first) throw new Error("empty selection");
      const fileKind =
        documents.length === 1 ? printableKind(first.validated.fileKind) : ("bundle" as const);
      const plaintext =
        documents.length === 1
          ? first.validated.bytes
          : (bundle = encodePrintBundle(
              documents.map(({ validated }) => ({
                fileKind: printableKind(validated.fileKind),
                bytes: validated.bytes,
              })),
            ));
      envelope = await encryptDocument({
        plaintext,
        fileKind,
        kioskPublicKey: claimed.kioskPublicKey,
        context: {
          protocolVersion: 1,
          sessionId,
          kioskPublicKeyFingerprint: claimed.kioskPublicKeyFingerprint,
        },
      });
      const authorization = await authorizeUpload(
        sessionId,
        mobileToken,
        await hashToken(generateToken(), "mobile"),
      );
      await startUpload(sessionId, mobileToken);
      setProgressKey("uploading");
      await completeUpload(sessionId, mobileToken, await uploadCiphertext(authorization, envelope));
    } catch (error) {
      await cancelClaim();
      setErrorKey(
        error instanceof ApiClientError && error.status === 410 ? "expiredQr" : "networkError",
      );
      setStage("error");
      return;
    } finally {
      bundle?.fill(0);
      envelope?.fill(0);
    }

    setProgressKey("waitingForPrint");
    setStage("progress");
    const controller = new AbortController();
    watchAbort.current = controller;
    const outcome = await watchPrintStatus({
      poll: () => getMobileStatus(sessionId, mobileToken),
      onState: setWatching,
      signal: controller.signal,
    });
    watchAbort.current = null;
    clearDocuments();
    setClaimed(undefined);
    setMobileToken("");
    if (outcome.kind === "completed") {
      setStage("complete");
      return;
    }
    if (outcome.kind === "failed") {
      setErrorKey(outcome.reason === "sessionExpired" ? "expiredQr" : "printFailed");
      setStage("error");
      return;
    }
    setErrorKey("printOutcomeUnknown");
    setStage("error");
  }, [cancelClaim, claimed, clearDocuments, documents, mobileToken, sessionId]);

  // The same three steps the home page and the big screen name. Scanning is
  // already done by the time this page exists. "Take your paper" lights only
  // once the paper is out: while the file is still sending or printing the
  // visitor is still on the second step, and telling them to collect output
  // that does not exist yet would send them to an empty printer.
  const step = stage === "complete" ? 3 : 2;
  const supportsHancom = supportsHwp || supportsHwpx;
  const hancomLabel = hancomFormatLabel(supportsHwp, supportsHwpx);
  const rules = (supportsHancom ? copy.rulesHancom : copy.rules).replaceAll(
    "HWP/HWPX",
    hancomLabel,
  );
  const single = documents.length === 1;
  const reminder = helpForStage(stage, text, copy);
  const secondsLeft = claimed ? Math.max(0, Math.ceil((claimed.expiresAt - now) / 1000)) : 0;
  const timeLeft =
    claimed && (stage === "file" || stage === "preview") ? (
      <p className={secondsLeft <= 30 ? "mobile-time-left is-urgent" : "mobile-time-left"}>
        <Clock3 aria-hidden="true" />
        {copy.timeLeft.replace("{{time}}", formatClock(secondsLeft))}
      </p>
    ) : null;

  return (
    <ScreenShell>
      <div className="mobile-topbar">
        <Wordmark compact />
        {stage === "boot" || stage === "closed" ? null : (
          <div className="mobile-topbar__actions">
            <button
              type="button"
              className="mobile-help-open"
              onClick={() => setHelpOpen(true)}
              aria-haspopup="dialog"
            >
              <CircleQuestionMark aria-hidden="true" /> {text("helpOpen")}
            </button>
            <label className="drop-language">
              <Languages aria-hidden="true" />
              <span className="drop-visually-hidden">{text("selectLanguage")}</span>
              <select
                value={locale}
                onChange={(event) => setLocale(event.target.value as SupportedLocale)}
              >
                {SUPPORTED_LOCALES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {LOCALE_NAMES[candidate]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {stage !== "boot" && stage !== "error" && stage !== "closed" ? (
        <ProgressSteps
          current={step}
          total={3}
          label={text("step", { current: step, total: 3 })}
          steps={[
            text("homePrintStepScan"),
            text("homePrintStepPick"),
            text("homePrintStepCollect"),
          ]}
        />
      ) : null}

      {reminderStage === stage && !["boot", "complete", "error", "closed"].includes(stage) ? (
        <p className="mobile-reminder" role="status">
          {reminder}
        </p>
      ) : null}

      {stage === "boot" ? <Loading text={text("preparingSession")} /> : null}

      {stage === "file" ? (
        <section className="mobile-step">
          <h1>{copy.chooseFiles}</h1>
          <p>{rules}</p>
          {timeLeft}
          <input
            ref={photoInput}
            data-testid="photo-input"
            hidden
            multiple
            type="file"
            accept="image/*,.heic,.heif,.webp,.avif,.bmp,.gif,.tif,.tiff"
            onChange={(event) => void chooseFiles(event.target.files)}
          />
          <input
            ref={fileInput}
            data-testid="file-input"
            hidden
            multiple
            type="file"
            accept={documentAccept(supportsHwp, supportsHwpx)}
            onChange={(event) => void chooseFiles(event.target.files)}
          />
          {batchError ? (
            <p className="mobile-file-error" role="alert">
              {batchError}
            </p>
          ) : fileErrorKey ? (
            <p className="mobile-file-error" role="alert">
              {/* A refusal has to name the format the visitor actually picked:
                  telling someone holding an .hwp that the printer cannot open
                  HWPX sends them off to convert the wrong thing. */}
              {applyHancomLabel(text(fileErrorKey), hancomLabel)}
            </p>
          ) : fileNoticeKey ? (
            <p className="mobile-file-notice" role="status">
              {text(fileNoticeKey)}
            </p>
          ) : null}
          <SourcePicker
            sources={[
              {
                id: "photos",
                icon: <ImageIcon />,
                label: text("locationPhotos"),
                hint: copy.photosHint,
                onPick: () => photoInput.current?.click(),
              },
              {
                id: "files",
                icon: <Files />,
                label: text("locationFiles"),
                hint: copy.filesHint,
                onPick: () => fileInput.current?.click(),
              },
            ]}
          />
          <button type="button" className="mobile-guide-link" onClick={() => setHelpOpen(true)}>
            {text("guideOpen")}
          </button>
        </section>
      ) : null}

      {stage === "preview" && documents.length > 0 ? (
        <section className="mobile-step mobile-step--preview">
          <h1>{single ? text("checkDocument") : copy.checkFiles}</h1>
          <p>{single ? text("previewHelp") : copy.previewHelp}</p>
          {timeLeft}
          {single && documents[0] ? (
            <>
              <DocumentPreview
                file={documents[0].file}
                validated={documents[0].validated}
                labels={{
                  documentPreview: text("documentPreview"),
                  selectedDocumentPreview: text("selectedDocumentPreview"),
                  pdfPreview: text("pdfPreview"),
                  firstPagePreview: text("firstPagePreview"),
                  hwpxPreview: text("hwpxPreview").replaceAll("HWPX", hancomLabel),
                }}
              />
              {/* The name, kind, and size in words, so a preview that looks
                  right but belongs to the wrong file is still caught. This is
                  the visitor's own phone; the shared screen never shows it. */}
              <div className="mobile-selected">
                <FileRow
                  file={documents[0].file}
                  text={text}
                  detail={pagesDetail(documents[0].validated, copy)}
                />
              </div>
            </>
          ) : (
            <ol className="mobile-selected drop-file-list">
              {documents.map(({ file, validated }, index) => (
                <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                  <FileRow file={file} text={text} detail={pagesDetail(validated, copy)} />
                </li>
              ))}
            </ol>
          )}
          {single ? null : (
            <p className="mobile-file-notice" role="status">
              {formatBatchCopy(copy.selected, documents.length)}
            </p>
          )}
          {/* Each setting as its own chip, so "A4" and "one side" can be read at
              a glance; the sentence is still read whole by a screen reader. */}
          <p className="mobile-print-settings">
            <span className="drop-visually-hidden">{text("printSummary")}</span>
            {text("printSummary")
              .split("·")
              .map((setting) => setting.trim())
              .filter(Boolean)
              .map((setting) => (
                <span key={setting} aria-hidden="true">
                  {setting}
                </span>
              ))}
          </p>
          <div className="mobile-summary">
            <p>
              <LockKeyhole aria-hidden="true" /> {text("privacySummary")}
            </p>
          </div>
          {/* The one forward action stays pinned to the bottom of the screen: a
              tall preview used to push it below the fold, and visitors scrolled
              looking for a button they could not see. */}
          <div className="mobile-actions">
            <PrimaryButton onClick={() => void print()}>
              <Printer aria-hidden="true" />
              {single ? text("printOneCopy") : formatBatchCopy(copy.printFiles, documents.length)}
            </PrimaryButton>
            <TertiaryButton
              className="mobile-change-selection"
              onClick={() => {
                clearDocuments();
                setStage("file");
              }}
            >
              {single ? text("chooseAnother") : copy.changeSelection}
            </TertiaryButton>
          </div>
        </section>
      ) : null}

      {stage === "transfer" ? (
        <ProgressState
          phase="sending"
          text={text(progressKey)}
          note={text("keepPageOpen")}
          steps={[copy.stepPrepare, copy.stepSend, copy.stepPrint]}
          current={progressKey === "encrypting" ? 0 : 1}
        />
      ) : null}
      {stage === "progress" ? (
        <ProgressState
          phase={watching.kind === "reconnecting" ? "reconnecting" : "printing"}
          text={text(watching.kind === "reconnecting" ? "reconnecting" : progressKey)}
          note={text(watching.kind === "reconnecting" ? "kioskMayStillBePrinting" : "keepPageOpen")}
          steps={[copy.stepPrepare, copy.stepSend, copy.stepPrint]}
          current={2}
        />
      ) : null}
      {stage === "complete" ? (
        <SingleAction
          icon="success"
          title={text("completed")}
          body={text("collectOutput")}
          note={copy.printMore}
          action={text("closePage")}
          onAction={shutdownPage}
        />
      ) : null}
      {stage === "closed" ? (
        <section className="mobile-step mobile-step--single mobile-step--closed">
          <StatusIcon tone="success">
            <CheckCircle2 size={34} aria-hidden="true" />
          </StatusIcon>
          <h1>{text("closedTitle")}</h1>
          <p>{text("closedBody")}</p>
          <a className="mobile-drop-link" href="/send">
            <Send aria-hidden="true" /> {text("dropTitle")}
          </a>
        </section>
      ) : null}
      {stage === "error" ? (
        <SingleAction
          icon={errorKey === "printOutcomeUnknown" ? "info" : "error"}
          title={text(errorKey)}
          body={errorKey === "printOutcomeUnknown" ? text("printOutcomeUnknownBody") : ""}
          link={{ href: "/start", label: copy.startOver }}
        />
      ) : null}
      <HelpSheet
        open={helpOpen}
        stage={stage}
        text={text}
        copy={copy}
        supportsHancom={supportsHancom}
        hancomLabel={hancomLabel}
        onClose={() => setHelpOpen(false)}
      />
      {quotaBlock ? (
        <PrintQuotaDialog
          decision={quotaBlock}
          text={text}
          onReselect={() => {
            setQuotaBlock(undefined);
            fileInput.current?.click();
          }}
          onCancel={() => setQuotaBlock(undefined)}
        />
      ) : null}
    </ScreenShell>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <section className="mobile-step" aria-busy="true">
      <div className="mobile-spinner" />
      <p>{text}</p>
    </section>
  );
}

function HelpSheet({
  open,
  stage,
  text,
  copy,
  supportsHancom,
  hancomLabel,
  onClose,
}: {
  open: boolean;
  stage: Stage;
  text: Text;
  copy: PrintBatchCopy;
  supportsHancom: boolean;
  hancomLabel: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const showFileLocations = stage === "file";

  return (
    <dialog
      ref={dialog}
      className="mobile-help"
      onClose={onClose}
      aria-labelledby="mobile-help-title"
    >
      {open ? (
        <>
          <h2 id="mobile-help-title">{text("helpTitle")}</h2>
          <p className="mobile-help__now">{helpForStage(stage, text, copy)}</p>
          <ol className="mobile-guide" aria-label={text("guideTitle")}>
            {guideStepsFor(supportsHancom, copy).map(({ icon: Icon, title, body, completed }) => (
              <li key={title} className={completed ? "is-complete" : undefined}>
                <span className="mobile-guide__icon" aria-hidden="true">
                  <Icon />
                  {completed ? <CheckCircle2 className="mobile-guide__check" /> : null}
                </span>
                <span>
                  <strong>{title.startsWith("batch:") ? title.slice(6) : text(title)}</strong>
                  <small>
                    {applyHancomLabel(
                      body.startsWith("batch:") ? body.slice(6) : text(body),
                      hancomLabel,
                    )}
                  </small>
                </span>
              </li>
            ))}
          </ol>
          {showFileLocations ? (
            <div className="mobile-help__where">
              <h3>{text("chooseLocation")}</h3>
              <ul>
                <li>
                  <MessageCircle aria-hidden="true" />
                  <span>
                    <strong>{text("locationKakao")}</strong>
                    <small>{text("kakaoGuide")}</small>
                  </span>
                </li>
                <li>
                  <Mail aria-hidden="true" />
                  <span>
                    <strong>{text("locationEmail")}</strong>
                    <small>{text("emailGuide")}</small>
                  </span>
                </li>
                <li>
                  <Ban aria-hidden="true" />
                  <span>
                    <strong>{text("locationMissing")}</strong>
                    <small>
                      {text("missingTitle")} {text("missingBody")}
                    </small>
                  </span>
                </li>
              </ul>
            </div>
          ) : null}
          <p className="mobile-help__staff">{text("helpAskStaff")}</p>
          <div className="mobile-help__actions">
            <PrimaryButton onClick={onClose}>{text("helpClose")}</PrimaryButton>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

function guideStepsFor(supportsHancom: boolean, copy: PrintBatchCopy) {
  return [
    { icon: ScanLine, title: "guideScanTitle", body: "guideScanBody", completed: true },
    {
      icon: ImageIcon,
      title: `batch:${copy.guideChooseTitle}`,
      body: `batch:${supportsHancom ? copy.guideChooseBodyHancom : copy.guideChooseBody}`,
      completed: false,
    },
    { icon: FileCheck2, title: "guideCheckTitle", body: "guideCheckBody", completed: false },
    { icon: Printer, title: "guideCollectTitle", body: "guideCollectBody", completed: false },
  ] as const;
}

function helpForStage(stage: Stage, text: Text, copy: PrintBatchCopy): string {
  if (stage === "file") return copy.helpFile;
  if (stage === "preview") return copy.helpPreview;
  return text(HELP_KEYS[stage]);
}

function printableKind(kind: ValidatedMobileFile["fileKind"]): PrintableFileKind {
  if (kind === "bundle") throw new Error("A selected document cannot itself be a print bundle");
  return kind;
}

/** Page count, in the visitor's language, only where it tells them something. */
function pagesDetail(validated: ValidatedMobileFile, copy: PrintBatchCopy): string | undefined {
  if (validated.fileKind !== "pdf" || validated.pageCount < 2) return undefined;
  return formatBatchCopy(copy.pages, validated.pageCount);
}

/**
 * Waiting, drawn as what is actually happening: the sheet going into the
 * printer while it is sent, coming out while it prints. A lost connection is
 * not drawn as progress, because nobody knows whether anything is moving.
 */
function ProgressState({
  phase,
  text,
  note,
  steps,
  current,
}: {
  phase: "sending" | "printing" | "reconnecting";
  text: string;
  note: string;
  /** What happens after the print button, so the wait has visible stages. */
  steps: readonly string[];
  current: number;
}) {
  return (
    <section className="mobile-step mobile-step--single mobile-step--progress" aria-live="polite">
      {phase === "reconnecting" ? (
        <StatusIcon tone="warning">
          <WifiOff size={32} aria-hidden="true" />
        </StatusIcon>
      ) : (
        <HandoffIllustration stage={phase} />
      )}
      <h1>{text}</h1>
      {note ? <p>{note}</p> : null}
      {/* The stage in words and a mark as well as colour; the heading above
          already announces it, so the list itself stays quiet. */}
      <ol className="mobile-progress-list" aria-hidden="true">
        {steps.map((step, index) => (
          <li
            key={step}
            className={index < current ? "is-done" : index === current ? "is-active" : undefined}
          >
            {index < current ? <CheckCircle2 /> : <span>{index + 1}</span>}
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SingleAction({
  icon = "info",
  title,
  body,
  note,
  action,
  onAction,
  link,
}: {
  icon?: "info" | "success" | "error";
  title: string;
  body: string;
  /** A quieter second line: what to do next time. */
  note?: string;
  action?: string;
  onAction?: () => void;
  /** A way out that is a place, not a command. */
  link?: { href: string; label: string };
}) {
  const Icon =
    icon === "success" ? CheckCircle2 : icon === "error" ? TriangleAlert : CircleQuestionMark;
  // A message that carries its own next step reads as a title and then an
  // instruction, rather than one paragraph set at headline size.
  const [heading, instruction] = body ? [title, body] : splitFirstSentence(title);
  return (
    <section className="mobile-step mobile-step--single">
      <StatusIcon tone={icon}>
        <Icon size={34} aria-hidden="true" />
      </StatusIcon>
      <h1>{heading}</h1>
      {instruction ? <p>{instruction}</p> : null}
      {note ? <p className="mobile-step__note">{note}</p> : null}
      {action && onAction ? (
        <PrimaryButton onClick={onAction}>
          <X aria-hidden="true" /> {action}
        </PrimaryButton>
      ) : null}
      {link ? (
        <a className="pc-button pc-button--secondary mobile-start-over" href={link.href}>
          <RotateCcw aria-hidden="true" /> {link.label}
        </a>
      ) : null}
    </section>
  );
}

function hancomFormatLabel(supportsHwp: boolean, supportsHwpx: boolean): string {
  if (supportsHwp === supportsHwpx) return "HWP/HWPX";
  return supportsHwp ? "HWP" : "HWPX";
}

function applyHancomLabel(value: string, label: string): string {
  return value.replaceAll("HWP/HWPX", label).replaceAll("HWPX", label);
}

function documentAccept(supportsHwp: boolean, supportsHwpx: boolean): string {
  const base = [
    "application/pdf",
    ".pdf",
    "image/*",
    ".jpg",
    ".jpeg",
    ".png",
    ".heic",
    ".heif",
    ".webp",
    ".avif",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
  ];
  const hancom: string[] = [];
  if (supportsHwp) hancom.push("application/x-hwp", "application/haansofthwp", ".hwp");
  if (supportsHwpx) hancom.push("application/hwp+zip", ".hwpx");
  return [...base, ...hancom].join(",");
}

class BatchSelectionError extends Error {}

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
