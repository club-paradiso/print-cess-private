import { describe, expect, it } from "vitest";

import { estimateMinutesRemaining, recordSample, type ThroughputSample } from "./drop-progress";
import type { DropProgress } from "./drop-transfer";

function progress(transferredBytes: number, totalBytes: number): DropProgress {
  return { transferredBytes, totalBytes, completedParts: 0, totalParts: 1 };
}

function steady(bytesPerSecond: number, seconds: number, from = 0): ThroughputSample[] {
  let samples: ThroughputSample[] = [];
  for (let second = 0; second <= seconds; second += 1) {
    samples = recordSample(
      samples,
      progress(from + bytesPerSecond * second, Number.MAX_SAFE_INTEGER),
      second * 1000,
    );
  }
  return samples;
}

describe("estimateMinutesRemaining", () => {
  it("says nothing until there is enough signal to be honest", () => {
    expect(estimateMinutesRemaining([], progress(0, 1000))).toBeNull();
    const two = steady(1000, 1);
    expect(estimateMinutesRemaining(two, progress(1000, 100_000))).toBeNull();
  });

  it("estimates from recent throughput", () => {
    const samples = steady(1_000_000, 5);
    const remaining = estimateMinutesRemaining(
      samples,
      progress(5_000_000, 5_000_000 + 120_000_000),
    );
    expect(remaining).toBe(2);
  });

  it("says nothing when the transfer has stalled", () => {
    const stalled = steady(0, 5);
    expect(estimateMinutesRemaining(stalled, progress(0, 100_000_000))).toBeNull();
  });

  it("says nothing once the transfer is complete", () => {
    const samples = steady(1_000_000, 5);
    expect(estimateMinutesRemaining(samples, progress(5_000_000, 5_000_000))).toBeNull();
  });

  it("withholds an estimate nobody would act on", () => {
    const samples = steady(10, 5);
    expect(estimateMinutesRemaining(samples, progress(50, 5_000_000_000))).toBeNull();
  });
});

describe("recordSample", () => {
  it("keeps a usable baseline even when every sample is old", () => {
    const samples = steady(1_000_000, 60);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(estimateMinutesRemaining(samples, progress(60_000_000, 180_000_000))).toBe(2);
  });
});
