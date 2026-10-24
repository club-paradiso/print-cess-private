import { describe, expect, it } from "vitest";

import { assertUnderRateLimit, enforceRateLimit } from "./rate-limit";

describe("miss-only rate limiting", () => {
  it("blocks before a sixth protected operation reaches its store", () => {
    const key = "pairing-miss:test-five";
    for (let count = 0; count < 5; count += 1) {
      enforceRateLimit(key, 5, 60_000, 1_000);
    }
    expect(() => assertUnderRateLimit(key, 5, 60_000, 1_000)).toThrow("Too many wrong numbers.");
  });

  it("allows a fresh budget after its window expires", () => {
    const key = "pairing-miss:test-expiry";
    enforceRateLimit(key, 1, 1_000, 1_000);
    expect(() => assertUnderRateLimit(key, 1, 1_000, 1_999)).toThrow();
    expect(() => assertUnderRateLimit(key, 1, 1_000, 2_000)).not.toThrow();
  });
});

describe("full rate-limit table", () => {
  it("admits a new caller instead of refusing everyone", () => {
    for (let index = 0; index < 5000; index += 1) {
      enforceRateLimit(`flood:${index}`, 240, 60_000, 10_000);
    }
    expect(() => enforceRateLimit("session-create:fresh", 20, 60_000, 10_000)).not.toThrow();
  });

  it("keeps a blocked caller blocked while the table churns", () => {
    const key = "pairing-miss:test-churn";
    for (let count = 0; count < 5; count += 1) {
      enforceRateLimit(key, 5, 60_000, 20_000);
    }
    for (let index = 0; index < 6000; index += 1) {
      enforceRateLimit(`churn:${index}`, 240, 60_000, 20_000);
    }
    expect(() => assertUnderRateLimit(key, 5, 60_000, 20_000)).toThrow("Too many wrong numbers.");
  });
});
