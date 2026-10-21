import { z } from "zod";

import { DIGEST_PATTERN } from "./canonical.js";

/**
 * A "drop" is a short-lived, end-to-end encrypted hand-off of one or more files
 * between two phones. It shares nothing with the print session state machine:
 * there is no kiosk, no printer, and no single-document restriction.
 *
 * The only secret is a twelve-character transfer code that the sender's browser
 * generates. QR and shared-link hand-offs keep it in a URL fragment, so the
 * server holds ciphertext plus an opaque identifier and cannot read a file it
 * stores. The optional nearby-phone pairing flow explicitly trades that
 * property for convenience by escrowing the code for three minutes.
 */
export const DROP_PROTOCOL_VERSION = 1 as const;

/**
 * Crockford base32. The letters people mistype when they read a code off
 * someone else's screen — I, L, O, U — are absent from the alphabet and folded
 * onto the digit they look like by `normalizeDropCode`, so a misread still
 * resolves to the code the sender is showing.
 */
export const DROP_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" as const;
export const DROP_CODE_LENGTH = 12;
export const DROP_CODE_GROUP_SIZE = 4;
export const DROP_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{12}$/u;
/** Twelve characters of a 32-symbol alphabet: sixty bits of transfer secret. */
export const DROP_CODE_ENTROPY_BITS = DROP_CODE_LENGTH * 5;

/** Same 16-byte canonical base64url shape as a print session identifier. */
export const DROP_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/u;
export const DROP_BLOB_PATH_PATTERN = /^d1\/[A-Za-z0-9_-]{21}[AQgw]\/p[0-9]{1,4}\.bin$/u;

/**
 * Plaintext bytes per encrypted part. Small enough that one part still finishes
 * inside a signed-URL lifetime on a weak mobile connection, and large enough
 * that a multi-gigabyte transfer stays well under the part ceiling.
 */
export const DROP_CHUNK_BYTES = 8 * 1024 * 1024;
export const DROP_PART_TAG_BYTES = 16;
export const MAX_DROP_PART_BYTES = DROP_CHUNK_BYTES + DROP_PART_TAG_BYTES;
export const MAX_DROP_PARTS = 4096;
export const MAX_DROP_FILES = 20;
export const MAX_DROP_TOTAL_BYTES = MAX_DROP_PARTS * DROP_CHUNK_BYTES;
/** Encrypted file list, base64url, stored beside the record rather than as a blob. */
export const MAX_DROP_MANIFEST_BYTES = 16 * 1024;
/**
 * File names are bounded twice over, and the two limits do different work.
 *
 * `MAX_DROP_FILE_NAME_LENGTH` is the UTF-16 length the manifest schema checks,
 * kept unchanged so a record written by an earlier build still validates.
 * `MAX_DROP_FILE_NAME_BYTES` is the budget the sending phone actually spends,
 * and it is the one that keeps the manifest inside its ceiling: twenty Korean
 * or emoji names bounded only by UTF-16 length encode to roughly three times
 * their length in UTF-8 and then grow by a further third in base64, which
 * overflows `MAX_DROP_MANIFEST_BYTES` for a selection the sender was told was
 * acceptable. Budgeting in UTF-8 bytes makes the worst case fit by
 * construction, and a UTF-8 byte count is never smaller than the UTF-16 length,
 * so satisfying this limit satisfies the other one too.
 */
export const MAX_DROP_FILE_NAME_LENGTH = 180;
export const MAX_DROP_FILE_NAME_BYTES = 180;
/** Media types are advisory metadata; a long one buys nothing and costs budget. */
export const MAX_DROP_MIME_LENGTH = 128;

export const DROP_HKDF_INFO = "print-cess-by-paradiso:drop:v1";
export const DROP_CODE_KDF_SALT = "print-cess-by-paradiso:drop-code:v1";
/**
 * The transfer code carries about sixty bits. Stretching it lifts the cost of
 * an offline attack on leaked ciphertext by roughly nineteen bits, while still
 * finishing in a few hundred milliseconds on a mid-range phone.
 */
export const DROP_CODE_KDF_ITERATIONS = 310_000;

