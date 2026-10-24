import { ServiceError } from "./errors";

type Window = { count: number; limit: number; resetAt: number };
const windows = new Map<string, Window>();
const MAX_WINDOWS = 5000;

export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): void {
  if (windows.size >= MAX_WINDOWS && !windows.has(key)) makeRoom(now);
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, limit, resetAt: now + windowMs });
    return;
  }
  existing.count += 1;
  if (existing.count > limit) {
    throw new ServiceError(
      "rate_limited",
      "Too many requests. Scan a current QR code and try again.",
      429,
    );
  }
}

/**
 * A full table must not refuse every new caller, or flooding it with unique
 * keys becomes a way to shut the service for everyone. Expired windows go
 * first, then the oldest windows that are still under budget. A window that
 * has reached its limit is never evicted, so churning the table cannot reset a
 * caller who is already blocked.
 */
function makeRoom(now: number): void {
  for (const [candidate, value] of windows) {
    if (value.resetAt <= now) windows.delete(candidate);
  }
  for (const [candidate, value] of windows) {
    if (windows.size < MAX_WINDOWS) return;
    if (value.count < value.limit) windows.delete(candidate);
  }
  if (windows.size >= MAX_WINDOWS) {
    throw new ServiceError("rate_limited", "Too many requests. Try again shortly.", 429);
  }
}

/**
 * Checks a budget without spending from it. Pairing joins are counted only when
 * they miss, because a café or a school shares one address: charging every
 * successful hand-off to that address would ration the service by building
 * rather than by behaviour, while a run of misses is what enumeration of a
 * hundred codes actually looks like.
 */
export function assertUnderRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): void {
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) return;
  if (existing.count >= limit) {
    throw new ServiceError(
      "rate_limited",
      "Too many wrong numbers. Wait a moment and try again.",
      429,
    );
  }
}
