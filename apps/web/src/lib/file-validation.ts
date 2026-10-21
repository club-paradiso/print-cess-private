import { MAX_PLAINTEXT_BYTES, type FileKind } from "@print-cess/protocol";

import { isHwpxSelection, validateHwpxHeader } from "./hwpx-validation";

export type ValidatedMobileFile = {
  bytes: Uint8Array;
  fileKind: FileKind;
  /** Exact for PDFs and images. A floor when `pageCountIsExact` is false. */
  pageCount: number;
  /**
   * False for HWP and HWPX: Hangul decides their pagination while rendering,
   * and only the kiosk runs Hangul. Counting them as one page would let a
   * fifty-page document through the free limit, so the quota carries the
   * uncertainty instead of hiding it.
   */
  pageCountIsExact: boolean;
  width?: number;
  height?: number;
  normalized: boolean;
};

export type FileValidationCode =
  | "unsupportedType"
  | "documentNeedsPdf"
  | "hwpxUnavailable"
  | "imageConversionUnsupported"
  | "tooLarge"
  | "tooManyPages"
  | "lockedPdf"
  | "damagedFile";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const ACTIVE_PDF_MARKERS = ["/JavaScript", "/OpenAction", "/Launch", "/EmbeddedFile", "/AA"];
const MAX_IMAGE_EDGE = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const NORMALIZED_IMAGE_EDGE = 6_000;
const NORMALIZED_IMAGE_PIXELS = 16_000_000;
const JPEG_QUALITIES = [0.92, 0.84, 0.72, 0.6] as const;

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jfif",
  "jpeg",
  "jpg",
  "png",
  "tif",
  "tiff",
  "webp",
]);

const DOCUMENT_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "hwp",
  "hwpx",
  "key",
  "numbers",
  "odp",
  "ods",
  "odt",
  "pages",
  "ppt",
  "pptx",
  "rtf",
  "txt",
  "xls",
  "xlsx",
]);

export class FileValidationError extends Error {
  public constructor(public readonly code: FileValidationCode) {
    super(code);
    this.name = "FileValidationError";
  }
}

export function detectFileKind(bytes: Uint8Array): FileKind {
  if (bytes.byteLength >= 5 && new TextDecoder("ascii").decode(bytes.subarray(0, 5)) === "%PDF-")
    return "pdf";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (
    bytes.byteLength >= PNG_SIGNATURE.length &&
    fixedBytesEqual(bytes.subarray(0, 8), PNG_SIGNATURE)
  )
    return "png";
  try {
    validateHwpxHeader(bytes);
    return "hwpx";
  } catch {
    throw new FileValidationError("unsupportedType");
  }
}

export function classifySelectedFile(
  file: Pick<File, "name" | "type">,
): "image" | "hwpx" | "document" | "unknown" {
  const extension = fileExtension(file.name);
  if (isHwpxSelection(file)) return "hwpx";
  if (file.type === "image/svg+xml" || extension === "svg") return "unknown";
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  if (
    DOCUMENT_EXTENSIONS.has(extension) ||
    file.type.startsWith("application/vnd") ||
    file.type.startsWith("text/")
  )
    return "document";
  return "unknown";
}

export async function validateFileForMobile(
  file: File,
  options: { allowHwpx?: boolean; trustedGeneratedPdf?: boolean } = {},
): Promise<ValidatedMobileFile> {
  const classification = classifySelectedFile(file);
  const sourceLimit = classification === "image" ? MAX_SOURCE_IMAGE_BYTES : MAX_PLAINTEXT_BYTES;
  if (file.size > sourceLimit) throw new FileValidationError("tooLarge");

  const bytes = await readSelectedFileBytes(file);
  if (bytes.byteLength > sourceLimit) throw new FileValidationError("tooLarge");
  if (classification === "hwpx") {
    if (!options.allowHwpx) throw new FileValidationError("hwpxUnavailable");
    try {
      validateHwpxHeader(bytes);
    } catch {
      throw new FileValidationError("damagedFile");
    }
    return { bytes, fileKind: "hwpx", pageCount: 1, pageCountIsExact: false, normalized: false };
  }

  let fileKind: FileKind;
  try {
    fileKind = detectFileKind(bytes);
  } catch (error) {
    if (!(error instanceof FileValidationError) || error.code !== "unsupportedType") throw error;
    if (classification === "document") throw new FileValidationError("documentNeedsPdf");
    if (classification === "image") return normalizeBrowserImage(file);
    throw error;
  }

  if (fileKind === "hwpx") {
    if (!options.allowHwpx) throw new FileValidationError("hwpxUnavailable");
    return { bytes, fileKind, pageCount: 1, pageCountIsExact: false, normalized: false };
  }

  if (fileKind === "pdf") {
    if (bytes.byteLength > MAX_PLAINTEXT_BYTES) throw new FileValidationError("tooLarge");
    return {
      bytes,
      fileKind,
      pageCount: await validatePdf(bytes),
      pageCountIsExact: true,
      normalized: false,
    };
  }

  const dimensions = fileKind === "png" ? parsePngDimensions(bytes) : parseJpegDimensions(bytes);
  if (
    bytes.byteLength > MAX_PLAINTEXT_BYTES ||
    !dimensionsWithinLimits(dimensions.width, dimensions.height)
  ) {
    return normalizeBrowserImage(file);
  }

  validateDimensions(dimensions.width, dimensions.height);
  await verifyBrowserImageDecode(file, dimensions);
  return {
    bytes,
    fileKind,
    pageCount: 1,
    pageCountIsExact: true,
    ...dimensions,
    normalized: false,
  };
}

