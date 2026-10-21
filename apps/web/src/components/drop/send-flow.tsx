"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Files,
  FilePlus2,
  Image as ImageIcon,
  LockKeyhole,
  Send,
  Share2,
  Timer,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import QRCode from "qrcode";

import type { SupportedLocale } from "@print-cess/i18n";
import type { DropReceiverState } from "@print-cess/protocol";
import {
  DestructiveButton,
  PrimaryButton,
  ProgressSteps,
  ScanFrame,
  SecondaryButton,
  StatusIcon,
  TertiaryButton,
} from "@print-cess/ui";

import { SourcePicker } from "@/components/shared/source-picker";

import { getDropCapabilities, getDropStatus, revokeDrop } from "@/lib/drop-client";
import { buildDropLink } from "@/lib/drop-link";
import {
  estimateMinutesRemaining,
  holdScreenAwake,
  recordSample,
  shareTransferLink,
  supportsSharing,
  type ThroughputSample,
} from "@/lib/drop-progress";
import {
  prepareSelection,
  PROTOCOL_DROP_LIMITS,
  sendDrop,
  type DropLimits,
  type DropProgress,
  type PreparedSelection,
  type SendResult,
} from "@/lib/drop-transfer";
import { QR_COLORS } from "@/lib/qr-style";

import {
  DropShell,
  FileRow,
  TransferBar,
  formatBytes,
  minutesUntil,
  useDropLocale,
  type Text,
} from "./drop-shell";
import { dropErrorKey } from "./drop-errors";
import { dropFlowCopy } from "./drop-flow-copy";
import { PairingHandover } from "./pairing-handover";

type Stage = "pick" | "sending" | "ready" | "error";

const PICKUP_POLL_MS = 5000;

