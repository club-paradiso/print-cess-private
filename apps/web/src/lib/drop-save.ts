import { disambiguateFileName, safeFileName, safeMediaType } from "./drop-file-name";

/**
 * Where a received file actually goes, and what the screen is then allowed to
 * claim about it.
 *
 * The distinction this module exists to preserve is between a file the browser
 * confirmed it wrote and a file the browser merely accepted responsibility for.
 * Writing through a handle the visitor picked ends with a closed file at a
 * known path, and "Saved" is true. Handing a blob to the download machinery
 * ends with a request the browser may still route to a dialog, a different
 * folder, or nowhere at all, and the honest claim is that a download started.
 * Collapsing the two was the single largest correctness defect on this screen.
 */

/** What a completed save is allowed to say about itself. */
export type SaveOutcome = "saved" | "downloadStarted";

export type SaveCapabilities = {
  /** A user-visible save dialog that returns a writable handle. */
  canPickFile: boolean;
  /** A user-chosen folder that many files can be streamed into. */
  canPickDirectory: boolean;
  /** Private origin storage, which keeps a large file off the JavaScript heap. */
  canStage: boolean;
  /** A system share sheet that accepts files, not just links. */
  canShareFiles: boolean;
};

/**
 * Above this, assembling a file in JavaScript memory is a gamble with the
 * visitor's tab rather than a fallback. Both a chunk list and the blob built
 * from it are live at the moment of assembly, so the real cost approaches twice
 * the file size.
 */
export const MEMORY_SAVE_LIMIT_BYTES = 512 * 1024 * 1024;
/** Large enough to be worth warning about before a long download begins. */
export const MEMORY_WARNING_BYTES = 128 * 1024 * 1024;
/** How long a saved file's object URL stays alive for the browser to fetch it. */
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
    // Feature detection, never user-agent sniffing: Safari exposes neither
    // picker, Firefox exposes neither, and Chromium exposes both — but only in
    // a secure top-level context, which is exactly what these checks measure.
    canPickFile: typeof picker.showSaveFilePicker === "function",
    canPickDirectory: typeof picker.showDirectoryPicker === "function",
    canStage: typeof navigator.storage?.getDirectory === "function",
    canShareFiles:
      typeof navigator.canShare === "function" && typeof navigator.share === "function",
  };
}

/** True when a large transfer can be received without buffering it in memory. */
export function supportsStreamingSave(): boolean {
  const capabilities = saveCapabilities();
  return capabilities.canStage || capabilities.canPickFile || capabilities.canPickDirectory;
}

/**
 * Whether this browser could put a received file into another app. The probe
 * uses a one-byte file because `canShare` inspects the type of what it is
 * given, and asking with an empty list answers a different question.
 */
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
  /** Completes the save and reports only what the browser actually confirmed. */
  finish(): Promise<SaveOutcome>;
  abort(): Promise<void>;
};

export type SaveTargetKind = "picked-file" | "picked-directory" | "download";

/**
 * A destination chosen once, during the tap that asked for it, and then used
 * for one or many files. Permission has to be obtained inside the user
 * activation: by the time a multi-gigabyte download finishes, the activation
 * that would have allowed a picker to open is long gone.
 */
export type SaveTarget = {
  kind: SaveTargetKind;
  /** What `finish()` will be entitled to claim for files written here. */
  outcome: SaveOutcome;
  open(file: { name: string; type: string }): Promise<FileSink>;
};

/**
 * The default is a regular browser download, including on desktop Chromium.
 * A writable file picker exposes stronger file-system permissions and triggers
 * Chromium's "this site can see edits" warning. Only explicit opt-in flows may
 * request that picker, synchronously from the user's click handler.
 */
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

/**
 * Opens a folder the visitor chose, so several files land in one known place
 * instead of arriving as a burst of downloads. Must be called from the tap.
 */
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

  // Names already used in this folder during this visit. Reading the whole
  // directory would need read permission over files the visitor did not offer,
  // so conflicts are resolved against what this session wrote plus whatever
  // `create: false` reveals about a name it is about to take.
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

