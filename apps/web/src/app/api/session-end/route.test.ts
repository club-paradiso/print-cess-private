import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("session end route", () => {
  beforeEach(() => {
    vi.stubEnv("PRINT_CESS_ADAPTER_MODE", "local");
    vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:3000");
    vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:3000");
    globalThis.__printCessRuntime = undefined;
  });

  afterEach(() => {
    globalThis.__printCessRuntime = undefined;
    vi.unstubAllEnvs();
  });

  it("tells the caller's browser to drop this origin's data", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/session-end", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Clear-Site-Data")).toBe('"cache", "cookies", "storage"');
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });

  it("never asks the browser to reload the finished page", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/session-end", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.headers.get("Clear-Site-Data")).not.toContain("executionContexts");
  });

  it("returns no body, so the response can carry nothing about the visit", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/session-end", { method: "POST" }),
    );

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it("refuses a request from another origin", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/session-end", {
        method: "POST",
        headers: { origin: "https://not-the-kiosk.invalid" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
