import { describe, expect, it } from "vitest";

import type { PairingRecord } from "@print-cess/protocol";

import { ServiceError } from "../errors";
import { MemoryPairingStore } from "./memory";

const TRANSFER_CODE = "23456789ABCD";

function draft(now = 1_000): Omit<PairingRecord, "code"> {
  return {
    protocolVersion: 1,
    shape: "star",
    transferCode: TRANSFER_CODE,
    createdAt: now,
    expiresAt: now + 180_000,
  };
}

describe("MemoryPairingStore", () => {
  it("takes the first code nobody holds", async () => {
    const store = new MemoryPairingStore();
    const first = await store.claim(draft(), ["42", "43"]);
    const second = await store.claim(draft(), ["42", "43"]);
    expect(first?.code).toBe("42");
    expect(second?.code).toBe("43");
  });

  it("reports exhaustion rather than overwriting a live pairing", async () => {
    const store = new MemoryPairingStore();
    await store.claim(draft(), ["42"]);
    await expect(store.claim(draft(), ["42"])).resolves.toBeNull();
  });

  it("hands an expired code back out", async () => {
    const store = new MemoryPairingStore();
    await store.claim(draft(1_000), ["42"]);
    const later = await store.claim(draft(200_000), ["42"]);
    expect(later?.code).toBe("42");
  });

  it("returns the transfer code for the chosen shape and consumes the pairing", async () => {
    const store = new MemoryPairingStore();
    await store.claim(draft(), ["42"]);

    await expect(store.redeem("42", "star", 1_000)).resolves.toMatchObject({
      transferCode: TRANSFER_CODE,
    });
    await expect(store.redeem("42", "star", 1_000)).rejects.toBeInstanceOf(ServiceError);
  });

  it("forgives one wrong shape", async () => {
    const store = new MemoryPairingStore();
    await store.claim(draft(), ["4242"]);

    await expect(store.redeem("4242", "circle", 1_000)).rejects.toThrow(
      "Those numbers and that shape do not match a transfer.",
    );
    await expect(store.redeem("4242", "star", 1_000)).resolves.toMatchObject({
      transferCode: TRANSFER_CODE,
    });
  });

  it("deletes the pairing on the second wrong shape", async () => {
    const store = new MemoryPairingStore();
    await store.claim(draft(), ["4242"]);

    await expect(store.redeem("4242", "circle", 1_000)).rejects.toBeInstanceOf(ServiceError);
    await expect(store.redeem("4242", "triangle", 1_000)).rejects.toBeInstanceOf(ServiceError);
    await expect(store.redeem("4242", "star", 1_000)).rejects.toBeInstanceOf(ServiceError);
  });

  it("counts wrong guesses per window across every caller", async () => {
    const store = new MemoryPairingStore();
    await store.recordMiss(60_000);
    await store.recordMiss(119_999);
    expect(await store.recentMisses(90_000)).toBe(2);
    expect(await store.recentMisses(120_000)).toBe(0);
  });

  it("answers an expired pairing exactly as one that never existed", async () => {
    const store = new MemoryPairingStore();
    await store.claim(draft(1_000), ["42"]);

    await expect(store.redeem("42", "star", 500_000)).rejects.toThrow(
      "Those numbers and that shape do not match a transfer.",
    );
    await expect(store.redeem("77", "star", 1_000)).rejects.toThrow(
      "Those numbers and that shape do not match a transfer.",
    );
  });
});
