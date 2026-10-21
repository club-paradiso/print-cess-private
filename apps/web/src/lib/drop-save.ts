import { disambiguateFileName, safeFileName, safeMediaType } from "./drop-file-name";


export type SaveOutcome = "saved" | "downloadStarted";

export type SaveCapabilities = {
  canPickFile: boolean;
  canPickDirectory: boolean;
  canStage: boolean;
  canShareFiles: boolean;
};

export const MEMORY_SAVE_LIMIT_BYTES = 512 * 1024 * 1024;
export const MEMORY_WARNING_BYTES = 128 * 1024 * 1024;
const OBJECT_URL_LIFETIME_MS = 120_000;
const STAGING_DIRECTORY = "print-cess-drops";

export class SaveError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "SaveError";
  }
}

type FileSystemFilePickerOptions = {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
};

type PickerWindow = Window & {
  showSaveFilePicker?: (options?: FileSystemFilePickerOptions) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<
    FileSystemDirectoryHandle & {
      queryPermission?: (descriptor: { mode: string }) => Promise<PermissionState>;
      requestPermission?: (descriptor: { mode: string }) => Promise<PermissionState>;
    }
  >;
};

export function saveCapabilities(): SaveCapabilities {
  if (typeof window === "undefined") {
    return { canPickFile: false, canPickDirectory: false, canStage: false, canShareFiles: false };
  }
  const picker = window as PickerWindow;
  return {
    canPickFile: typeof picker.showSaveFilePicker === "function",
    canPickDirectory: typeof picker.showDirectoryPicker === "function",
    canStage: typeof navigator.storage?.getDirectory === "function",
    canShareFiles:
      typeof navigator.canShare === "function" && typeof navigator.share === "function",
  };
}

export function supportsStreamingSave(): boolean {
  const capabilities = saveCapabilities();
  return capabilities.canStage || capabilities.canPickFile || capabilities.canPickDirectory;
}

export function canShareReceivedFiles(): boolean {
  if (!saveCapabilities().canShareFiles) return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], "probe.bin")] });
  } catch {
    return false;
  }
}

export type FileSink = {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<SaveOutcome>;
  abort(): Promise<void>;
};

export type SaveTargetKind = "picked-file" | "picked-directory" | "download";

export type SaveTarget = {
  kind: SaveTargetKind;
  outcome: SaveOutcome;
  open(file: { name: string; type: string }): Promise<FileSink>;
};

export async function pickSaveTarget(
  file: { name: string; type: string; size: number },
  options: { preferFilePicker?: boolean } = {},
): Promise<SaveTarget> {
  const capabilities = saveCapabilities();
  if (options.preferFilePicker && capabilities.canPickFile) {
    const picked = await openFilePicker(file);
    if (picked) return picked;
  }
  return downloadTarget(file.size, capabilities);
}

export async function pickDirectoryTarget(): Promise<SaveTarget | null> {
  const picker = window as PickerWindow;
  if (typeof picker.showDirectoryPicker !== "function") return null;
  let handle: Awaited<ReturnType<NonNullable<PickerWindow["showDirectoryPicker"]>>>;
  try {
    handle = await picker.showDirectoryPicker({ mode: "readwrite" });
  } catch (error) {
    if (isAbort(error)) return null;
    throw new SaveError("dropSaveRefused");
  }
  if (typeof handle.requestPermission === "function") {
    const granted = await handle.requestPermission({ mode: "readwrite" }).catch(() => "denied");
    if (granted !== "granted") throw new SaveError("dropSaveRefused");
  }

  const used = new Set<string>();
  return {
    kind: "picked-directory",
    outcome: "saved",
    async open(entry) {
      const name = await freeNameIn(handle, safeFileName(entry.name), used);
      used.add(name);
      const fileHandle = await handle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      return writableSink(writable, "saved", async () => {
        await handle.removeEntry(name).catch(() => undefined);
        used.delete(name);
      });
    },
  };
}

export function downloadTarget(size: number, capabilities = saveCapabilities()): SaveTarget {
  if (!capabilities.canStage && size > MEMORY_SAVE_LIMIT_BYTES) {
    throw new SaveError("dropTooLargeForBrowser");
  }
  return {
    kind: "download",
    outcome: "downloadStarted",
    async open(entry) {
      const name = safeFileName(entry.name);
      const type = safeMediaType(entry.type);
      const staged = capabilities.canStage ? await openStagedSink(name, type) : null;
      if (!staged && size > MEMORY_SAVE_LIMIT_BYTES) {
        throw new SaveError("dropTooLargeForBrowser");
      }
      return staged ?? memorySink(name, type);
    },
  };
}

export async function shareReceivedFile(
  entry: { name: string; type: string },
  collect: (sink: FileSink) => Promise<void>,
): Promise<boolean> {
  const capabilities = saveCapabilities();
  const name = safeFileName(entry.name);
  const type = safeMediaType(entry.type);
  const staged = capabilities.canStage ? await openStagedShare(name, type) : null;
  const buffered = staged ?? memoryShare(name, type);
  try {
    await collect(buffered.sink);
    const file = await buffered.file();
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file] });
    return true;
  } catch (error) {
    if (isAbort(error)) return false;
    throw error;
  } finally {
    await buffered.release();
  }
}

