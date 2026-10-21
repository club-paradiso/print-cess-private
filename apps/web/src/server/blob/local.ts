import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DROP_BLOB_PATH_PATTERN, ENCRYPTED_BLOB_PATH_PATTERN } from "@print-cess/protocol";

import type {
  BlobMetadata,
  BlobTransport,
  SignedBlobOperation,
  UploadAuthorizationOptions,
} from "../contracts";
import { ServiceError } from "../errors";

type LocalToken = {
  operation: "put" | "get";
  pathname: string;
  expiresAt: number;
  maximumSize?: number;
  allowOverwrite?: boolean;
};

export class LocalEncryptedBlobTransport implements BlobTransport {
  readonly #secret = randomBytes(32);
  readonly #root: string;
  readonly #ready: Promise<void>;

  public constructor(
    private readonly baseUrl: string,
    root = join(process.cwd(), ".print-cess", "blobs"),
  ) {
    this.#root = root;
    // Local mode has no durable session/key ledger. Any ciphertext from a
    // previous process is therefore unreachable and must be removed before
    // the new in-memory runtime serves requests.
    this.#ready = rm(this.#root, { recursive: true, force: true });
  }

  public async authorizeUpload(
    pathname: string,
    expiresAt: number,
    maximumSize: number,
    options?: UploadAuthorizationOptions,
  ): Promise<SignedBlobOperation> {
    await this.#ready;
    return this.signedOperation({
      operation: "put",
      pathname,
      expiresAt,
      maximumSize,
      allowOverwrite: options?.allowOverwrite === true,
    });
  }

  public async authorizeDownload(
    pathname: string,
    expiresAt: number,
  ): Promise<SignedBlobOperation> {
    await this.#ready;
    return this.signedOperation({ operation: "get", pathname, expiresAt });
  }

  public async head(pathname: string): Promise<BlobMetadata> {
    await this.#ready;
    const file = this.filePath(pathname);
    try {
      const [details, contents] = await Promise.all([stat(file), readFile(file)]);
      return { size: details.size, etag: etag(contents) };
    } catch {
      throw new ServiceError("not_found", "The encrypted upload was not found.", 404);
    }
  }

  public async delete(pathname: string, expectedEtag?: string): Promise<void> {
    await this.#ready;
    const file = this.filePath(pathname);
    if (expectedEtag) {
      try {
        const current = await readFile(file);
        if (etag(current) !== expectedEtag) {
          throw new ServiceError("conflict", "The encrypted upload changed before cleanup.", 409);
        }
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        return;
      }
    }
    await rm(file, { force: true });
  }

  public async put(request: Request, token: string): Promise<BlobMetadata> {
    await this.#ready;
    const payload = this.verify(token, "put");
    if (request.headers.get("content-type") !== "application/octet-stream") {
      throw new ServiceError("bad_request", "The encrypted upload content type is invalid.", 415);
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (
      !Number.isFinite(declaredLength) ||
      declaredLength < 1 ||
      declaredLength > (payload.maximumSize ?? 0)
    ) {
      throw new ServiceError("bad_request", "The encrypted upload size is invalid.", 413);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== declaredLength || bytes.byteLength > (payload.maximumSize ?? 0)) {
      throw new ServiceError("bad_request", "The encrypted upload size is invalid.", 413);
    }
    const file = this.filePath(payload.pathname);
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    try {
      await writeFile(file, bytes, { flag: payload.allowOverwrite ? "w" : "wx", mode: 0o600 });
    } catch {
      throw new ServiceError("conflict", "This upload URL has already been used.", 409);
    }
    return { size: bytes.byteLength, etag: etag(bytes) };
  }

  public async get(token: string): Promise<{ bytes: Uint8Array; metadata: BlobMetadata }> {
    await this.#ready;
    const payload = this.verify(token, "get");
    const file = this.filePath(payload.pathname);
    try {
      const bytes = new Uint8Array(await readFile(file));
      return { bytes, metadata: { size: bytes.byteLength, etag: etag(bytes) } };
    } catch {
      throw new ServiceError("not_found", "The encrypted upload was not found.", 404);
    }
  }

  private signedOperation(payload: LocalToken): SignedBlobOperation {
    this.assertPath(payload.pathname);
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.#secret).update(encoded).digest("base64url");
    const token = `${encoded}.${signature}`;
    return {
      method: payload.operation === "put" ? "PUT" : "GET",
      pathname: payload.pathname,
      expiresAt: payload.expiresAt,
      url: `${this.baseUrl}/api/dev/blob?t=${encodeURIComponent(token)}`,
      headers: payload.operation === "put" ? { "Content-Type": "application/octet-stream" } : {},
    };
  }

  private verify(token: string, operation: LocalToken["operation"]): LocalToken {
    const [encoded = "", supplied = ""] = token.split(".", 2);
    const expected = createHmac("sha256", this.#secret).update(encoded).digest();
    let suppliedBytes = Buffer.alloc(expected.length);
    try {
      suppliedBytes = Buffer.from(supplied, "base64url");
    } catch {
      // The fixed zero buffer is compared below to keep the failure path uniform.
    }
    const signatureValid =
      suppliedBytes.length === expected.length && timingSafeEqual(suppliedBytes, expected);
    let payload: LocalToken | null = null;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      // A generic authorization error is returned below.
    }
    if (
      !signatureValid ||
      !payload ||
      payload.operation !== operation ||
      payload.expiresAt <= Date.now()
    ) {
      throw new ServiceError(
        "unauthorized",
        "The signed blob operation is invalid or expired.",
        401,
      );
    }
    this.assertPath(payload.pathname);
    return payload;
  }

  private filePath(pathname: string): string {
    this.assertPath(pathname);
    return join(this.#root, pathname.replaceAll("/", "_"));
  }

  private assertPath(pathname: string): void {
    if (!ENCRYPTED_BLOB_PATH_PATTERN.test(pathname) && !DROP_BLOB_PATH_PATTERN.test(pathname)) {
      throw new ServiceError("bad_request", "The blob path is invalid.", 400);
    }
  }
}

function etag(bytes: Uint8Array): string {
  return `"${createHash("sha256").update(bytes).digest("base64url")}"`;
}
