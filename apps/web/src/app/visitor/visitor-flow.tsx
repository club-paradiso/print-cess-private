"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileX2,
  Printer,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  Upload,
} from "lucide-react";
import QRCode from "qrcode";

import {
  exportPublicKeyBase64Url,
  fingerprintPublicKey,
  generateEcdhKeyPair,
} from "@print-cess/crypto";

import { QR_COLORS } from "@/lib/qr-style";

export type VisitorCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  stepScan: string;
  stepScanDetail: string;
  stepUpload: string;
  stepUploadDetail: string;
  stepPrint: string;
  stepPrintDetail: string;
  stepDestroy: string;
  stepDestroyDetail: string;
  expiresIn: string;
  expired: string;
  newSession: string;
  preparing: string;
  preparingFailed: string;
  completed: string;
  completedDetail: string;
  failed: string;
  failedDetail: string;
  expiredTitle: string;
  expiredDetail: string;
  cancelled: string;
  cancelledDetail: string;
  statusLive: string;
  qrAlt: string;
};

type VisitorSession = {
  sessionId: string;
  expiresAt: number;
  kioskToken: string;
  qrImage: string;
};

type VisitorStatus =
  | "preparing"
  | "waiting"
  | "claimed"
  | "uploading"
  | "printing"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

const POLL_INTERVAL_MS = 2000;

async function mintVisitorSession(): Promise<VisitorSession> {
  const keyPair = await generateEcdhKeyPair();
  const kioskPublicKey = await exportPublicKeyBase64Url(keyPair.publicKey);
  const kioskPublicKeyFingerprint = await fingerprintPublicKey(kioskPublicKey);
  const response = await fetch("/api/visitor/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, kioskPublicKey, kioskPublicKeyFingerprint }),
  });
  if (!response.ok) throw new Error("visitor session registration failed");
  const body = (await response.json()) as {
    sessionId: string;
    expiresAt: number;
    kioskToken: string;
    qrUrl: string;
  };
  const qrImage = await QRCode.toDataURL(body.qrUrl, {
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 11,
    color: QR_COLORS,
  });
  return {
    sessionId: body.sessionId,
    expiresAt: body.expiresAt,
    kioskToken: body.kioskToken,
    qrImage,
  };
}

async function fetchSessionStatus(session: VisitorSession): Promise<string> {
  const response = await fetch(`/api/sessions/${session.sessionId}/status`, {
    headers: { "x-print-cess-kiosk-token": session.kioskToken },
  });
  if (!response.ok) throw new Error("status lookup failed");
  const body = (await response.json()) as { status?: string };
  return typeof body.status === "string" ? body.status : "failed";
}