async function openFilePicker(file: { name: string; type: string }): Promise<SaveTarget | null> {
  const picker = window as PickerWindow;
  if (typeof picker.showSaveFilePicker !== "function") return null;
  const suggestedName = safeFileName(file.name);
  let handle: FileSystemFileHandle;
  try {
    handle = await picker.showSaveFilePicker({
      suggestedName,
      ...acceptFor(file.type, suggestedName),
    });
  } catch (error) {
    if (isAbort(error)) throw new SaveError("dropSaveCancelled");
    return null;
  }
  return {
    kind: "picked-file",
    outcome: "saved",
    async open() {
      const writable = await handle.createWritable();
      return writableSink(writable, "saved");
    },
  };
}

function acceptFor(type: string, suggestedName: string): FileSystemFilePickerOptions {
  const mediaType = safeMediaType(type);
  const dot = suggestedName.lastIndexOf(".");
  const extension = dot > 0 ? suggestedName.slice(dot) : "";
  if (!mediaType || !/^\.[A-Za-z0-9]{1,16}$/u.test(extension)) return {};
  return { types: [{ accept: { [mediaType]: [extension] } }] };
}

function writableSink(
  writable: FileSystemWritableFileStream,
  outcome: SaveOutcome,
  onAbort?: () => Promise<void>,
): FileSink {
  return {
    async write(chunk) {
      await writable.write(toBuffer(chunk));
    },
    async finish() {
      await writable.close();
      return outcome;
    },
    async abort() {
      await writable.abort().catch(() => undefined);
      await onAbort?.();
    },
  };
}

type StagedHandles = {
  directory: FileSystemDirectoryHandle;
  handle: FileSystemFileHandle;
  writable: FileSystemWritableFileStream;
  stagingName: string;
};

async function stage(): Promise<StagedHandles | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(STAGING_DIRECTORY, { create: true });
    const stagingName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = await directory.getFileHandle(stagingName, { create: true });
    if (typeof handle.createWritable !== "function") return null;
    const writable = await handle.createWritable();
    return { directory, handle, writable, stagingName };
  } catch {
    return null;
  }
}

async function openStagedSink(name: string, type: string): Promise<FileSink | null> {
  const staged = await stage();
  if (!staged) return null;
  return {
    async write(chunk) {
      await staged.writable.write(toBuffer(chunk));
    },
    async finish() {
      await staged.writable.close();
      const assembled = await staged.handle.getFile();
      startDownload(new File([assembled], name, fileOptions(type)), name);
      window.setTimeout(() => {
        void staged.directory.removeEntry(staged.stagingName).catch(() => undefined);
      }, OBJECT_URL_LIFETIME_MS);
      return "downloadStarted";
    },
    async abort() {
      await staged.writable.abort().catch(() => undefined);
      await staged.directory.removeEntry(staged.stagingName).catch(() => undefined);
    },
  };
}

function memorySink(name: string, type: string): FileSink {
  let chunks: Uint8Array[] = [];
  return {
    async write(chunk) {
      chunks.push(chunk.slice());
    },
    async finish() {
      const parts = chunks.map((chunk) => toBuffer(chunk) as BlobPart);
      chunks = [];
      startDownload(new File(parts, name, fileOptions(type)), name);
      return "downloadStarted";
    },
    async abort() {
      for (const chunk of chunks) chunk.fill(0);
      chunks = [];
    },
  };
}

type BufferedFile = { sink: FileSink; file: () => Promise<File>; release: () => Promise<void> };

async function openStagedShare(name: string, type: string): Promise<BufferedFile | null> {
  const staged = await stage();
  if (!staged) return null;
  let closed = false;
  return {
    sink: {
      async write(chunk) {
        await staged.writable.write(toBuffer(chunk));
      },
      async finish() {
        await staged.writable.close();
        closed = true;
        return "downloadStarted";
      },
      async abort() {
        await staged.writable.abort().catch(() => undefined);
        closed = true;
      },
    },
    async file() {
      return new File([await staged.handle.getFile()], name, fileOptions(type));
    },
    async release() {
      if (!closed) await staged.writable.abort().catch(() => undefined);
      await staged.directory.removeEntry(staged.stagingName).catch(() => undefined);
    },
  };
}

function memoryShare(name: string, type: string): BufferedFile {
  let chunks: Uint8Array[] = [];
  return {
    sink: {
      async write(chunk) {
        chunks.push(chunk.slice());
      },
      async finish() {
        return "downloadStarted";
      },
      async abort() {
        for (const chunk of chunks) chunk.fill(0);
        chunks = [];
      },
    },
    async file() {
      return new File(
        chunks.map((chunk) => toBuffer(chunk) as BlobPart),
        name,
        fileOptions(type),
      );
    },
    async release() {
      for (const chunk of chunks) chunk.fill(0);
      chunks = [];
    },
  };
}

async function freeNameIn(
  directory: FileSystemDirectoryHandle,
  name: string,
  used: ReadonlySet<string>,
): Promise<string> {
  let candidate = disambiguateFileName(name, used);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const taken = await directory
      .getFileHandle(candidate, { create: false })
      .then(() => true)
      .catch(() => false);
    if (!taken) return candidate;
    candidate = disambiguateFileName(candidate, new Set([...used, candidate]));
  }
  return candidate;
}

function fileOptions(type: string): FilePropertyBag {
  const mediaType = safeMediaType(type);
  return mediaType ? { type: mediaType } : {};
}

function startDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
}

function toBuffer(chunk: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy.buffer;
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "NotAllowedError")
  );
}
