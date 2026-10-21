import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { DROP_BLOB_PATH_PATTERN, ENCRYPTED_BLOB_PATH_PATTERN } from "@print-cess/protocol";

import type {
  BlobMetadata,
  BlobTransport,
  SignedBlobOperation,
  UploadAuthorizationOptions,
} from "../contracts";
import { ServiceError } from "../errors";

const OCTET_STREAM = "application/octet-stream";
const MAX_SIGNED_TTL_SECONDS = 180;

type S3Settings = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export class S3BlobTransport implements BlobTransport {
  readonly #client: S3Client;
  readonly #bucket: string;

  public constructor(environment: NodeJS.ProcessEnv = process.env) {
    const settings = readSettings(environment);
    this.#bucket = settings.bucket;
    this.#client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
  }

  public async authorizeUpload(
    pathname: string,
    expiresAt: number,
    maximumSize: number,
    options?: UploadAuthorizationOptions,
  ): Promise<SignedBlobOperation> {
    assertPath(pathname);
    const allowOverwrite = options?.allowOverwrite === true;
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: pathname,
      ContentType: OCTET_STREAM,
      ContentLength: maximumSize,
      ...(allowOverwrite ? {} : { IfNoneMatch: "*" }),
    });
    const url = await this.sign(command, expiresAt);
    return {
      method: "PUT",
      pathname,
      expiresAt,
      url,
      headers: {
        "Content-Type": OCTET_STREAM,
        ...(allowOverwrite ? {} : { "If-None-Match": "*" }),
      },
    };
  }

  public async authorizeDownload(
    pathname: string,
    expiresAt: number,
  ): Promise<SignedBlobOperation> {
    assertPath(pathname);
    const command = new GetObjectCommand({ Bucket: this.#bucket, Key: pathname });
    const url = await this.sign(command, expiresAt);
    return { method: "GET", pathname, expiresAt, url, headers: {} };
  }

  public async head(pathname: string): Promise<BlobMetadata> {
    assertPath(pathname);
    try {
      const response = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: pathname }),
      );
      const size = Number(response.ContentLength);
      const etag = normalizeEtag(response.ETag);
      if (!Number.isSafeInteger(size) || size < 1 || !etag) {
        throw new ServiceError("unavailable", "Blob metadata is incomplete.", 503);
      }
      return { size, etag };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (isNotFound(error)) {
        throw new ServiceError("not_found", "The encrypted upload was not found.", 404);
      }
      throw new ServiceError("unavailable", "Blob metadata lookup failed.", 503);
    }
  }

  public async delete(pathname: string, expectedEtag?: string): Promise<void> {
    assertPath(pathname);
    if (expectedEtag) {
      let current: BlobMetadata;
      try {
        current = await this.head(pathname);
      } catch (error) {
        if (error instanceof ServiceError && error.status === 404) return;
        throw new ServiceError("unavailable", "Encrypted blob cleanup failed.", 503);
      }
      if (normalizeEtag(current.etag) !== normalizeEtag(expectedEtag)) {
        throw new ServiceError("conflict", "The encrypted upload changed before cleanup.", 409);
      }
    }
    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: pathname }));
    } catch (error) {
      if (isNotFound(error)) return;
      throw new ServiceError("unavailable", "Encrypted blob cleanup failed.", 503);
    }
  }

  private async sign(
    command: PutObjectCommand | GetObjectCommand,
    expiresAt: number,
  ): Promise<string> {
    const expiresIn = Math.min(
      MAX_SIGNED_TTL_SECONDS,
      Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
    );
    try {
      return await getSignedUrl(this.#client, command, { expiresIn });
    } catch {
      throw new ServiceError("unavailable", "The blob operation could not be authorized.", 503);
    }
  }
}

function readSettings(environment: NodeJS.ProcessEnv): S3Settings {
  const endpoint = environment.S3_ENDPOINT;
  const region = environment.S3_REGION;
  const bucket = environment.S3_BUCKET;
  const accessKeyId = environment.S3_ACCESS_KEY_ID;
  const secretAccessKey = environment.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 blob provider requires the full S3_* credential set");
  }
  if (new URL(endpoint).protocol !== "https:") {
    throw new Error("S3_ENDPOINT must use HTTPS");
  }
  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE === "true",
  };
}

function assertPath(pathname: string): void {
  if (!ENCRYPTED_BLOB_PATH_PATTERN.test(pathname) && !DROP_BLOB_PATH_PATTERN.test(pathname)) {
    throw new ServiceError("bad_request", "The blob path is invalid.", 400);
  }
}

function normalizeEtag(value: string | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .replace(/^W\//u, "")
    .replace(/^"(.*)"$/u, "$1");
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status =
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object" &&
    "httpStatusCode" in error.$metadata
      ? error.$metadata.httpStatusCode
      : undefined;
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}
