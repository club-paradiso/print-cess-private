import { describe, expect, it } from "vitest";

import { blobConnectOrigins, buildContentSecurityPolicy } from "./proxy";

function env(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("Content Security Policy", () => {
  it("allows the exact Vercel private Blob signing endpoint", () => {
    const policy = buildContentSecurityPolicy("test-nonce", false, env());

    expect(policy).toContain(
      "connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com https://blob.vercel-storage.com",
    );
    expect(policy).toContain("frame-src 'self' blob:");
    expect(policy).not.toContain("https://*.vercel.com");
  });

  it("permits WebAssembly compilation without enabling JavaScript eval in production", () => {
    const policy = buildContentSecurityPolicy("test-nonce", false, env());

    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).not.toContain(" 'unsafe-eval'");
  });

  it("allows Emscripten eval and same-origin PDF preview only on the scanner route", () => {
    const scanner = buildContentSecurityPolicy("test-nonce", false, env(), true);
    const ordinary = buildContentSecurityPolicy("test-nonce", false, env(), false);

    expect(scanner).toContain(" 'unsafe-eval'");
    expect(scanner).toContain("frame-ancestors 'self'");
    expect(scanner).toContain("style-src 'self' 'unsafe-inline'");
    expect(ordinary).not.toContain(" 'unsafe-eval'");
    expect(ordinary).toContain("frame-ancestors 'none'");
    expect(ordinary).toContain("style-src 'self' 'nonce-test-nonce'");
  });

  it("allows only the pinned OCR asset origins required for local recognition", () => {
    const policy = buildContentSecurityPolicy("test-nonce", false, env());

    expect(policy).toContain("https://cdn.jsdelivr.net");
    expect(policy).toContain("https://tessdata.projectnaptha.com");
    expect(policy).toContain("worker-src 'self' blob: https://cdn.jsdelivr.net");
    expect(policy).not.toContain("worker-src *");
    expect(policy).not.toContain("connect-src *");
  });

  it("admits the configured S3 endpoint so the browser can reach it", () => {
    const origins = blobConnectOrigins(
      env({
        PRINT_CESS_BLOB_PROVIDER: "railway-s3",
        S3_ENDPOINT: "https://storage.example.test",
        S3_BUCKET: "print-cess",
      }),
    );

    expect(origins).toEqual([
      "https://storage.example.test",
      "https://print-cess.storage.example.test",
    ]);
  });

  it("drops the virtual-hosted form when the bucket forces path style", () => {
    const origins = blobConnectOrigins(
      env({
        PRINT_CESS_BLOB_PROVIDER: "railway-s3",
        S3_ENDPOINT: "https://storage.example.test",
        S3_BUCKET: "print-cess",
        S3_FORCE_PATH_STYLE: "true",
      }),
    );

    expect(origins).toEqual(["https://storage.example.test"]);
  });

  it("never widens the policy for a missing, plaintext, or malformed endpoint", () => {
    for (const endpoint of [undefined, "http://storage.example.test", "not-a-url"]) {
      const origins = blobConnectOrigins(
        env({
          PRINT_CESS_BLOB_PROVIDER: "railway-s3",
          ...(endpoint ? { S3_ENDPOINT: endpoint } : {}),
        }),
      );
      expect(origins).toEqual([]);
    }
  });

  it("keeps a path or query out of the admitted origin", () => {
    const origins = blobConnectOrigins(
      env({
        PRINT_CESS_BLOB_PROVIDER: "railway-s3",
        S3_ENDPOINT: "https://storage.example.test/bucket?token=secret",
      }),
    );

    expect(origins).toEqual(["https://storage.example.test"]);
  });

  it("does not admit S3 when the Vercel provider is selected", () => {
    const policy = buildContentSecurityPolicy(
      "test-nonce",
      false,
      env({ S3_ENDPOINT: "https://storage.example.test" }),
    );

    expect(policy).not.toContain("storage.example.test");
  });
});
