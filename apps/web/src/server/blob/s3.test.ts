import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    public constructor(public readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      public readonly send = mocks.send;
    },
    PutObjectCommand: class extends Command {},
    GetObjectCommand: class extends Command {},
    HeadObjectCommand: class extends Command {},
    DeleteObjectCommand: class extends Command {},
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.getSignedUrl }));

import { S3BlobTransport } from "./s3";

const ENVIRONMENT: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  S3_ENDPOINT: "https://bucket.example.test",
  S3_REGION: "us-east-1",
  S3_BUCKET: "print-cess-preview",
  S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
  S3_SECRET_ACCESS_KEY: "s".repeat(40),
};
const PATHNAME = `v1/${"A".repeat(22)}.bin`;

function transport(): S3BlobTransport {
  return new S3BlobTransport(ENVIRONMENT);
}

describe("S3BlobTransport configuration", () => {
  it("requires the full credential set", () => {
    const { S3_BUCKET: _drop, ...partial } = ENVIRONMENT;
    expect(() => new S3BlobTransport(partial)).toThrow(/S3_\*/u);
  });

  it("requires an HTTPS endpoint", () => {
    expect(() => new S3BlobTransport({ ...ENVIRONMENT, S3_ENDPOINT: "http://x" })).toThrow(
      /HTTPS/u,
    );
  });
});

describe("S3BlobTransport presigning", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.getSignedUrl.mockReset();
    mocks.getSignedUrl.mockResolvedValue("https://signed.example.test/object");
  });

  it("signs a PUT with octet-stream and a no-overwrite precondition", async () => {
    const operation = await transport().authorizeUpload(PATHNAME, Date.now() + 60_000, 1024);
    expect(operation.method).toBe("PUT");
    expect(operation.headers).toEqual({
      "Content-Type": "application/octet-stream",
      "If-None-Match": "*",
    });
    const [, command] = mocks.getSignedUrl.mock.calls[0] as [
      unknown,
      { input: Record<string, unknown> },
    ];
    expect(command.input).toMatchObject({
      ContentType: "application/octet-stream",
      IfNoneMatch: "*",
      ContentLength: 1024,
    });
  });

  it("caps the signed URL TTL at the configured maximum", async () => {
    await transport().authorizeDownload(PATHNAME, Date.now() + 10 * 60_000);
    const [, , options] = mocks.getSignedUrl.mock.calls[0] as [
      unknown,
      unknown,
      { expiresIn: number },
    ];
    expect(options.expiresIn).toBeLessThanOrEqual(180);
  });

  it("rejects an invalid blob path before signing", async () => {
    await expect(
      transport().authorizeUpload("../etc/passwd", Date.now() + 1_000, 10),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });
});

describe("S3BlobTransport metadata and cleanup", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.getSignedUrl.mockReset();
  });

  it("normalizes a quoted ETag and returns the size", async () => {
    mocks.send.mockResolvedValue({ ContentLength: 512, ETag: '"abc123"' });
    await expect(transport().head(PATHNAME)).resolves.toEqual({ size: 512, etag: "abc123" });
  });

  it("maps a missing object to a 404", async () => {
    mocks.send.mockRejectedValue({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    await expect(transport().head(PATHNAME)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects incomplete metadata", async () => {
    mocks.send.mockResolvedValue({ ContentLength: 0, ETag: '"abc"' });
    await expect(transport().head(PATHNAME)).rejects.toMatchObject({ status: 503 });
  });

  it("refuses to delete when the committed ETag no longer matches", async () => {
    mocks.send.mockResolvedValue({ ContentLength: 512, ETag: '"current"' });
    await expect(transport().delete(PATHNAME, "stale")).rejects.toMatchObject({ status: 409 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("treats an already-absent object as a successful delete", async () => {
    mocks.send.mockRejectedValue({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    await expect(transport().delete(PATHNAME, "any")).resolves.toBeUndefined();
  });

  it("deletes unconditionally when no ETag is supplied", async () => {
    mocks.send.mockResolvedValue({});
    await expect(transport().delete(PATHNAME)).resolves.toBeUndefined();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("does not leak the endpoint when signing fails", async () => {
    mocks.getSignedUrl.mockRejectedValue(new Error("connect ECONNREFUSED bucket.example.test:443"));
    await expect(
      transport().authorizeDownload(PATHNAME, Date.now() + 60_000),
    ).rejects.toMatchObject({ status: 503, message: expect.not.stringContaining("example.test") });
  });
});
