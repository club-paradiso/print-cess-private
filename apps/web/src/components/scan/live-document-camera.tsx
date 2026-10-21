"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Check, ScanLine, X } from "lucide-react";

import type { SupportedLocale } from "@print-cess/i18n";
import { PrimaryButton, SecondaryButton } from "@print-cess/ui";

import {
  FULL_FRAME_QUAD,
  inspectDocumentFrame,
  quadDrift,
  type CaptureIssue,
  type DocumentQuad,
} from "@/lib/document-scan-engine";
import { proScanCopy } from "./scan-pro-copy";

const ANALYSIS_EDGE = 820;
const ANALYSIS_INTERVAL_MS = 360;
const STABLE_DRIFT = 0.018;
const STABLE_FRAMES = 3;
const NEW_PAGE_DRIFT = 0.055;

async function waitForVideoDimensions(video: HTMLVideoElement): Promise<boolean> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return true;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (ready: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", check);
      video.removeEventListener("resize", check);
      resolve(ready);
    };
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) finish(true);
    };
    const timeout = window.setTimeout(() => finish(false), 8000);
    video.addEventListener("loadedmetadata", check);
    video.addEventListener("resize", check);
    check();
  });
}

function captureIssueText(issue: CaptureIssue, copy: ReturnType<typeof proScanCopy>): string {
  switch (issue) {
    case "no-document":
    case "move-closer":
      return copy.moveCloser;
    case "too-dark":
      return copy.moreLight;
    case "too-bright":
      return copy.tooBright;
    case "glare":
      return copy.reduceGlare;
    case "blurry":
      return copy.blurry;
    case "ready":
      return copy.ready;
    default:
      return copy.holdSteady;
  }
}

