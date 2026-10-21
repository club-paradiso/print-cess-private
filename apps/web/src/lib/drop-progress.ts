import type { DropProgress } from "./drop-transfer";

/**
 * A percentage alone does not answer the question a waiting visitor actually
 * has, which is whether to keep holding the phone or put it down. The estimate
 * is deliberately coarse — recent throughput only, rounded to whole minutes —
 * because a precise number that keeps changing reads as less trustworthy than
 * an approximate one that holds still.
 */

/** Samples older than this stop describing the connection the phone has now. */
const WINDOW_MS = 20_000;
/** Below this there is not enough signal to say anything honest. */
const MINIMUM_SAMPLES = 3;

export type ThroughputSample = { at: number; bytes: number };

export function recordSample(
  samples: readonly ThroughputSample[],
  progress: DropProgress,
  now: number,
): ThroughputSample[] {
  const next = [...samples, { at: now, bytes: progress.transferredBytes }];
  const earliest = now - WINDOW_MS;
  const trimmed = next.filter((sample) => sample.at >= earliest);
  // Always keep one sample from before the window so a slow connection still
  // has a baseline to measure against.
  return trimmed.length >= MINIMUM_SAMPLES ? trimmed : next.slice(-MINIMUM_SAMPLES * 2);
}

/** Whole minutes remaining, or null when there is nothing trustworthy to say. */
export function estimateMinutesRemaining(
  samples: readonly ThroughputSample[],
  progress: DropProgress,
): number | null {
  if (samples.length < MINIMUM_SAMPLES) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;

  const elapsed = last.at - first.at;
  const moved = last.bytes - first.bytes;
  if (elapsed <= 0 || moved <= 0) return null;

  const remaining = progress.totalBytes - progress.transferredBytes;
  if (remaining <= 0) return null;

  const bytesPerMs = moved / elapsed;
  const minutes = Math.ceil(remaining / bytesPerMs / 60_000);
  // Anything beyond an hour is a number nobody acts on.
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 ? minutes : null;
}

type WakeLockSentinelLike = { release(): Promise<void> };
type WakeLockLike = { request(type: "screen"): Promise<WakeLockSentinelLike> };

/**
 * Holds the screen awake for the length of a transfer. A phone that sleeps
 * mid-upload throttles timers and can stall a large hand-off, which the visitor
 * experiences as the service silently failing.
 */
export async function holdScreenAwake(): Promise<() => void> {
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  if (!wakeLock) return () => {};
  try {
    const sentinel = await wakeLock.request("screen");
    return () => void sentinel.release().catch(() => undefined);
  } catch {
    // Refused locks are ordinary; the transfer simply proceeds without one.
    return () => {};
  }
}

/** Hands the link to the phone's own share sheet when it has one. */
export async function shareTransferLink(link: string, title: string): Promise<boolean> {
  const share = navigator.share?.bind(navigator);
  if (!share) return false;
  try {
    await share({ title, text: title, url: link });
    return true;
  } catch {
    // Dismissing the sheet is a normal outcome, not a failure to report.
    return false;
  }
}

export function supportsSharing(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}
