import type { DropProgress } from "./drop-transfer";


const WINDOW_MS = 20_000;
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
  return trimmed.length >= MINIMUM_SAMPLES ? trimmed : next.slice(-MINIMUM_SAMPLES * 2);
}

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
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 ? minutes : null;
}

type WakeLockSentinelLike = { release(): Promise<void> };
type WakeLockLike = { request(type: "screen"): Promise<WakeLockSentinelLike> };

export async function holdScreenAwake(): Promise<() => void> {
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  if (!wakeLock) return () => {};
  try {
    const sentinel = await wakeLock.request("screen");
    return () => void sentinel.release().catch(() => undefined);
  } catch {
    return () => {};
  }
}

export async function shareTransferLink(link: string, title: string): Promise<boolean> {
  const share = navigator.share?.bind(navigator);
  if (!share) return false;
  try {
    await share({ title, text: title, url: link });
    return true;
  } catch {
    return false;
  }
}

export function supportsSharing(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}
