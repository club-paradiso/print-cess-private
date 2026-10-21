import { describe, expect, it, vi } from "vitest";

import {
  FileValidationError,
  classifySelectedFile,
  decodedDimensionsMatch,
  detectFileKind,
  parsePngDimensions,
  readSelectedFileBytes,
  validateFileForMobile,
  validatePdf,
} from "./file-validation";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));

describe("file validation", () => {
  it("detects signatures instead of trusting filenames", () => {
    expect(detectFileKind(new TextEncoder().encode("%PDF-1.7\n"))).toBe("pdf");
    expect(detectFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(() => detectFileKind(new TextEncoder().encode("MZ pretend.pdf"))).toThrow(
      FileValidationError,
    );
  });

  it("classifies common phone images for local normalization", () => {
    expect(classifySelectedFile({ name: "photo.HEIC", type: "image/heic" })).toBe("image");
    expect(classifySelectedFile({ name: "scan.webp", type: "image/webp" })).toBe("image");
    expect(classifySelectedFile({ name: "legacy.tiff", type: "" })).toBe("image");
    expect(classifySelectedFile({ name: "unsafe.svg", type: "image/svg+xml" })).toBe("unknown");
  });

  it("routes office and Hangul documents to the PDF guidance", () => {
    expect(classifySelectedFile({ name: "application.hwp", type: "application/x-hwp" })).toBe(
      "document",
    );
    expect(
      classifySelectedFile({
        name: "form.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("document");
    expect(classifySelectedFile({ name: "table.xlsx", type: "application/vnd.ms-excel" })).toBe(
      "document",
    );
  });

  it("accepts canonical HWPX only for a capable kiosk", async () => {
    const mime = new TextEncoder().encode("application/hwp+zip");
    const bytes = new Uint8Array(30 + 8 + mime.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, 0, true);
    view.setUint32(18, mime.length, true);
    view.setUint32(22, mime.length, true);
    view.setUint16(26, 8, true);
    bytes.set(new TextEncoder().encode("mimetype"), 30);
    bytes.set(mime, 38);
    const file = new File([bytes], "application.hwpx", { type: "application/hwp+zip" });

    await expect(validateFileForMobile(file)).rejects.toMatchObject({ code: "hwpxUnavailable" });
    await expect(validateFileForMobile(file, { allowHwpx: true })).resolves.toMatchObject({
      fileKind: "hwpx",
      normalized: false,
    });
  });

  it("recovers when an iCloud-backed file is temporarily unreadable", async () => {
    const originalFileReader = globalThis.FileReader;
    vi.stubGlobal("FileReader", undefined);

    try {
      const payload = new TextEncoder().encode("%PDF-1.7\n%%EOF");
      const file = new File([payload], "icloud.pdf", { type: "application/pdf" });
      const nativeRead = file.arrayBuffer.bind(file);
      const arrayBuffer = vi
        .fn<() => Promise<ArrayBuffer>>()
        .mockRejectedValueOnce(new DOMException("not ready", "NotReadableError"))
        .mockImplementation(nativeRead);
      Object.defineProperty(file, "arrayBuffer", { configurable: true, value: arrayBuffer });

      await expect(readSelectedFileBytes(file)).resolves.toEqual(payload);
      expect(arrayBuffer).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal("FileReader", originalFileReader);
    }
  });

  it("parses PNG dimensions from IHDR", () => {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 1170, false);
    view.setUint32(20, 1654, false);
    expect(parsePngDimensions(bytes)).toEqual({ width: 1170, height: 1654 });
  });

  it("accepts a photo whose decoded axes are swapped by its EXIF orientation", () => {
    const stored = { width: 4032, height: 3024 };
    expect(decodedDimensionsMatch(stored, { width: 3024, height: 4032 })).toBe(true);
    expect(decodedDimensionsMatch(stored, stored)).toBe(true);
    expect(decodedDimensionsMatch(stored, { width: 1024, height: 768 })).toBe(false);
  });

  it("rejects active PDF content that hex-escapes its name", async () => {
    const plain = new TextEncoder().encode("%PDF-1.7\n1 0 obj<</OpenAction 2 0 R>>endobj\n");
    await expect(validatePdf(plain)).rejects.toThrow(
      expect.objectContaining({ code: "damagedFile" }),
    );

    const escaped = new TextEncoder().encode("%PDF-1.7\n1 0 obj<</#4fpenAction 2 0 R>>endobj\n");
    await expect(validatePdf(escaped)).rejects.toThrow(
      expect.objectContaining({ code: "damagedFile" }),
    );
  });

  it("reports an encrypted PDF even when /Encrypt is hex-escaped", async () => {
    const escaped = new TextEncoder().encode("%PDF-1.7\ntrailer<</#45ncrypt 9 0 R>>\n");
    await expect(validatePdf(escaped)).rejects.toThrow(
      expect.objectContaining({ code: "lockedPdf" }),
    );
  });

  it("returns page counts above the system ceiling so the quota screen can explain the denial", async () => {
    const pdfjs = await import("pdfjs-dist");
    vi.mocked(pdfjs.getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 51,
        cleanup: vi.fn(),
      }),
      destroy: vi.fn(),
    } as never);

    await expect(validatePdf(new TextEncoder().encode("%PDF-1.7\n%%EOF"))).resolves.toBe(51);
  });
});
