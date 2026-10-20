import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

describe("session lifetime configuration", () => {
  it("uses a two-minute public QR window and a three-minute claimed session window", () => {
    expect(loadConfig({ NODE_ENV: "test", PRINT_CESS_ADAPTER_MODE: "local" })).toMatchObject({
      qrTtlMs: 120_000,
      sessionTtlMs: 180_000,
    });
  });

  it("rejects a public QR lifetime longer than the claimed session lifetime", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PRINT_CESS_ADAPTER_MODE: "local",
        QR_TTL_SECONDS: "240",
        SESSION_TTL_SECONDS: "180",
      }),
    ).toThrow(/QR_TTL_SECONDS must not exceed SESSION_TTL_SECONDS/u);
  });
});

describe("visitor counter session lifetime configuration", () => {
  it("defaults the visitor QR and file lifetime to ten minutes", () => {
    expect(loadConfig({ NODE_ENV: "test", PRINT_CESS_ADAPTER_MODE: "local" })).toMatchObject({
      visitorTtlMs: 600_000,
    });
  });

  it("accepts a configured visitor lifetime", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        PRINT_CESS_ADAPTER_MODE: "local",
        VISITOR_TTL_SECONDS: "900",
      }),
    ).toMatchObject({ visitorTtlMs: 900_000 });
  });

  it("rejects a visitor lifetime below one minute", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PRINT_CESS_ADAPTER_MODE: "local",
        VISITOR_TTL_SECONDS: "30",
      }),
    ).toThrow();
  });

  it("rejects a visitor lifetime above thirty minutes", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PRINT_CESS_ADAPTER_MODE: "local",
        VISITOR_TTL_SECONDS: "3600",
      }),
    ).toThrow();
  });
});
