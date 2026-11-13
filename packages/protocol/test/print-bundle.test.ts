import { describe, expect, it } from "vitest";

import {
  MAX_PRINT_BUNDLE_FILES,
  PrintBundleError,
  decodePrintBundle,
  encodePrintBundle,
} from "../src/index.js";

describe("print bundle", () => {
  it("round-trips mixed printable document kinds in order", () => {
    const bundle = encodePrintBundle([
      { fileKind: "jpeg", bytes: new Uint8Array([1, 2, 3]) },
      { fileKind: "pdf", bytes: new Uint8Array([4, 5]) },
      { fileKind: "hwpx", bytes: new Uint8Array([6, 7, 8, 9]) },
    ]);

    expect(decodePrintBundle(bundle)).toEqual([
      { fileKind: "jpeg", bytes: new Uint8Array([1, 2, 3]) },
      { fileKind: "pdf", bytes: new Uint8Array([4, 5]) },
      { fileKind: "hwpx", bytes: new Uint8Array([6, 7, 8, 9]) },
    ]);
  });

  it("rejects a truncated bundle instead of returning a partial print set", () => {
    const bundle = encodePrintBundle([{ fileKind: "png", bytes: new Uint8Array([1, 2, 3]) }]);
    expect(() => decodePrintBundle(bundle.subarray(0, bundle.byteLength - 1))).toThrow(
      PrintBundleError,
    );
  });

  it("round-trips thirty photos in their original order", () => {
    const photos = Array.from({ length: 30 }, (_, index) => ({
      fileKind: "jpeg" as const,
      bytes: new Uint8Array([0xff, 0xd8, index]),
    }));
    const encoded = encodePrintBundle(photos);
    expect(decodePrintBundle(encoded)).toEqual(photos);
    expect(MAX_PRINT_BUNDLE_FILES).toBe(30);
  });

  it("round-trips thirty PDFs and mixed photo-document bundles in order", () => {
    const documents = Array.from({ length: 30 }, (_, index) => ({
      fileKind: "pdf" as const,
      bytes: new Uint8Array([index + 1]),
    }));
    expect(decodePrintBundle(encodePrintBundle(documents))).toEqual(documents);
    const mixed = documents.map((entry, index) =>
      index % 3 === 0
        ? { fileKind: "png" as const, bytes: entry.bytes }
        : index % 3 === 1
          ? { fileKind: "jpeg" as const, bytes: entry.bytes }
          : { fileKind: "hwpx" as const, bytes: entry.bytes },
    );
    expect(decodePrintBundle(encodePrintBundle(mixed))).toEqual(mixed);
  });

  it("rejects more than the bounded file count", () => {
    expect(() =>
      encodePrintBundle(
        Array.from({ length: MAX_PRINT_BUNDLE_FILES + 1 }, () => ({
          fileKind: "pdf" as const,
          bytes: new Uint8Array([1]),
        })),
      ),
    ).toThrow(PrintBundleError);
  });

  it("rejects trailing bytes so the authenticated plaintext is canonical", () => {
    const bundle = encodePrintBundle([{ fileKind: "hwp", bytes: new Uint8Array([1]) }]);
    const changed = new Uint8Array(bundle.byteLength + 1);
    changed.set(bundle);
    expect(() => decodePrintBundle(changed)).toThrow(PrintBundleError);
  });
});
