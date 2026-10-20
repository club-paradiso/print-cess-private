import { describe, expect, it } from "vitest";

import {
  exportPublicKeyBase64Url,
  fingerprintPublicKey,
  generateEcdhKeyPair,
  generateToken,
  hashToken,
} from "@print-cess/crypto";
import { PROTOCOL_VERSION, type PrintSession } from "@print-cess/protocol";

import type { BlobTransport, CleanupScheduler, DropStore, PairingStore } from "./contracts";
import { loadConfig } from "./config";
import {
  cleanupSession,
  createBlobPath,
  createVisitorPrintSession,
  type ServerRuntime,
} from "./runtime";
import { MemorySessionStore } from "./session-store/memory";

async function kioskIdentity(): Promise<{
  kioskPublicKey: string;
  kioskPublicKeyFingerprint: string;
}> {
  const keyPair = await generateEcdhKeyPair();
  const kioskPublicKey = await exportPublicKeyBase64Url(keyPair.publicKey);
  return { kioskPublicKey, kioskPublicKeyFingerprint: await fingerprintPublicKey(kioskPublicKey) };
}

function stubBlobs(onDelete: (pathname: string) => void): BlobTransport {
  const unsupported = (): Promise<never> => Promise.reject(new Error("not used in this test"));
  return {
    authorizeUpload: unsupported,
    authorizeDownload: unsupported,
    head: unsupported,
    delete: (pathname: string) => {
      onDelete(pathname);
      return Promise.resolve();
    },
  };
}

function stubRuntime(
  config: ReturnType<typeof loadConfig>,
  onDelete: (pathname: string) => void,
): ServerRuntime {
  const sessions = new MemorySessionStore();
  const cleanup: CleanupScheduler = { schedule: () => Promise.resolve() };
  const unsupportedStore = new Proxy(
    {},
    {
      get: () => () => Promise.reject(new Error("not used in this test")),
    },
  );
  return {
    config,
    sessions,
    drops: unsupportedStore as unknown as DropStore,
    pairings: unsupportedStore as unknown as PairingStore,
    blobs: stubBlobs(onDelete),
    cleanup,
  };
}

describe("visitor print sessions", () => {
  it("mints a waiting session whose expiry is the configured visitor TTL", async () => {
    process.env.VISITOR_TTL_SECONDS = "900";
    delete (globalThis as { __printCessRuntime?: unknown }).__printCessRuntime;
    try {
      const before = Date.now();
      const { session } = await createVisitorPrintSession(await kioskIdentity());
      const after = Date.now();

      expect(session.status).toBe("waiting");
      expect(session.expiresAt).toBeGreaterThanOrEqual(before + 900_000);
      expect(session.expiresAt).toBeLessThanOrEqual(after + 900_000);
      expect(session.expiresAt - session.createdAt).toBe(900_000);
    } finally {
      delete process.env.VISITOR_TTL_SECONDS;
      delete (globalThis as { __printCessRuntime?: unknown }).__printCessRuntime;
    }
  });

  it("deletes the uploaded ciphertext when the visitor session expires", async () => {
    const config = loadConfig({ NODE_ENV: "test", PRINT_CESS_ADAPTER_MODE: "local" });
    const deleted: string[] = [];
    const runtime = stubRuntime(config, (pathname) => deleted.push(pathname));

    // A visitor who uploaded a document and then abandoned the counter: the
    // session passed its expiry with ciphertext still on the blob store.
    const past = Date.now() - 60_000;
    const blobPath = createBlobPath();
    const expired: PrintSession = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: generateToken(16),
      status: "uploaded",
      kioskPublicKey: (await kioskIdentity()).kioskPublicKey,
      kioskPublicKeyFingerprint: (await kioskIdentity()).kioskPublicKeyFingerprint,
      encryptedBlobPath: blobPath,
      createdAt: past - config.visitorTtlMs,
      expiresAt: past,
      uploadTokenHash: await hashToken(generateToken(32), "upload"),
      kioskTokenHash: await hashToken(generateToken(32), "kiosk"),
      revision: 0,
    };
    await runtime.sessions.create(expired, 24 * 3_600_000);

    const outcome = await cleanupSession(runtime, expired.sessionId, Date.now());

    expect(outcome).toBe("deleted");
    expect(deleted).toEqual([blobPath]);
    expect(await runtime.sessions.get(expired.sessionId)).toBeNull();
    expect((await runtime.sessions.getReceipt(expired.sessionId))?.status).toBe("expired");
  });

  it("keeps an unexpired visitor session and its upload untouched", async () => {
    const config = loadConfig({ NODE_ENV: "test", PRINT_CESS_ADAPTER_MODE: "local" });
    const deleted: string[] = [];
    const runtime = stubRuntime(config, (pathname) => deleted.push(pathname));

    const now = Date.now();
    const blobPath = createBlobPath();
    const live: PrintSession = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: generateToken(16),
      status: "uploaded",
      kioskPublicKey: (await kioskIdentity()).kioskPublicKey,
      kioskPublicKeyFingerprint: (await kioskIdentity()).kioskPublicKeyFingerprint,
      encryptedBlobPath: blobPath,
      createdAt: now,
      expiresAt: now + config.visitorTtlMs,
      uploadTokenHash: await hashToken(generateToken(32), "upload"),
      kioskTokenHash: await hashToken(generateToken(32), "kiosk"),
      revision: 0,
    };
    await runtime.sessions.create(live, 24 * 3_600_000);

    const outcome = await cleanupSession(runtime, live.sessionId, now);

    expect(outcome).toBe("deferred");
    expect(deleted).toEqual([]);
    expect((await runtime.sessions.get(live.sessionId))?.status).toBe("uploaded");
  });
});
