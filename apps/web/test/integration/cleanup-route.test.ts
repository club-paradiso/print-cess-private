import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMock = vi.hoisted(() => ({
  getRuntime: vi.fn(),
  sweepDueOrphans: vi.fn(),
  sweepExpiredDrops: vi.fn(),
  cleanupSession: vi.fn(),
}));
const qstashMock = vi.hoisted(() => ({ verifyQStashRequest: vi.fn() }));

vi.mock("@/server/runtime", () => runtimeMock);
vi.mock("@/server/cleanup/qstash", () => qstashMock);

const pairingPrune = vi.fn().mockResolvedValue(undefined);

import { POST } from "@/app/api/cleanup/route";

const ADMIN_SECRET = "admin-".padEnd(40, "a");
const WORKER_SECRET = "worker-".padEnd(40, "w");
const SESSION_ID = "A".repeat(22);
const PUBLIC_BASE_URL = "https://print-cess.example.test";

let config: {
  mode: "local" | "external";
  cleanupProvider: "qstash" | "railway-worker" | null;
  publicBaseUrl: string;
};

function request(headers: Record<string, string>, body: unknown): Request {
  return new Request("https://deployment-alias.example.test/api/cleanup", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("ADMIN_DIAGNOSTICS_SECRET", ADMIN_SECRET);
  vi.stubEnv("CLEANUP_WORKER_SECRET", WORKER_SECRET);
  config = {
    mode: "external",
    cleanupProvider: "railway-worker",
    publicBaseUrl: PUBLIC_BASE_URL,
  };
  runtimeMock.getRuntime.mockReturnValue({
    config,
    sessions: { get: vi.fn().mockResolvedValue(null) },
    pairings: { pruneExpired: pairingPrune },
  });
  runtimeMock.sweepDueOrphans.mockResolvedValue({
    attempted: 0,
    deleted: 0,
    deferred: 0,
    failed: 0,
  });
  runtimeMock.sweepExpiredDrops.mockResolvedValue({ attempted: 0, deleted: 0, failed: 0 });
  runtimeMock.cleanupSession.mockResolvedValue("absent");
  qstashMock.verifyQStashRequest.mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("cleanup route worker authorization", () => {
  it("accepts a valid worker secret for a sweep", async () => {
    const response = await POST(
      request({ "x-cleanup-worker-secret": WORKER_SECRET }, { sweep: true }),
    );
    expect(response.status).toBe(200);
    expect(runtimeMock.sweepDueOrphans).toHaveBeenCalledOnce();
    expect(pairingPrune).toHaveBeenCalledOnce();
  });

  it("rejects an incorrect worker secret", async () => {
    const response = await POST(request({ "x-cleanup-worker-secret": "nope" }, { sweep: true }));
    expect(response.status).toBe(401);
    expect(runtimeMock.sweepDueOrphans).not.toHaveBeenCalled();
  });

  it("rejects a worker attempting a forced cleanup", async () => {
    const response = await POST(
      request({ "x-cleanup-worker-secret": WORKER_SECRET }, { sessionId: SESSION_ID, force: true }),
    );
    expect(response.status).toBe(401);
    expect(runtimeMock.cleanupSession).not.toHaveBeenCalled();
  });

  it("rejects a worker attempting a targeted cleanup", async () => {
    const response = await POST(
      request({ "x-cleanup-worker-secret": WORKER_SECRET }, { sessionId: SESSION_ID }),
    );
    expect(response.status).toBe(401);
    expect(runtimeMock.cleanupSession).not.toHaveBeenCalled();
  });

  it("allows an administrator forced cleanup", async () => {
    const response = await POST(
      request({ "x-admin-secret": ADMIN_SECRET }, { sessionId: SESSION_ID, force: true }),
    );
    expect(response.status).toBe(200);
    expect(runtimeMock.cleanupSession).toHaveBeenCalledOnce();
  });

  it("does not honor the worker secret under the qstash provider", async () => {
    config.cleanupProvider = "qstash";
    const response = await POST(
      request({ "x-cleanup-worker-secret": WORKER_SECRET }, { sweep: true }),
    );
    expect(response.status).toBe(401);
  });

  it("accepts a verified qstash sweep against the configured callback URL", async () => {
    config.cleanupProvider = "qstash";
    qstashMock.verifyQStashRequest.mockResolvedValue(true);
    const incoming = request({}, { sweep: true });
    const response = await POST(incoming);
    expect(response.status).toBe(200);
    expect(runtimeMock.sweepDueOrphans).toHaveBeenCalledOnce();
    expect(qstashMock.verifyQStashRequest).toHaveBeenCalledWith(
      incoming,
      JSON.stringify({ sweep: true }),
      `${PUBLIC_BASE_URL}/api/cleanup`,
    );
  });

  it("rejects a malformed body once authorized", async () => {
    const bad = new Request("https://app.example.test/api/cleanup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-secret": ADMIN_SECRET },
      body: "{not json",
    });
    const response = await POST(bad);
    expect(response.status).toBe(400);
  });

  it("rejects an over-limit body before running cleanup", async () => {
    const oversized = new Request("https://app.example.test/api/cleanup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "10000",
        "x-admin-secret": ADMIN_SECRET,
      },
      body: JSON.stringify({ sweep: true, filler: "x".repeat(9000) }),
    });
    const response = await POST(oversized);
    expect(response.status).toBe(413);
  });
});