export function LiveDocumentCamera({
  locale,
  disabled,
  onCapture,
  onFallback,
  onClose,
}: {
  locale: SupportedLocale;
  disabled?: boolean;
  onCapture: (file: File) => void | Promise<void>;
  onFallback: () => void;
  onClose: () => void;
}) {
  const copy = proScanCopy(locale);
  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisCanvas = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisBusy = useRef(false);
  const captureBusy = useRef(false);
  const autoCaptureRef = useRef(true);
  const disabledRef = useRef(Boolean(disabled));
  const copyRef = useRef(copy);
  const onCaptureRef = useRef(onCapture);
  const lastQuad = useRef<DocumentQuad | null>(null);
  const capturedQuad = useRef<DocumentQuad | null>(null);
  const stableFrames = useRef(0);
  const waitingForNewPage = useRef(false);
  const analysisFailures = useRef(0);
  const analysisUnavailableRef = useRef(false);
  const [analysisUnavailable, setAnalysisUnavailable] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [quad, setQuad] = useState<DocumentQuad>(FULL_FRAME_QUAD);
  const [detected, setDetected] = useState(false);
  const [qualityScore, setQualityScore] = useState(0);
  const [message, setMessage] = useState(copy.cameraStarting);
  const [aspectRatio, setAspectRatio] = useState("3 / 4");

  useEffect(() => {
    disabledRef.current = Boolean(disabled);
  }, [disabled]);

  useEffect(() => {
    copyRef.current = copy;
  }, [copy]);

  useEffect(() => {
    onCaptureRef.current = onCapture;
  }, [onCapture]);

  const stopCamera = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (
      !video ||
      video.videoWidth === 0 ||
      video.videoHeight === 0 ||
      captureBusy.current ||
      disabledRef.current
    ) {
      return;
    }
    captureBusy.current = true;
    setCapturing(true);
    try {
      const maxEdge = 3200;
      const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("scanCameraCanvasUnavailable");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("scanCameraCaptureFailed"))),
          "image/jpeg",
          0.96,
        );
      });
      const file = new File([blob], `Print-cess-scan-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      capturedQuad.current = lastQuad.current;
      waitingForNewPage.current = true;
      stableFrames.current = 0;
      setMessage(copyRef.current.holdSteady);
      await onCaptureRef.current(file);
    } catch (captureError) {
      console.error("[scan-camera] capture failed", captureError);
      setMessage(copyRef.current.cameraFallback);
    } finally {
      window.setTimeout(() => {
        captureBusy.current = false;
        setCapturing(false);
      }, 650);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const inspect = async () => {
      if (
        cancelled ||
        disabledRef.current ||
        analysisUnavailableRef.current ||
        analysisBusy.current ||
        captureBusy.current
      )
        return;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      analysisBusy.current = true;
      try {
        const scale = Math.min(1, ANALYSIS_EDGE / Math.max(video.videoWidth, video.videoHeight));
        const canvas = analysisCanvas.current ?? document.createElement("canvas");
        analysisCanvas.current = canvas;
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const inspection = await inspectDocumentFrame(canvas);
        if (cancelled) return;
        analysisFailures.current = 0;
        const activeCopy = copyRef.current;

        setQuad(inspection.detection.quad);
        setDetected(inspection.detection.detected);
        setQualityScore(inspection.quality.score);

        if (waitingForNewPage.current) {
          const previous = capturedQuad.current;
          if (
            !inspection.detection.detected ||
            (previous && quadDrift(previous, inspection.detection.quad) > NEW_PAGE_DRIFT)
          ) {
            waitingForNewPage.current = false;
            capturedQuad.current = null;
            lastQuad.current = null;
          } else {
            setMessage(activeCopy.holdSteady);
            lastQuad.current = inspection.detection.quad;
            return;
          }
        }

        if (!inspection.quality.ready) {
          stableFrames.current = 0;
          setMessage(captureIssueText(inspection.quality.issue, activeCopy));
          lastQuad.current = inspection.detection.quad;
          return;
        }

        const previous = lastQuad.current;
        const stable = previous
          ? quadDrift(previous, inspection.detection.quad) <= STABLE_DRIFT
          : false;
        stableFrames.current = stable ? stableFrames.current + 1 : 0;
        lastQuad.current = inspection.detection.quad;

        if (stableFrames.current < STABLE_FRAMES) {
          setMessage(activeCopy.holdSteady);
          return;
        }

        setMessage(activeCopy.ready);
        if (autoCaptureRef.current) await captureFrame();
      } catch (analysisError) {
        console.error("[scan-camera] frame analysis failed", analysisError);
        if (cancelled) return;
        stableFrames.current = 0;
        analysisFailures.current += 1;
        if (analysisFailures.current >= 2) {
          analysisUnavailableRef.current = true;
          setAnalysisUnavailable(true);
          autoCaptureRef.current = false;
          setAutoCapture(false);
          setMessage(copyRef.current.cameraFallback);
          if (timer !== undefined) window.clearInterval(timer);
        } else {
          setMessage(copyRef.current.holdSteady);
        }
      } finally {
        analysisBusy.current = false;
      }
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(true);
        setMessage(copyRef.current.cameraDenied);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2560 },
            height: { ideal: 1920 },
          },
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const hasVideo = await waitForVideoDimensions(video);
        if (cancelled) return;
        if (!hasVideo) throw new Error("scanCameraNoVideoFrames");
        setAspectRatio(`${video.videoWidth || 3} / ${video.videoHeight || 4}`);
        setStarted(true);
        setMessage(copyRef.current.holdSteady);
        timer = window.setInterval(() => void inspect(), ANALYSIS_INTERVAL_MS);
      } catch (cameraError) {
        console.error("[scan-camera] unable to start camera", cameraError);
        stopCamera();
        if (cancelled) return;
        setError(true);
        setMessage(copyRef.current.cameraDenied);
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stopCamera();
    };
  }, [captureFrame, stopCamera]);

  const close = () => {
    stopCamera();
    onClose();
  };
  const polygon = quad.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ");
  const toggleAutoCapture = () => {
    setAutoCapture((current) => {
      const next = !current;
      autoCaptureRef.current = next;
      stableFrames.current = 0;
      return next;
    });
  };

  return (
    <div className="scan-live-dialog" role="dialog" aria-modal="true" aria-label={copy.liveCamera}>
      <div className="scan-live-panel">
        <div className="scan-live-header">
          <div>
            <strong>{copy.liveCamera}</strong>
            <span>{message}</span>
          </div>
          <button type="button" onClick={close} aria-label={copy.closeCamera}>
            <X aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <div className="scan-camera-error">
            <CameraOff aria-hidden="true" />
            <p>{copy.cameraDenied}</p>
            <PrimaryButton
              onClick={() => {
                stopCamera();
                onClose();
                onFallback();
              }}
            >
              <Camera aria-hidden="true" /> {copy.cameraFallback}
            </PrimaryButton>
          </div>
        ) : (
          <>
            <div className="scan-live-stage" style={{ aspectRatio }}>
              <video ref={videoRef} muted playsInline autoPlay aria-label={copy.liveCamera} />
              <svg
                className={`scan-live-overlay ${detected ? "is-detected" : ""}`}
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polygon points={polygon} />
              </svg>
              {!started ? <div className="scan-live-loading">{copy.cameraStarting}</div> : null}
              <div className={`scan-live-guidance ${message === copy.ready ? "is-ready" : ""}`}>
                {message === copy.ready ? (
                  <Check aria-hidden="true" />
                ) : (
                  <ScanLine aria-hidden="true" />
                )}
                <span>{message}</span>
              </div>
            </div>

            <div className="scan-quality" aria-label={copy.quality}>
              <span>{copy.quality}</span>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(qualityScore * 100)}
              >
                <i style={{ width: `${Math.round(qualityScore * 100)}%` }} />
              </div>
            </div>

            <div className="scan-live-controls">
              <SecondaryButton
                onClick={toggleAutoCapture}
                disabled={disabled || capturing || analysisUnavailable}
              >
                {autoCapture ? copy.autoCaptureOn : copy.autoCaptureOff}
              </SecondaryButton>
              <PrimaryButton
                onClick={() => void captureFrame()}
                disabled={!started || disabled || capturing}
              >
                <Camera aria-hidden="true" /> {copy.manualCapture}
              </PrimaryButton>
            </div>
            <div className="scan-live-fallback">
              <SecondaryButton
                disabled={disabled || capturing}
                onClick={() => {
                  stopCamera();
                  onClose();
                  onFallback();
                }}
              >
                <Camera aria-hidden="true" /> {copy.cameraFallback}
              </SecondaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
