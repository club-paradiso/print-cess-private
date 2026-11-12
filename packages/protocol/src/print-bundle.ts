import {
  FILE_KIND_CODES,
  MAX_PRINT_BUNDLE_BYTES,
  MAX_PRINT_BUNDLE_FILES,
  type PrintableFileKind,
} from "./envelope.js";

export const PRINT_BUNDLE_HEADER_BYTES = 12;
export const PRINT_BUNDLE_ENTRY_HEADER_BYTES = 8;

const MAGIC = new Uint8Array([0x50, 0x43, 0x42, 0x4e, 0x44, 0x4c, 0x30, 0x31]);
const VERSION = 1;

export type PrintBundleEntry = {
  fileKind: PrintableFileKind;
  bytes: Uint8Array;
};

export class PrintBundleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PrintBundleError";
  }
}

export function encodePrintBundle(entries: readonly PrintBundleEntry[]): Uint8Array {
  if (entries.length < 1 || entries.length > MAX_PRINT_BUNDLE_FILES) {
    throw new PrintBundleError(`A print bundle must contain 1-${MAX_PRINT_BUNDLE_FILES} files`);
  }

  let total = PRINT_BUNDLE_HEADER_BYTES;
  for (const entry of entries) {
    if (entry.bytes.byteLength < 1)
      throw new PrintBundleError("Print bundle files must not be empty");
    total += PRINT_BUNDLE_ENTRY_HEADER_BYTES + entry.bytes.byteLength;
    if (total > MAX_PRINT_BUNDLE_BYTES) {
      throw new PrintBundleError("Print bundle exceeds the encrypted payload limit");
    }
  }

  const output = new Uint8Array(total);
  output.set(MAGIC, 0);
  const view = new DataView(output.buffer);
  view.setUint8(8, VERSION);
  view.setUint8(9, entries.length);
  view.setUint16(10, 0, false);

  let offset = PRINT_BUNDLE_HEADER_BYTES;
  for (const entry of entries) {
    const code = FILE_KIND_CODES[entry.fileKind];
    view.setUint8(offset, code);
    view.setUint8(offset + 1, 0);
    view.setUint16(offset + 2, 0, false);
    view.setUint32(offset + 4, entry.bytes.byteLength, false);
    offset += PRINT_BUNDLE_ENTRY_HEADER_BYTES;
    output.set(entry.bytes, offset);
    offset += entry.bytes.byteLength;
  }

  return output;
}

export function decodePrintBundle(bytes: Uint8Array): PrintBundleEntry[] {
  if (bytes.byteLength < PRINT_BUNDLE_HEADER_BYTES || bytes.byteLength > MAX_PRINT_BUNDLE_BYTES) {
    throw new PrintBundleError("Print bundle size is invalid");
  }
  if (!equal(bytes.subarray(0, MAGIC.length), MAGIC)) {
    throw new PrintBundleError("Print bundle magic is invalid");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(8) !== VERSION) throw new PrintBundleError("Unsupported print bundle version");
  const count = view.getUint8(9);
  if (count < 1 || count > MAX_PRINT_BUNDLE_FILES || view.getUint16(10, false) !== 0) {
    throw new PrintBundleError("Print bundle header is invalid");
  }

  const entries: PrintBundleEntry[] = [];
  let offset = PRINT_BUNDLE_HEADER_BYTES;
  try {
    for (let index = 0; index < count; index += 1) {
      if (offset + PRINT_BUNDLE_ENTRY_HEADER_BYTES > bytes.byteLength) {
        throw new PrintBundleError("Print bundle entry header is truncated");
      }
      const kind = printableKindFromCode(view.getUint8(offset));
      if (view.getUint8(offset + 1) !== 0 || view.getUint16(offset + 2, false) !== 0) {
        throw new PrintBundleError("Print bundle entry flags are unsupported");
      }
      const length = view.getUint32(offset + 4, false);
      offset += PRINT_BUNDLE_ENTRY_HEADER_BYTES;
      if (length < 1 || offset + length > bytes.byteLength) {
        throw new PrintBundleError("Print bundle entry length is invalid");
      }
      entries.push({ fileKind: kind, bytes: bytes.slice(offset, offset + length) });
      offset += length;
    }

    if (offset !== bytes.byteLength) throw new PrintBundleError("Print bundle has trailing bytes");
    return entries;
  } catch (error) {
    for (const entry of entries) entry.bytes.fill(0);
    throw error;
  }
}

// Keep the API introduced by the earlier multi-file implementation while the
// newer call sites use the clearer decode/EncodedBytes names. Rolling branches
// should not have to choose which generation of the same protocol helper exists.
export const parsePrintBundle = decodePrintBundle;

export function printBundleEncodedBytes(entries: readonly { bytes: Uint8Array }[]): number {
  return (
    PRINT_BUNDLE_HEADER_BYTES +
    entries.reduce(
      (total, entry) => total + PRINT_BUNDLE_ENTRY_HEADER_BYTES + entry.bytes.byteLength,
      0,
    )
  );
}

export const printBundleEncodedSize = printBundleEncodedBytes;

function printableKindFromCode(code: number): PrintableFileKind {
  for (const [kind, value] of Object.entries(FILE_KIND_CODES)) {
    if (value === code && kind !== "bundle") return kind as PrintableFileKind;
  }
  throw new PrintBundleError("Print bundle contains an unsupported file kind");
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
