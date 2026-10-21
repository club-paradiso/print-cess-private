// @vitest-environment jsdom
// The scanner is camera and DOM glue, so it can only be exercised where a
// document, a video element and a script tag exist.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which decoder reads the camera, and what a visitor is told when none can.
 *
 * Safari on iOS has no BarcodeDetector. Before the jsQR fallback, every iPhone
 * that tapped "Scan QR code" on the home page was told it could not scan. The
 * cases here pin the three outcomes apart: native decoding, the fallback, and
 * an honest "unavailable" when the fallback cannot load, which must not be
 * reported as a refused camera.
 */

type Scope = typeof globalThis & { BarcodeDetector?: unknown; jsQR?: unknown };
const scope = globalThis as Scope;

const JSQR_SRC = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";

function fakeStream() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

function fakeVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", { value: 4 });
  Object.defineProperty(video, "videoWidth", { value: 1920 });
  Object.defineProperty(video, "videoHeight", { value: 1080 });
  video.play = () => Promise.resolve();
  return video;
}

function stubCamera(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function stubCanvas() {
  const drawImage = vi.fn();
  const context = {
    drawImage,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  return { drawImage };
}

async function loadScanner() {
  vi.resetModules();
  return import("./drop-scanner");
}

function pendingScript(): HTMLScriptElement | null {
  return document.head.querySelector<HTMLScriptElement>("script[data-print-cess-qr]");
}

beforeEach(() => {
  vi.useFakeTimers();
  delete scope.BarcodeDetector;
  delete scope.jsQR;
  document.head.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete scope.BarcodeDetector;
  delete scope.jsQR;
});

describe("startCodeScanner", () => {
  it("reports a refused camera as cameraRefused", async () => {
    stubCamera(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    scope.BarcodeDetector = class {
      async detect() {
        return [];
      }
    };
    const { startCodeScanner } = await loadScanner();

    await expect(startCodeScanner(fakeVideo(), (raw) => raw)).rejects.toMatchObject({
      code: "cameraRefused",
    });
  });

  it("uses the native detector when the browser has one and never fetches jsQR", async () => {
    const { stream } = fakeStream();
    stubCamera(() => Promise.resolve(stream));
    scope.BarcodeDetector = class {
      async detect() {
        return [{ rawValue: "native" }];
      }
    };
    const { startCodeScanner } = await loadScanner();

    const scanner = await startCodeScanner(fakeVideo(), (raw) => raw);
    await vi.advanceTimersByTimeAsync(250);

    await expect(scanner.codes).resolves.toBe("native");
    expect(pendingScript()).toBeNull();
  });

  it("decodes with jsQR on a capped canvas when there is no native detector", async () => {
    const { stream, track } = fakeStream();
    stubCamera(() => Promise.resolve(stream));
    const { drawImage } = stubCanvas();
    const seen: Array<[number, number]> = [];
    scope.jsQR = (_data: Uint8ClampedArray, width: number, height: number) => {
      seen.push([width, height]);
      return { data: "fallback" };
    };
    const { startCodeScanner } = await loadScanner();

    const scanner = await startCodeScanner(fakeVideo(), (raw) => raw);
    await vi.advanceTimersByTimeAsync(250);

    await expect(scanner.codes).resolves.toBe("fallback");
    // A 1920x1080 frame is scaled so its long side is 960.
    expect(seen[0]).toEqual([960, 540]);
    expect(drawImage).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it("keeps scanning past codes the parser rejects", async () => {
    const { stream } = fakeStream();
    stubCamera(() => Promise.resolve(stream));
    stubCanvas();
    const reads = ["https://example.com/menu", "accepted"];
    scope.jsQR = () => ({ data: reads.shift() ?? "accepted" });
    const { startCodeScanner } = await loadScanner();

    const scanner = await startCodeScanner(fakeVideo(), (raw) => (raw === "accepted" ? raw : null));
    await vi.advanceTimersByTimeAsync(500);

    await expect(scanner.codes).resolves.toBe("accepted");
  });

  it("loads the pinned jsQR file with integrity and without a referrer", async () => {
    const { stream } = fakeStream();
    stubCamera(() => Promise.resolve(stream));
    stubCanvas();
    const { startCodeScanner } = await loadScanner();

    const starting = startCodeScanner(fakeVideo(), (raw) => raw);
    await vi.waitFor(() => expect(pendingScript()).not.toBeNull());
    const script = pendingScript()!;

    expect(script.src).toBe(JSQR_SRC);
    expect(script.integrity).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/u);
    expect(script.crossOrigin).toBe("anonymous");
    expect(script.referrerPolicy).toBe("no-referrer");

    scope.jsQR = () => ({ data: "loaded" });
    script.dispatchEvent(new Event("load"));
    const scanner = await starting;
    await vi.advanceTimersByTimeAsync(250);

    await expect(scanner.codes).resolves.toBe("loaded");
  });

  it("says the scanner is unavailable, not that the camera was refused, when jsQR cannot load", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    stubCamera(getUserMedia);
    stubCanvas();
    const { startCodeScanner } = await loadScanner();
    const video = fakeVideo();

    const starting = startCodeScanner(video, (raw) => raw);
    const outcome = expect(starting).rejects.toMatchObject({ code: "scannerUnavailable" });
    await vi.waitFor(() => expect(pendingScript()).not.toBeNull());
    // The decoder loads before the camera opens, so a stalled download can
    // never leave the camera on with nothing able to stop it.
    expect(getUserMedia).not.toHaveBeenCalled();
    pendingScript()!.dispatchEvent(new Event("error"));
    await outcome;

    // The camera was never opened, and the failed tag is gone so a retry can load again.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(video.srcObject ?? null).toBeNull();
    expect(pendingScript()).toBeNull();

    const retry = startCodeScanner(video, (raw) => raw);
    await vi.waitFor(() => expect(pendingScript()).not.toBeNull());
    scope.jsQR = () => null;
    pendingScript()!.dispatchEvent(new Event("load"));
    const scanner = await retry;
    scanner.stop();
    await expect(scanner.codes).resolves.toBeNull();
  });

  it("drops a tag that loaded without defining jsQR, so a retry is not left waiting", async () => {
    const { stream } = fakeStream();
    stubCamera(() => Promise.resolve(stream));
    stubCanvas();
    const { startCodeScanner } = await loadScanner();

    const starting = startCodeScanner(fakeVideo(), (raw) => raw);
    const outcome = expect(starting).rejects.toMatchObject({ code: "scannerUnavailable" });
    await vi.waitFor(() => expect(pendingScript()).not.toBeNull());
    pendingScript()!.dispatchEvent(new Event("load"));
    await outcome;

    expect(pendingScript()).toBeNull();
  });
});
