"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Camera,
  CheckCircle2,
  Download,
  FolderDown,
  RotateCcw,
  Send,
  Share2,
  Timer,
  TriangleAlert,
  X,
} from "lucide-react";

import type { SupportedLocale } from "@print-cess/i18n";
import { PrimaryButton, SecondaryButton, StatusIcon, TertiaryButton } from "@print-cess/ui";

import { reportDropDelivered } from "@/lib/drop-client";
import { parseDropFragment, readDropCodeEntry } from "@/lib/drop-link";
import { splitFirstSentence } from "@/lib/first-sentence";
import {
  estimateMinutesRemaining,
  holdScreenAwake,
  recordSample,
  type ThroughputSample,
} from "@/lib/drop-progress";
import {
  canShareReceivedFiles,
  downloadTarget,
  MEMORY_WARNING_BYTES,
  pickDirectoryTarget,
  pickSaveTarget,
  SaveError,
  shareReceivedFile,
  supportsStreamingSave,
  type SaveOutcome,
  type SaveTarget,
} from "@/lib/drop-save";
import {
  DropScannerError,
  startDropScanner,
  supportsCodeScanning,
  type DropScanner,
} from "@/lib/drop-scanner";
import {
  DropTransferError,
  inspectDrop,
  receiveDropFile,
  type DropProgress,
  type ReceivedDrop,
} from "@/lib/drop-transfer";

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
import { PairingEntry } from "./pairing-entry";

type Stage = "code" | "scanning" | "checking" | "pending" | "files" | "error";

type FileState =
  | { status: "waiting" }
  | { status: "saving"; progress: DropProgress; minutesRemaining: number | null }
  | { status: "saved"; outcome: SaveOutcome }
  | { status: "shared" }
  | { status: "failed"; errorKey: string };

const WAITING: FileState = { status: "waiting" };

function pendingDelayMs(attempt: number): number {
  return Math.min(8000, 1500 * 2 ** Math.floor(attempt / 4));
}