const FILE_READ_RETRY_DELAYS_MS = [0, 120, 360] as const;

/**
 * iOS Safari can hand a File backed by iCloud Drive to the page before the
 * provider is ready to serve its bytes. A single arrayBuffer() failure is not
 * proof that the document is corrupt. Retry briefly and fall back to
 * FileReader, which uses a different WebKit read path on older/iOS builds.
 */
export async function readSelectedFileBytes(file: File): Promise<Uint8Array> {
  for (const delayMs of FILE_READ_RETRY_DELAYS_MS) {
    if (delayMs > 0) await waitForFileProvider(delayMs);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > 0) return bytes;
    } catch {
      // Try FileReader below, then give the provider a moment before retrying.
    }

    if (typeof FileReader !== "undefined") {
      try {
        const bytes = new Uint8Array(await readWithFileReader(file));
        if (bytes.byteLength > 0) return bytes;
      } catch {
        // Continue to the next attempt. Do not label a transient provider read
        // failure as a corrupt file until every local read path has failed.
      }
    }
  }

  throw new FileValidationError("damagedFile");
}

function readWithFileReader(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new Error("FileReader returned a non-binary result"));
      },
      { once: true },
    );
    reader.addEventListener("error", () => reject(reader.error ?? new Error("FileReader failed")), {
      once: true,
    });
    reader.addEventListener("abort", () => reject(new Error("FileReader aborted")), { once: true });
    reader.readAsArrayBuffer(file);
  });
}

function waitForFileProvider(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function validatePdf(
  bytes: Uint8Array,
  options: { skipActiveContentScan?: boolean } = {},
): Promise<number> {
  const searchable = new TextDecoder("latin1").decode(bytes);
  // PDF names may hex-escape any character, so `/J#61vaScript` names the same
  // key as `/JavaScript`. Scan the decoded form too, or the marker check below
  // is bypassed by an author who only has to escape one letter.
  const decodedNames = decodePdfNameEscapes(searchable);
  if (searchable.includes("/Encrypt") || decodedNames.includes("/Encrypt"))
    throw new FileValidationError("lockedPdf");
  if (
    !options.skipActiveContentScan &&
    ACTIVE_PDF_MARKERS.some(
      (marker) => searchable.includes(marker) || decodedNames.includes(marker),
    )
  )
    throw new FileValidationError("damagedFile");
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      stopAtErrors: true,
      enableXfa: false,
      maxImageSize: MAX_IMAGE_PIXELS,
      canvasMaxAreaInBytes: 64 * 1024 * 1024,
      disableAutoFetch: true,
      disableStream: true,
    });
    let passwordRequested = false;
    task.onPassword = () => {
      passwordRequested = true;
      void task.destroy();
    };
    const document = await task.promise;
    try {
      if (passwordRequested) throw new FileValidationError("lockedPdf");
      if (document.numPages < 1) throw new FileValidationError("damagedFile");
      return document.numPages;
    } finally {
      await document.cleanup();
      await task.destroy();
    }
  } catch (error) {
    if (error instanceof FileValidationError) throw error;
    if (String(error).toLowerCase().includes("password"))
      throw new FileValidationError("lockedPdf");
    throw new FileValidationError("damagedFile");
  }
}

export function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 24 || !fixedBytesEqual(bytes.subarray(0, 8), PNG_SIGNATURE))
    throw new FileValidationError("damagedFile");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

export function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new FileValidationError("damagedFile");
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.byteLength)
      throw new FileValidationError("damagedFile");
    if (isStartOfFrame(marker)) {
      return {
        height: ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0),
        width: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
      };
    }
    offset += length;
  }
  throw new FileValidationError("damagedFile");
}