/**
 * The fallback every browser has: assemble the file somewhere sensible, then
 * hand it to the download machinery. It reports `downloadStarted` because that
 * is the last thing it can actually observe.
 */
export function downloadTarget(size: number, capabilities = saveCapabilities()): SaveTarget {
  if (!capabilities.canStage && size > MEMORY_SAVE_LIMIT_BYTES) {
    // Better to refuse in one second than to crash the tab in four minutes.
    throw new SaveError("dropTooLargeForBrowser");
  }
  return {
    kind: "download",
    outcome: "downloadStarted",
    async open(entry) {
      const name = safeFileName(entry.name);
      const type = safeMediaType(entry.type);
      const staged = capabilities.canStage ? await openStagedSink(name, type) : null;
      // Feature detection is not permission: managed browsers may expose OPFS
      // while denying access when we actually open it. Never route a large file
      // into heap buffering after that failure.
      if (!staged && size > MEMORY_SAVE_LIMIT_BYTES) {
        throw new SaveError("dropTooLargeForBrowser");
      }
      return staged ?? memorySink(name, type);
    },
  };
}

/**
 * Materializes a received file and offers it to the system share sheet. The
 * file is staged on disk wherever possible, so putting a large video into
 * another app does not first copy it through the JavaScript heap.
 */
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
    // Dismissing the sheet is an ordinary outcome, not a failure to report.
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
    // A dismissed dialog means the visitor changed their mind, which is a
    // decision to respect rather than a failure to route around.
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

/**
 * Offering the file's own type keeps the dialog from proposing a different
 * extension. A type the browser refuses would reject the whole call, so an
 * unrecognized one is simply left out.
 */
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
      // The file is only saved once the stream closes; a failure here is a
      // failed save, not a save with a warning.
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
    // A unique staging name keeps two simultaneous downloads of the same file
    // name from writing over each other.
    const stagingName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = await directory.getFileHandle(stagingName, { create: true });
    if (typeof handle.createWritable !== "function") return null;
    const writable = await handle.createWritable();
    return { directory, handle, writable, stagingName };
  } catch {
    // Private browsing modes and locked-down origins can refuse storage.
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
      startDownload(new File([assembled], name, downloadOptions(type)), name);
      // Staging has served its purpose once the browser has had time to read
      // the object URL; decrypted bytes are not kept a moment longer.
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
      // The chunk is zeroed by the caller after this returns, so keep a copy.
      chunks.push(chunk.slice());
    },
    async finish() {
      const parts = chunks.map((chunk) => toBuffer(chunk) as BlobPart);
      chunks = [];
      startDownload(new File(parts, name, downloadOptions(type)), name);
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
      // Backed by the staged file on disk rather than a copy in the heap.
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

/**
 * Finds a name nothing in the chosen folder is already using. `create: false`
 * throws for a free name, which is the only way to ask without taking it.
 */
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

/** A blank media type must be omitted, not passed through as an empty string. */
function fileOptions(type: string): FilePropertyBag {
  const mediaType = safeMediaType(type);
  return mediaType ? { type: mediaType } : {};
}

/**
 * The sender chooses the declared type. A browser that opens a download instead
 * of saving it would run a same-origin `blob:` page for markup or script, so
 * those types are handed over as opaque bytes; the file name keeps its
 * extension either way.
 */
function downloadOptions(type: string): FilePropertyBag {
  const options = fileOptions(type);
  return options.type && ACTIVE_CONTENT_TYPE.test(options.type)
    ? { type: "application/octet-stream" }
    : options;
}

const ACTIVE_CONTENT_TYPE =
  /^(?:text\/(?:html|xml|javascript|ecmascript)|image\/svg\+xml|application\/(?:[a-z0-9.+-]*\+)?xml|application\/(?:x-)?(?:javascript|ecmascript))$/iu;

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
