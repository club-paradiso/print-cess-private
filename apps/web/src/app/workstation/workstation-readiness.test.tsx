// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkstationReadiness } from "./workstation-readiness";

const copy = {
  checking: "CHECKING",
  ready: "READY",
  limited: "LIMITED",
  blocked: "BLOCKED",
  secureContext: "https",
  webCrypto: "crypto",
  fileApi: "files",
  downloadApi: "downloads",
  serviceReach: "reach",
  sameOriginRoute: "relay",
  pass: "ok",
  pending: "…",
  fail: "no",
  blockedHint: "blocked hint",
  limitedHint: "limited hint",
  unreachableHint: "UNREACHABLE",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(globalThis, "crypto", {
    value: { subtle: {} },
    configurable: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderWith(fetchImpl: () => Promise<Response>): Promise<void> {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  await act(async () => {
    root.render(<WorkstationReadiness copy={copy} />);
  });
}

describe("workstation readiness verdict", () => {
  it("stays on checking while the reachability request is still in flight", async () => {
    await renderWith(() => new Promise<Response>(() => undefined));
    const headline = container.querySelector(".workstation-readiness__headline")?.textContent;
    expect(headline).toBe("CHECKING");
    expect(container.textContent).not.toContain("READY");
  });

  it("is ready once the server answers and offers the same-origin route", async () => {
    await renderWith(async () => Response.json({ sameOriginTransfers: true }));
    expect(container.querySelector(".workstation-readiness__headline")?.textContent).toBe("READY");
  });

  it("treats a rate-limited answer as proof the server is reachable", async () => {
    await renderWith(async () =>
      Response.json({ error: { code: "rate_limited" } }, { status: 429 }),
    );
    expect(container.textContent).not.toContain("UNREACHABLE");
    expect(container.querySelector(".workstation-readiness__headline")?.textContent).not.toBe(
      "BLOCKED",
    );
  });

  it("reports the network as blocking Print-cess when no response arrives", async () => {
    await renderWith(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(container.querySelector(".workstation-readiness__headline")?.textContent).toBe(
      "BLOCKED",
    );
    expect(container.textContent).toContain("UNREACHABLE");
  });
});