async function normalizeBrowserImage(file: File): Promise<ValidatedMobileFile> {
  let decoded: Awaited<ReturnType<typeof decodeBrowserImage>> | undefined;
  try {
    const source = await convertHeicIfNeeded(file);
    decoded = await decodeBrowserImage(source);
    const dimensions = normalizedDimensions(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new FileValidationError("imageConversionUnsupported");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.drawImage(decoded.source, 0, 0, dimensions.width, dimensions.height);
    const blob = await encodeJpeg(canvas);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      bytes,
      fileKind: "jpeg",
      pageCount: 1,
      pageCountIsExact: true,
      ...dimensions,
      normalized: true,
    };
  } catch (error) {
    if (error instanceof FileValidationError) throw error;
    throw new FileValidationError("imageConversionUnsupported");
  } finally {
    decoded?.dispose();
  }
}

async function convertHeicIfNeeded(file: File): Promise<Blob> {
  if (!isHeicFile(file)) return file;
  try {
    const { heicTo } = await import("heic-to/csp");
    const converted = await heicTo({
      blob: file,
      type: "image/jpeg",
      quality: 0.92,
    });
    if (!(converted instanceof Blob) || converted.size < 1)
      throw new FileValidationError("imageConversionUnsupported");
    return converted;
  } catch (error) {
    if (error instanceof FileValidationError) throw error;
    throw new FileValidationError("imageConversionUnsupported");
  }
}

function isHeicFile(file: File): boolean {
  const extension = fileExtension(file.name);
  return (
    extension === "heic" ||
    extension === "heif" ||
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    file.type === "image/heic-sequence" ||
    file.type === "image/heif-sequence"
  );
}

async function decodeBrowserImage(file: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Fall back to the browser image element for formats it decodes there.
    }
  }

  if (typeof document === "undefined") throw new FileValidationError("imageConversionUnsupported");
  const url = URL.createObjectURL(file);
  const image = document.createElement("img");
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("image decode failed")), { once: true });
  });
  image.src = url;
  try {
    await loaded;
    if (image.naturalWidth < 1 || image.naturalHeight < 1)
      throw new FileValidationError("imageConversionUnsupported");
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function encodeJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of JPEG_QUALITIES) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob.size <= MAX_PLAINTEXT_BYTES) return blob;
  }
  throw new FileValidationError("tooLarge");
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new FileValidationError("imageConversionUnsupported"));
      },
      type,
      quality,
    );
  });
}

function normalizedDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new FileValidationError("damagedFile");
  const edgeScale = Math.min(1, NORMALIZED_IMAGE_EDGE / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(NORMALIZED_IMAGE_PIXELS / (width * height)));
  const scale = Math.min(edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function dimensionsWithinLimits(width: number, height: number): boolean {
  return (
    width >= 1 &&
    height >= 1 &&
    width <= MAX_IMAGE_EDGE &&
    height <= MAX_IMAGE_EDGE &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

export function validateDimensions(width: number, height: number): void {
  if (!dimensionsWithinLimits(width, height)) throw new FileValidationError("damagedFile");
}

export function decodedDimensionsMatch(
  expected: { width: number; height: number },
  decoded: { width: number; height: number },
): boolean {
  if (decoded.width === expected.width && decoded.height === expected.height) return true;
  // The decode below asks for the EXIF orientation to be applied, and a photo
  // taken sideways — most photos in a phone gallery — then reports its axes
  // swapped relative to the width and height stored in the file. That is a
  // valid, printable photograph, not a damaged one. Browsers also disagree
  // about honouring the orientation request at all, so accept both forms.
  return decoded.width === expected.height && decoded.height === expected.width;
}

async function verifyBrowserImageDecode(
  file: File,
  expected: { width: number; height: number },
): Promise<void> {
  if (typeof createImageBitmap !== "function") return;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      if (!decodedDimensionsMatch(expected, bitmap)) throw new FileValidationError("damagedFile");
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (error instanceof FileValidationError) throw error;
    throw new FileValidationError("damagedFile");
  }
}

function decodePdfNameEscapes(source: string): string {
  if (!source.includes("#")) return source;
  return source.replaceAll(/#([0-9a-fA-F]{2})/gu, (match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    // `#00` is not a legal name character, so leave the sequence untouched
    // rather than inventing a NUL that the real parser would reject.
    return code === 0 ? match : String.fromCharCode(code);
  });
}

function fileExtension(name: string): string {
  const separator = name.lastIndexOf(".");
  return separator < 0 ? "" : name.slice(separator + 1).toLowerCase();
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function fixedBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    difference |= left[index]! ^ right[index]!;
  return difference === 0;
}
