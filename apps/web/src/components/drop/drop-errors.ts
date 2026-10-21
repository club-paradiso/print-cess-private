import { SaveError } from "@/lib/drop-save";
import { DropTransferError } from "@/lib/drop-transfer";

const SHARED_MESSAGES: Record<string, string> = {
  dropFileMissing: "dropFileUnreadable",
  dropFileChanged: "dropFileUnreadable",
  dropUploadFailed: "dropNetworkError",
  dropDownloadFailed: "dropNetworkError",
};

const KNOWN_KEYS = new Set([
  "dropNoFiles",
  "dropTooManyFiles",
  "dropTooLarge",
  "dropNamesTooLong",
  "dropFileUnreadable",
  "dropNetworkError",
  "dropCodeNotFound",
  "dropExpired",
  "dropTooManyTries",
  "dropDamaged",
  "dropCancelled",
  "dropSaveRefused",
  "dropTooLargeForBrowser",
]);

export function dropErrorKey(error: unknown): string {
  if (error instanceof SaveError) {
    return KNOWN_KEYS.has(error.code) ? error.code : "dropNetworkError";
  }
  if (error instanceof DOMException && error.name === "AbortError") return "dropCancelled";
  if (!(error instanceof DropTransferError)) return "dropNetworkError";
  const key = SHARED_MESSAGES[error.code] ?? error.code;
  return KNOWN_KEYS.has(key) ? key : "dropNetworkError";
}
