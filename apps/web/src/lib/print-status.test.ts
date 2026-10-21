import { describe, expect, it, vi } from "vitest";

import { RECONNECT_AFTER_FAILURES, watchPrintStatus, type PrintWatchState } from "./print-status";

function fakeTiming(intervalMs = 1000) {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
    intervalMs,
  };
}

function record() {
  const states: PrintWatchState[] = [];
  return { states, onState: (state: PrintWatchState) => states.push(state) };
}

describe("watchPrintStatus", () => {
  it("reports a completed print", async () => {
    const timing = fakeTiming();
    const { states, onState } = record();
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ status: "printing" })
      .mockResolvedValueOnce({ status: "completed" });

    await expect(watchPrintStatus({ poll, onState, ...timing })).resolves.toEqual({
      kind: "completed",
    });
    expect(states.at(-1)).toEqual({ kind: "completed" });
  });

  it("never turns a lost connection into a failed print", async () => {
    const timing = fakeTiming();
    const { states, onState } = record();
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ status: "printing" })
      .mockResolvedValueOnce({ status: "completed" });

    const result = await watchPrintStatus({ poll, onState, ...timing });

    expect(result).toEqual({ kind: "completed" });
    expect(states.map((state) => state.kind)).toEqual([
      "waiting",
      "reconnecting",
      "waiting",
      "completed",
    ]);
    expect(states.some((state) => state.kind === "failed")).toBe(false);
  });

  it("waits out a single missed poll without saying anything", async () => {
    const timing = fakeTiming();
    const { states, onState } = record();
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ status: "completed" });

    await watchPrintStatus({ poll, onState, ...timing });

    expect(states.map((state) => state.kind)).toEqual(["waiting", "completed"]);
    expect(RECONNECT_AFTER_FAILURES).toBeGreaterThan(1);
  });

  it("reports failure only when the service says so", async () => {
    for (const [status, reason] of [
      ["failed", "printFailed"],
      ["expired", "sessionExpired"],
      ["cancelled", "printCancelled"],
    ] as const) {
      const timing = fakeTiming();
      const { onState } = record();
      const poll = vi.fn().mockResolvedValue({ status });
      await expect(watchPrintStatus({ poll, onState, ...timing })).resolves.toEqual({
        kind: "failed",
        reason,
      });
    }
  });

  it("admits it does not know rather than inventing an answer", async () => {
    const timing = fakeTiming();
    const { states, onState } = record();
    const poll = vi.fn().mockRejectedValue(new Error("offline"));

    const result = await watchPrintStatus({ poll, onState, deadlineMs: 10_000, ...timing });

    expect(result).toEqual({ kind: "unknown" });
    expect(states.at(-1)).toEqual({ kind: "unknown" });
    expect(states.some((state) => state.kind === "completed")).toBe(false);
    expect(states.some((state) => state.kind === "failed")).toBe(false);
  });

  it("stops when the page is going away", async () => {
    const timing = fakeTiming();
    const { onState } = record();
    const controller = new AbortController();
    controller.abort();
    const poll = vi.fn();

    await expect(
      watchPrintStatus({ poll, onState, signal: controller.signal, ...timing }),
    ).resolves.toEqual({ kind: "unknown" });
    expect(poll).not.toHaveBeenCalled();
  });

  it("does not repeat the waiting notice on every poll", async () => {
    const timing = fakeTiming();
    const { states, onState } = record();
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ status: "uploaded" })
      .mockResolvedValueOnce({ status: "validating" })
      .mockResolvedValueOnce({ status: "printing" })
      .mockResolvedValueOnce({ status: "completed" });

    await watchPrintStatus({ poll, onState, ...timing });

    expect(states.map((state) => state.kind)).toEqual(["waiting", "completed"]);
  });
});