export const DROP_STATUSES = ["collecting", "ready"] as const;
export type DropStatus = (typeof DROP_STATUSES)[number];

export function dropPartPath(dropId: string, partIndex: number): string {
  if (!DROP_ID_PATTERN.test(dropId)) throw new Error("Invalid drop identifier");
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= MAX_DROP_PARTS) {
    throw new Error("Invalid drop part index");
  }
  return `d1/${dropId}/p${partIndex}.bin`;
}

export function formatDropCode(code: string): string {
  const groups: string[] = [];
  for (let index = 0; index < code.length; index += DROP_CODE_GROUP_SIZE) {
    groups.push(code.slice(index, index + DROP_CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Accepts what a person actually types: lower case, spaces, hyphens, and the
 * four look-alike letters the alphabet leaves out.
 */
export function normalizeDropCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/gu, "")
    .replaceAll("O", "0")
    .replaceAll("I", "1")
    .replaceAll("L", "1")
    .replaceAll("U", "V");
}

/**
 * A part always carries at least an authentication tag, even when the file it
 * belongs to is empty, so the floor here is a tag rather than a byte.
 */
const partSchema = z
  .object({
    size: z.number().int().min(DROP_PART_TAG_BYTES).max(MAX_DROP_PART_BYTES),
    etag: z.string().min(1).max(256).optional(),
  })
  .strict();

export const dropRecordSchema = z
  .object({
    protocolVersion: z.literal(DROP_PROTOCOL_VERSION),
    dropId: z.string().regex(DROP_ID_PATTERN),
    status: z.enum(DROP_STATUSES),
    ownerTokenHash: z.string().regex(DIGEST_PATTERN),
    manifest: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/u)
      .max(MAX_DROP_MANIFEST_BYTES),
    fileCount: z.number().int().min(1).max(MAX_DROP_FILES),
    partCount: z.number().int().min(1).max(MAX_DROP_PARTS),
    /**
     * Plaintext bytes the sender declared. It is what the configured transfer
     * ceiling is actually measured against, and it gives every later commit an
     * exact upper bound to check against without consulting configuration.
     */
    totalBytes: z.number().int().nonnegative().max(MAX_DROP_TOTAL_BYTES).default(0),
    /** Index-aligned with the part list; `null` until that part is committed. */
    parts: z.array(partSchema.nullable()).min(1).max(MAX_DROP_PARTS),
    totalCiphertextBytes: z.number().int().min(0),
    /**
     * Three separate things the service is allowed to know about the receiving
     * side, and no more. They default rather than being required so a record
     * written by an earlier build still parses after a deployment.
     */
    openCount: z.number().int().nonnegative().default(0),
    downloadCount: z.number().int().nonnegative(),
    deliveredCount: z.number().int().nonnegative().default(0),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine((drop) => drop.parts.length === drop.partCount, {
    message: "The part table must match the declared part count.",
    path: ["parts"],
  })
  .refine((drop) => drop.expiresAt > drop.createdAt, {
    message: "Drop expiry must be later than creation.",
    path: ["expiresAt"],
  });

export type DropRecord = z.infer<typeof dropRecordSchema>;

export const createDropRequestSchema = z
  .object({
    protocolVersion: z.literal(DROP_PROTOCOL_VERSION),
    dropId: z.string().regex(DROP_ID_PATTERN),
    ownerTokenHash: z.string().regex(DIGEST_PATTERN),
    manifest: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/u)
      .max(MAX_DROP_MANIFEST_BYTES),
    fileCount: z.number().int().min(1).max(MAX_DROP_FILES),
    partCount: z.number().int().min(1).max(MAX_DROP_PARTS),
    totalBytes: z.number().int().nonnegative().max(MAX_DROP_TOTAL_BYTES),
  })
  .strict()
  .refine((body) => body.partCount >= requiredPartCountFloor(body.fileCount, body.totalBytes), {
    message: "The part count is too small for the declared size.",
    path: ["partCount"],
  })
  .refine((body) => body.partCount <= requiredPartCountCeiling(body.fileCount, body.totalBytes), {
    message: "The part count is too large for the declared size.",
    path: ["partCount"],
  });

/**
 * Every file costs at least one part, and every whole chunk of declared bytes
 * costs one more. Pinning the part count between these two bounds is what stops
 * a client from reserving four thousand part slots for a transfer it declared
 * as a single byte, or from under-declaring its size to slip past the ceiling.
 */
export function requiredPartCountFloor(fileCount: number, totalBytes: number): number {
  return Math.max(fileCount, Math.ceil(totalBytes / DROP_CHUNK_BYTES));
}

export function requiredPartCountCeiling(fileCount: number, totalBytes: number): number {
  return fileCount + Math.floor(totalBytes / DROP_CHUNK_BYTES);
}

export const dropPartAuthorizeRequestSchema = z
  .object({
    indexes: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(MAX_DROP_PARTS - 1),
      )
      .min(1)
      .max(8),
  })
  .strict();

export const dropPartCommitRequestSchema = z
  .object({
    parts: z
      .array(
        z
          .object({
            index: z
              .number()
              .int()
              .min(0)
              .max(MAX_DROP_PARTS - 1),
            size: z.number().int().min(1).max(MAX_DROP_PART_BYTES),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

export const dropDownloadRequestSchema = z
  .object({
    indexes: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(MAX_DROP_PARTS - 1),
      )
      .min(1)
      .max(8),
  })
  .strict();

/**
 * What the receiving phone learns before it can decrypt anything: how many
 * parts exist and how big each one is. File names live inside `manifest`,
 * which only the transfer code can open.
 */
export type DropOpenView = {
  protocolVersion: typeof DROP_PROTOCOL_VERSION;
  state: "ready";
  dropId: string;
  manifest: string;
  fileCount: number;
  partCount: number;
  partSizes: number[];
  totalCiphertextBytes: number;
  expiresAt: number;
};

/**
 * The answer a receiver gets while the sending phone is still uploading. It
 * carries no file list, no progress, and no hint of who is sending: reaching it
 * at all already required deriving the identifier from the transfer code, and a
 * wrong guess is answered exactly as a transfer that never existed.
 */
export type DropPendingView = {
  protocolVersion: typeof DROP_PROTOCOL_VERSION;
  state: "collecting";
  dropId: string;
  expiresAt: number;
};

export type DropOpenResponse = DropOpenView | DropPendingView;

/**
 * How far the receiving side has got, in the only four steps the service can
 * honestly distinguish. `downloading` means a receiver asked for the first
 * part, not that any file reached their storage; `delivered` means a receiver's
 * own flow reported that it finished handling every file.
 */
export const DROP_RECEIVER_STATES = ["waiting", "opened", "downloading", "delivered"] as const;
export type DropReceiverState = (typeof DROP_RECEIVER_STATES)[number];

export type DropSenderView = {
  protocolVersion: typeof DROP_PROTOCOL_VERSION;
  dropId: string;
  status: DropStatus;
  uploadedPartCount: number;
  partCount: number;
  receiver: DropReceiverState;
  openCount: number;
  downloadCount: number;
  deliveredCount: number;
  expiresAt: number;
};

export function dropReceiverState(counts: {
  openCount: number;
  downloadCount: number;
  deliveredCount: number;
}): DropReceiverState {
  if (counts.deliveredCount > 0) return "delivered";
  if (counts.downloadCount > 0) return "downloading";
  if (counts.openCount > 0) return "opened";
  return "waiting";
}

/**
 * The limits a sending phone needs before it spends several hundred
 * milliseconds stretching a transfer code and then starts uploading. Every
 * value here is a published product limit; none of it describes the
 * infrastructure behind the service.
 */
export type DropCapabilities = {
  protocolVersion: typeof DROP_PROTOCOL_VERSION;
  maximumTotalBytes: number;
  maximumFileCount: number;
  maximumParts: number;
  maximumFileNameBytes: number;
  chunkBytes: number;
  ttlSeconds: number;
  /**
   * Whether ciphertext can also travel through this origin, for networks that
   * approved the Print-cess address but not a separate storage host.
   */
  sameOriginTransfers?: boolean;
};