export function SendFlow({
  initialLocale,
  carriedLocale,
  initialFiles,
  back,
}: {
  initialLocale?: SupportedLocale;
  /** The language picked on the screen that handed over to this one. */
  carriedLocale?: SupportedLocale;
  /**
   * Files that are already in hand, such as a PDF the scanner just made on
   * this phone. They are offered exactly as if the visitor had picked them.
   */
  initialFiles?: readonly File[];
  /** A way back to whatever handed those files over. */
  back?: { label: string; onBack: () => void };
}) {
  const [locale, setLocale, text] = useDropLocale(initialLocale, carriedLocale);
  const [stage, setStage] = useState<Stage>("pick");
  const [chosen, setChosen] = useState<File[]>(() => [...(initialFiles ?? [])]);
  const [limits, setLimits] = useState<DropLimits>(PROTOCOL_DROP_LIMITS);
  const [progress, setProgress] = useState<DropProgress>();
  const [result, setResult] = useState<SendResult>();
  const [qrImage, setQrImage] = useState("");
  const [receiver, setReceiver] = useState<DropReceiverState>("waiting");
  const [sealed, setSealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [errorKey, setErrorKey] = useState("dropNetworkError");
  const [minutesRemaining, setMinutesRemaining] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const samples = useRef<ThroughputSample[]>([]);
  const canShare = useSyncExternalStore(subscribeNever, supportsSharing, () => false);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController>(null);
  const created = useRef<SendResult>(undefined);

  // The published limits, so a selection that this deployment will never accept
  // is refused on the phone rather than after several minutes of uploading.
  useEffect(() => {
    const controller = new AbortController();
    void getDropCapabilities(controller.signal)
      .then((capabilities) =>
        setLimits({
          maximumTotalBytes: capabilities.maximumTotalBytes,
          maximumFileCount: capabilities.maximumFileCount,
          maximumParts: capabilities.maximumParts,
        }),
      )
      .catch(() => {
        // The protocol ceilings remain in force; the server checks again anyway.
      });
    return () => controller.abort();
  }, []);

  // The selection is a pure function of the chosen files and the published
  // limits, so it is derived rather than stored. Removing one file therefore
  // costs one removal, instead of clearing everything and starting again.
  const { selection, selectionErrorKey } = useMemo(() => {
    if (chosen.length === 0) return { selection: undefined, selectionErrorKey: undefined };
    try {
      return { selection: prepareSelection(chosen, limits), selectionErrorKey: undefined };
    } catch (error) {
      return { selection: undefined, selectionErrorKey: dropErrorKey(error) };
    }
  }, [chosen, limits]);

  const addFiles = useCallback((incoming: FileList | readonly File[] | null) => {
    if (!incoming) return;
    const arriving = Array.from(incoming);
    if (arriving.length === 0) return;
    setChosen((current) => {
      const merged = [...current, ...arriving];
      // The same file picked twice would be sent twice; identity here is the
      // name, size, and modification time the browser reports.
      return merged.filter(
        (file, index) =>
          merged.findIndex(
            (candidate) =>
              candidate.name === file.name &&
              candidate.size === file.size &&
              candidate.lastModified === file.lastModified,
          ) === index,
      );
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setChosen((current) => current.filter((_, at) => at !== index));
  }, []);

  const clearSelection = useCallback(() => {
    setChosen([]);
    if (photoInput.current) photoInput.current.value = "";
    if (fileInput.current) fileInput.current.value = "";
  }, []);

  const showCode = useCallback(async (sent: SendResult) => {
    setResult(sent);
    const link = buildDropLink(window.location.origin, sent.code);
    const image = await QRCode.toDataURL(link, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 9,
      color: QR_COLORS,
    });
    setQrImage(image);
    setStage("ready");
  }, []);

  const start = useCallback(async () => {
    if (!selection) return;
    const controller = new AbortController();
    abort.current = controller;
    setStage("sending");
    setSealed(false);
    setReceiver("waiting");
    samples.current = [];
    setMinutesRemaining(null);
    setProgress({
      transferredBytes: 0,
      totalBytes: selection.totalBytes,
      completedParts: 0,
      totalParts: selection.partCount,
    });
    // A phone that sleeps mid-upload throttles timers and can stall the
    // transfer, which reads as the service quietly failing.
    const releaseWakeLock = await holdScreenAwake();
    try {
      await sendDrop(selection, {
        signal: controller.signal,
        // The code appears as soon as the service holds the record, not when
        // the last byte lands. The other phone can scan and wait through a
        // gigabyte instead of watching this one's progress bar first.
        onDropCreated: (record) => {
          created.current = record;
          void showCode(record);
        },
        onProgress: (next) => {
          setProgress(next);
          samples.current = recordSample(samples.current, next, Date.now());
          setMinutesRemaining(estimateMinutesRemaining(samples.current, next));
        },
      });
      created.current = undefined;
      setSealed(true);
    } catch (error) {
      // The code went on screen the moment the record existed, so somebody may
      // already be holding it and waiting. A send that stops here will never be
      // sealed, and leaving the record behind would leave them waiting on a
      // transfer that is not coming until it expires — so it is erased now.
      if (created.current) {
        await revokeDrop(created.current.dropId, created.current.ownerToken).catch(() => undefined);
        created.current = undefined;
      }
      setErrorKey(dropErrorKey(error));
      setStage("error");
    } finally {
      releaseWakeLock();
      abort.current = null;
    }
  }, [selection, showCode]);

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  // Once the code is on screen, the only thing left to tell the sender is how
  // far the other phone has got — in the four steps the service can honestly
  // distinguish, and no further.
  useEffect(() => {
    if (stage !== "ready" || !result || deleted || receiver === "delivered") return;
    let active = true;
    const timer = window.setInterval(() => {
      void getDropStatus(result.dropId, result.ownerToken)
        .then((status) => {
          if (active) setReceiver(status.receiver);
        })
        .catch(() => undefined);
    }, PICKUP_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [deleted, receiver, result, stage]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyLink = useCallback(async () => {
    if (!result) return;
    const link = buildDropLink(window.location.origin, result.code);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the code on screen still works.
    }
  }, [result]);

  const share = useCallback(async () => {
    if (!result) return;
    const link = buildDropLink(window.location.origin, result.code);
    if (!(await shareTransferLink(link, text("dropTitle")))) await copyLink();
  }, [copyLink, result, text]);

  const erase = useCallback(async () => {
    if (!result) return;
    abort.current?.abort();
    created.current = undefined;
    await revokeDrop(result.dropId, result.ownerToken).catch(() => undefined);
    setDeleted(true);
  }, [result]);

  const restart = useCallback(() => {
    clearSelection();
    setResult(undefined);
    setQrImage("");
    setProgress(undefined);
    setReceiver("waiting");
    setSealed(false);
    setDeleted(false);
    setStage("pick");
  }, [clearSelection]);

  const dragHandlers = {
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      addFiles(event.dataTransfer?.files ?? null);
    },
  };

  const flowCopy = dropFlowCopy(locale);
  // The same three-step strip the print flow shows, once the visitor is past
  // choosing, so a hand-off reads as a short sequence with an end rather than
  // a screen that just sits there. The first screen stays as bare as V2 made
  // it: the two source tiles are the whole job there.
  const step = receiver === "delivered" ? 3 : 2;

  return (
    <DropShell locale={locale} onLocaleChange={setLocale} text={text}>
      {(stage === "sending" || stage === "ready") && !deleted ? (
        <ProgressSteps
          current={step}
          total={3}
          label={text("step", { current: step, total: 3 })}
          steps={[flowCopy.stepPick, flowCopy.stepHandOver, flowCopy.stepReceived]}
        />
      ) : null}
      {stage === "pick" ? (
        <section
          className={dragging ? "mobile-step drop-pick is-dragging" : "mobile-step drop-pick"}
          {...dragHandlers}
        >
          <h1>{text("dropPickFiles")}</h1>
          <p>{text("dropPickHint")}</p>
          <input
            ref={photoInput}
            data-testid="drop-photo-input"
            hidden
            multiple
            type="file"
            accept="image/*,video/*"
            onChange={(event) => addFiles(event.target.files)}
          />
          <input
            ref={fileInput}
            data-testid="drop-file-input"
            hidden
            multiple
            type="file"
            onChange={(event) => addFiles(event.target.files)}
          />
          {selectionErrorKey ? (
            <p className="mobile-file-error" role="alert">
              {text(selectionErrorKey)}
            </p>
          ) : null}
          {chosen.length === 0 ? (
            <>
              <SourcePicker
                sources={[
                  {
                    id: "photos",
                    icon: <ImageIcon />,
                    label: text("locationPhotos"),
                    hint: text("dropSourcePhotosHint"),
                    onPick: () => photoInput.current?.click(),
                  },
                  {
                    id: "files",
                    icon: <Files />,
                    label: text("locationFiles"),
                    hint: text("dropSourceFilesHint"),
                    onPick: () => fileInput.current?.click(),
                  },
                ]}
              />
              {/* A pointer environment can drop files anywhere on this step.
                  The tiles stay, because a phone has no drag and this must
                  never become the only way in. */}
              <p className="drop-target__hint">
                <Upload aria-hidden="true" /> {text("dropDragHere")}
              </p>
            </>
          ) : (
            <SelectedFiles
              files={chosen}
              selection={selection}
              text={text}
              onRemove={removeFile}
              onClear={clearSelection}
              onAddMore={() => fileInput.current?.click()}
            />
          )}
          {selection ? (
            // Pinned to the bottom like the print flow's button, so a long
            // list of files never pushes the one forward action off screen.
            <div className="mobile-actions">
              <PrimaryButton onClick={() => void start()}>
                <Send aria-hidden="true" /> {text("dropStartSending")}
              </PrimaryButton>
            </div>
          ) : null}
          <p className="drop-privacy">
            <LockKeyhole aria-hidden="true" /> {text("dropPrivacyNote")}
          </p>
          {back ? (
            <TertiaryButton className="drop-back" onClick={back.onBack}>
              <ArrowLeft aria-hidden="true" /> {back.label}
            </TertiaryButton>
          ) : (
            <a className="drop-link drop-switch" href="/receive">
              <Download aria-hidden="true" /> {text("homeReceiveCta")}
            </a>
          )}
        </section>
      ) : null}

      {stage === "sending" && progress ? (
        <section className="mobile-step mobile-step--single" aria-live="polite">
          <h1>{text("dropSending")}</h1>
          <TransferBar progress={progress} text={text} minutesRemaining={minutesRemaining} />
          <p>{text("dropSendingHint")}</p>
          <SecondaryButton onClick={stop}>{text("dropCancel")}</SecondaryButton>
        </section>
      ) : null}

      {stage === "ready" && result ? (
        deleted ? (
          <section className="mobile-step mobile-step--single">
            <StatusIcon tone="success">
              <Trash2 size={34} aria-hidden="true" />
            </StatusIcon>
            <h1>{text("dropDeleted")}</h1>
            <PrimaryButton onClick={restart}>
              <FilePlus2 aria-hidden="true" /> {text("dropSendAnother")}
            </PrimaryButton>
          </section>
        ) : (
          <section
            className="mobile-step drop-ready"
            // The transfer code is the whole secret and no longer appears on
            // screen. End-to-end tests need it to stand in for the phone that
            // scanned the QR code, so it is exposed outside a Production build
            // only — exactly as the kiosk exposes its session URL.
            data-transfer-code={process.env.NODE_ENV === "production" ? undefined : result.code}
          >
            <h1>{text(sealed ? "dropReady" : "dropReadyEarly")}</h1>
            {/* What the other side has done, first: it is the one thing the
                sender keeps glancing back at. Once they have the files, the
                next thing to do sits right under it. */}
            <p
              className={receiver === "delivered" ? "drop-status is-delivered" : "drop-status"}
              role="status"
            >
              <ReceiverStatus
                receiver={receiver}
                sealed={sealed}
                expiresAt={result.expiresAt}
                text={text}
              />
            </p>
            {receiver === "delivered" ? (
              <PrimaryButton onClick={restart}>
                <FilePlus2 aria-hidden="true" /> {text("dropSendAnother")}
              </PrimaryButton>
            ) : null}
            {!sealed && progress ? (
              <div className="drop-still-sending">
                <TransferBar progress={progress} text={text} minutesRemaining={minutesRemaining} />
                <p>{text("dropStillSending")}</p>
              </div>
            ) : null}
            {/* The two ways to hand the files over (the code to scan, the link
                to send) sit on one card, so they read as one choice. */}
            <div className="drop-handoff">
              {qrImage ? (
                <figure className="drop-qr">
                  <div className="drop-qr__code">
                    <ScanFrame />
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data URL generated in the browser */}
                    <img src={qrImage} alt={text("dropScanToReceive")} />
                  </div>
                  <figcaption>{text("dropScanToReceive")}</figcaption>
                </figure>
              ) : null}
              <div className="drop-link-actions">
                {canShare ? (
                  <SecondaryButton onClick={() => void share()}>
                    <Share2 aria-hidden="true" /> {text("dropShareLink")}
                  </SecondaryButton>
                ) : null}
                <SecondaryButton onClick={() => void copyLink()}>
                  {copied ? <CheckCircle2 aria-hidden="true" /> : <Copy aria-hidden="true" />}{" "}
                  {copied ? text("dropCopied") : text("dropCopyLink")}
                </SecondaryButton>
              </div>
            </div>
            {/* QR and shared-link hand-offs keep the transfer code in the URL
                fragment. The optional nearby-phone flow below escrows it for
                three minutes so the sender can leave after upload. */}
            {/* The number-and-shape hand-off is the fallback for a phone that
                cannot scan, so it waits behind one line instead of filling the
                screen under the code most people will simply scan. */}
            {sealed ? (
              <details className="drop-more-ways">
                <summary>{flowCopy.moreWays}</summary>
                <PairingHandover transferCode={result.code} sealed={sealed} text={text} />
              </details>
            ) : (
              <PairingHandover transferCode={result.code} sealed={sealed} text={text} />
            )}
            <DestructiveButton className="drop-erase" onClick={() => void erase()}>
              <Trash2 aria-hidden="true" /> {text("dropDeleteNow")}
            </DestructiveButton>
          </section>
        )
      ) : null}

      {stage === "error" ? (
        <section className="mobile-step mobile-step--single">
          <StatusIcon tone="error">
            <TriangleAlert size={34} aria-hidden="true" />
          </StatusIcon>
          <h1>{text(errorKey)}</h1>
          <PrimaryButton onClick={restart}>{text("dropClearSelection")}</PrimaryButton>
        </section>
      ) : null}
    </DropShell>
  );
}

/**
 * What the service actually knows about the other phone, and nothing more.
 * "Opened" is an open request; "on their way" is a first chunk being asked for;
 * "taken" is the receiving flow reporting that it finished. Saying any of these
 * one step early is the difference between a receipt and a guess.
 */
function ReceiverStatus({
  receiver,
  sealed,
  expiresAt,
  text,
}: {
  receiver: DropReceiverState;
  sealed: boolean;
  expiresAt: number;
  text: Text;
}) {
  if (receiver === "delivered") {
    return (
      <>
        <CheckCircle2 aria-hidden="true" /> {text("dropReceiverDelivered")}
      </>
    );
  }
  if (receiver === "downloading") {
    return (
      <>
        <Send aria-hidden="true" /> {text("dropReceiverDownloading")}
      </>
    );
  }
  if (receiver === "opened") {
    return (
      <>
        <CheckCircle2 aria-hidden="true" />{" "}
        {text(sealed ? "dropReceiverOpened" : "dropReceiverWaitingOnUpload")}
      </>
    );
  }
  return (
    <>
      <Timer aria-hidden="true" /> {text("dropExpiresIn", { minutes: minutesUntil(expiresAt) })} ·{" "}
      {text("dropWaitingPickup")}
    </>
  );
}

function SelectedFiles({
  files,
  selection,
  text,
  onRemove,
  onClear,
  onAddMore,
}: {
  files: readonly File[];
  selection: PreparedSelection | undefined;
  text: Text;
  onRemove: (index: number) => void;
  onClear: () => void;
  onAddMore: () => void;
}) {
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  return (
    <div className="drop-selection">
      <p className="drop-selection__summary">
        {text("dropSelectedSummary", {
          count: files.length,
          size: formatBytes(totalBytes),
        })}
      </p>
      <ul className="drop-file-list drop-file-list--removable">
        {files.map((file, index) => (
          <li key={`${file.name}-${file.size}-${file.lastModified}`} className="drop-file">
            <FileRow
              file={{
                // The name shown is the one that will travel, so a name the
                // policy had to change is visible before anything is sent.
                name: selection?.manifestFiles[index]?.name ?? file.name,
                size: file.size,
                type: file.type,
              }}
              text={text}
            />
            <button
              type="button"
              className="drop-file__remove"
              onClick={() => onRemove(index)}
              aria-label={text("dropRemoveFile", { name: file.name })}
            >
              <X aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className="drop-selection__actions">
        <SecondaryButton onClick={onAddMore}>
          <FilePlus2 aria-hidden="true" /> {text("dropAddMore")}
        </SecondaryButton>
        <SecondaryButton onClick={onClear}>{text("dropClearSelection")}</SecondaryButton>
      </div>
    </div>
  );
}

function subscribeNever(): () => void {
  // Sharing support does not change while a transfer screen is open.
  return () => {};
}
