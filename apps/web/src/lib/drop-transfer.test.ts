import { describe, expect, it } from "vitest";

import {
  DROP_CHUNK_BYTES,
  MAX_DROP_FILES,
  MAX_DROP_MANIFEST_BYTES,
  MAX_DROP_PARTS,
} from "@print-cess/protocol";

import {
  DropTransferError,
  prepareSelection,
  safeFileName,
  sealedManifestBytes,
} from "./drop-transfer";

function fakeFile(name: string, size: number): File {
  return { name, size, type: "application/octet-stream" } as File;
}

describe("prepareSelection", () => {
  it("splits a large file into chunks and lays the parts out end to end", () => {
    const selection = prepareSelection([
      fakeFile("video.mp4", DROP_CHUNK_BYTES * 2 + 1),
      fakeFile("note.txt", 12),
    ]);
    expect(selection.manifestFiles[0]?.chunkCount).toBe(3);
    expect(selection.manifestFiles[1]?.chunkCount).toBe(1);
    expect(selection.partCount).toBe(4);
    expect(selection.totalBytes).toBe(DROP_CHUNK_BYTES * 2 + 13);
  });

  it("refuses an empty selection", () => {
    expect(() => prepareSelection([])).toThrow(DropTransferError);
  });

  it("refuses more files than one transfer carries", () => {
    const files = Array.from({ length: MAX_DROP_FILES + 1 }, (_, index) =>
      fakeFile(`f${index}.txt`, 10),
    );
    expect(() => prepareSelection(files)).toThrow(/dropTooManyFiles/u);
  });

  it("carries a zero-byte file, which still costs one part", () => {
    const selection = prepareSelection([fakeFile("empty.txt", 0)]);
    expect(selection.totalBytes).toBe(0);
    expect(selection.partCount).toBe(1);
    expect(selection.manifestFiles[0]?.chunkCount).toBe(1);
  });
});

describe("prepareSelection limits", () => {
  it("accepts many tiny files, which cost one part each", () => {
    const files = Array.from({ length: MAX_DROP_FILES }, (_, index) =>
      fakeFile(`note-${index}.txt`, 1024),
    );
    const selection = prepareSelection(files, {
      maximumTotalBytes: 64 * 1024 * 1024,
      maximumFileCount: MAX_DROP_FILES,
      maximumParts: MAX_DROP_PARTS,
    });
    expect(selection.partCount).toBe(MAX_DROP_FILES);
    expect(selection.totalBytes).toBe(MAX_DROP_FILES * 1024);
  });

  it("refuses a transfer larger than this deployment allows", () => {
    const limits = {
      maximumTotalBytes: 64 * 1024 * 1024,
      maximumFileCount: MAX_DROP_FILES,
      maximumParts: MAX_DROP_PARTS,
    };
    expect(() => prepareSelection([fakeFile("a.bin", 64 * 1024 * 1024)], limits)).not.toThrow();
    expect(() => prepareSelection([fakeFile("a.bin", 64 * 1024 * 1024 + 1)], limits)).toThrow(
      /dropTooLarge/u,
    );
  });

  it("keeps the worst selection a person can choose inside the manifest ceiling", () => {
    for (const script of ["가", "文", "م", "क", "🎉", "a"]) {
      const files = Array.from({ length: MAX_DROP_FILES }, (_, index) =>
        fakeFile(`${script.repeat(400)}-${index}.hwpx`, 1024),
      );
      const selection = prepareSelection(files);
      expect(sealedManifestBytes(selection.manifestFiles)).toBeLessThan(MAX_DROP_MANIFEST_BYTES);
    }
  });

  it("still refuses a file list that would not fit, however it got that large", () => {
    const oversized = Array.from({ length: MAX_DROP_FILES }, (_, index) => ({
      name: `${"가".repeat(400)}-${index}.hwpx`,
      size: 1024,
      type: "application/hwp+zip",
      chunkCount: 1,
    }));
    expect(sealedManifestBytes(oversized)).toBeGreaterThan(MAX_DROP_MANIFEST_BYTES);
  });

  it("keeps a realistic selection of long Korean names comfortably inside it", () => {
    const files = Array.from({ length: MAX_DROP_FILES }, (_, index) =>
      fakeFile(`${"전입신고서".repeat(6)}-${index}.hwpx`, 1024),
    );
    const selection = prepareSelection(files);
    expect(sealedManifestBytes(selection.manifestFiles)).toBeLessThan(MAX_DROP_MANIFEST_BYTES);
  });

  it("keeps twenty emoji-heavy names inside it too, once names are bounded by bytes", () => {
    const files = Array.from({ length: MAX_DROP_FILES }, (_, index) =>
      fakeFile(`${"🎉".repeat(200)}-${index}.png`, 1024),
    );
    const selection = prepareSelection(files);
    expect(sealedManifestBytes(selection.manifestFiles)).toBeLessThan(MAX_DROP_MANIFEST_BYTES);
  });

  it("keeps a long media type from eating the budget", () => {
    const file = fakeFile("sheet.xlsx", 1024);
    const selection = prepareSelection([
      { ...file, type: `application/${"x".repeat(400)}` } as File,
    ]);
    expect(selection.manifestFiles[0]?.type).toBe("");
  });
});

describe("safeFileName", () => {
  it("keeps an ordinary name unchanged", () => {
    expect(safeFileName("holiday photo.jpg")).toBe("holiday photo.jpg");
  });

  it("strips the separators that would let a name escape its folder", () => {
    expect(safeFileName("../../etc/passwd")).toBe("__.._etc_passwd");
    expect(safeFileName("C:\\Windows\\system32")).toBe("C__Windows_system32");
  });

  it("removes control characters a sending device could smuggle in", () => {
    expect(safeFileName("in\u0000voice\u001b.pdf")).toBe("in_voice_.pdf");
  });

  it("never returns an empty name", () => {
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("...")).toBe("_");
  });

  it("bounds a name that would otherwise be unreasonably long", () => {
    expect(safeFileName("a".repeat(500))).toHaveLength(180);
  });
});
