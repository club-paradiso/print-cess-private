import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  prepareSelection,
  preferSameOriginStorageRoute,
  resetStorageRouteForTests,
  sendDrop,
} from "./drop-transfer";

const STORAGE = "https://store1.private.blob.vercel-storage.com";

type Seen = { method: string; url: string };

function stubNetwork(storageBlocked: boolean): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    seen.push({ method, url: input });
    if (input.startsWith(STORAGE)) {
      if (storageBlocked) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 200 });
    }
    if (input.startsWith("/relay/blob/")) return new Response(null, { status: 200 });
    if (input === "/api/drops") {
      const body = JSON.parse(String(init.body)) as { dropId: string };
      return Response.json({
        protocolVersion: 1,
        dropId: body.dropId,
        status: "collecting",
        expiresAt: Date.now() + 600_000,
        chunkBytes: 8 * 1024 * 1024,
        maximumPartBytes: 8 * 1024 * 1024 + 16,
      });
    }
    if (input.endsWith("/parts")) {
      const { indexes } = JSON.parse(String(init.body)) as { indexes: number[] };
      return Response.json({
        operations: indexes.map((index) => ({
          index,
          method: "PUT",
          url: `${STORAGE}/drops/x/${index}?vercel-blob-signature=s${index}`,
          relayUrl: `/relay/blob/drops/x/${index}?vercel-blob-signature=s${index}`,
          headers: { "Content-Type": "application/octet-stream" },
          expiresAt: Date.now() + 600_000,
        })),
      });
    }
    if (input.endsWith("/parts/complete")) {
      return Response.json({ uploadedPartCount: 1, partCount: 1 });
    }
    if (input.endsWith("/seal")) return Response.json({ status: "ready" });
    return new Response(null, { status: 404 });
  });
  return seen;
}

function files(count: number): File[] {
  return Array.from(
    { length: count },
    (_, index) => new File([`synthetic ${index}`], `f${index}.txt`, { type: "text/plain" }),
  );
}

describe("storage route on managed networks", () => {
  beforeEach(() => resetStorageRouteForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorageRouteForTests();
  });

  it("uploads straight to storage when the network allows it", async () => {
    const seen = stubNetwork(false);
    await sendDrop(prepareSelection(files(2)));
    const puts = seen.filter((request) => request.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts.every((request) => request.url.startsWith(STORAGE))).toBe(true);
  });

  it("falls back to the same-origin relay when the storage host is blocked", async () => {
    const seen = stubNetwork(true);
    await sendDrop(prepareSelection(files(1)));
    await sendDrop(prepareSelection(files(1)));
    const puts = seen.filter((request) => request.method === "PUT");
    expect(puts.map((request) => request.url.startsWith(STORAGE))).toEqual([true, false, false]);
    expect(puts[1]?.url).toBe("/relay/blob/drops/x/0?vercel-blob-signature=s0");
  });

  it("never touches the storage host once the work-computer page asked for the relay", async () => {
    preferSameOriginStorageRoute();
    const seen = stubNetwork(true);
    await sendDrop(prepareSelection(files(3)));
    const puts = seen.filter((request) => request.method === "PUT");
    expect(puts).toHaveLength(3);
    expect(puts.some((request) => request.url.startsWith(STORAGE))).toBe(false);
  });
});
