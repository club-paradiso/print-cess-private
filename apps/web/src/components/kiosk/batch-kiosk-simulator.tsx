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
  MAX_PRINT_BUNDLE_FILES,
  parsePrintBundle,
  type PrintableFileKind,
} from "@print-cess/protocol";

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
  printArtifacts,
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

/** The outcome of getting one QR code onto the screen. */
type PreparedSession = { ok: true; session: RegisteredSession } | { ok: false };

/**
 * Mints one print session and renders its QR code. Kept out of the effect body
 * so that the promise it returns can be reused rather than the work repeated:
 * every call here consumes a session from the per-counter creation limit.
 */
async function prepareSession(): Promise<PreparedSession> {
  try {
    const keyPair = await generateEcdhKeyPair();
    const kioskPublicKey = await exportPublicKeyBase64Url(keyPair.publicKey);
    const fingerprint = await fingerprintPublicKey(kioskPublicKey);
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
  } catch {
    return { ok: false };
  }
}

export function BatchKioskSimulator({
  automaticPrinting = false,
  sound = true,
  services = false,
}: {
  automaticPrinting?: boolean;
  sound?: boolean;
  /** Show links to the other features (the main page only). */
  services?: boolean;
}) {
  const [session, setSession] = useState<RegisteredSession>();
  const [status, setStatus] = useState<KioskStatus>("preparing");
  const [remaining, setRemaining] = useState(120);
  // How long this QR code lived when it appeared, so the bar under it can show
  // the time left as a share of the whole rather than as a bare number.
  const [sessionLifetime, setSessionLifetime] = useState(120);
  const [completionRemaining, setCompletionRemaining] = useState(60);
  const [artifacts, setArtifacts] = useState<PrintArtifact[]>([]);
  const [generation, setGeneration] = useState(0);
  const processing = useRef(false);
  const artifactsRef = useRef<PrintArtifact[]>([]);
  const preparation = useRef<{ generation: number; ready: Promise<PreparedSession> }>(null);

  const replaceArtifacts = useCallback((next: PrintArtifact[]) => {
    for (const artifact of artifactsRef.current) revokePrintArtifact(artifact);
    artifactsRef.current = next;
    setArtifacts(next);
  }, []);

  const reset = useCallback(() => {
    processing.current = false;
    replaceArtifacts([]);
    setSession(undefined);
    setStatus("preparing");
    setRemaining(120);
    setCompletionRemaining(60);
    setGeneration((value) => value + 1);
  }, [replaceArtifacts]);

  useEffect(
    () => () => {
      for (const artifact of artifactsRef.current) revokePrintArtifact(artifact);
      artifactsRef.current = [];
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
          }
          if (body.status === "claimed") setStatus("claimed");
          if (body.status === "upload_authorized" || body.status === "uploading")
            setStatus("uploading");
          if (body.status === "uploaded" && !processing.current) {
            processing.current = true;
            setStatus("uploaded");
            await consumeValidateAndPrint(session, setStatus, replaceArtifacts);
            if (active && sound) playCompletionTone();
          }
        } catch {
          // A transient status read does not rewrite the kiosk's known state.
        }
      })();
    }, 750);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [replaceArtifacts, reset, session, sound, status]);

  useEffect(() => {
    if (status !== "completed") return;
    const deadline = Date.now() + 60_000;
    const interval = window.setInterval(
      () => setCompletionRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
      250,
    );
    const timeout = window.setTimeout(reset, 60_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [reset, status]);

  if (status === "completed" && artifacts.length > 0) {
    return (
      <CompletedScreen
        artifacts={artifacts}
        automaticPrinting={automaticPrinting}
        remaining={completionRemaining}
      />
    );
  }
  if (status === "failed") return <UnavailableScreen onReset={reset} />;
  if (status !== "preparing" && status !== "waiting") {
    return <ConnectedScreen status={status} remaining={remaining} />;
  }

  return (
    <KioskWaitingScreen
      status={status}
      session={session}
      remaining={remaining}
      lifetime={sessionLifetime}
      maxFiles={MAX_PRINT_BUNDLE_FILES}
      services={services}
    />
  );
}

async function consumeValidateAndPrint(
  session: RegisteredSession,
  setStatus: (status: KioskStatus) => void,
  setArtifacts: (artifacts: PrintArtifact[]) => void,
) {
  let envelope = new Uint8Array();
  let plaintext = new Uint8Array();
  let bundleItems: ReturnType<typeof parsePrintBundle> = [];
  try {
    const consumeResponse = await fetch(`/api/sessions/${session.sessionId}/consume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-print-cess-kiosk-token": session.kioskToken,
      },
      body: JSON.stringify({ consumeIdHash: await hashToken(generateToken(), "kiosk") }),
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

    const items =
      decrypted.fileKind === "bundle"
        ? (bundleItems = parsePrintBundle(plaintext))
        : [{ fileKind: printableKind(decrypted.fileKind), bytes: plaintext }];

    const nextArtifacts: PrintArtifact[] = [];
    try {
      for (const item of items) {
        await validateBrowserPrintable(item.bytes, item.fileKind);
        nextArtifacts.push(createPrintArtifact(item.bytes, item.fileKind));
      }
    } catch (error) {
      for (const artifact of nextArtifacts) revokePrintArtifact(artifact);
      throw error;
    }

    setArtifacts(nextArtifacts);
    setStatus("printing");
    await kioskTransition(session, "printing");
    // `window.print()` blocks until its dialog is dismissed in the supported
    // desktop browsers, so this naturally walks the selected documents in order.
    // Every document loads before the first dialog opens, so a document that
    // cannot load fails the session with nothing printed, and a resend never
    // duplicates pages.
    await printArtifacts(nextArtifacts);
    await kioskTransition(session, "completed");
    setStatus("completed");
  } catch {
    // The failure screen offers no reprint or download, so the decrypted Blob
    // is released now instead of when the next QR code is created.
    setArtifacts([]);
    setStatus("failed");
    await kioskTransition(session, "failed").catch(() => undefined);
  } finally {
    envelope.fill(0);
    plaintext.fill(0);
    for (const item of bundleItems) item.bytes.fill(0);
  }
}

async function validateBrowserPrintable(bytes: Uint8Array, expectedKind: PrintableFileKind) {
  if (expectedKind === "hwp" || expectedKind === "hwpx") {
    throw new Error("Hancom files require the native Windows kiosk");
  }
  const detected = detectFileKind(bytes);
  if (detected !== expectedKind) throw new Error("file kind mismatch");
  if (detected === "pdf") await validatePdf(bytes);
  else if (detected === "png" || detected === "jpeg") {
    const { width, height } =
      detected === "png" ? parsePngDimensions(bytes) : parseJpegDimensions(bytes);
    validateDimensions(width, height);
  } else throw new Error("unsupported browser print kind");
}

function printableKind(kind: string): PrintableFileKind {
  if (kind === "pdf" || kind === "jpeg" || kind === "png" || kind === "hwp" || kind === "hwpx")
    return kind;
  throw new Error("outer print kind is not printable");
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
