/**
 * Watching a print job from the phone, after the document has been committed.
 *
 * The distinction this exists to hold is between the phone losing sight of the
 * kiosk and the kiosk failing. Before the upload is committed the phone owns
 * the session and cancelling on error is correct. After it, the kiosk owns the
 * work: it may already be validating, spooling, or printing, and a phone that
 * treats its own lost signal as a failed print both lies to the visitor and
 * cancels a job that is on its way to paper.
 *
 * So a transport failure never produces a verdict here. Only the service
 * saying a terminal word does, and running out of patience produces `unknown`,
 * which is the truth: nobody on this phone knows.
 */

export type PrintWatchState =
  | { kind: "waiting" }
  /** The phone cannot reach the service. The kiosk may well be printing. */
  | { kind: "reconnecting" }
  | { kind: "completed" }
  | { kind: "failed"; reason: PrintFailureReason }
  /** Contact was never regained. Neither success nor failure may be claimed. */
  | { kind: "unknown" };

export type PrintFailureReason = "printFailed" | "sessionExpired" | "printCancelled";

export const PRINT_POLL_INTERVAL_MS = 1000;
/** Long enough for a slow printer to warm up, spool, and finish a page. */
export const PRINT_WATCH_DEADLINE_MS = 150_000;
/**
 * One missed poll is a hiccup and saying so would flicker; two in a row is
 * worth telling the visitor about, because it changes what they should do —
 * which is to look at the printer rather than at this screen.
 */
export const RECONNECT_AFTER_FAILURES = 2;

const TERMINAL_FAILURES: Record<string, PrintFailureReason> = {
  failed: "printFailed",
  expired: "sessionExpired",
  cancelled: "printCancelled",
};

export type PrintStatusReader = () => Promise<{ status: string }>;

export async function watchPrintStatus(options: {
  poll: PrintStatusReader;
  onState: (state: PrintWatchState) => void;
  signal?: AbortSignal;
  deadlineMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PrintWatchState> {
  const {
    poll,
    onState,
    signal,
    deadlineMs = PRINT_WATCH_DEADLINE_MS,
    intervalMs = PRINT_POLL_INTERVAL_MS,
    now = Date.now,
    sleep = defaultSleep,
  } = options;

  const startedAt = now();
  let consecutiveFailures = 0;
  let announced: PrintWatchState["kind"] = "waiting";
  onState({ kind: "waiting" });

  while (now() - startedAt < deadlineMs) {
    if (signal?.aborted) return { kind: "unknown" };
    try {
      const { status } = await poll();
      consecutiveFailures = 0;
      if (status === "completed") {
        onState({ kind: "completed" });
        return { kind: "completed" };
      }
      const reason = TERMINAL_FAILURES[status];
      if (reason) {
        const failure: PrintWatchState = { kind: "failed", reason };
        onState(failure);
        return failure;
      }
      if (announced !== "waiting") {
        announced = "waiting";
        onState({ kind: "waiting" });
      }
    } catch {
      // A request that did not arrive says nothing about the printer. The one
      // thing it must never do is decide the job failed.
      consecutiveFailures += 1;
      if (consecutiveFailures >= RECONNECT_AFTER_FAILURES && announced !== "reconnecting") {
        announced = "reconnecting";
        onState({ kind: "reconnecting" });
      }
    }
    await sleep(intervalMs);
  }

  onState({ kind: "unknown" });
  return { kind: "unknown" };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
