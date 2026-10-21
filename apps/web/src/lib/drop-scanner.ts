import { parseDropCode } from "./drop-link";


type BarcodeDetection = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<BarcodeDetection[]> };
type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

type JsQrResult = { data: string };
type JsQrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst";
  },
) => JsQrResult | null;

const JSQR_SRC = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
const JSQR_INTEGRITY = "sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx";
let jsQrLoader: Promise<JsQrDecoder> | undefined;

function detectorConstructor(): BarcodeDetectorConstructor | null {
  const candidate = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  return typeof candidate === "function" ? candidate : null;
}

function jsQrDecoder(): JsQrDecoder | null {
  const candidate = (globalThis as typeof globalThis & { jsQR?: JsQrDecoder }).jsQR;
  return typeof candidate === "function" ? candidate : null;
}

async function loadJsQrDecoder(): Promise<JsQrDecoder> {
  const existing = jsQrDecoder();
  if (existing) return existing;
  if (typeof document === "undefined") throw new DropScannerError("scannerUnavailable");
  if (jsQrLoader) return jsQrLoader;

  jsQrLoader = new Promise<JsQrDecoder>((resolve, reject) => {
    const alreadyLoading = document.querySelector<HTMLScriptElement>("script[data-print-cess-qr]");
    const script = alreadyLoading ?? document.createElement("script");

    const finish = () => {
      const loaded = jsQrDecoder();
      if (loaded) {
        resolve(loaded);
        return;
      }
      script.remove();
      reject(new DropScannerError("scannerUnavailable"));
    };
    const fail = () => {
      script.remove();
      reject(new DropScannerError("scannerUnavailable"));
    };

    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!alreadyLoading) {
      script.dataset.printCessQr = "true";
      script.src = JSQR_SRC;
      script.integrity = JSQR_INTEGRITY;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      document.head.append(script);
    }
  }).catch((error: unknown) => {
    jsQrLoader = undefined;
    throw error;
  });

  return jsQrLoader;
}

export function supportsCodeScanning(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

export class DropScannerError extends Error {
  public constructor(public readonly code: "cameraRefused" | "scannerUnavailable") {
    super(code);
    this.name = "DropScannerError";
  }
}

export type CodeScanner<T> = {
  stream: MediaStream;
  codes: Promise<T | null>;
  stop(): void;
};

export type DropScanner = CodeScanner<string>;

const SCAN_INTERVAL_MS = 220;
const FALLBACK_MAX_DIMENSION = 960;

export function startDropScanner(video: HTMLVideoElement): Promise<DropScanner> {
  return startCodeScanner(video, parseDropCode);
}

export async function startCodeScanner<T>(
  video: HTMLVideoElement,
  parse: (rawValue: string) => T | null,
): Promise<CodeScanner<T>> {
  if (!supportsCodeScanning()) throw new DropScannerError("scannerUnavailable");

  const Detector = detectorConstructor();
  const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;

  let fallback: JsQrDecoder | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;

  if (!detector) {
    try {
      fallback = await loadJsQrDecoder();
    } catch {
      throw new DropScannerError("scannerUnavailable");
    }
    canvas = document.createElement("canvas");
    context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new DropScannerError("scannerUnavailable");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch {
    throw new DropScannerError("cameraRefused");
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await video.play().catch(() => undefined);

  let stopped = false;
  let timer = 0;
  let settle: (code: T | null) => void = () => {};
  const codes = new Promise<T | null>((resolve) => {
    settle = resolve;
  });

  const finish = (code: T | null) => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
    settle(code);
  };
  const stop = () => finish(null);

  const decodeWithFallback = (): string | null => {
    if (!fallback || !canvas || !context || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const scale = Math.min(
      1,
      FALLBACK_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight),
    );
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    context.drawImage(video, 0, 0, width, height);
    const frame = context.getImageData(0, 0, width, height);
    return fallback(frame.data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };

  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2) {
        const rawValues = detector
          ? (await detector.detect(video)).map((detection) => detection.rawValue)
          : [decodeWithFallback()].filter((value): value is string => value !== null);

        for (const rawValue of rawValues) {
          const code = parse(rawValue);
          if (code !== null) {
            finish(code);
            return;
          }
        }
      }
    } catch {
    }
    if (!stopped) timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
  };

  timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);

  return { stream, codes, stop };
}
