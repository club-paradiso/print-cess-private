"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import {
  decryptDocument,
  exportPublicKeyBase64Url,
  fingerprintPublicKey,
  generateEcdhKeyPair,
  generateToken,
  hashToken,
} from "@print-cess/crypto";

import {
  CompletedScreen,
  ConnectedScreen,
  KioskWaitingScreen,
  playCompletionTone,
  UnavailableScreen,
  type KioskStatus,
} from "@/components/kiosk/kiosk-screens";

import {
  detectFileKind,
  parseJpegDimensions,
  parsePngDimensions,
  validateDimensions,
  validatePdf,
} from "@/lib/file-validation";
import {
  createPrintArtifact,
  printArtifact,
  revokePrintArtifact,
  type PrintArtifact,
} from "@/lib/kiosk-print";
import { QR_COLORS } from "@/lib/qr-style";

type RegisteredSession = {
  sessionId: string;
  expiresAt: number;
  kioskToken: string;
  qrUrl: string;
  qrImage: string;
  privateKey: CryptoKey;
  fingerprint: string;
};

/**
 * The outcome of getting one QR code onto the screen. The failing step travels
 * with the failure so the development console still names where it broke,
 * while the caller stays free to apply a single shared attempt to whichever run
 * of the effect is still mounted.
 */
type PreparedSession =
  { ok: true; session: RegisteredSession } | { ok: false; step: string; reason: string };

/**
 * Mints one print session and renders its QR code. Kept out of the effect body
 * so that the promise it returns can be reused rather than the work repeated:
 * every call here consumes a session from the per-counter creation limit.
 */
async function prepareSession(): Promise<PreparedSession> {
  let step = "key-generation";
  try {
    const keyPair = await generateEcdhKeyPair();
    const kioskPublicKey = await exportPublicKeyBase64Url(keyPair.publicKey);
    const fingerprint = await fingerprintPublicKey(kioskPublicKey);
    step = "session-registration";
    const response = await fetch("/api/kiosk/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 1,
        kioskPublicKey,
        kioskPublicKeyFingerprint: fingerprint,
      }),
    });
    if (!response.ok) throw new Error("session registration failed");
    const body = (await response.json()) as {
      sessionId: string;
      expiresAt: number;
      kioskToken: string;
      qrUrl: string;
    };
    step = "qr-rendering";
    const qrImage = await QRCode.toDataURL(body.qrUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 11,
      color: QR_COLORS,
    });
    return {
      ok: true,
      session: { ...body, qrImage, privateKey: keyPair.privateKey, fingerprint },
    };
  } catch (error) {
    return {
      ok: false,
      step,
      reason: error instanceof Error ? error.message : "unknown error",
    };
  }
}