/** Server session states collapsed onto the four counter-visible steps. */
function toVisitorStatus(serverStatus: string): VisitorStatus {
  switch (serverStatus) {
    case "waiting":
      return "waiting";
    case "claimed":
      return "claimed";
    case "upload_authorized":
    case "uploading":
    case "uploaded":
      return "uploading";
    case "consumed":
    case "validating":
    case "printing":
      return "printing";
    case "completed":
      return "completed";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function VisitorPrintFlow({ copy }: { copy: VisitorCopy }) {
  const [session, setSession] = useState<VisitorSession | null>(null);
  const [status, setStatus] = useState<VisitorStatus>("preparing");
  const [remainingMs, setRemainingMs] = useState(0);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  const start = useCallback(async () => {
    const run = ++generation.current;
    setSession(null);
    setStatus("preparing");
    setFailed(false);
    try {
      const created = await mintVisitorSession();
      if (generation.current !== run) return;
      setSession(created);
      setRemainingMs(created.expiresAt - Date.now());
      setStatus("waiting");
    } catch {
      if (generation.current === run) setFailed(true);
    }
  }, []);

  // The first session is minted on mount. The state initializers above already
  // carry the "preparing" values, so this effect performs no synchronous
  // setState — the async mint resolves into setState only when it finishes.
  useEffect(() => {
    const run = ++generation.current;
    let cancelled = false;
    mintVisitorSession()
      .then((created) => {
        if (cancelled || generation.current !== run) return;
        setSession(created);
        setRemainingMs(created.expiresAt - Date.now());
        setStatus("waiting");
      })
      .catch(() => {
        if (cancelled || generation.current !== run) return;
        setFailed(true);
      });
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, []);

  // Session-expiry countdown: the counter screen shows exactly when the
  // server's file lifetime ends and the uploaded ciphertext is destroyed.
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      setRemainingMs(session.expiresAt - Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const serverStatus = await fetchSessionStatus(session);
        if (!cancelled) setStatus(toVisitorStatus(serverStatus));
      } catch {
        // A transient poll failure is not a terminal state: the next poll
        // retries. The session's own expiry still destroys the file.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session]);

  const terminal =
    status === "completed" || status === "failed" || status === "expired" || status === "cancelled";
  const expired = session !== null && remainingMs <= 0 && !terminal;

  const steps = [
    {
      id: "scan",
      icon: QrCode,
      title: copy.stepScan,
      detail: copy.stepScanDetail,
      active: status === "waiting" || status === "preparing",
      done: status !== "preparing" && status !== "waiting",
    },
    {
      id: "upload",
      icon: Smartphone,
      title: copy.stepUpload,
      detail: copy.stepUploadDetail,
      active: status === "claimed" || status === "uploading",
      done: status === "printing" || terminal,
    },
    {
      id: "print",
      icon: Printer,
      title: copy.stepPrint,
      detail: copy.stepPrintDetail,
      active: status === "printing",
      done: terminal,
    },
    {
      id: "destroy",
      icon: Trash2,
      title: copy.stepDestroy,
      detail: copy.stepDestroyDetail,
      active: status === "completed",
      done: false,
    },
  ];

  return (
    <div className="visitor-flow">
      <div className="visitor-flow__main">
        <div className="visitor-qr-card">
          {session ? (
            <img src={session.qrImage} alt={copy.qrAlt} width={320} height={320} />
          ) : (
            <div
              className={`visitor-qr-card__placeholder${failed ? " visitor-qr-card__placeholder--failed" : ""}`}
              role="status"
            >
              {failed ? <AlertTriangle aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              <p>{failed ? copy.preparingFailed : copy.preparing}</p>
            </div>
          )}
          <p className="visitor-timer" aria-live="off">
            {expired || status === "expired"
              ? copy.expired
              : `${copy.expiresIn} ${formatCountdown(remainingMs)}`}
          </p>
        </div>

        <ol className="visitor-steps" aria-label={copy.statusLive}>
          {steps.map((step) => (
            <li
              key={step.id}
              className={`visitor-step${step.active ? " visitor-step--active" : ""}${step.done ? " visitor-step--done" : ""}`}
              aria-current={step.active ? "step" : undefined}
            >
              <span className="visitor-step__icon" aria-hidden="true">
                {step.done ? <CheckCircle2 /> : <step.icon />}
              </span>
              <span className="visitor-step__text">
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="visitor-status" role="status" aria-live="polite">
        {status === "completed" && (
          <div className="visitor-notice visitor-notice--ok">
            <CheckCircle2 aria-hidden="true" />
            <div>
              <strong>{copy.completed}</strong>
              <p>{copy.completedDetail}</p>
            </div>
          </div>
        )}
        {status === "failed" && (
          <div className="visitor-notice visitor-notice--warn">
            <FileX2 aria-hidden="true" />
            <div>
              <strong>{copy.failed}</strong>
              <p>{copy.failedDetail}</p>
            </div>
          </div>
        )}
        {(status === "expired" || expired) && (
          <div className="visitor-notice visitor-notice--warn">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>{copy.expiredTitle}</strong>
              <p>{copy.expiredDetail}</p>
            </div>
          </div>
        )}
        {status === "cancelled" && (
          <div className="visitor-notice visitor-notice--warn">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>{copy.cancelled}</strong>
              <p>{copy.cancelledDetail}</p>
            </div>
          </div>
        )}
        {status === "uploading" && (
          <p className="visitor-hint">
            <Upload aria-hidden="true" /> {copy.stepUploadDetail}
          </p>
        )}
      </div>

      {(terminal || expired || failed) && (
        <button type="button" className="visitor-restart" onClick={start}>
          <RefreshCw aria-hidden="true" /> {copy.newSession}
        </button>
      )}
    </div>
  );
}
