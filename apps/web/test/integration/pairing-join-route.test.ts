import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PairingRecord } from "@print-cess/protocol";

import { MemoryPairingStore } from "@/server/pairing-store/memory";
import { PAIRING_GLOBAL_MISS_LIMIT } from "@/server/pairing-store/transitions";

const runtimeMock = vi.hoisted(() => ({ getRuntime: vi.fn() }));
vi.mock("@/server/runtime", () => runtimeMock);

import { POST } from "@/app/api/pairings/[code]/join/route";

const TRANSFER_CODE = "23456789ABCD";
let pairings: MemoryPairingStore;
let address = 0;

function draft(): Omit<PairingRecord, "code"> {
  const now = Date.now();
  return {
    protocolVersion: 1,
    shape: "star",
    transferCode: TRANSFER_CODE,
    createdAt: now,
    expiresAt: now + 180_000,
  };
}

function join(code: string, shape: string): Promise<Response> {
  // A fresh address per request isolates the service-wide budget from the
  // per-address limit, which is exactly what a distributed guesser does.
  address += 1;
  return POST(
    new Request(`https://print-cess.example.test/api/pairings/${code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${address}` },
      body: JSON.stringify({ protocolVersion: 1, shape }),
    }),
    { params: Promise.resolve({ code }) },
  );
}

beforeEach(() => {
  // The budget is counted per minute; a fixed clock keeps a test from
  // straddling two windows.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
  pairings = new MemoryPairingStore();
  runtimeMock.getRuntime.mockReturnValue({ config: { allowedOrigins: [] }, pairings });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pairing join route", () => {
  it("answers a wrong shape on a live code exactly like an unknown code", async () => {
    await pairings.claim(draft(), ["4242"]);

    const wrongShape = await join("4242", "circle");
    const unknown = await join("1111", "star");
    expect(wrongShape.status).toBe(404);
    expect(await wrongShape.json()).toEqual(await unknown.json());

    const matched = await join("4242", "star");
    expect(matched.status).toBe(200);
    expect(await matched.json()).toMatchObject({ transferCode: TRANSFER_CODE });
  });

  it("pauses joins for everyone once the service-wide miss budget is spent", async () => {
    await pairings.claim(draft(), ["4242"]);
    for (let index = 0; index < PAIRING_GLOBAL_MISS_LIMIT; index += 1) {
      expect((await join(String(1000 + index), "star")).status).toBe(404);
    }

    const paused = await join("4242", "star");
    expect(paused.status).toBe(429);
    await expect(pairings.get("4242")).resolves.not.toBeNull();
  });
});