export function KioskSimulator({
  automaticPrinting = false,
  sound = true,
}: {
  automaticPrinting?: boolean;
  sound?: boolean;
}) {
  const [session, setSession] = useState<RegisteredSession>();
  const [status, setStatus] = useState<KioskStatus>("preparing");
  const [remaining, setRemaining] = useState(120);
  const [completionRemaining, setCompletionRemaining] = useState(60);
  const [artifact, setArtifact] = useState<PrintArtifact>();
  const [generation, setGeneration] = useState(0);
  const [sessionLifetime, setSessionLifetime] = useState(120);
  const processing = useRef(false);
  const artifactRef = useRef<PrintArtifact | undefined>(undefined);
  const preparation = useRef<{ generation: number; ready: Promise<PreparedSession> }>(null);

  const replaceArtifact = useCallback((nextArtifact: PrintArtifact | undefined) => {
    revokePrintArtifact(artifactRef.current);
    artifactRef.current = nextArtifact;
    setArtifact(nextArtifact);
  }, []);

  const reset = useCallback(() => {
    processing.current = false;
    replaceArtifact(undefined);
    setSession(undefined);
    setStatus("preparing");
    setRemaining(120);
    setCompletionRemaining(60);
    setGeneration((value) => value + 1);
  }, [replaceArtifact]);

  useEffect(
    () => () => {
      revokePrintArtifact(artifactRef.current);
      artifactRef.current = undefined;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    // Registering a session mints server-side state and counts against the
    // per-counter creation limit, so it is started once per QR generation.
    // React runs an effect twice in development; without this the screen would
    // quietly burn two sessions every time it opened and abandon the first.
    if (preparation.current?.generation !== generation) {
      preparation.current = { generation, ready: prepareSession() };
    }
    void preparation.current.ready.then((prepared) => {
      if (!active) return;
      if (!prepared.ok) {
        if (process.env.NODE_ENV !== "production") {
          console.error(`Kiosk preparation failed during ${prepared.step}: ${prepared.reason}.`);
        }
        setStatus("failed");
        return;
      }
      const lifetime = Math.max(0, Math.ceil((prepared.session.expiresAt - Date.now()) / 1000));
      setRemaining(lifetime);
      setSessionLifetime(lifetime);
      setSession(prepared.session);
      setStatus("waiting");
    });
    return () => {
      active = false;
    };
  }, [generation]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0 && !processing.current) reset();
    }, 500);
    return () => window.clearInterval(timer);
  }, [reset, session]);

  useEffect(() => {
    if (!session || status === "completed" || status === "failed") return;
    let active = true;
    const poll = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/sessions/${session.sessionId}/status`, {
            headers: { "x-print-cess-kiosk-token": session.kioskToken },
            cache: "no-store",
          });
          if (!response.ok) return;
          const body = (await response.json()) as { status: string; expiresAt?: number };
          if (!active) return;
          if (body.status === "expired" || body.status === "cancelled") {
            reset();
            return;
          }
          if (body.status === "failed") {
            setStatus("failed");
            return;
          }
          if (typeof body.expiresAt === "number" && Number.isFinite(body.expiresAt)) {
            setSession((current) =>
              current && current.sessionId === session.sessionId
                ? { ...current, expiresAt: body.expiresAt as number }
                : current,
            );
            setRemaining(Math.max(0, Math.ceil((body.expiresAt - Date.now()) / 1000)));
          }
          if (body.status === "claimed") setStatus("claimed");
          if (body.status === "upload_authorized" || body.status === "uploading")
            setStatus("uploading");
          if (body.status === "uploaded" && !processing.current) {
            processing.current = true;
            setStatus("uploaded");
            await consumeAndPrint(session, setStatus, replaceArtifact);
            if (active && sound) {
              playCompletionTone();
            }
          }
        } catch {
          // Transient polling errors do not change the kiosk screen.
        }
      })();
    }, 750);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [replaceArtifact, reset, session, sound, status]);

  useEffect(() => {
    if (status !== "completed") return;
    const deadline = Date.now() + 60_000;
    const tick = () => {
      setCompletionRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };
    const interval = window.setInterval(tick, 250);
    const timeout = window.setTimeout(reset, 60_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [reset, status]);

  if (status === "completed" && artifact)
    return (
      <CompletedScreen
        artifacts={[artifact]}
        automaticPrinting={automaticPrinting}
        remaining={completionRemaining}
      />
    );
  if (status === "failed") return <UnavailableScreen onReset={reset} />;
  // Once a phone has claimed the session, telling the room to scan a QR code
  // that is no longer valid is both wrong and confusing: the visitor standing
  // here is looking for what happens next, and it is happening on their phone.
  if (status !== "preparing" && status !== "waiting") {
    return <ConnectedScreen status={status} remaining={remaining} />;
  }

  return (
    <KioskWaitingScreen
      status={status}
      session={session}
      remaining={remaining}
      lifetime={sessionLifetime}
    />
  );
}

async function consumeAndPrint(
  session: RegisteredSession,
  setStatus: (status: KioskStatus) => void,
  setArtifact: (artifact: PrintArtifact | undefined) => void,
) {
  let envelope: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let plaintext: Uint8Array<ArrayBufferLike> = new Uint8Array();
  try {
    const consumeId = generateToken();
    const consumeResponse = await fetch(`/api/sessions/${session.sessionId}/consume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-print-cess-kiosk-token": session.kioskToken,
      },
      body: JSON.stringify({ consumeIdHash: await hashToken(consumeId, "kiosk") }),
    });
    if (!consumeResponse.ok) throw new Error("consume failed");
    const operation = (await consumeResponse.json()) as {
      url: string;
      headers: Record<string, string>;
      size: number;
      etag: string;
    };
    const download = await fetch(operation.url, {
      method: "GET",
      headers: operation.headers,
      cache: "no-store",
    });
    if (!download.ok) throw new Error("download failed");
    envelope = new Uint8Array(await download.arrayBuffer());
    if (envelope.byteLength !== operation.size) throw new Error("metadata mismatch");
    const decrypted = await decryptDocument(
      envelope,
      {
        protocolVersion: 1,
        sessionId: session.sessionId,
        kioskPublicKeyFingerprint: session.fingerprint,
      },
      session.privateKey,
    );
    plaintext = decrypted.plaintext;
    setStatus("validating");
    await kioskTransition(session, "validating");
    const detected = detectFileKind(plaintext);
    if (detected !== decrypted.fileKind) throw new Error("file kind mismatch");
    if (detected === "pdf") {
      await validatePdf(plaintext);
    } else if (detected === "png" || detected === "jpeg") {
      // `docs/SECURITY.md` requires the kiosk to enforce the image dimension
      // and resource budget itself, not to inherit the phone's verdict.
      const { width, height } =
        detected === "png" ? parsePngDimensions(plaintext) : parseJpegDimensions(plaintext);
      validateDimensions(width, height);
    } else {
      // Only the Windows kiosk carries a Hancom renderer, and this browser
      // kiosk never advertises HWP/HWPX support, so anything else fails closed.
      throw new Error("unsupported file kind for the browser kiosk");
    }
    const artifact = createPrintArtifact(plaintext, decrypted.fileKind);
    setArtifact(artifact);
    setStatus("printing");
    await kioskTransition(session, "printing");
    // A document that never reached the print dialog was not printed, so a
    // frame that failed to load ends the session as failed, never completed.
    await printArtifact(artifact);
    await kioskTransition(session, "completed");
    setStatus("completed");
  } catch {
    // The failure screen offers no reprint or download, so the decrypted Blob
    // is released now instead of when the next QR code is created.
    setArtifact(undefined);
    setStatus("failed");
    await kioskTransition(session, "failed").catch(() => undefined);
  } finally {
    envelope.fill(0);
    plaintext.fill(0);
  }
}

async function kioskTransition(
  session: RegisteredSession,
  status: "validating" | "printing" | "completed" | "failed",
) {
  const response = await fetch(`/api/sessions/${session.sessionId}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-print-cess-kiosk-token": session.kioskToken },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(`transition ${status} failed`);
}