export function ReceiveFlow({ initialLocale }: { initialLocale?: SupportedLocale }) {
  const [locale, setLocale, text] = useDropLocale(initialLocale);
  const scannedOnArrival = useSyncExternalStore(subscribeNever, readHasFragment, () => false);
  const [arrivalHandled, setArrivalHandled] = useState(false);
  const [stage, setStage] = useState<Stage>("code");
  const [entry, setEntry] = useState("");
  const [drop, setDrop] = useState<ReceivedDrop>();
  const [fileStates, setFileStates] = useState<FileState[]>([]);
  const [errorKey, setErrorKey] = useState("dropNetworkError");
  const [noticeKey, setNoticeKey] = useState<string>();
  const [expiresAt, setExpiresAt] = useState(0);
  const samples = useRef<ThroughputSample[]>([]);
  const abort = useRef<AbortController>(null);
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<DropScanner>(null);
  const scanAttempt = useRef(0);
  const pending = useRef<AbortController>(null);
  const canScan = useSyncExternalStore(subscribeNever, supportsCodeScanning, () => false);
  const canShare = useSyncExternalStore(subscribeNever, canShareReceivedFiles, () => false);
  const canStream = useSyncExternalStore(subscribeNever, supportsStreamingSave, () => true);
  const canPickFolder = useSyncExternalStore(subscribeNever, readCanPickFolder, () => false);

  const statesRef = useRef<FileState[]>([]);

  const writeStates = useCallback((next: FileState[]) => {
    statesRef.current = next;
    setFileStates(next);
  }, []);

  const settle = useCallback(
    (opened: ReceivedDrop) => {
      setDrop(opened);
      setExpiresAt(opened.expiresAt);
      writeStates(opened.manifest.files.map(() => WAITING));
      setStage("files");
    },
    [writeStates],
  );

  const open = useCallback(
    async (candidate: string, onRecognized?: () => void) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      try {
        let opened = await inspectDrop(candidate, { signal: controller.signal });
        if (controller.signal.aborted) return;
        onRecognized?.();
        for (let attempt = 0; opened.state === "collecting"; attempt += 1) {
          setExpiresAt(opened.expiresAt);
          setStage("pending");
          if (opened.expiresAt <= Date.now()) throw new DropTransferError("dropExpired");
          await wait(pendingDelayMs(attempt), controller.signal);
          opened = await inspectDrop(opened.keys, { signal: controller.signal });
        }
        if (controller.signal.aborted) return;
        settle(opened);
      } catch (error) {
        if (controller.signal.aborted) return;
        setErrorKey(dropErrorKey(error));
        setStage("error");
      }
    },
    [settle],
  );

  const startOpen = useCallback(
    (candidate: string) => {
      setStage("checking");
      void open(candidate);
    },
    [open],
  );

  useEffect(() => {
    const scanned = parseDropFragment(window.location.hash);
    if (!scanned) return;
    let active = true;
    void (async () => {
      if (!active) return;
      await open(scanned, () => {
        if (active) history.replaceState(null, "", window.location.pathname);
      });
    })();
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(
    () => () => {
      scanAttempt.current += 1;
      scanner.current?.stop();
    },
    [],
  );

  const updateFile = useCallback(
    (index: number, next: FileState) => {
      writeStates(statesRef.current.map((state, at) => (at === index ? next : state)));
    },
    [writeStates],
  );

  const reportIfComplete = useCallback((received: ReceivedDrop) => {
    const settled = statesRef.current.every(
      (state) => state.status === "saved" || state.status === "shared",
    );
    if (settled) void reportDropDelivered(received.dropId);
  }, []);

  const runSave = useCallback(
    async (target: SaveTarget, index: number, signal: AbortSignal): Promise<SaveOutcome> => {
      if (!drop) throw new Error("dropNetworkError");
      const file = drop.manifest.files[index];
      if (!file) throw new Error("dropFileMissing");
      samples.current = [];
      updateFile(index, {
        status: "saving",
        progress: {
          transferredBytes: 0,
          totalBytes: file.size,
          completedParts: 0,
          totalParts: file.chunkCount,
        },
        minutesRemaining: null,
      });
      const sink = await target.open(file);
      const outcome = await receiveDropFile(drop, index, sink, {
        signal,
        onProgress: (next) => {
          samples.current = recordSample(samples.current, next, Date.now());
          updateFile(index, {
            status: "saving",
            progress: next,
            minutesRemaining: estimateMinutesRemaining(samples.current, next),
          });
        },
      });
      updateFile(index, { status: "saved", outcome });
      return outcome;
    },
    [drop, updateFile],
  );

  const saveOne = useCallback(
    async (index: number) => {
      if (!drop) return;
      const file = drop.manifest.files[index];
      if (!file) return;
      setNoticeKey(undefined);
      let target: SaveTarget;
      try {
        target = await pickSaveTarget(file);
      } catch (error) {
        if (error instanceof SaveError && error.code === "dropSaveCancelled") return;
        updateFile(index, { status: "failed", errorKey: dropErrorKey(error) });
        return;
      }
      const controller = new AbortController();
      abort.current = controller;
      const release = await holdScreenAwake();
      try {
        await runSave(target, index, controller.signal);
        reportIfComplete(drop);
      } catch (error) {
        updateFile(index, { status: "failed", errorKey: dropErrorKey(error) });
      } finally {
        release();
        abort.current = null;
      }
    },
    [drop, reportIfComplete, runSave, updateFile],
  );

  const saveRemaining = useCallback(
    async (mode: "download" | "folder" = "download") => {
      if (!drop) return;
      setNoticeKey(undefined);
      const outstanding = fileStates
        .map((state, index) => ({ state, index }))
        .filter(({ state }) => state.status !== "saved" && state.status !== "shared")
        .map(({ index }) => index);
      if (outstanding.length === 0) return;

      let folder: SaveTarget | null = null;
      if (mode === "folder" && canPickFolder) {
        try {
          folder = await pickDirectoryTarget();
        } catch (error) {
          setNoticeKey(dropErrorKey(error));
          return;
        }
        if (!folder) return;
      }

      const controller = new AbortController();
      abort.current = controller;
      const release = await holdScreenAwake();
      try {
        for (const index of outstanding) {
          const file = drop.manifest.files[index];
          if (!file) continue;
          try {
            const target = folder ?? downloadTarget(file.size);
            await runSave(target, index, controller.signal);
          } catch (error) {
            updateFile(index, { status: "failed", errorKey: dropErrorKey(error) });
            if (controller.signal.aborted) break;
          }
        }
        reportIfComplete(drop);
      } finally {
        release();
        abort.current = null;
      }
    },
    [canPickFolder, drop, fileStates, reportIfComplete, runSave, updateFile],
  );

  const shareOne = useCallback(
    async (index: number) => {
      if (!drop) return;
      const file = drop.manifest.files[index];
      if (!file) return;
      setNoticeKey(undefined);
      const controller = new AbortController();
      abort.current = controller;
      const release = await holdScreenAwake();
      try {
        samples.current = [];
        updateFile(index, {
          status: "saving",
          progress: {
            transferredBytes: 0,
            totalBytes: file.size,
            completedParts: 0,
            totalParts: file.chunkCount,
          },
          minutesRemaining: null,
        });
        const shared = await shareReceivedFile(file, async (sink) => {
          await receiveDropFile(drop, index, sink, {
            signal: controller.signal,
            onProgress: (next) => {
              samples.current = recordSample(samples.current, next, Date.now());
              updateFile(index, {
                status: "saving",
                progress: next,
                minutesRemaining: estimateMinutesRemaining(samples.current, next),
              });
            },
          });
        });
        updateFile(index, shared ? { status: "shared" } : WAITING);
      } catch (error) {
        updateFile(index, { status: "failed", errorKey: dropErrorKey(error) });
      } finally {
        release();
        abort.current = null;
      }
    },
    [drop, updateFile],
  );

  const scan = useCallback(async () => {
    setNoticeKey(undefined);
    setStage("scanning");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    const element = video.current;
    if (!element) return;
    const attempt = ++scanAttempt.current;
    try {
      const active = await startDropScanner(element);
      if (attempt !== scanAttempt.current) {
        active.stop();
        return;
      }
      scanner.current = active;
      const scanned = await active.codes;
      scanner.current = null;
      if (scanned) {
        setStage("checking");
        await open(scanned);
      } else setStage("code");
    } catch (error) {
      if (attempt !== scanAttempt.current) return;
      scanner.current = null;
      setNoticeKey(
        error instanceof DropScannerError && error.code === "cameraRefused"
          ? "dropCameraRefused"
          : "dropScannerUnavailable",
      );
      setStage("code");
    }
  }, [open]);

  const stopScanning = useCallback(() => {
    scanAttempt.current += 1;
    scanner.current?.stop();
    scanner.current = null;
    setStage("code");
  }, []);

  const restart = useCallback(() => {
    pending.current?.abort();
    abort.current?.abort();
    setArrivalHandled(true);
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
    setDrop(undefined);
    setFileStates([]);
    setEntry("");
    setNoticeKey(undefined);
    setStage("code");
  }, []);

  const onEntryChange = useCallback(
    (value: string) => {
      const read = readDropCodeEntry(value);
      setEntry(read.display);
      if (read.fromLink && read.code) startOpen(read.code);
    },
    [startOpen],
  );

  const typedCode = readDropCodeEntry(entry).code;
  const checking =
    stage === "checking" || (stage === "code" && scannedOnArrival && !arrivalHandled);
  const totalBytes = drop?.totalBytes ?? 0;
  const showMemoryNotice = stage === "files" && totalBytes > MEMORY_WARNING_BYTES && !canStream;
  const outstanding = useMemo(
    () =>
      fileStates.filter((state) => state.status !== "saved" && state.status !== "shared").length,
    [fileStates],
  );
  const anyFailed = fileStates.some((state) => state.status === "failed");
  const busy = fileStates.some((state) => state.status === "saving");
  const everythingArrived = fileStates.length > 0 && outstanding === 0;
  const anyStarted = fileStates.some((state) => state.status !== "waiting");

  return (
    <DropShell locale={locale} onLocaleChange={setLocale} text={text}>
      {stage === "scanning" ? (
        <section className="mobile-step drop-scan">
          <h1>{text("dropScanTitle")}</h1>
          <p>{text("dropScanHint")}</p>
          <video ref={video} className="drop-scan__preview" playsInline muted />
          <SecondaryButton onClick={stopScanning}>
            <X aria-hidden="true" /> {text("dropTypeInstead")}
          </SecondaryButton>
        </section>
      ) : null}

      {stage === "code" && !checking ? (
        <>
          {/* Four digits and a shape, rather than twelve characters read off
              somebody else's screen. Scanning stays for whoever prefers it. */}
          <PairingEntry text={text} onTransferCode={startOpen} />
          <section className="drop-receive-alt">
            {canScan ? (
              <SecondaryButton onClick={() => void scan()}>
                <Camera aria-hidden="true" /> {text("dropScanCta")}
              </SecondaryButton>
            ) : null}
            {noticeKey ? (
              <p className="drop-notice" role="status">
                {text(noticeKey)}
              </p>
            ) : null}
            {/* A shared link still has to land somewhere. This is for pasting
                one, not for typing a code out by hand — that is what the two
                digits above replaced. */}
            <details className="drop-paste">
              <summary>{text("dropPasteLink")}</summary>
              <label className="drop-code-field">
                <span className="drop-visually-hidden">{text("dropPasteLink")}</span>
                <input
                  data-testid="drop-code-input"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  value={entry}
                  onChange={(event) => onEntryChange(event.target.value)}
                />
              </label>
              <SecondaryButton
                disabled={!typedCode}
                onClick={() => typedCode && startOpen(typedCode)}
              >
                <Download aria-hidden="true" /> {text("dropOpenTransfer")}
              </SecondaryButton>
            </details>
            <a className="drop-link" href="/send">
              <Send aria-hidden="true" /> {text("dropSendCta")}
            </a>
          </section>
        </>
      ) : null}

      {checking ? (
        <section className="mobile-step mobile-step--single" aria-busy="true">
          <div className="mobile-spinner" />
          <p>{text("dropChecking")}</p>
        </section>
      ) : null}

      {stage === "pending" ? (
        <section className="mobile-step mobile-step--single" aria-live="polite">
          <div className="drop-pulse" aria-hidden="true">
            <span />
          </div>
          <h1>{text("dropConnected")}</h1>
          {/* Never a name, never a device, never a person: the receiving phone
              knows only that the code was right and the files are not ready. */}
          <p>{text("dropSenderPreparing")}</p>
          <p className="drop-status">{text("dropKeepPageOpen")}</p>
          <SecondaryButton onClick={restart}>{text("dropCancel")}</SecondaryButton>
        </section>
      ) : null}

      {stage === "files" && drop ? (
        <section className="mobile-step drop-receive-files">
          <h1>{text("dropFilesTitle")}</h1>
          <p>{text("dropFilesHint")}</p>
          {/* How much, and for how long, before the list: the two facts that
              decide whether to save everything now. */}
          <p className="drop-status">
            <Timer aria-hidden="true" />{" "}
            {text("dropExpiresIn", { minutes: minutesUntil(expiresAt) })} ·{" "}
            {formatBytes(totalBytes)}
          </p>
          {/* Once everything is out of the service, that is the news; it sits
              where the eye already is rather than under the list. */}
          {everythingArrived ? (
            <div className="drop-complete" role="status">
              <StatusIcon tone="success">
                <CheckCircle2 size={28} aria-hidden="true" />
              </StatusIcon>
              <p>{text(completionKey(fileStates))}</p>
            </div>
          ) : null}
          <ul className="drop-file-list drop-file-list--actions">
            {drop.manifest.files.map((file, index) => (
              <ReceivedFileRow
                key={`${file.name}-${index}`}
                file={file}
                state={fileStates[index] ?? WAITING}
                text={text}
                canShare={canShare}
                busy={busy}
                showWaiting={anyStarted}
                onSave={() => void saveOne(index)}
                onShare={() => void shareOne(index)}
              />
            ))}
          </ul>
          {showMemoryNotice ? (
            <p className="drop-notice" role="status">
              {text("dropMemoryNotice")}
            </p>
          ) : null}
          {noticeKey ? (
            <p className="drop-notice" role="status">
              {text(noticeKey)}
            </p>
          ) : null}
          {/* Saving everything is the one forward action, so it stays on screen
              however long the list is; the way out sits quietly under it. */}
          <div className="mobile-actions">
            {everythingArrived ? null : (
              <PrimaryButton disabled={busy} onClick={() => void saveRemaining("download")}>
                {anyFailed ? (
                  <>
                    <RotateCcw aria-hidden="true" /> {text("dropRetryRemaining")}
                  </>
                ) : (
                  <>
                    <Download aria-hidden="true" /> {text("dropSaveAll")}
                  </>
                )}
              </PrimaryButton>
            )}
            {!everythingArrived && canPickFolder ? (
              <SecondaryButton disabled={busy} onClick={() => void saveRemaining("folder")}>
                <FolderDown aria-hidden="true" /> {text("dropSaveAllToFolder")}
              </SecondaryButton>
            ) : null}
            {busy ? (
              <SecondaryButton onClick={() => abort.current?.abort()}>
                {text("dropCancel")}
              </SecondaryButton>
            ) : everythingArrived ? (
              <PrimaryButton onClick={restart}>{text("dropReceiveAnother")}</PrimaryButton>
            ) : (
              <TertiaryButton className="drop-receive-another" onClick={restart}>
                {text("dropReceiveAnother")}
              </TertiaryButton>
            )}
          </div>
        </section>
      ) : null}

      {stage === "error" ? <ErrorState errorKey={errorKey} text={text} onRetry={restart} /> : null}
    </DropShell>
  );
}

function ReceivedFileRow({
  file,
  state,
  text,
  canShare,
  busy,
  showWaiting,
  onSave,
  onShare,
}: {
  file: { name: string; size: number; type: string };
  state: FileState;
  text: Text;
  canShare: boolean;
  busy: boolean;
  showWaiting: boolean;
  onSave: () => void;
  onShare: () => void;
}) {
  const settled = state.status === "saved" || state.status === "shared";
  return (
    <li className={`drop-file drop-file--${state.status}`}>
      <FileRow file={file} text={text} />
      {state.status === "saving" ? (
        <TransferBar
          progress={state.progress}
          text={text}
          minutesRemaining={state.minutesRemaining}
        />
      ) : null}
      {state.status === "waiting" && !showWaiting ? null : (
        <p className="drop-file__state" role="status">
          {text(fileStateKey(state))}
        </p>
      )}
      {settled || state.status === "saving" ? null : (
        <div className="drop-file__actions">
          <SecondaryButton disabled={busy} onClick={onSave}>
            <Download aria-hidden="true" />{" "}
            {text(state.status === "failed" ? "dropTryAgain" : "dropSaveOne")}
          </SecondaryButton>
          {canShare ? (
            <SecondaryButton disabled={busy} onClick={onShare}>
              <Share2 aria-hidden="true" /> {text("dropShareFile")}
            </SecondaryButton>
          ) : null}
        </div>
      )}
    </li>
  );
}

function fileStateKey(state: FileState): string {
  switch (state.status) {
    case "waiting":
      return "dropFileWaiting";
    case "saving":
      return "dropFileSaving";
    case "saved":
      return state.outcome === "saved" ? "dropFileSaved" : "dropFileDownloadStarted";
    case "shared":
      return "dropFileShared";
    case "failed":
      return state.errorKey;
  }
}

function completionKey(states: readonly FileState[]): string {
  const everyOneWritten = states.every(
    (state) => state.status === "saved" && state.outcome === "saved",
  );
  return everyOneWritten ? "dropAllSaved" : "dropAllHandedOver";
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function subscribeNever(): () => void {
  return () => {};
}

function readHasFragment(): boolean {
  return parseDropFragment(window.location.hash) !== null;
}

function readCanPickFolder(): boolean {
  return typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

function ErrorState({
  errorKey,
  text,
  onRetry,
}: {
  errorKey: string;
  text: Text;
  onRetry: () => void;
}) {
  const [heading, instruction] = splitFirstSentence(text(errorKey));
  return (
    <section className="mobile-step mobile-step--single">
      <StatusIcon tone="error">
        <TriangleAlert size={34} aria-hidden="true" />
      </StatusIcon>
      {/* A message that carries its own next step reads as a title and then
          an instruction, not one paragraph at headline size. */}
      <h1>{heading}</h1>
      {instruction ? <p>{instruction}</p> : null}
      <PrimaryButton onClick={onRetry}>
        <RotateCcw aria-hidden="true" /> {text("dropTryAgain")}
      </PrimaryButton>
    </section>
  );
}
