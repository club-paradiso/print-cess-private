import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ServerConfig } from "./config";
import { assertAllowedOrigin, readJson, readSessionId } from "./http";

const schema = z.object({ value: z.string() }).strict();

const originConfig = {
  mode: "external",
  sessionProvider: "upstash-redis",
  blobProvider: "vercel-blob",
  cleanupProvider: "qstash",
  publicBaseUrl: "https://print-cess.vercel.app",
  allowedOrigins: ["https://print-cess.vercel.app"],
  qrTtlMs: 120_000,
  sessionTtlMs: 180_000,
  signedUrlTtlMs: 120_000,
  dropTtlMs: 1_800_000,
  dropMaxTotalBytes: 2 * 1024 * 1024 * 1024,
  visitorTtlMs: 600_000,
  demoEnabled: false,
} satisfies ServerConfig;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertAllowedOrigin", () => {
  it("accepts origins explicitly configured by the deployment", () => {
    const request = new Request("https://print-cess.vercel.app/api", {
      headers: { Origin: "https://print-cess.vercel.app" },
    });

    expect(() => assertAllowedOrigin(request, originConfig)).not.toThrow();
  });

  it.each(["https://print-cess.vercel.app", "https://paradiso-print-cess-web.vercel.app"])(
    "accepts the official Production alias %s",
    (origin) => {
      vi.stubEnv("VERCEL_ENV", "production");
      const request = new Request(`${origin}/api`, { headers: { Origin: origin } });
      const config = { ...originConfig, allowedOrigins: ["https://configured.example.test"] };

      expect(() => assertAllowedOrigin(request, config)).not.toThrow();
    },
  );

  it("does not trust the Production aliases outside Vercel Production", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const origin = "https://paradiso-print-cess-web.vercel.app";
    const request = new Request(`${origin}/api`, { headers: { Origin: origin } });
    const config = { ...originConfig, allowedOrigins: ["https://configured.example.test"] };

    expect(() => assertAllowedOrigin(request, config)).toThrow(
      expect.objectContaining({ code: "unauthorized", status: 403 }),
    );
  });

  it("rejects unrelated Vercel hosts in Production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const origin = "https://unrelated-project.vercel.app";
    const request = new Request(`${origin}/api`, { headers: { Origin: origin } });

    expect(() => assertAllowedOrigin(request, originConfig)).toThrow(
      expect.objectContaining({ code: "unauthorized", status: 403 }),
    );
  });
});

describe("readJson", () => {
  it("parses and validates a bounded JSON body", async () => {
    const request = new Request("https://print.example.test/api", {
      method: "POST",
      body: JSON.stringify({ value: "safe" }),
    });

    await expect(readJson(request, schema)).resolves.toEqual({ value: "safe" });
  });

  it("maps malformed JSON to a public 400 error", async () => {
    const request = new Request("https://print.example.test/api", {
      method: "POST",
      body: "{",
    });

    await expect(readJson(request, schema)).rejects.toMatchObject({
      code: "bad_request",
      status: 400,
    });
  });

  it("rejects unknown JSON members instead of silently stripping them", async () => {
    const request = new Request("https://print.example.test/api", {
      method: "POST",
      body: JSON.stringify({ value: "safe", unexpected: true }),
    });

    await expect(readJson(request, schema)).rejects.toMatchObject({
      code: "bad_request",
      status: 400,
    });
  });

  it("rejects a body that exceeds the byte limit", async () => {
    const request = new Request("https://print.example.test/api", {
      method: "POST",
      body: JSON.stringify({ value: "four bytes" }),
    });

    await expect(readJson(request, schema, 4)).rejects.toMatchObject({
      code: "bad_request",
      status: 413,
    });
  });
});

describe("readSessionId", () => {
  it("rejects non-canonical dynamic route identifiers before store access", async () => {
    await expect(
      readSessionId({ params: Promise.resolve({ sessionId: "../unbounded-key" }) }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
    await expect(
      readSessionId({
        params: Promise.resolve({ sessionId: `${"A".repeat(21)}B` }),
      }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });
});
