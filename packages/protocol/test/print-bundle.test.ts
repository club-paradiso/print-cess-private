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

  it("rejects more than ten documents, including mixed thirty-file batches", () => {
    const documents = Array.from({ length: 11 }, () => ({
      fileKind: "pdf" as const,
      bytes: new Uint8Array([1]),
    }));
    expect(() => encodePrintBundle(documents)).toThrow(PrintBundleError);
    const images = Array.from({ length: 29 }, () => ({
      fileKind: "png" as const,
      bytes: new Uint8Array([1]),
    }));
    expect(() =>
      encodePrintBundle([...images, { fileKind: "pdf", bytes: new Uint8Array([1]) }]),
    ).toThrow(PrintBundleError);
  });

  it("rejects an altered thirty-photo bundle containing a document on decode", () => {
    const encoded = encodePrintBundle(
      Array.from({ length: 30 }, () => ({
        fileKind: "png" as const,
        bytes: new Uint8Array([1]),
      })),
    );
    encoded[12] = 1; // change first entry to PDF after encoding
    expect(() => decodePrintBundle(encoded)).toThrow(PrintBundleError);
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
