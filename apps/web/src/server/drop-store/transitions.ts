import { timingSafeEqualBase64Url } from "@print-cess/crypto";
import { DROP_PART_TAG_BYTES, type DropRecord } from "@print-cess/protocol";

import type { DropPartCommit, DropReceiverEvent } from "../contracts";
import { ServiceError } from "../errors";

export type DropMutation = (drop: DropRecord) => DropRecord;

export function requireOwner(drop: DropRecord, candidateTokenHash: string): void {
  if (!timingSafeEqualBase64Url(drop.ownerTokenHash, candidateTokenHash)) {
    throw new ServiceError("unauthorized", "The transfer credential is invalid.", 401);
  }
}

export function applyPartCommits(drop: DropRecord, commits: readonly DropPartCommit[]): DropRecord {
  if (drop.status !== "collecting") {
    throw new ServiceError("conflict", "This transfer is already sealed.", 409);
  }
  const parts = [...drop.parts];
  let addedBytes = 0;
  for (const commit of commits) {
    if (commit.index >= drop.partCount) {
      throw new ServiceError("bad_request", "That part is not in this transfer.", 400);
    }
    const existing = parts[commit.index];
    if (existing) {
      if (existing.size !== commit.size) {
        throw new ServiceError("conflict", "A different part has already been committed.", 409);
      }
      continue;
    }
    parts[commit.index] = { size: commit.size, ...(commit.etag ? { etag: commit.etag } : {}) };
    addedBytes += commit.size;
  }
  if (addedBytes === 0) return drop;
  const totalCiphertextBytes = drop.totalCiphertextBytes + addedBytes;
  if (totalCiphertextBytes > ciphertextCeiling(drop)) {
    throw new ServiceError("payload_too_large", "This transfer is larger than the limit.", 413);
  }
  return {
    ...drop,
    parts,
    totalCiphertextBytes,
    revision: drop.revision + 1,
  };
}

function ciphertextCeiling(drop: DropRecord): number {
  return drop.totalBytes + drop.partCount * DROP_PART_TAG_BYTES;
}

export function applyReceiverEvent(drop: DropRecord, event: DropReceiverEvent): DropRecord {
  if (drop.status !== "ready") {
    throw new ServiceError("not_found", "This transfer is not ready yet.", 404);
  }
  const field =
    event === "opened" ? "openCount" : event === "downloading" ? "downloadCount" : "deliveredCount";
  return { ...drop, [field]: drop[field] + 1, revision: drop.revision + 1 };
}

export function assertSealable(drop: DropRecord): void {
  if (drop.parts.some((part) => part === null)) {
    throw new ServiceError("conflict", "Some parts of this transfer are still missing.", 409);
  }
}

export function uploadedPartCount(drop: DropRecord): number {
  return drop.parts.reduce((total, part) => total + (part ? 1 : 0), 0);
}
